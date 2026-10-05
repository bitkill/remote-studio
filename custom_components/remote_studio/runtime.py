"""Event runtime for Remote Studio.

One *source adapter* per integration turns what HA hands us into a
``core.events.RemoteEvent``; the runtime matches it against the device's
definitions and runs the resolved action list via HA's Script helper.

Adapters (all with ``start(emit)`` / ``stop()`` / ``resync()``):
  * ZHA — ``zha_event`` bus events (device id comes with the event).
  * Zigbee2MQTT — MQTT ``zigbee2mqtt/<friendly_name>``; the friendly name
    is resolved to a device id via the device registry.
  * Matter — ``event`` entities, one per endpoint (debounced by HA).
  * Matter position — ``current_switch_position`` sensors, low latency,
    disabled by default in HA (the panel offers a one-click enable, which
    calls ``resync()``).
  * Xiaomi BLE — ``event`` entities from the xiaomi_ble integration.

Every match also dispatches ``remote_studio:remote_event`` via HA's
dispatcher so the websocket API can forward live events to the panel.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from homeassistant.core import Context, Event, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.config_validation import SCRIPT_SCHEMA
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.script import Script

from .const import DOMAIN
from .core import actions as act, events as ev
from .core.definitions import RemoteDefinition
from .core.events import RemoteEvent
from .registry import DefinitionRegistry, async_get_registry
from .storage import MappingStore, async_get_store

_LOGGER = logging.getLogger(__name__)

SIGNAL_REMOTE_EVENT = f"{DOMAIN}:remote_event"

Emit = Callable[[RemoteEvent], None]
DefsForDevice = Callable[[str], list[RemoteDefinition]]


# ================================================================== adapters
class SourceAdapter:
    """Base for one integration's subscription. Subclasses override the hooks."""

    source: str = ""

    def __init__(self, hass: HomeAssistant, defs_for_device: DefsForDevice) -> None:
        self._hass = hass
        self._defs_for_device = defs_for_device
        self._emit: Emit | None = None
        self._unsub: Callable[[], None] | None = None

    async def start(self, emit: Emit) -> None:
        self._emit = emit
        await self._subscribe()

    def stop(self) -> None:
        if self._unsub is not None:
            try:
                self._unsub()
            except Exception:  # noqa: BLE001
                _LOGGER.debug("%s: unsubscribe raised", self.source, exc_info=True)
            self._unsub = None

    def resync(self) -> None:
        """Re-discover and re-subscribe. No-op for adapters without discovery."""

    async def _subscribe(self) -> None:
        raise NotImplementedError

    def _fire(self, event: RemoteEvent) -> None:
        if self._emit is not None:
            self._emit(event)


class ZhaAdapter(SourceAdapter):
    source = "zha"

    async def _subscribe(self) -> None:
        self._unsub = self._hass.bus.async_listen("zha_event", self._on_event)

    @callback
    def _on_event(self, event: Event) -> None:
        decoded = ev.decode_zha(event.data)
        if decoded is not None:
            self._fire(decoded)


class Z2mAdapter(SourceAdapter):
    source = "z2m"
    TOPIC = "zigbee2mqtt/+"

    def __init__(self, hass: HomeAssistant, defs_for_device: DefsForDevice) -> None:
        super().__init__(hass, defs_for_device)
        self._name_cache: dict[str, str] = {}

    async def _subscribe(self) -> None:
        try:
            from homeassistant.components import mqtt
        except ImportError:
            return
        if not self._hass.config_entries.async_entries("mqtt"):
            _LOGGER.debug("MQTT not configured; skipping Z2M subscription")
            return
        try:
            self._unsub = await mqtt.async_subscribe(self._hass, self.TOPIC, self._on_message)
        except Exception as err:  # noqa: BLE001 — depends on user MQTT health
            _LOGGER.debug("MQTT subscribe failed: %s", err)

    @callback
    def _on_message(self, msg: Any) -> None:
        decoded = ev.decode_z2m(getattr(msg, "topic", ""), getattr(msg, "payload", None))
        if decoded is None:
            return
        friendly_name, action = decoded
        device_id = self._device_id(friendly_name)
        if device_id:
            self._fire(RemoteEvent(device_id, "z2m", {"action": action}))

    def _device_id(self, friendly_name: str) -> str | None:
        registry = dr.async_get(self._hass)
        cached = self._name_cache.get(friendly_name)
        if cached is not None:
            if registry.async_get(cached) is not None:
                return cached
            self._name_cache.pop(friendly_name, None)
        for device in registry.devices.values():
            if device.name_by_user == friendly_name or device.name == friendly_name:
                self._name_cache[friendly_name] = device.id
                return device.id
        return None


