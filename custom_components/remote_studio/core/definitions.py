"""Remote definitions: schema, dataclasses, builder and matcher.

A *remote definition* describes one physical remote model: the
manufacturer/model identifiers used for auto-discovery, the SVG layout,
and the per-button states with their per-source signatures.

This module works on an already-loaded dict. Loading YAML from disk is
the caller's job (``registry.py`` uses HA's loader, ``scripts/check.py``
and the tests use PyYAML), which keeps this module importable without
Home Assistant.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
import re
from typing import Any

import voluptuous as vol

SOURCES: tuple[str, ...] = ("zha", "z2m", "matter", "matter_position", "xiaomi_ble")

# Roles drive the "one target per group" UX: the resolver turns
# (role + group config) into a default action list so most users never
# touch the action editor. `none` is the literal-string opt-out for
# states like STYRBAR's arrow buttons that have no obvious default.
ROLES: tuple[str, ...] = (
    "turn_on",
    "turn_off",
    "toggle",
    "dim_up",
    "dim_down",
    # Long-press default: ramp the target light to the group's scene
    # brightness, in the group's scene colour if one was picked.
    "scene",
    "none",
)


class DefinitionError(ValueError):
    """A definition failed validation. ``source`` names the file."""

    def __init__(self, source: str, message: str) -> None:
        super().__init__(f"{source}: {message}")
        self.source = source
        self.detail = message


# --------------------------------------------------------------------- schema
_ZHA_SOURCE = vol.Schema(
    {
        vol.Required("command"): str,
        vol.Optional("args"): dict,
        vol.Optional("cluster"): vol.Coerce(int),
    }
)
_Z2M_SOURCE = vol.Schema({vol.Required("action"): str})
_MATTER_SOURCE = vol.Schema(
    {
        # Single event_type, or a list when one state corresponds to many
        # related events (the IKEA scroll wheel reports rotation as
        # `multi_press_<N>`, so `rotate_cw` lists multi_press_1..9).
        vol.Required("event"): vol.Any(str, [str]),
        # Endpoint number parsed from the matter entity's unique_id. Each
        # physical button is a separate endpoint.
        vol.Optional("endpoint", default=1): vol.Coerce(int),
        # Extra match keys: all listed attribute name/value pairs must
        # equal the event entity's attributes for this state to fire.
        vol.Optional("attributes"): dict,
    }
)
# xiaomi_ble exposes one `event` entity per device whose
# state.attributes['event_type'] flips on each gesture.
_XIAOMI_BLE_SOURCE = vol.Schema(
    {
        vol.Required("event"): vol.Any(str, [str]),
        vol.Optional("attributes"): dict,
    }
)
# Matter "Current switch position" sensors flip 0 → 1 → 0 on each
# actuation without HA's matter event-entity debounce. Disabled by
# default in HA; the panel offers a one-click enable.
_MATTER_POSITION_SOURCE = vol.Schema(
    {
        vol.Required("endpoint"): vol.Coerce(int),
        vol.Optional("edge", default="rising"): vol.In(("rising", "falling")),
    }
)

_SOURCES_SCHEMA = vol.All(
    vol.Schema(
        {
            vol.Optional("zha"): _ZHA_SOURCE,
            vol.Optional("z2m"): _Z2M_SOURCE,
            vol.Optional("matter"): _MATTER_SOURCE,
            vol.Optional("matter_position"): _MATTER_POSITION_SOURCE,
            vol.Optional("xiaomi_ble"): _XIAOMI_BLE_SOURCE,
        }
    ),
    vol.Length(min=1, msg="state needs at least one source mapping"),
)

_STATE = vol.Schema(
    {
        vol.Required("id"): str,
        vol.Optional("label"): str,
        vol.Optional("role", default="none"): vol.In(ROLES),
        vol.Required("sources"): _SOURCES_SCHEMA,
    }
)

_BUTTON = vol.Schema(
    {
        vol.Required("id"): str,
        vol.Optional("label"): str,
        # Multi-zone remotes (BILRESA E2490's three dots) target a
        # different entity per zone; single-zone remotes end up in "main".
        vol.Optional("group", default="main"): str,
        vol.Required("states"): vol.All([_STATE], vol.Length(min=1)),
    }
)

_BATTERY = vol.Schema(
    {
        vol.Required("count"): vol.All(vol.Coerce(int), vol.Range(min=1)),
        vol.Required("type"): str,
    }
)

SCHEMA = vol.Schema(
    {
        vol.Required("id"): str,
        vol.Required("name"): str,
        # Singular form retained for older files; the list is preferred.
        vol.Optional("manufacturer"): str,
        vol.Optional("manufacturers", default=list): [str],
        vol.Optional("models", default=list): [str],
        vol.Optional("battery"): _BATTERY,
        vol.Required("svg"): str,
        vol.Required("buttons"): vol.All([_BUTTON], vol.Length(min=1)),
    }
)


# ----------------------------------------------------------------- dataclasses
@dataclass(frozen=True)
class StateDef:
    id: str
    label: str | None
    role: str
    sources: dict[str, dict[str, Any]]  # source -> signature


@dataclass(frozen=True)
class ButtonDef:
    id: str
    label: str | None
    group: str
    states: tuple[StateDef, ...]


Match = tuple[str, str]  # (button_id, state_id)
_Filtered = tuple[str, str, dict[str, Any]]  # (button_id, state_id, attr filter)


@dataclass
class RemoteDefinition:
    id: str
    name: str
    manufacturers: tuple[str, ...]
    models: tuple[str, ...]
    svg: str
    buttons: tuple[ButtonDef, ...]
    source: str
    svg_path: Path | None = None
    battery: dict[str, Any] | None = None

    # Per-source indices, built once in build().
    _zha: dict[str, list[_Filtered]] = field(default_factory=dict, repr=False)
    _z2m: dict[str, Match] = field(default_factory=dict, repr=False)
    _matter: dict[tuple[int, str], list[_Filtered]] = field(
        default_factory=dict, repr=False
    )
    _xiaomi_ble: dict[str, list[_Filtered]] = field(default_factory=dict, repr=False)
    _matter_position: dict[tuple[int, str], Match] = field(
        default_factory=dict, repr=False
    )

    # ------------------------------------------------------------ queries
    @property
    def sources(self) -> frozenset[str]:
        """Sources this definition has at least one signature for."""
        return frozenset(
            s for s in SOURCES
            if getattr(self, f"_{s}")
        )

    def groups(self) -> list[dict[str, Any]]:
        """Groups in declaration order: ``{id, label, has_dim, has_scene, button_ids}``.

        The ``has_*`` flags drive which inputs the group card surfaces.
        """
        order: list[str] = []
        info: dict[str, dict[str, Any]] = {}
        for button in self.buttons:
            entry = info.get(button.group)
            if entry is None:
                entry = {
                    "id": button.group,
                    "label": humanise_group(button.group),
                    "has_dim": False,
                    "has_scene": False,
                    "button_ids": [],
                }
                info[button.group] = entry
                order.append(button.group)
            entry["button_ids"].append(button.id)
            for state in button.states:
                if state.role in ("dim_up", "dim_down"):
                    entry["has_dim"] = True
                if state.role == "scene":
                    entry["has_scene"] = True
        return [info[g] for g in order]

    def role_for(self, button_id: str, state_id: str) -> str:
        for button in self.buttons:
            if button.id != button_id:
                continue
            for state in button.states:
                if state.id == state_id:
                    return state.role
        return "none"

    def group_for(self, button_id: str) -> str:
        for button in self.buttons:
            if button.id == button_id:
                return button.group
        return "main"

    def matches_device(self, manufacturer: str | None, model: str | None) -> bool:
        """True if this definition fits a device with the given identity.

        - Manufacturer: any listed manufacturer must match case-insensitively
          as a substring in either direction ("IKEA" ~ "IKEA of Sweden AB").
        - Model: any listed model must appear (case-insensitive substring)
          in the device's model, so "BILRESA" catches every variant.
        - Unknown model but matching manufacturer: accept; the user can
          correct via the manual layout picker.
        """
        if self.manufacturers and manufacturer:
            mfr_cf = manufacturer.casefold()
            if not any(
                m.casefold() in mfr_cf or mfr_cf in m.casefold()
                for m in self.manufacturers
            ):
                return False
        if self.models and model:
            mdl_cf = model.casefold()
            return any(m.casefold() in mdl_cf for m in self.models)
        return bool(self.manufacturers and manufacturer)

    # ----------------------------------------------------------- matching
    def match(self, source: str, payload: Mapping[str, Any]) -> Match | None:
        """Return (button_id, state_id) for a source-tagged payload, or None.

        Payload keys per source (see ``core.events.RemoteEvent``):
          zha:             command, args
          z2m:             action
          matter:          endpoint, event_type, attributes
          matter_position: endpoint, edge
          xiaomi_ble:      event_type, attributes
        """
        if source == "zha":
            return _first_filtered(
                self._zha.get(payload.get("command", "")), payload.get("args")
            )
        if source == "z2m":
            return self._z2m.get(payload.get("action", ""))
        if source == "matter":
            key = (int(payload.get("endpoint", 1)), payload.get("event_type", ""))
            return _first_filtered(self._matter.get(key), payload.get("attributes"))
        if source == "xiaomi_ble":
            return _first_filtered(
                self._xiaomi_ble.get(payload.get("event_type", "")),
                payload.get("attributes"),
            )
        if source == "matter_position":
            key = (int(payload.get("endpoint", 1)), payload.get("edge", ""))
            return self._matter_position.get(key)
        return None


def _first_filtered(
    candidates: list[_Filtered] | None, attrs: Mapping[str, Any] | None
) -> Match | None:
    if not candidates:
        return None
    attrs = attrs or {}
    for button_id, state_id, attr_filter in candidates:
        if all(attrs.get(k) == v for k, v in attr_filter.items()):
            return button_id, state_id
    return None


# -------------------------------------------------------------------- building
def humanise_group(group_id: str) -> str:
    """Default group label: `dot1` → `Dot 1`, `main` → `Main`."""
    if group_id == "main":
        return "Main"
    head = group_id.rstrip("0123456789")
    tail = group_id[len(head) :]
    base = head.replace("_", " ").strip()
    if tail and base:
        return f"{base.title()} {tail}"
    return base.title() or group_id


def build(raw: Any, source_path: Path | None = None) -> RemoteDefinition:
    """Validate an already-loaded YAML dict and build its match indices.

    Raises ``DefinitionError`` on a schema violation, a duplicate button
    or state id, or two states that claim the same signature (which would
    make one of them silently never fire).
    """
    source = str(source_path) if source_path else "<memory>"
    try:
        validated = SCHEMA(raw)
    except vol.Invalid as err:
        raise DefinitionError(source, str(err)) from err

    buttons: list[ButtonDef] = []
    seen_buttons: set[str] = set()
    for raw_btn in validated["buttons"]:
        if raw_btn["id"] in seen_buttons:
            raise DefinitionError(source, f"duplicate button id {raw_btn['id']!r}")
        seen_buttons.add(raw_btn["id"])
        seen_states: set[str] = set()
        states: list[StateDef] = []
        for s in raw_btn["states"]:
            if s["id"] in seen_states:
                raise DefinitionError(
                    source, f"button {raw_btn['id']!r}: duplicate state id {s['id']!r}"
                )
            seen_states.add(s["id"])
            states.append(
                StateDef(
                    id=s["id"],
                    label=s.get("label"),
                    role=s["role"],
                    sources=dict(s["sources"]),
                )
            )
        buttons.append(
            ButtonDef(
                id=raw_btn["id"],
                label=raw_btn.get("label"),
                group=raw_btn["group"],
                states=tuple(states),
            )
        )

    manufacturers: list[str] = []
    if validated.get("manufacturer"):
        manufacturers.append(validated["manufacturer"])
    manufacturers.extend(validated.get("manufacturers") or [])
    seen: set[str] = set()
    deduped: list[str] = []
    for m in manufacturers:
        key = m.casefold()
        if key not in seen:
            seen.add(key)
            deduped.append(m)

    definition = RemoteDefinition(
        id=validated["id"],
        name=validated["name"],
        manufacturers=tuple(deduped),
        models=tuple(validated["models"]),
        svg=validated["svg"],
        buttons=tuple(buttons),
        source=source,
        svg_path=(source_path.parent / validated["svg"]) if source_path else None,
        battery=dict(validated["battery"]) if validated.get("battery") else None,
    )
    _index(definition)
    return definition


def _index(d: RemoteDefinition) -> None:
    def clash(where: str, existing: Match, new: Match) -> DefinitionError:
        return DefinitionError(
            d.source,
            f"{where} is claimed by both {existing[0]}/{existing[1]} "
            f"and {new[0]}/{new[1]}",
        )

    def add_filtered(
        index: dict[Any, list[_Filtered]], key: Any, where: str,
        match: Match, attr_filter: dict[str, Any],
    ) -> None:
        bucket = index.setdefault(key, [])
        for b, s, existing_filter in bucket:
            if existing_filter == attr_filter:
                raise clash(where, (b, s), match)
        bucket.append((match[0], match[1], attr_filter))

    for button in d.buttons:
        for state in button.states:
            match: Match = (button.id, state.id)
            zha = state.sources.get("zha")
            if zha is not None:
                args = dict(zha.get("args") or {})
                add_filtered(d._zha, zha["command"], f"zha {zha['command']} {args}", match, args)
            z2m = state.sources.get("z2m")
            if z2m is not None:
                if z2m["action"] in d._z2m:
                    raise clash(f"z2m action {z2m['action']!r}", d._z2m[z2m["action"]], match)
                d._z2m[z2m["action"]] = match
            matter = state.sources.get("matter")
            if matter is not None:
                events = matter["event"]
                if isinstance(events, str):
                    events = [events]
                attrs_filter = dict(matter.get("attributes") or {})
                endpoint = int(matter["endpoint"])
                for event in events:
                    add_filtered(
                        d._matter, (endpoint, event),
                        f"matter endpoint {endpoint} {event} {attrs_filter}",
                        match, attrs_filter,
                    )
            ble = state.sources.get("xiaomi_ble")
            if ble is not None:
                events = ble["event"]
                if isinstance(events, str):
                    events = [events]
                attrs_filter = dict(ble.get("attributes") or {})
                for event in events:
                    add_filtered(
                        d._xiaomi_ble, event, f"xiaomi_ble {event} {attrs_filter}",
                        match, attrs_filter,
                    )
            mp = state.sources.get("matter_position")
            if mp is not None:
                key = (int(mp["endpoint"]), mp["edge"])
                if key in d._matter_position:
                    raise clash(f"matter_position {key}", d._matter_position[key], match)
                d._matter_position[key] = match


# ------------------------------------------------------------------ serialise
def serialise(definition: RemoteDefinition) -> dict[str, Any]:
    """The definition as the websocket API ships it (SVG text added by the caller)."""
    return {
        "id": definition.id,
        "name": definition.name,
        "models": list(definition.models),
        "battery": definition.battery,
        "groups": definition.groups(),
        "buttons": [
            {
                "id": btn.id,
                "label": btn.label,
                "group": btn.group,
                "states": [
                    {"id": s.id, "label": s.label, "role": s.role} for s in btn.states
                ],
            }
            for btn in definition.buttons
        ],
    }


# --------------------------------------------------------------------- lookups
def find_for_device(
    definitions: Iterable[RemoteDefinition],
    manufacturer: str | None,
    model: str | None,
) -> list[RemoteDefinition]:
    """Definitions whose identity rules accept this device, in input order."""
    return [d for d in definitions if d.matches_device(manufacturer, model)]


_HOTSPOT_ID = re.compile(r'\bid\s*=\s*["\']button-([^"\']+)["\']')


def missing_hotspots(definition: RemoteDefinition, svg_text: str) -> list[str]:
    """Button ids with no ``<g id="button-<id>">`` in the SVG."""
    present = set(_HOTSPOT_ID.findall(svg_text))
    return [b.id for b in definition.buttons if b.id not in present]


def wants_wheel(definition: RemoteDefinition) -> bool:
    """True if any state id starts with ``rotate_`` (the panel pulses ``#wheel``)."""
    return any(
        s.id.startswith("rotate_") for b in definition.buttons for s in b.states
    )
