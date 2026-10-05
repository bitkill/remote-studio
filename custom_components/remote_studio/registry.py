"""Remote-definition registry: loads YAML files and caches definitions.

Two sources, built-ins first, user files override by ``id``:

1. ``custom_components/remote_studio/remotes/``
2. ``<config>/remote_studio/remotes/``

All validation, index building and matching lives in
``core.definitions``; this module only does I/O and caching.
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.core import HomeAssistant
from homeassistant.util.yaml import load_yaml

from .const import DOMAIN, USER_REMOTES_DIR
from .core import definitions as defs
from .core.definitions import DefinitionError, RemoteDefinition

_LOGGER = logging.getLogger(__name__)

BUILTIN_REMOTES_DIR = Path(__file__).parent / "remotes"

__all__ = ["DefinitionRegistry", "RemoteDefinition", "async_get_registry"]


class DefinitionRegistry:
    """In-memory registry of remote definitions."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._defs: dict[str, RemoteDefinition] = {}

    async def async_load(self) -> None:
        """Load (or reload) all definitions from disk."""
        user_dir = Path(self._hass.config.path(USER_REMOTES_DIR))
        self._defs = await self._hass.async_add_executor_job(
            self._load_sync, BUILTIN_REMOTES_DIR, user_dir
        )

    @staticmethod
    def _load_sync(builtin_dir: Path, user_dir: Path) -> dict[str, RemoteDefinition]:
        loaded: dict[str, RemoteDefinition] = {}
        for directory in (builtin_dir, user_dir):
            if not directory.is_dir():
                continue
            for path in sorted(directory.glob("*.yaml")):
                try:
                    definition = defs.build(load_yaml(str(path)), path)
                except (DefinitionError, OSError, ValueError) as err:
                    _LOGGER.warning("Skipping invalid remote definition: %s", err)
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
        return defs.find_for_device(self._defs.values(), manufacturer, model)


async def async_get_registry(hass: HomeAssistant) -> DefinitionRegistry:
    """Return the loaded singleton DefinitionRegistry."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    registry = domain_data.get("registry")
    if registry is None:
        registry = DefinitionRegistry(hass)
        await registry.async_load()
        domain_data["registry"] = registry
    return registry