class EntityStateAdapter(SourceAdapter):
    """Sources that surface as HA entities whose state changes carry the gesture.

    Discovery: every device with a definition that uses this source has
    its matching entities indexed (entity_id → (device_id, endpoint)) and
    a single state-change subscription covers them all. ``resync()``
    rebuilds that index, e.g. after the panel enables disabled entities.
    """

    domain: str = "event"
    platform: str = ""

    def __init__(self, hass: HomeAssistant, defs_for_device: DefsForDevice) -> None:
        super().__init__(hass, defs_for_device)
        self._index: dict[str, tuple[str, int]] = {}

    def resync(self) -> None:
        self.stop()
        self._hass.async_create_task(self._subscribe(), f"remote_studio_resync_{self.source}")

    async def _subscribe(self) -> None:
        self._index.clear()
        device_reg = dr.async_get(self._hass)
        entity_reg = er.async_get(self._hass)
        for device in device_reg.devices.values():
            if not any(self.source in d.sources for d in self._defs_for_device(device.id)):
                continue
            for entry in er.async_entries_for_device(
                entity_reg, device.id, include_disabled_entities=False
            ):
                if entry.domain != self.domain or entry.platform != self.platform:
                    continue
                endpoint = self._endpoint_for(entry)
                if endpoint is None:
                    continue
                self._index[entry.entity_id] = (device.id, endpoint)
        if self._index:
            self._unsub = async_track_state_change_event(
                self._hass, list(self._index), self._on_state_change
            )

    def _endpoint_for(self, entry: er.RegistryEntry) -> int | None:
        """Endpoint for this entity, or None to skip it. Default: no endpoints."""
        return 0

    def _decode(self, old_state: Any, new_state: Any, endpoint: int) -> dict[str, Any] | None:
        raise NotImplementedError

    @callback
    def _on_state_change(self, event: Event) -> None:
        new_state = event.data.get("new_state")
        old_state = event.data.get("old_state")
        # old_state None is HA's initial announcement on startup, not a press.
        if new_state is None or old_state is None:
            return
        meta = self._index.get(new_state.entity_id)
        if meta is None:
            return
        device_id, endpoint = meta
        payload = self._decode(old_state, new_state, endpoint)
        if payload is not None:
            self._fire(RemoteEvent(device_id, self.source, payload))


class MatterEventAdapter(EntityStateAdapter):
    source = "matter"
    domain = "event"
    platform = "matter"

    def _endpoint_for(self, entry: er.RegistryEntry) -> int | None:
        return ev.matter_endpoint_from_unique_id(entry.unique_id)

    def _decode(self, old_state: Any, new_state: Any, endpoint: int) -> dict[str, Any] | None:
        payload = ev.decode_event_entity(new_state.attributes)
        if payload is not None:
            payload["endpoint"] = endpoint
        return payload


class MatterPositionAdapter(EntityStateAdapter):
    source = "matter_position"
    domain = "sensor"
    platform = "matter"

    def _endpoint_for(self, entry: er.RegistryEntry) -> int | None:
        if "current_switch_position" not in (entry.entity_id or ""):
            return None
        return ev.matter_endpoint_from_unique_id(entry.unique_id)

    def _decode(self, old_state: Any, new_state: Any, endpoint: int) -> dict[str, Any] | None:
        edge = ev.decode_position_edge(old_state.state, new_state.state)
        if edge is None:
            return None
        return {"endpoint": endpoint, "edge": edge}


class XiaomiBleAdapter(EntityStateAdapter):
    source = "xiaomi_ble"
    domain = "event"
    platform = "xiaomi_ble"

    def _decode(self, old_state: Any, new_state: Any, endpoint: int) -> dict[str, Any] | None:
        return ev.decode_event_entity(new_state.attributes)


ADAPTERS: tuple[type[SourceAdapter], ...] = (
    ZhaAdapter,
    Z2mAdapter,
    MatterEventAdapter,
    MatterPositionAdapter,
    XiaomiBleAdapter,
)


