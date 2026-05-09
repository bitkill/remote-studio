"""WebSocket API for the Remote Studio panel."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import Context, HomeAssistant, callback
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.config_validation import SCRIPT_SCHEMA
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.script import Script
from homeassistant.loader import async_get_integration

from .const import DOMAIN
from .registry import RemoteDefinition, async_get_registry
from .runtime import SIGNAL_REMOTE_EVENT, resolve_actions
from .storage import async_get_store


async def async_register(hass: HomeAssistant) -> None:
    """Register all WebSocket commands."""
    websocket_api.async_register_command(hass, ws_list_remotes)
    websocket_api.async_register_command(hass, ws_get_remote)
    websocket_api.async_register_command(hass, ws_set_group)
    websocket_api.async_register_command(hass, ws_set_override)
    websocket_api.async_register_command(hass, ws_test_action)
    websocket_api.async_register_command(hass, ws_trigger_button)
    websocket_api.async_register_command(hass, ws_subscribe_events)
    websocket_api.async_register_command(hass, ws_enable_entities)


def _serialise_definition(definition: RemoteDefinition) -> dict[str, Any]:
    return {
        "id": definition.id,
        "name": definition.name,
        "manufacturer": definition.manufacturer,
        "models": list(definition.models),
        "battery": definition.battery,
        "groups": definition.groups(),
        "buttons": [
            {
                "id": btn.id,
                "label": btn.label,
                "group": btn.group,
                "states": [
                    {"id": s.id, "label": s.label, "role": s.role}
                    for s in btn.states
                ],
            }
            for btn in definition.buttons
        ],
    }


def _ws_context(connection: websocket_api.ActiveConnection) -> Context:
    user_id = connection.user.id if connection.user else None
    return Context(user_id=user_id)


# Priority for picking a "primary" integration when a device is registered
# with several. Matter/ZHA win over generic MQTT.
_INTEGRATION_PRIORITY = (
    "matter",
    "zha",
    "zigbee2mqtt",
    "zigbee",
    # xiaomi_ble must outrank the generic `bluetooth` identifier so a
    # device that the integration owns is labelled as such, not just
    # "Bluetooth".
    "xiaomi_ble",
    "bluetooth",
    "mqtt",
)


def _device_integration(device) -> str | None:
    """Return the integration domain we'd label this device with."""
    domains = {ident[0] for ident in (device.identifiers or set())}
    for domain in _INTEGRATION_PRIORITY:
        if domain in domains:
            return domain
    return next(iter(sorted(domains)), None) if domains else None


def _device_area(hass: HomeAssistant, device) -> dict[str, str] | None:
    """Return {id, name} for the device's HA area, or None."""
    if not device.area_id:
        return None
    area = ar.async_get(hass).async_get_area(device.area_id)
    if area is None:
        return None
    return {"id": area.id, "name": area.name}


def _automations_for_device(
    hass: HomeAssistant, device_id: str
) -> list[dict[str, Any]]:
    """Return automations whose triggers fire from the given device.

    A warning is surfaced in the device view so the user knows that any
    action they wire here will run alongside an existing automation —
    common cause of "the light flips twice on a press" bugs.

    Match heuristics (any one is enough):
      • device-trigger with our `device_id`
      • event-trigger whose `event_data.device_id` is ours (e.g. zha_event)
      • state-trigger on an entity that belongs to the device (Matter
        event entities, Z2M action sensors, …)
      • blueprint automation that takes our `device_id` as an input value
    """
    # Avoid the import at module top — `automation` is not in our
    # `dependencies`, so it might not be loaded if the user removed it.
    component = None
    try:
        # Modern HA (≥ 2024.x) stores the EntityComponent under a HassKey,
        # which doesn't compare equal to the plain string "automation",
        # so we have to use the typed key for the lookup to find it.
        from homeassistant.components.automation import (  # type: ignore[import-not-found]
            DATA_COMPONENT,
        )
        component = hass.data.get(DATA_COMPONENT)
    except ImportError:
        pass
    if component is None:
        try:
            from homeassistant.components.automation import (  # type: ignore[import-not-found]
                DOMAIN as AUTOMATION_DOMAIN,
            )
            component = hass.data.get(AUTOMATION_DOMAIN)
        except ImportError:
            return []
    if component is None:
        return []

    entity_reg = er.async_get(hass)
    device_entity_ids = {
        e.entity_id
        for e in er.async_entries_for_device(
            entity_reg, device_id, include_disabled_entities=False
        )
    }

    matches: list[dict[str, Any]] = []
    for automation in getattr(component, "entities", []):
        config = getattr(automation, "raw_config", None) or {}
        if not isinstance(config, dict):
            continue
        if _automation_uses_device(config, device_id, device_entity_ids):
            matches.append(
                {
                    "entity_id": automation.entity_id,
                    "name": getattr(automation, "name", None) or automation.entity_id,
                    "unique_id": getattr(automation, "unique_id", None),
                }
            )
    return matches


