"""Persistent storage for Remote Studio device config.

Thin HA-side wrapper: loads and saves ``core.mappings.MappingData``
through Home Assistant's ``Store``. Everything about the data's shape,
defaults and cleanup lives in ``core/mappings.py`` and is tested there.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .core import mappings
from .core.mappings import ActionStep, GroupConfig, MappingData

_LOGGER = logging.getLogger(__name__)

STORAGE_KEY = f"{DOMAIN}.mappings"

__all__ = ["ActionStep", "GroupConfig", "MappingStore", "async_get_store"]


class _RemoteStudioStore(Store[dict[str, Any]]):
    """Subclass so we can hook schema migration.

    HA calls ``_async_migrate_func`` whenever the stored (major, minor)
    differs from ours — including minor bumps, which only ever add
    optional fields. The decision of what to keep lives in
    ``core.mappings.migrate`` so it is tested without HA.
    """

    async def _async_migrate_func(
        self, old_major_version: int, old_minor_version: int, old_data: Any
    ) -> dict[str, Any]:
        if old_major_version < mappings.STORAGE_VERSION:
            _LOGGER.warning(
                "Remote Studio: dropping legacy v%d mappings on schema upgrade. "
                "Re-pick targets for each remote in the panel.",
                old_major_version,
            )
        return mappings.migrate(old_major_version, old_minor_version, old_data)


class MappingStore:
    """Loaded mapping data plus persistence."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = _RemoteStudioStore(
            hass,
            mappings.STORAGE_VERSION,
            STORAGE_KEY,
            minor_version=mappings.STORAGE_MINOR_VERSION,
            atomic_writes=True,
        )
        self.data = MappingData()

    async def async_load(self) -> None:
        self.data = MappingData(await self._store.async_load())
        for warning in self.data.warnings:
            _LOGGER.warning("Remote Studio storage: %s", warning)

    async def _async_save(self) -> None:
        await self._store.async_save(self.data.raw)

    # ----------------------------------------------------------------- read
    def group(self, device_id: str, group_id: str) -> GroupConfig:
        return self.data.group(device_id, group_id)

    def override(self, device_id: str, button_id: str, state_id: str) -> list[ActionStep]:
        return self.data.override(device_id, button_id, state_id)

    def pairing(self, device_id: str) -> str | None:
        return self.data.pairing(device_id)

    # ---------------------------------------------------------------- write
    async def async_set_group(
        self, device_id: str, group_id: str, cfg: GroupConfig
    ) -> GroupConfig:
        canonical = self.data.set_group(device_id, group_id, cfg)
        await self._async_save()
        return canonical

    async def async_set_override(
        self, device_id: str, button_id: str, state_id: str, actions: list[ActionStep]
    ) -> None:
        self.data.set_override(device_id, button_id, state_id, actions)
        await self._async_save()

    async def async_set_pairing(self, device_id: str, definition_id: str | None) -> None:
        self.data.set_pairing(device_id, definition_id)
        await self._async_save()

    async def async_clear_device(self, device_id: str) -> None:
        if self.data.clear_device(device_id):
            await self._async_save()


async def async_get_store(hass: HomeAssistant) -> MappingStore:
    """Return the loaded singleton MappingStore for this hass instance."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    store = domain_data.get("store")
    if store is None:
        store = MappingStore(hass)
        await store.async_load()
        domain_data["store"] = store
    return store
