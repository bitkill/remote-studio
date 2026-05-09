"""Remote-definition registry.

Loads remote YAML definitions from two sources and indexes them for fast
event matching at runtime:

1. Built-ins shipped with the integration: ``custom_components/remote_studio/remotes/``
2. User-contributed: ``<config>/remote_studio/remotes/``

A definition describes a physical remote model — its manufacturer/model
identifiers (used for auto-discovery), its SVG layout, and the per-button
states with their integration-specific event signatures (ZHA / Z2M / Matter).

User definitions with the same ``id`` as a built-in override it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import voluptuous as vol
from homeassistant.core import HomeAssistant
from homeassistant.util.yaml import load_yaml

from .const import DOMAIN, USER_REMOTES_DIR

BUILTIN_REMOTES_DIR = Path(__file__).parent / "remotes"


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
        # related events. The IKEA scroll wheel for example reports
        # rotation as `multi_press_<N>` where N is the tick count, so a
        # `rotate_cw` state lists multi_press_1..multi_press_9.
        vol.Required("event"): vol.Any(str, [str]),
        # 1-based index into the device's event entities (sorted by unique_id).
        # For multi-button Matter remotes each physical button is a separate
        # endpoint and HA registers one event entity per endpoint.
        vol.Optional("endpoint", default=1): vol.Coerce(int),
        # Optional extra match keys (e.g. multi_press_count) — when set, all
        # listed attribute name/value pairs must match the event entity's
        # attributes for this state to fire.
        vol.Optional("attributes"): dict,
    }
)
# Xiaomi BLE devices (xiaomi_ble integration) expose one or more `event`
# entities whose state.attributes['event_type'] flips on each gesture.
# We only need the event_type — Xiaomi exposes a single event entity per
# device for the current generation we support, so no endpoint required.
_XIAOMI_BLE_SOURCE = vol.Schema(
    {
        vol.Required("event"): vol.Any(str, [str]),
        vol.Optional("attributes"): dict,
    }
)
# Matter "Current switch position" sensors (one per endpoint) flip
# 0 → 1 → 0 on each physical actuation, *without* the 400-1200 ms
# debounce that HA applies to matter event entities. For low-latency
# rotation / press detection we listen to those sensors directly and
# dispatch on the rising or falling edge.
#
# The sensors are disabled by default in HA — users have to enable
# every "Current switch position" entity on the device before this
# source path kicks in. The slower matter event sources stay in the
# YAML as a fallback for users who haven't enabled them.
_MATTER_POSITION_SOURCE = vol.Schema(
    {
        vol.Required("endpoint"): vol.Coerce(int),
        vol.Optional("edge", default="rising"): vol.In(("rising", "falling")),
    }
)

_SOURCES = vol.All(
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

# Roles drive the new "one target per group" UX: the runtime turns
# (role + group target + dim_step) into a default action so most users
# never touch the action editor. `none` is the literal-string opt-out
# for states like STYRBAR's arrow buttons that have no obvious default.
_ROLES = ("turn_on", "turn_off", "toggle", "dim_up", "dim_down", "none")

_STATE = vol.Schema(
    {
        vol.Required("id"): str,
        vol.Optional("label"): str,
        vol.Optional("role", default="none"): vol.In(_ROLES),
        vol.Required("sources"): _SOURCES,
    }
)

_BUTTON = vol.Schema(
    {
        vol.Required("id"): str,
        vol.Optional("label"): str,
        # Group lets multi-zone remotes (e.g. BILRESA E2490, with three
        # dots) target a different entity per zone. Single-zone remotes
        # leave it implicit and end up in the "main" group.
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

_REMOTE = vol.Schema(
    {
        vol.Required("id"): str,
        vol.Required("name"): str,
        # Legacy singular form retained for backwards compatibility; the
        # plural list is preferred. Either is accepted.
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
    sources: dict[str, dict[str, Any]]  # integration -> source spec


@dataclass(frozen=True)
class ButtonDef:
    id: str
    label: str | None
    group: str
    states: tuple[StateDef, ...]


@dataclass
class RemoteDefinition:
    id: str
    name: str
    manufacturers: tuple[str, ...]
    models: tuple[str, ...]
    svg_path: Path
    buttons: tuple[ButtonDef, ...]
    source_path: Path
    battery: dict[str, Any] | None = None

    @property
    def manufacturer(self) -> str | None:
        """First listed manufacturer, kept for the WS API serialiser."""
        return self.manufacturers[0] if self.manufacturers else None

    # Per-integration indices.
    zha_index: dict[str, list[tuple[str, str, dict[str, Any]]]] = field(
        default_factory=dict
    )
    z2m_index: dict[str, tuple[str, str]] = field(default_factory=dict)
    # Matter index keyed by (endpoint, event_type) -> list of
    # (button_id, state_id, attribute_filter). The attribute filter lets us
    # disambiguate, e.g., multi_press_count=2 vs 3.
    matter_index: dict[
        tuple[int, str], list[tuple[str, str, dict[str, Any]]]
    ] = field(default_factory=dict)
    # Xiaomi BLE index keyed by event_type -> list of
    # (button_id, state_id, attribute_filter).
    xiaomi_ble_index: dict[
        str, list[tuple[str, str, dict[str, Any]]]
    ] = field(default_factory=dict)
    # Matter position-sensor index keyed by (endpoint, edge) -> list of
    # (button_id, state_id). No attribute filter — the sensor only
    # reports a numeric position string.
    matter_position_index: dict[
        tuple[int, str], list[tuple[str, str]]
    ] = field(default_factory=dict)

    @property
    def has_matter(self) -> bool:
        return bool(self.matter_index)

    @property
    def has_xiaomi_ble(self) -> bool:
        return bool(self.xiaomi_ble_index)

    @property
    def has_matter_position(self) -> bool:
        return bool(self.matter_position_index)

    def groups(self) -> list[dict[str, Any]]:
        """Return a list of groups in declaration order.

        Each entry: ``{id, label, has_dim, button_ids}``. ``has_dim`` is
        true when any state in the group has a dim role — the UI uses
        it to decide whether to show the dim-step input.
        """
        order: list[str] = []
        info: dict[str, dict[str, Any]] = {}
        for button in self.buttons:
            entry = info.get(button.group)
            if entry is None:
                entry = {
                    "id": button.group,
                    "label": _humanise_group(button.group),
                    "has_dim": False,
                    "button_ids": [],
                }
                info[button.group] = entry
                order.append(button.group)
            entry["button_ids"].append(button.id)
            for state in button.states:
                if state.role in ("dim_up", "dim_down"):
                    entry["has_dim"] = True
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
        """Return True if this definition fits a device with given manufacturer/model.

        - Manufacturer: any of the listed manufacturers must match
          case-insensitively (substring, so "IKEA" matches "IKEA of Sweden AB").
        - Model: any of the listed model entries must appear (case-insensitive
          substring) in the device's model. So "BILRESA" catches every BILRESA
          variant ("BILRESA dual button remote control", "E2489 BILRESA", etc.).
        """
        if self.manufacturers and manufacturer:
            mfr_cf = manufacturer.casefold()
            if not any(m.casefold() in mfr_cf or mfr_cf in m.casefold() for m in self.manufacturers):
                return False
        if self.models and model:
            mdl_cf = model.casefold()
            return any(m.casefold() in mdl_cf for m in self.models)
        # If we don't know the device's model but the manufacturer matches
        # (or no manufacturer was declared), accept; user can correct via the
        # manual layout picker.
        return bool(self.manufacturers and manufacturer)

    def match_zha(
        self, command: str, args: dict[str, Any] | None
    ) -> tuple[str, str] | None:
        candidates = self.zha_index.get(command)
        if not candidates:
            return None
        args = args or {}
        for button_id, state_id, args_filter in candidates:
            if all(args.get(k) == v for k, v in args_filter.items()):
                return button_id, state_id
        return None

    def match_z2m(self, action: str) -> tuple[str, str] | None:
        return self.z2m_index.get(action)

    def match_matter(
        self,
        endpoint: int,
        event_type: str,
        attributes: dict[str, Any] | None = None,
    ) -> tuple[str, str] | None:
        candidates = self.matter_index.get((endpoint, event_type))
        if not candidates:
            return None
        attrs = attributes or {}
        for button_id, state_id, attr_filter in candidates:
            if all(attrs.get(k) == v for k, v in attr_filter.items()):
                return button_id, state_id
        return None

    def match_xiaomi_ble(
        self,
        event_type: str,
        attributes: dict[str, Any] | None = None,
    ) -> tuple[str, str] | None:
        candidates = self.xiaomi_ble_index.get(event_type)
        if not candidates:
            return None
        attrs = attributes or {}
        for button_id, state_id, attr_filter in candidates:
            if all(attrs.get(k) == v for k, v in attr_filter.items()):
                return button_id, state_id
        return None

    def match_matter_position(
        self, endpoint: int, edge: str
    ) -> tuple[str, str] | None:
        candidates = self.matter_position_index.get((endpoint, edge))
        if not candidates:
            return None
        return candidates[0]


# -------------------------------------------------------------------- loading
def _humanise_group(group_id: str) -> str:
    """Default group label: `dot1` → `Dot 1`, `main` → `Main`."""
    if group_id == "main":
        return "Main"
    # Insert a space before any trailing digits, then title-case.
    head = group_id.rstrip("0123456789")
    tail = group_id[len(head) :]
    base = head.replace("_", " ").strip()
    if tail and base:
        return f"{base.title()} {tail}"
    return base.title() or group_id


def _build_definition(raw: dict[str, Any], source_path: Path) -> RemoteDefinition:
    validated = _REMOTE(raw)
    buttons: list[ButtonDef] = []

    for raw_btn in validated["buttons"]:
        states = tuple(
            StateDef(
                id=s["id"],
                label=s.get("label"),
                role=s["role"],
                sources=dict(s["sources"]),
            )
            for s in raw_btn["states"]
        )
        buttons.append(
            ButtonDef(
                id=raw_btn["id"],
                label=raw_btn.get("label"),
                group=raw_btn["group"],
                states=states,
            )
        )

    svg_path = source_path.parent / validated["svg"]

    manufacturers: list[str] = []
    if validated.get("manufacturer"):
        manufacturers.append(validated["manufacturer"])
    manufacturers.extend(validated.get("manufacturers") or [])
    # Preserve order, drop duplicates (case-insensitive).
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
        svg_path=svg_path,
        buttons=tuple(buttons),
        source_path=source_path,
        battery=dict(validated["battery"]) if validated.get("battery") else None,
    )

    # Build per-integration indices
    for button in definition.buttons:
        for state in button.states:
            zha = state.sources.get("zha")
            if zha is not None:
                definition.zha_index.setdefault(zha["command"], []).append(
                    (button.id, state.id, dict(zha.get("args") or {}))
                )
            z2m = state.sources.get("z2m")
            if z2m is not None:
                definition.z2m_index[z2m["action"]] = (button.id, state.id)
            matter = state.sources.get("matter")
            if matter is not None:
                events = matter["event"]
                if isinstance(events, str):
                    events = [events]
                attrs_filter = dict(matter.get("attributes") or {})
                endpoint = int(matter["endpoint"])
                for event in events:
                    key = (endpoint, event)
                    definition.matter_index.setdefault(key, []).append(
                        (button.id, state.id, attrs_filter)
                    )
            xiaomi_ble = state.sources.get("xiaomi_ble")
            if xiaomi_ble is not None:
                events = xiaomi_ble["event"]
                if isinstance(events, str):
                    events = [events]
                attrs_filter = dict(xiaomi_ble.get("attributes") or {})
                for event in events:
                    definition.xiaomi_ble_index.setdefault(event, []).append(
                        (button.id, state.id, attrs_filter)
                    )
            mp = state.sources.get("matter_position")
            if mp is not None:
                key = (int(mp["endpoint"]), mp["edge"])
                definition.matter_position_index.setdefault(key, []).append(
                    (button.id, state.id)
                )

    return definition


class DefinitionRegistry:
    """In-memory registry of remote definitions."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._defs: dict[str, RemoteDefinition] = {}

    async def async_load(self) -> None:
        """Load (or reload) all definitions from disk."""
        user_dir = Path(self._hass.config.path(USER_REMOTES_DIR))
        defs = await self._hass.async_add_executor_job(
            self._load_sync, BUILTIN_REMOTES_DIR, user_dir
        )
        self._defs = defs

    @staticmethod
    def _load_sync(builtin_dir: Path, user_dir: Path) -> dict[str, RemoteDefinition]:
        loaded: dict[str, RemoteDefinition] = {}
        # Built-ins first, user files override by id.
        for directory in (builtin_dir, user_dir):
            if not directory.is_dir():
                continue
            for path in sorted(directory.glob("*.yaml")):
                try:
                    raw = load_yaml(str(path))
                    definition = _build_definition(raw, path)
                except (vol.Invalid, OSError, ValueError) as err:
                    # Skip malformed files; runtime logs the error.
                    import logging

                    logging.getLogger(__name__).warning(
                        "Skipping invalid remote definition %s: %s", path, err
                    )
                    continue
                loaded[definition.id] = definition
        return loaded

    def all(self) -> list[RemoteDefinition]:
        return list(self._defs.values())

    def get(self, definition_id: str) -> RemoteDefinition | None:
        return self._defs.get(definition_id)

    def find_for_device(
        self, manufacturer: str | None, model: str | None
    ) -> list[RemoteDefinition]:
        return [d for d in self._defs.values() if d.matches_device(manufacturer, model)]


async def async_get_registry(hass: HomeAssistant) -> DefinitionRegistry:
    """Return the loaded singleton DefinitionRegistry."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    registry = domain_data.get("registry")
    if registry is None:
        registry = DefinitionRegistry(hass)
        await registry.async_load()
        domain_data["registry"] = registry
    return registry