def _automation_uses_device(
    config: dict[str, Any], device_id: str, device_entity_ids: set[str]
) -> bool:
    # Blueprint automations: their inputs include the device id directly.
    blueprint = config.get("use_blueprint")
    if isinstance(blueprint, dict):
        inputs = blueprint.get("input") or {}
        if isinstance(inputs, dict) and device_id in inputs.values():
            return True

    # Standard automations: scan the trigger list.
    triggers = config.get("trigger") or config.get("triggers") or []
    if isinstance(triggers, dict):
        triggers = [triggers]
    if not isinstance(triggers, list):
        return False
    return any(
        _trigger_references_device(t, device_id, device_entity_ids)
        for t in triggers
        if isinstance(t, dict)
    )


def _trigger_references_device(
    trigger: dict[str, Any], device_id: str, device_entity_ids: set[str]
) -> bool:
    platform = trigger.get("platform") or trigger.get("trigger")

    if platform == "device" and trigger.get("device_id") == device_id:
        return True

    if platform == "event":
        event_data = trigger.get("event_data") or {}
        if isinstance(event_data, dict) and event_data.get("device_id") == device_id:
            return True

    if platform == "state":
        entity_id = trigger.get("entity_id")
        entity_ids = entity_id if isinstance(entity_id, list) else [entity_id]
        if any(eid in device_entity_ids for eid in entity_ids):
            return True

    return False


def _disabled_required_entities(
    hass: HomeAssistant, device_id: str, definition
) -> list[dict[str, Any]]:
    """Return entities the layout depends on but HA has disabled.

    Currently the only "required" class is matter `current_switch_position`
    sensors (used by matter_position sources for low-latency rotation /
    press dispatch). The matter integration ships those disabled so we
    surface them in a warning + offer a one-click fix in the panel.
    """
    out: list[dict[str, Any]] = []
    has_mp = getattr(definition, "has_matter_position", False)
    if not has_mp:
        return out
    entity_reg = er.async_get(hass)
    for entry in er.async_entries_for_device(
        entity_reg, device_id, include_disabled_entities=True
    ):
        if (
            entry.domain == "sensor"
            and entry.platform == "matter"
            and "current_switch_position" in (entry.entity_id or "")
            and entry.disabled_by is not None
        ):
            out.append(
                {
                    "entity_id": entry.entity_id,
                    "kind": "matter_position",
                }
            )
    return out


def _entity_targets_for(store, device_id: str) -> list[str]:
    """Return the entity_ids picked across all groups for a device.

    Used by the index list to show what each remote is wired to. Only
    entity-shaped targets are surfaced — area/device targets live behind
    the picker but the list view doesn't try to summarise them yet.
    """
    cfg = store.device(device_id) or {}
    out: list[str] = []
    for group in (cfg.get("groups") or {}).values():
        target = group.get("target") if isinstance(group, dict) else None
        if not isinstance(target, dict):
            continue
        eid = target.get("entity_id")
        if isinstance(eid, list):
            out.extend(str(e) for e in eid if e)
        elif eid:
            out.append(str(eid))
    # Preserve order, drop duplicates.
    seen: set[str] = set()
    deduped: list[str] = []
    for e in out:
        if e in seen:
            continue
        seen.add(e)
        deduped.append(e)
    return deduped


