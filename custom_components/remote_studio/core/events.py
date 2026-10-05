"""Remote events: the normalised shape every source adapter emits.

A *source adapter* (HA-side, in ``runtime.py``) subscribes to one
integration, resolves the HA device id, and emits a ``RemoteEvent``.
``match_event`` turns that into ``(definition, button_id, state_id)``.

The decoders here are the pure halves of the adapters: they take the
raw thing HA hands over and return the payload ``RemoteDefinition.match``
expects, so the per-source parsing is tested without ``hass``.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
import json
from typing import Any

from .definitions import RemoteDefinition

SOURCES_WITH_ENTITIES: frozenset[str] = frozenset({"matter", "matter_position", "xiaomi_ble"})


@dataclass(frozen=True)
class RemoteEvent:
    """One gesture on one device, tagged with the source that saw it.

    ``payload`` keys per source:
      zha:             command, args
      z2m:             action
      matter:          endpoint, event_type, attributes
      matter_position: endpoint, edge
      xiaomi_ble:      event_type, attributes
    """

    device_id: str
    source: str
    payload: Mapping[str, Any]


MatchedEvent = tuple[RemoteDefinition, str, str]


def match_event(
    event: RemoteEvent, definitions: Iterable[RemoteDefinition]
) -> MatchedEvent | None:
    """First definition (in the given order) that matches the event."""
    for definition in definitions:
        match = definition.match(event.source, event.payload)
        if match is not None:
            return definition, match[0], match[1]
    return None


# ------------------------------------------------------------------ decoders
def decode_zha(event_data: Mapping[str, Any]) -> RemoteEvent | None:
    """``zha_event`` bus payload → event, or None if it is not a button press."""
    device_id = event_data.get("device_id")
    command = event_data.get("command")
    if not device_id or not command:
        return None
    args = event_data.get("args")
    return RemoteEvent(
        str(device_id),
        "zha",
        {"command": str(command), "args": dict(args) if isinstance(args, Mapping) else {}},
    )


def decode_z2m(topic: str, payload: Any) -> tuple[str, str] | None:
    """MQTT ``zigbee2mqtt/<friendly_name>`` message → (friendly_name, action).

    Subtopics (``…/availability``, ``…/set``) and payloads without an
    ``action`` return None. The caller resolves the friendly name to a
    device id; that needs the device registry.
    """
    parts = topic.split("/", 2)
    if len(parts) != 2:
        return None
    friendly_name = parts[1]
    if isinstance(payload, (str, bytes)):
        try:
            payload = json.loads(payload)
        except (TypeError, ValueError):
            return None
    if not isinstance(payload, Mapping):
        return None
    action = payload.get("action")
    if not action:
        return None
    return friendly_name, str(action)


def decode_event_entity(attributes: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """HA ``event`` entity attributes → ``{event_type, attributes}``, or None."""
    attrs = dict(attributes or {})
    event_type = attrs.get("event_type")
    if not event_type:
        return None
    return {"event_type": str(event_type), "attributes": attrs}


def decode_position_edge(old_state: str | None, new_state: str | None) -> str | None:
    """Matter ``current_switch_position`` transition → ``rising``/``falling``/None."""
    new = (new_state or "").strip()
    old = (old_state or "").strip()
    if new in ("", "unknown", "unavailable"):
        return None
    if old != "1" and new == "1":
        return "rising"
    if old == "1" and new != "1":
        return "falling"
    return None


def matter_endpoint_from_unique_id(unique_id: str | None) -> int | None:
    """Endpoint number from a matter entity unique_id.

    Matter formats unique_ids as
    ``<bridge>-<node>-MatterNodeDevice-<endpoint>-<cluster>-…``; the
    endpoint sits at index 3. None if the layout does not look right.
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
