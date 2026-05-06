"""WebSocket API for the Remote Studio panel."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import Context, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.script import Script

from .const import DOMAIN
from .registry import RemoteDefinition, async_get_registry
from .runtime import SIGNAL_REMOTE_EVENT
from .storage import async_get_store


async def async_register(hass: HomeAssistant) -> None:
    """Register all WebSocket commands."""
    websocket_api.async_register_command(hass, ws_list_remotes)
    websocket_api.async_register_command(hass, ws_get_remote)
    websocket_api.async_register_command(hass, ws_save_mapping)
    websocket_api.async_register_command(hass, ws_clear_mapping)
    websocket_api.async_register_command(hass, ws_test_action)
    websocket_api.async_register_command(hass, ws_subscribe_events)


def _serialise_definition(definition: RemoteDefinition) -> dict[str, Any]:
    return {
        "id": definition.id,
        "name": definition.name,
        "manufacturer": definition.manufacturer,
        "models": list(definition.models),
        "battery": definition.battery,
        "buttons": [
            {
                "id": btn.id,
                "label": btn.label,
                "states": [{"id": s.id, "label": s.label} for s in btn.states],
            }
            for btn in definition.buttons
        ],
    }


def _ws_context(connection: websocket_api.ActiveConnection) -> Context:
    user_id = connection.user.id if connection.user else None
    return Context(user_id=user_id)


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
                    "battery": _find_battery(hass, device.id),
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
            }
        )

    serialised_defs: list[dict[str, Any]] = []
    for d in registry.all():
        s = _serialise_definition(d)
        s["svg"] = await _load_svg_cached(hass, d)
        serialised_defs.append(s)

    connection.send_result(
        msg["id"],
        {
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

    connection.send_result(
        msg["id"],
        {
            "device": {
                "id": device.id,
                "name": device.name_by_user or device.name,
                "manufacturer": device.manufacturer,
                "model": device.model,
            },
            "definition": _serialise_definition(definition),
            "svg": svg_text,
            "mappings": store.device_mappings(device_id),
            "battery": battery,
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
        vol.Required("type"): "remote_studio/save_mapping",
        vol.Required("device_id"): str,
        vol.Required("button_id"): str,
        vol.Required("state_id"): str,
        vol.Required("actions"): list,
    }
)
@websocket_api.async_response
async def ws_save_mapping(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    store = await async_get_store(hass)
    await store.async_set_actions(
        msg["device_id"], msg["button_id"], msg["state_id"], msg["actions"]
    )
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "remote_studio/clear_mapping",
        vol.Required("device_id"): str,
        vol.Required("button_id"): str,
        vol.Required("state_id"): str,
    }
)
@websocket_api.async_response
async def ws_clear_mapping(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    store = await async_get_store(hass)
    await store.async_set_actions(
        msg["device_id"], msg["button_id"], msg["state_id"], []
    )
    connection.send_result(msg["id"], {"ok": True})


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
        script = Script(hass, msg["actions"], "Remote Studio (test)", DOMAIN)
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
