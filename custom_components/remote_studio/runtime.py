"""Event runtime for Remote Studio.

Listens for remote events from each supported integration and, on a match,
runs the user-configured action list via Home Assistant's Script helper.

Currently supported integrations:
  * ZHA — direct subscription to the ``zha_event`` bus event.
  * Zigbee2MQTT — MQTT subscription to ``zigbee2mqtt/<friendly_name>``;
    the friendly name is resolved to a HA device_id via the device registry.
  * Matter — placeholder; Matter exposes button presses as event entities,
    each with their own attribute updates. v2 work.

Every match also dispatches ``remote_studio:remote_event`` via HA's
dispatcher so the WebSocket API can forward live events to the panel.
"""

from __future__ import annotations

import json
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
from .registry import DefinitionRegistry, RemoteDefinition, async_get_registry
from .storage import MappingStore, async_get_store

_LOGGER = logging.getLogger(__name__)

ZHA_EVENT = "zha_event"
SIGNAL_REMOTE_EVENT = f"{DOMAIN}:remote_event"
Z2M_TOPIC = "zigbee2mqtt/+"


def _matter_endpoint_from_unique_id(unique_id: str | None) -> int | None:
    """Pull the endpoint number out of a matter entity's unique_id.

    The matter integration formats unique_ids as
    `<bridge>-<node>-MatterNodeDevice-<endpoint>-<cluster>-…`. The
    endpoint sits at index 3 when split on `-`. Returns None if the
    layout doesn't look right (defensive — older HA may differ).
    """
    if not unique_id:
        return None
    parts = unique_id.split("-")
    if len(parts) < 4:
        return None
    try:
        return int(parts[3])
    except (ValueError, TypeError):
        return None


def resolve_actions(
    definition: RemoteDefinition,
    store: MappingStore,
    device_id: str,
    button_id: str,
    state_id: str,
) -> list[dict[str, Any]]:
    """Decide which action list a (button, state) should fire.

    Resolution order:
      1. user override (Advanced editor) — wins if present.
      2. role-based default — built from the group's target + dim_step.
      3. nothing — returns [].
    """
    override = store.override(device_id, button_id, state_id)
    if override:
        return override
    role = definition.role_for(button_id, state_id)
    if role == "none":
        return []
    group = store.group(device_id, definition.group_for(button_id))
    target = group.target
    if not target:
        return []
    dim_step = group.dim_step

    if role == "turn_on":
        return [{"service": "homeassistant.turn_on", "target": target}]
    if role == "turn_off":
        return [{"service": "homeassistant.turn_off", "target": target}]
    if role == "toggle":
        return [{"service": "homeassistant.toggle", "target": target}]
    if role == "dim_up":
        return [
            {
                "service": "light.turn_on",
                "target": target,
                "data": {"brightness_step_pct": dim_step, "transition": 0.3},
            }
        ]
    if role == "dim_down":
        return [
            {
                "service": "light.turn_on",
                "target": target,
                "data": {"brightness_step_pct": -dim_step, "transition": 0.3},
            }
        ]
    if role == "scene":
        # Group's scene brightness, in the user's chosen colour if any
        # (no colour by default). Lights without colour support drop the
        # rgb_color key — HA logs a warning but applies the brightness.
        data: dict[str, Any] = {
            "brightness_pct": group.scene_brightness,
            "transition": 0.5,
        }
        if group.scene_color is not None:
            data["rgb_color"] = list(group.scene_color)
        return [
            {
                "service": "light.turn_on",
                "target": target,
                "data": data,
            }
        ]
    return []


