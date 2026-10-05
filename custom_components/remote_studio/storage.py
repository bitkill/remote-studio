"""Persistent storage for Remote Studio device config.

Schema (v2):

    {
      <device_id>: {
        "groups": {
          <group_id>: {
            "target": {"entity_id": "light.living"} | null,
            "dim_step": 20              # percentage step for dim_up/dim_down
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
from .core import mappings

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = mappings.STORAGE_VERSION
STORAGE_MINOR_VERSION = mappings.STORAGE_MINOR_VERSION
STORAGE_KEY = f"{DOMAIN}.mappings"
DEFAULT_DIM_STEP = 20
# Warm-white default for the `scene` long-press role. Matches the
# `[255, 217, 168]` value the bilresa_three_light_dimmer_v2 blueprint
# uses, which reads as a soft "movie night" white on most bulbs.
DEFAULT_SCENE_COLOR: list[int] = [255, 217, 168]

ActionStep = dict[str, Any]
GroupConfig = dict[str, Any]                  # {target, dim_step}
DeviceConfig = dict[str, Any]                 # {groups, overrides}
StoreData = dict[str, DeviceConfig]


def _empty_device() -> DeviceConfig:
    return {"groups": {}, "overrides": {}}


def _empty_group() -> GroupConfig:
    return {"target": None, "dim_step": DEFAULT_DIM_STEP}


class _RemoteStudioStore(Store[StoreData]):
    """Subclass so we can hook schema migration.

    HA calls ``_async_migrate_func`` whenever the stored (major, minor)
    differs from ours — including minor bumps, which only ever add
    optional fields. The decision of what to keep lives in
    ``core.mappings.migrate`` so it is tested without HA.
    """

    async def _async_migrate_func(
        self, old_major_version: int, old_minor_version: int, old_data: Any
    ) -> StoreData:
        if old_major_version < STORAGE_VERSION:
            _LOGGER.warning(
                "Remote Studio: dropping legacy v%d mappings on schema upgrade. "
                "Re-pick targets for each remote in the panel.",
                old_major_version,
            )
        return mappings.migrate(old_major_version, old_minor_version, old_data)


class MappingStore:
    """Thin wrapper around HA's Store for the v2 schema."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[StoreData] = _RemoteStudioStore(
            hass,
            STORAGE_VERSION,
            STORAGE_KEY,
            minor_version=STORAGE_MINOR_VERSION,
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
        scene_color: list[int] | None = None,
        scene_brightness: int | None = None,
    ) -> None:
        """Replace the full config for one (device, group).

        The frontend always sends a complete view of the group on save,
        so any optional field that's None / absent is treated as "no
        override" — the runtime falls back to its built-in default
        (100% brightness, no colour). That makes "reset to defaults" a
        one-line frontend change (drop the field, save) instead of a
        new WS endpoint.
        """
        device = self._data.setdefault(device_id, _empty_device())
        groups = device.setdefault("groups", {})
        new_group: GroupConfig = _empty_group()
        new_group["target"] = target
        if dim_step is not None:
            new_group["dim_step"] = int(dim_step)
        if scene_color is not None:
            new_group["scene_color"] = [int(c) for c in scene_color]
        if scene_brightness is not None:
            new_group["scene_brightness"] = int(scene_brightness)
        groups[group_id] = new_group
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
        # Drop a group dict only when none of its fields hold any
        # user-meaningful value (no target, default dim_step, no
        # scene_color override).
        for gid in list(groups.keys()):
            g = groups[gid]
            if (
                not g.get("target")
                and g.get("dim_step", DEFAULT_DIM_STEP) == DEFAULT_DIM_STEP
                and not g.get("scene_color")
                and not g.get("scene_brightness")
            ):
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