# ================================================================== executor
class ActionError(Exception):
    """An action list failed validation or execution."""


class ActionRunner:
    """Runs action lists through HA's Script helper. The one place that
    knows about SCRIPT_SCHEMA and Script; raises ActionError on failure."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    async def run(self, steps: list[dict[str, Any]], name: str, context: Context) -> None:
        try:
            # SCRIPT_SCHEMA normalises raw service-call dicts into the
            # structure Script expects; without it the engine trips its
            # 'service_template' fallback at execution time.
            sequence = SCRIPT_SCHEMA(steps)
            script = Script(self._hass, sequence, f"Remote Studio {name}", DOMAIN)
            await script.async_run(context=context)
        except Exception as err:  # noqa: BLE001 — any user action failure
            raise ActionError(str(err)) from err


# =================================================================== runtime
class EventRuntime:
    """Owns the source adapters and dispatches matched events to actions."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._store: MappingStore | None = None
        self._registry: DefinitionRegistry | None = None
        self.runner = ActionRunner(hass)
        self._adapters: list[SourceAdapter] = [
            cls(hass, self.definitions_for) for cls in ADAPTERS
        ]

    async def async_start(self) -> None:
        self._store = await async_get_store(self._hass)
        self._registry = await async_get_registry(self._hass)
        for adapter in self._adapters:
            await adapter.start(self._on_event)

    async def async_stop(self) -> None:
        for adapter in self._adapters:
            adapter.stop()

    def resync(self) -> None:
        """Re-run entity discovery on every adapter (after enabling entities)."""
        for adapter in self._adapters:
            adapter.resync()

    # ------------------------------------------------------------- lookup
    def definitions_for(self, device_id: str) -> list[RemoteDefinition]:
        """Candidate definitions for a device: the user's pairing first,
        then auto-matches by manufacturer/model. The one lookup shared by
        event matching, test mode and the device view."""
        if self._registry is None:
            return []
        device = dr.async_get(self._hass).async_get(device_id)
        if device is None:
            return []
        out: list[RemoteDefinition] = []
        paired_id = self._store.pairing(device_id) if self._store else None
        paired = self._registry.get(paired_id) if paired_id else None
        if paired is not None:
            out.append(paired)
        for d in self._registry.find_for_device(device.manufacturer, device.model):
            if d is not paired:
                out.append(d)
        return out

    # ------------------------------------------------------------ actions
    def resolve(
        self, definition: RemoteDefinition, device_id: str, button_id: str, state_id: str
    ) -> list[dict[str, Any]]:
        """Action list for a (button, state): override, else role default."""
        if self._store is None:
            return []
        return act.resolve(
            definition,
            button_id,
            state_id,
            self._store.group(device_id, definition.group_for(button_id)),
            self._store.override(device_id, button_id, state_id),
        )

    # ----------------------------------------------------------- dispatch
    @callback
    def _on_event(self, event: RemoteEvent) -> None:
        matched = ev.match_event(event, self.definitions_for(event.device_id))
        if matched is None:
            return
        definition, button_id, state_id = matched
        async_dispatcher_send(
            self._hass, SIGNAL_REMOTE_EVENT, event.device_id, button_id, state_id
        )
        steps = self.resolve(definition, event.device_id, button_id, state_id)
        if not steps:
            return
        name = f"{event.device_id}/{button_id}/{state_id}"
        self._hass.async_create_task(
            self._run_logged(steps, name),
            f"remote_studio_run_{event.device_id}_{button_id}_{state_id}",
        )

    async def _run_logged(self, steps: list[dict[str, Any]], name: str) -> None:
        try:
            await self.runner.run(steps, name, Context())
        except ActionError as err:
            _LOGGER.error("Action execution failed for %s: %s", name, err)


async def async_get_runtime(hass: HomeAssistant) -> EventRuntime:
    """Return the started singleton EventRuntime."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    runtime = domain_data.get("runtime")
    if runtime is None:
        runtime = EventRuntime(hass)
        await runtime.async_start()
        domain_data["runtime"] = runtime
    return runtime


async def async_stop_runtime(hass: HomeAssistant) -> None:
    """Stop and dispose the runtime singleton if it exists."""
    runtime: EventRuntime | None = hass.data.get(DOMAIN, {}).pop("runtime", None)
    if runtime is not None:
        await runtime.async_stop()
