"""WebSocket API for the Remote Studio panel."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import Context, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
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


@websocket_api.websocket_command({vol.Required("type"): "remote_studio/list_remotes"})
@websocket_api.async_response
async def ws_list_remotes(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    registry = await async_get_registry(hass)
    device_reg = dr.async_get(hass)

    remotes: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    known_zigbee_domains = {"zha", "mqtt", "zigbee", "zigbee2mqtt", "matter"}

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
                }
            )
            continue

        # Surface devices that look like Zigbee/Matter peripherals but didn't
        # match any built-in definition, so the user can pair them manually
        # with a layout of their choice.
        if not device.manufacturer:
            continue
        domains = {ident[0] for ident in (device.identifiers or set())}
        if domains & known_zigbee_domains:
            candidates.append(
                {
                    "device_id": device.id,
                    "device_name": device.name_by_user or device.name,
                    "manufacturer": device.manufacturer,
                    "model": device.model,
                }
            )

    connection.send_result(
        msg["id"],
        {
            "remotes": remotes,
            "candidates": candidates,
            "definitions": [_serialise_definition(d) for d in registry.all()],
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
    try:
        svg_text: str | None = await hass.async_add_executor_job(
            definition.svg_path.read_text, "utf-8"
        )
    except OSError:
        svg_text = None

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
        },
    )


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
