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
_MATTER_SOURCE = vol.Schema({vol.Required("event"): str})

_SOURCES = vol.All(
    vol.Schema(
        {
            vol.Optional("zha"): _ZHA_SOURCE,
            vol.Optional("z2m"): _Z2M_SOURCE,
            vol.Optional("matter"): _MATTER_SOURCE,
        }
    ),
    vol.Length(min=1, msg="state needs at least one source mapping"),
)

_STATE = vol.Schema(
    {
        vol.Required("id"): str,
        vol.Optional("label"): str,
        vol.Required("sources"): _SOURCES,
    }
)

_BUTTON = vol.Schema(
    {
        vol.Required("id"): str,
        vol.Optional("label"): str,
        vol.Required("states"): vol.All([_STATE], vol.Length(min=1)),
    }
)

_REMOTE = vol.Schema(
    {
        vol.Required("id"): str,
        vol.Required("name"): str,
        vol.Optional("manufacturer"): str,
        vol.Optional("models", default=list): [str],
        vol.Required("svg"): str,
        vol.Required("buttons"): vol.All([_BUTTON], vol.Length(min=1)),
    }
)


# ----------------------------------------------------------------- dataclasses
@dataclass(frozen=True)
class StateDef:
    id: str
    label: str | None
    sources: dict[str, dict[str, Any]]  # integration -> source spec


@dataclass(frozen=True)
class ButtonDef:
    id: str
    label: str | None
    states: tuple[StateDef, ...]


@dataclass
class RemoteDefinition:
    id: str
    name: str
    manufacturer: str | None
    models: tuple[str, ...]
    svg_path: Path
    buttons: tuple[ButtonDef, ...]
    source_path: Path

    # Per-integration indices: signature_key -> (button_id, state_id)
    zha_index: dict[str, list[tuple[str, str, dict[str, Any]]]] = field(
        default_factory=dict
    )
    z2m_index: dict[str, tuple[str, str]] = field(default_factory=dict)
    matter_index: dict[str, tuple[str, str]] = field(default_factory=dict)

    def matches_device(self, manufacturer: str | None, model: str | None) -> bool:
        """Return True if this definition fits a device with given manufacturer/model."""
        if self.manufacturer and manufacturer:
            if self.manufacturer.casefold() != manufacturer.casefold():
                return False
        if self.models and model:
            return any(m.casefold() == model.casefold() for m in self.models)
        # If we don't know the device's model but the definition has a
        # manufacturer match, accept it; the user can correct via the picker.
        return bool(self.manufacturer and manufacturer)

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

    def match_matter(self, event: str) -> tuple[str, str] | None:
        return self.matter_index.get(event)


# -------------------------------------------------------------------- loading
def _build_definition(raw: dict[str, Any], source_path: Path) -> RemoteDefinition:
    validated = _REMOTE(raw)
    buttons: list[ButtonDef] = []

    for raw_btn in validated["buttons"]:
        states = tuple(
            StateDef(
                id=s["id"],
                label=s.get("label"),
                sources=dict(s["sources"]),
            )
            for s in raw_btn["states"]
        )
        buttons.append(
            ButtonDef(
                id=raw_btn["id"],
                label=raw_btn.get("label"),
                states=states,
            )
        )

    svg_path = source_path.parent / validated["svg"]

    definition = RemoteDefinition(
        id=validated["id"],
        name=validated["name"],
        manufacturer=validated.get("manufacturer"),
        models=tuple(validated["models"]),
        svg_path=svg_path,
        buttons=tuple(buttons),
        source_path=source_path,
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
                definition.matter_index[matter["event"]] = (button.id, state.id)

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
