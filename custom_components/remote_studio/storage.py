"""Persistent storage for Remote Studio device config.

Schema (v2):

    {
      <device_id>: {
        "groups": {
          <group_id>: {
            "target": {"entity_id": "light.living"} | null,
            "dim_step": 10              # percentage step for dim_up/dim_down
          }
        },
        "overrides": {                  # advanced escape hatch
          <button_id>: {
            <state_id>: [<action_step>, ...]
          }
        }
      }
    }

The default behaviour is target + dim_step driving role-based actions;
``overrides`` is only populated when the user opens the Advanced editor
for a specific (button, state).

Action steps mirror Home Assistant's automation ``action:`` block so they
can be executed directly via ``homeassistant.helpers.script.Script``.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 2
STORAGE_KEY = f"{DOMAIN}.mappings"
DEFAULT_DIM_STEP = 10

ActionStep = dict[str, Any]
GroupConfig = dict[str, Any]                  # {target, dim_step}
DeviceConfig = dict[str, Any]                 # {groups, overrides}
StoreData = dict[str, DeviceConfig]


def _empty_device() -> DeviceConfig:
    return {"groups": {}, "overrides": {}}


def _empty_group() -> GroupConfig:
    return {"target": None, "dim_step": DEFAULT_DIM_STEP}


class _RemoteStudioStore(Store[StoreData]):
    """Subclass so we can hook the v1 → v2 migration.

    Pre-1.0 schema stored ``{<device>: {<button>: {<state>: [actions]}}}``.
    The new shape doesn't have a one-to-one mapping for that data and we
    have no real users yet — wipe and let people re-pick targets.
    """

    async def _async_migrate_func(
        self, old_major_version: int, _old_minor_version: int, _old_data: Any
    ) -> StoreData:
        if old_major_version < STORAGE_VERSION:
            _LOGGER.warning(
                "Remote Studio: dropping legacy v%d mappings on schema upgrade. "
                "Re-pick targets for each remote in the panel.",
                old_major_version,
            )
        return {}


class MappingStore:
    """Thin wrapper around HA's Store for the v2 schema."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[StoreData] = _RemoteStudioStore(
            hass,
            STORAGE_VERSION,
            STORAGE_KEY,
            minor_version=1,
            atomic_writes=True,
        )
        self._data: StoreData = {}

    async def async_load(self) -> None:
        loaded = await self._store.async_load()
        self._data = loaded or {}

    async def _async_save(self) -> None:
        await self._store.async_save(self._data)

    # ----------------------------------------------------------------- read
    def all_devices(self) -> StoreData:
        return self._data

    def device(self, device_id: str) -> DeviceConfig:
        """Return the device's config (creates an empty entry if missing).

        The returned dict is a *reference* to the stored data — callers
        treat it as read-only.
        """
        return self._data.get(device_id) or _empty_device()

    def group(self, device_id: str, group_id: str) -> GroupConfig:
        return (
            self.device(device_id).get("groups", {}).get(group_id)
            or _empty_group()
        )

    def override(
        self, device_id: str, button_id: str, state_id: str
    ) -> list[ActionStep]:
        return (
            self.device(device_id)
            .get("overrides", {})
            .get(button_id, {})
            .get(state_id, [])
        )

    # ---------------------------------------------------------------- write
    async def async_set_group(
        self,
        device_id: str,
        group_id: str,
        *,
        target: dict[str, Any] | None,
        dim_step: int | None,
    ) -> None:
        """Set target and/or dim_step for one (device, group)."""
        device = self._data.setdefault(device_id, _empty_device())
        groups = device.setdefault("groups", {})
        group = groups.setdefault(group_id, _empty_group())
        group["target"] = target
        if dim_step is not None:
            group["dim_step"] = int(dim_step)
        # Drop the device entirely if nothing useful is set.
        self._cleanup(device_id)
        await self._async_save()

    async def async_set_override(
        self,
        device_id: str,
        button_id: str,
        state_id: str,
        actions: list[ActionStep],
    ) -> None:
        """Set or clear the action override for one (button, state)."""
        device = self._data.setdefault(device_id, _empty_device())
        overrides = device.setdefault("overrides", {})
        if actions:
            overrides.setdefault(button_id, {})[state_id] = actions
        else:
            states = overrides.get(button_id)
            if states is not None:
                states.pop(state_id, None)
                if not states:
                    overrides.pop(button_id, None)
        self._cleanup(device_id)
        await self._async_save()

    async def async_clear_device(self, device_id: str) -> None:
        if self._data.pop(device_id, None) is not None:
            await self._async_save()

    # --------------------------------------------------------------- helpers
    def _cleanup(self, device_id: str) -> None:
        """Remove a device entry that has no groups and no overrides."""
        device = self._data.get(device_id)
        if device is None:
            return
        groups = device.get("groups") or {}
        # Drop any empty group dicts (no target and default dim_step).
        for gid in list(groups.keys()):
            g = groups[gid]
            if not g.get("target") and g.get("dim_step", DEFAULT_DIM_STEP) == DEFAULT_DIM_STEP:
                groups.pop(gid)
        if not groups and not device.get("overrides"):
            self._data.pop(device_id, None)


async def async_get_store(hass: HomeAssistant) -> MappingStore:
    """Return the loaded singleton MappingStore for this hass instance."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    store = domain_data.get("store")
    if store is None:
        store = MappingStore(hass)
        await store.async_load()
        domain_data["store"] = store
    return store