async def _load_svg_cached(
    hass: HomeAssistant, definition: RemoteDefinition
) -> str | None:
    """Read a definition's SVG once and cache it on hass.data."""
    cache = hass.data.setdefault(DOMAIN, {}).setdefault("svg_cache", {})
    if definition.id in cache:
        return cache[definition.id]
    try:
        svg = await hass.async_add_executor_job(
            definition.svg_path.read_text, "utf-8"
        )
    except OSError:
        svg = None
    cache[definition.id] = svg
    return svg


@websocket_api.websocket_command({vol.Required("type"): "remote_studio/list_remotes"})
@websocket_api.async_response
async def ws_list_remotes(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    registry = await async_get_registry(hass)
    store = await async_get_store(hass)
    device_reg = dr.async_get(hass)

    entity_reg = er.async_get(hass)

    remotes: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    known_radio_domains = {"zha", "mqtt", "zigbee", "zigbee2mqtt", "matter"}
    # If a device has any of these entities, it isn't a remote — it's a
    # controllable thing like a bulb, plug, climate, etc.
    DISQUALIFYING_DOMAINS = {
        "light",
        "switch",
        "climate",
        "cover",
        "fan",
        "media_player",
        "vacuum",
        "lock",
        "humidifier",
        "water_heater",
        "siren",
        "valve",
        "alarm_control_panel",
        "camera",
        "lawn_mower",
        "number",
        "select",
    }
    REMOTE_NAME_KEYWORDS = (
        "remote",
        "dimmer",
        "button",
        "controller",
        "wand",
        "fob",
        "switch",  # Aqara/Xiaomi battery-powered "switches" (no switch entity)
    )

    for device in device_reg.devices.values():
        matches = registry.find_for_device(device.manufacturer, device.model)
        if matches:
            chosen = matches[0]
            remotes.append(
                {
                    "device_id": device.id,
                    "device_name": device.name_by_user or device.name,
                    "manufacturer": device.manufacturer,
                    "model": device.model,
                    "definition_id": chosen.id,
                    "integration": _device_integration(device),
                    "area": _device_area(hass, device),
                    "battery": _find_battery(hass, device.id),
                    "targets": _entity_targets_for(store, device.id),
                }
            )
            continue

        if not device.manufacturer:
            continue
        domains = {ident[0] for ident in (device.identifiers or set())}
        if not (domains & known_radio_domains):
            continue

        entries = er.async_entries_for_device(
            entity_reg, device.id, include_disabled_entities=False
        )
        entity_domains = {e.domain for e in entries}
        if entity_domains & DISQUALIFYING_DOMAINS:
            continue

        # Strong signal: a Matter button surfaces as `event` entities.
        is_remote = "event" in entity_domains
        # Weaker signal: battery-powered sensor-only device with a remote-ish
        # name (covers ZHA/Z2M remotes which only register a battery sensor).
        if not is_remote:
            text = " ".join(
                (
                    device.name_by_user or "",
                    device.name or "",
                    device.model or "",
                )
            ).casefold()
            is_remote = any(kw in text for kw in REMOTE_NAME_KEYWORDS)

        if not is_remote:
            continue

        candidates.append(
            {
                "device_id": device.id,
                "device_name": device.name_by_user or device.name,
                "manufacturer": device.manufacturer,
                "model": device.model,
                "integration": _device_integration(device),
                "area": _device_area(hass, device),
            }
        )

    serialised_defs: list[dict[str, Any]] = []
    for d in registry.all():
        s = _serialise_definition(d)
        s["svg"] = await _load_svg_cached(hass, d)
        serialised_defs.append(s)

    integration_meta = await async_get_integration(hass, DOMAIN)

    connection.send_result(
        msg["id"],
        {
            "version": integration_meta.version,
            "remotes": remotes,
            "candidates": candidates,
            "definitions": serialised_defs,
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "remote_studio/get_remote",
        vol.Required("device_id"): str,
        vol.Optional("definition_id"): str,
    }
)
@websocket_api.async_response
async def ws_get_remote(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    device_id = msg["device_id"]
    device_reg = dr.async_get(hass)
    device = device_reg.async_get(device_id)
    if device is None:
        connection.send_error(
            msg["id"], "device_not_found", f"No device {device_id}"
        )
        return

    registry = await async_get_registry(hass)
    definition: RemoteDefinition | None
    if "definition_id" in msg:
        definition = registry.get(msg["definition_id"])
    else:
        candidates = registry.find_for_device(device.manufacturer, device.model)
        definition = candidates[0] if candidates else None

    if definition is None:
        connection.send_error(
            msg["id"], "no_definition", "No matching remote definition"
        )
        return

    store = await async_get_store(hass)
    svg_text = await _load_svg_cached(hass, definition)

    battery = _find_battery(hass, device.id)
    device_cfg = store.device(device_id)

    connection.send_result(
        msg["id"],
        {
            "device": {
                "id": device.id,
                "name": device.name_by_user or device.name,
                "manufacturer": device.manufacturer,
                "model": device.model,
                "integration": _device_integration(device),
                "area": _device_area(hass, device),
            },
            "definition": _serialise_definition(definition),
            "svg": svg_text,
            "groups": device_cfg.get("groups", {}),
            "overrides": device_cfg.get("overrides", {}),
            "battery": battery,
            "automations": _automations_for_device(hass, device_id),
            "health": {
                "disabled_entities": _disabled_required_entities(
                    hass, device_id, definition
                ),
            },
        },
    )


def _find_battery(hass: HomeAssistant, device_id: str) -> dict[str, Any] | None:
    """Return {entity_id, state, unit} for the device's battery sensor, if any.

    Picks the first sensor entity belonging to the device whose state has
    ``device_class == "battery"`` and a numeric state. Skips the battery
    voltage / battery type sensors so we surface the percentage cleanly.
    """
    entity_reg = er.async_get(hass)
    for entry in er.async_entries_for_device(
        entity_reg, device_id, include_disabled_entities=False
    ):
        if entry.domain != "sensor":
            continue
        state = hass.states.get(entry.entity_id)
        if state is None or state.state in ("unknown", "unavailable"):
            continue
        if state.attributes.get("device_class") != "battery":
            continue
        try:
            float(state.state)
        except (TypeError, ValueError):
            continue
        return {
            "entity_id": entry.entity_id,
            "state": state.state,
            "unit": state.attributes.get("unit_of_measurement", "%"),
        }
    return None


@websocket_api.websocket_command(
    {
        vol.Required("type"): "remote_studio/set_group",
        vol.Required("device_id"): str,
        vol.Required("group_id"): str,
        # `target` is a HA target dict ({entity_id|device_id|area_id}) or
        # null to clear. We don't constrain the inner shape — HA's target
        # selector validates on its own when the action runs.
        vol.Optional("target"): vol.Any(None, dict),
        vol.Optional("dim_step"): vol.All(int, vol.Range(min=0, max=100)),
        # rgb tuple [r, g, b], each 0-255. Used by the `scene` role
        # default (long-press → 100% brightness in this colour).
        vol.Optional("scene_color"): vol.All(
            [vol.All(int, vol.Range(min=0, max=255))], vol.Length(min=3, max=3)
        ),
    }
)
@websocket_api.async_response
async def ws_set_group(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    store = await async_get_store(hass)
    await store.async_set_group(
        msg["device_id"],
        msg["group_id"],
        target=msg.get("target"),
        dim_step=msg.get("dim_step"),
        scene_color=msg.get("scene_color"),
    )
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "remote_studio/set_override",
        vol.Required("device_id"): str,
        vol.Required("button_id"): str,
        vol.Required("state_id"): str,
        # Empty list clears the override.
        vol.Required("actions"): list,
    }
)
@websocket_api.async_response
async def ws_set_override(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    store = await async_get_store(hass)
    await store.async_set_override(
        msg["device_id"], msg["button_id"], msg["state_id"], msg["actions"]
    )
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "remote_studio/trigger_button",
        vol.Required("device_id"): str,
        vol.Required("button_id"): str,
        vol.Required("state_id"): str,
    }
)
@websocket_api.async_response
async def ws_trigger_button(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Run the resolved action for a (button, state) — the test-mode path.

    Resolves through the same role+target+override pipeline as a real
    physical event would, so test mode and live presses behave identically.
    """
    registry = await async_get_registry(hass)
    device_reg = dr.async_get(hass)
    device = device_reg.async_get(msg["device_id"])
    if device is None:
        connection.send_error(msg["id"], "device_not_found", "Unknown device")
        return
    candidates = registry.find_for_device(device.manufacturer, device.model)
    if not candidates:
        connection.send_error(msg["id"], "no_definition", "No matching layout")
        return
    definition = candidates[0]
    store = await async_get_store(hass)
    actions = resolve_actions(
        definition,
        store,
        msg["device_id"],
        msg["button_id"],
        msg["state_id"],
    )
    if not actions:
        connection.send_result(msg["id"], {"ok": True, "fired": False})
        return
    try:
        sequence = SCRIPT_SCHEMA(actions)
        script = Script(
            hass,
            sequence,
            f"Remote Studio (test {msg['button_id']}/{msg['state_id']})",
            DOMAIN,
        )
        await script.async_run(context=_ws_context(connection))
    except Exception as err:  # noqa: BLE001 — surface to UI
        connection.send_error(msg["id"], "action_failed", str(err))
        return
    connection.send_result(msg["id"], {"ok": True, "fired": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "remote_studio/test_action",
        vol.Required("actions"): list,
    }
)
@websocket_api.async_response
async def ws_test_action(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    try:
        sequence = SCRIPT_SCHEMA(msg["actions"])
        script = Script(hass, sequence, "Remote Studio (test)", DOMAIN)
        await script.async_run(context=_ws_context(connection))
    except Exception as err:  # noqa: BLE001 — surface error to UI
        connection.send_error(msg["id"], "action_failed", str(err))
        return
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {vol.Required("type"): "remote_studio/subscribe_events"}
)
@callback
def ws_subscribe_events(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    sub_id = msg["id"]

    @callback
    def forward(device_id: str, button_id: str, state_id: str) -> None:
        connection.send_message(
            websocket_api.event_message(
                sub_id,
                {
                    "device_id": device_id,
                    "button_id": button_id,
                    "state_id": state_id,
                },
            )
        )

    connection.subscriptions[sub_id] = async_dispatcher_connect(
        hass, SIGNAL_REMOTE_EVENT, forward
    )
    connection.send_result(sub_id)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "remote_studio/enable_entities",
        vol.Required("entity_ids"): [str],
    }
)
@websocket_api.async_response
async def ws_enable_entities(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Flip ``disabled_by`` to None on each listed entity.

    Used by the device-view "Enable N sensors" button to flip on the
    matter `current_switch_position` sensors that the layout's
    matter_position source depends on. After updating the registry we
    ask the runtime to re-discover its matter_position subscriptions
    so the freshly-enabled entities are picked up without a HA
    restart.
    """
    from .runtime import async_get_runtime  # local import to avoid cycle

    entity_reg = er.async_get(hass)
    enabled: list[str] = []
    failed: list[dict[str, str]] = []
    for entity_id in msg["entity_ids"]:
        try:
            entity_reg.async_update_entity(entity_id, disabled_by=None)
            enabled.append(entity_id)
        except Exception as err:  # noqa: BLE001 — surface to UI
            failed.append({"entity_id": entity_id, "error": str(err)})

    # Re-run the matter_position discovery so the runtime starts
    # listening to the newly-enabled sensors. The setup is idempotent —
    # it tears down its previous subscription before reattaching.
    if enabled:
        try:
            runtime = await async_get_runtime(hass)
            runtime.resync_matter_position()
        except Exception:  # noqa: BLE001 — log but don't fail the WS call
            import logging
            logging.getLogger(__name__).exception(
                "matter_position resync failed after enabling entities"
            )

    connection.send_result(
        msg["id"], {"ok": True, "enabled": enabled, "failed": failed}
    )