class EventRuntime:
    """Owns event subscriptions and dispatches matched actions."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._unsubs: list[Callable[[], None]] = []
        self._store: MappingStore | None = None
        self._registry: DefinitionRegistry | None = None
        self._z2m_name_cache: dict[str, str] = {}
        # entity_id -> (device_id, endpoint_index)
        self._matter_entity_index: dict[str, tuple[str, int]] = {}
        # entity_id -> device_id (Xiaomi BLE has no endpoint indexing)
        self._xiaomi_ble_entity_index: dict[str, str] = {}
        # entity_id -> (device_id, endpoint_index) for Matter
        # current_switch_position sensors. Same numbering as event entities.
        self._matter_position_index: dict[str, tuple[str, int]] = {}
        # Tracked separately from _unsubs so we can tear down + rebuild
        # this single subscription when entities get enabled/disabled at
        # runtime (the rest of _unsubs only matters at shutdown).
        self._mp_unsub: Callable[[], None] | None = None

    async def async_start(self) -> None:
        self._store = await async_get_store(self._hass)
        self._registry = await async_get_registry(self._hass)
        self._unsubs.append(
            self._hass.bus.async_listen(ZHA_EVENT, self._handle_zha_event)
        )
        await self._setup_mqtt()
        self._setup_matter()
        self._setup_matter_position()
        self._setup_xiaomi_ble()

    async def async_stop(self) -> None:
        for unsub in self._unsubs:
            try:
                unsub()
            except Exception:  # noqa: BLE001
                _LOGGER.debug("Error while unsubscribing", exc_info=True)
        self._unsubs.clear()

    # ---------------------------------------------------------------- ZHA
    @callback
    def _handle_zha_event(self, event: Event) -> None:
        data = event.data
        device_id = data.get("device_id")
        command = data.get("command")
        if not device_id or not command:
            return
        args = data.get("args") if isinstance(data.get("args"), dict) else {}
        for definition in self._defs_for_device(device_id):
            match = definition.match("zha", {"command": command, "args": args})
            if match is not None:
                button_id, state_id = match
                self._dispatch(definition, device_id, button_id, state_id)
                return

    # ---------------------------------------------------------------- Z2M
    async def _setup_mqtt(self) -> None:
        try:
            from homeassistant.components import mqtt
        except ImportError:
            return
        if not self._hass.config_entries.async_entries("mqtt"):
            _LOGGER.debug("MQTT not configured; skipping Z2M subscription")
            return
        try:
            unsub = await mqtt.async_subscribe(
                self._hass, Z2M_TOPIC, self._handle_z2m_message
            )
        except Exception as err:  # noqa: BLE001 — depends on user MQTT health
            _LOGGER.debug("MQTT subscribe failed: %s", err)
            return
        self._unsubs.append(unsub)

    @callback
    def _handle_z2m_message(self, msg: Any) -> None:
        topic: str = getattr(msg, "topic", "")
        parts = topic.split("/", 2)
        if len(parts) < 2:
            return
        friendly_name = parts[1]
        if len(parts) > 2:
            return  # ignore subtopics like .../availability or .../set
        try:
            payload = (
                json.loads(msg.payload) if isinstance(msg.payload, str) else msg.payload
            )
        except (TypeError, ValueError):
            return
        if not isinstance(payload, dict):
            return
        action = payload.get("action")
        if not action:
            return
        device_id = self._z2m_device_id(friendly_name)
        if not device_id:
            return
        for definition in self._defs_for_device(device_id):
            match = definition.match("z2m", {"action": action})
            if match is not None:
                button_id, state_id = match
                self._dispatch(definition, device_id, button_id, state_id)
                return

    def _z2m_device_id(self, friendly_name: str) -> str | None:
        cached = self._z2m_name_cache.get(friendly_name)
        if cached is not None:
            # Verify the cached id still exists, otherwise refresh.
            if dr.async_get(self._hass).async_get(cached) is not None:
                return cached
            self._z2m_name_cache.pop(friendly_name, None)
        registry = dr.async_get(self._hass)
        for device in registry.devices.values():
            if device.name_by_user == friendly_name or device.name == friendly_name:
                self._z2m_name_cache[friendly_name] = device.id
                return device.id
        return None

    # -------------------------------------------------------------- Matter
    def _setup_matter(self) -> None:
        """Discover Matter event entities for matched devices and subscribe.

        Matter exposes one ``event`` entity per physical button (one per
        endpoint). HA materialises the Matter SwitchClusterEvents as state
        changes on these entities; the latest event_type lives in
        ``new_state.attributes['event_type']``.

        Endpoint comes from the unique_id (`<…>-MatterNodeDevice-<n>-…`)
        so the same number lines up with the matter_position sensors.
        """
        if self._registry is None:
            return
        device_reg = dr.async_get(self._hass)
        entity_reg = er.async_get(self._hass)
        watched: list[str] = []

        for device in device_reg.devices.values():
            defs = self._registry.find_for_device(device.manufacturer, device.model)
            if not defs or not any(d.has_matter for d in defs):
                continue
            for entry in er.async_entries_for_device(
                entity_reg, device.id, include_disabled_entities=False
            ):
                if entry.domain != "event" or entry.platform != "matter":
                    continue
                endpoint = _matter_endpoint_from_unique_id(entry.unique_id)
                if endpoint is None:
                    continue
                self._matter_entity_index[entry.entity_id] = (device.id, endpoint)
                watched.append(entry.entity_id)

        if not watched:
            return
        unsub = async_track_state_change_event(
            self._hass, watched, self._handle_matter_state_change
        )
        self._unsubs.append(unsub)

    @callback
    def _handle_matter_state_change(self, event: Event) -> None:
        new_state = event.data.get("new_state")
        old_state = event.data.get("old_state")
        if new_state is None:
            return
        # Skip the initial "no state" announcement on startup.
        if old_state is None:
            return
        entity_id = new_state.entity_id
        attrs = dict(new_state.attributes or {})
        event_type = attrs.get("event_type")
        if not event_type:
            return
        meta = self._matter_entity_index.get(entity_id)
        if meta is None:
            return
        device_id, endpoint = meta
        if self._registry is None:
            return
        device = dr.async_get(self._hass).async_get(device_id)
        if device is None:
            return
        for definition in self._registry.find_for_device(
            device.manufacturer, device.model
        ):
            match = definition.match(
                "matter",
                {"endpoint": endpoint, "event_type": event_type, "attributes": attrs},
            )
            if match is not None:
                button_id, state_id = match
                self._dispatch(definition, device_id, button_id, state_id)
                return

    # ------------------------------------------------- Matter position sensors
    def _setup_matter_position(self) -> None:
        """Subscribe to Matter `current_switch_position` sensors.

        These sensors flip 0 → 1 on physical actuation and 1 → 0 on
        release without HA's matter event-entity debounce, so any
        layout that wants snappy rotation / press detection points its
        states at this source.

        Endpoint numbering matches the matter event entities — sort
        the device's matter sensor entries by unique_id and assign
        1-based indices in that order.

        Idempotent: tears down the previous subscription and rebuilds
        the index, so it can be called again when entities are enabled
        at runtime via the panel's "Enable N sensors" button.
        """
        if self._mp_unsub is not None:
            try:
                self._mp_unsub()
            except Exception:  # noqa: BLE001
                _LOGGER.debug(
                    "matter_position unsub raised on resync", exc_info=True
                )
            self._mp_unsub = None
        self._matter_position_index.clear()

        if self._registry is None:
            return
        device_reg = dr.async_get(self._hass)
        entity_reg = er.async_get(self._hass)
        watched: list[str] = []

        for device in device_reg.devices.values():
            defs = self._registry.find_for_device(device.manufacturer, device.model)
            if not defs or not any(d.has_matter_position for d in defs):
                continue
            # Matter unique_ids embed the endpoint at index 3 — e.g.
            # `<bridge>-<node>-MatterNodeDevice-1-GenericSwitch-59-1`.
            # Parse it directly so the position-sensor index uses the
            # same numbering as the YAML's matter `endpoint:` fields.
            for entry in er.async_entries_for_device(
                entity_reg, device.id, include_disabled_entities=False
            ):
                if (
                    entry.domain != "sensor"
                    or entry.platform != "matter"
                    or "current_switch_position" not in (entry.entity_id or "")
                ):
                    continue
                endpoint = _matter_endpoint_from_unique_id(entry.unique_id)
                if endpoint is None:
                    continue
                self._matter_position_index[entry.entity_id] = (
                    device.id,
                    endpoint,
                )
                watched.append(entry.entity_id)

        if not watched:
            return
        self._mp_unsub = async_track_state_change_event(
            self._hass, watched, self._handle_matter_position_change
        )

    def resync_matter_position(self) -> None:
        """Public hook used by the WS API after enabling entities."""
        self._setup_matter_position()

    @callback
    def _handle_matter_position_change(self, event: Event) -> None:
        new_state = event.data.get("new_state")
        old_state = event.data.get("old_state")
        if new_state is None or old_state is None:
            return
        new = (new_state.state or "").strip()
        old = (old_state.state or "").strip()
        if new in ("unknown", "unavailable"):
            return
        if old != "1" and new == "1":
            edge = "rising"
        elif old == "1" and new != "1":
            edge = "falling"
        else:
            return
        meta = self._matter_position_index.get(new_state.entity_id)
        if meta is None or self._registry is None:
            return
        device_id, endpoint = meta
        device = dr.async_get(self._hass).async_get(device_id)
        if device is None:
            return
        for definition in self._registry.find_for_device(
            device.manufacturer, device.model
        ):
            match = definition.match(
                "matter_position", {"endpoint": endpoint, "edge": edge}
            )
            if match is not None:
                button_id, state_id = match
                self._dispatch(definition, device_id, button_id, state_id)
                return

    # ----------------------------------------------------------- Xiaomi BLE
    def _setup_xiaomi_ble(self) -> None:
        """Discover xiaomi_ble event entities for matched devices and subscribe.

        The xiaomi_ble integration exposes one ``event`` entity per device
        whose ``event_type`` attribute updates on each gesture (press,
        long_press, rotate_left, rotate_right, rotate_*_pressed).
        """
        if self._registry is None:
            return
        device_reg = dr.async_get(self._hass)
        entity_reg = er.async_get(self._hass)
        watched: list[str] = []

        for device in device_reg.devices.values():
            defs = self._registry.find_for_device(device.manufacturer, device.model)
            if not defs or not any(d.has_xiaomi_ble for d in defs):
                continue
            for entry in er.async_entries_for_device(
                entity_reg, device.id, include_disabled_entities=False
            ):
                if entry.domain != "event" or entry.platform != "xiaomi_ble":
                    continue
                self._xiaomi_ble_entity_index[entry.entity_id] = device.id
                watched.append(entry.entity_id)

        if not watched:
            return
        unsub = async_track_state_change_event(
            self._hass, watched, self._handle_xiaomi_ble_state_change
        )
        self._unsubs.append(unsub)

    @callback
    def _handle_xiaomi_ble_state_change(self, event: Event) -> None:
        new_state = event.data.get("new_state")
        old_state = event.data.get("old_state")
        if new_state is None or old_state is None:
            return
        attrs = dict(new_state.attributes or {})
        event_type = attrs.get("event_type")
        if not event_type:
            return
        device_id = self._xiaomi_ble_entity_index.get(new_state.entity_id)
        if device_id is None or self._registry is None:
            return
        device = dr.async_get(self._hass).async_get(device_id)
        if device is None:
            return
        for definition in self._registry.find_for_device(
            device.manufacturer, device.model
        ):
            match = definition.match(
                "xiaomi_ble", {"event_type": event_type, "attributes": attrs}
            )
            if match is not None:
                button_id, state_id = match
                self._dispatch(definition, device_id, button_id, state_id)
                return

    # ---------------------------------------------------------- dispatch
    def _defs_for_device(self, device_id: str) -> list[RemoteDefinition]:
        device = dr.async_get(self._hass).async_get(device_id)
        if device is None or self._registry is None:
            return []
        return self._registry.find_for_device(device.manufacturer, device.model)

    def _dispatch(
        self,
        definition: RemoteDefinition,
        device_id: str,
        button_id: str,
        state_id: str,
    ) -> None:
        async_dispatcher_send(
            self._hass, SIGNAL_REMOTE_EVENT, device_id, button_id, state_id
        )
        if self._store is None:
            return
        actions = resolve_actions(
            definition, self._store, device_id, button_id, state_id
        )
        if not actions:
            return
        self._hass.async_create_task(
            self._run_actions(device_id, button_id, state_id, actions),
            f"remote_studio_run_{device_id}_{button_id}_{state_id}",
        )

    async def _run_actions(
        self,
        device_id: str,
        button_id: str,
        state_id: str,
        actions: list[dict[str, Any]],
    ) -> None:
        try:
            # Pass through HA's script schema so we end up with the same
            # validated structure HA's automation engine uses — without
            # this, raw service-call dicts trip the engine's
            # 'service_template' fallback at execution time.
            sequence = SCRIPT_SCHEMA(actions)
            script = Script(
                self._hass,
                sequence,
                f"Remote Studio {device_id}/{button_id}/{state_id}",
                DOMAIN,
            )
            await script.async_run(context=Context())
        except Exception:  # noqa: BLE001 — surface any user action failure
            _LOGGER.exception(
                "Action execution failed for %s/%s/%s",
                device_id,
                button_id,
                state_id,
            )


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
