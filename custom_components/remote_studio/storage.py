"""Persistent storage for Remote Studio mappings.

Schema:
    {
      <device_id>: {
        <button_id>: {
          <state_id>: [<action_step>, ...]
        }
      }
    }

Action steps mirror Home Assistant's automation `action:` block so they can
be executed directly via ``homeassistant.helpers.script.Script``.
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.mappings"

ActionStep = dict[str, Any]
StateActions = dict[str, list[ActionStep]]
ButtonStates = dict[str, StateActions]
DeviceMap = dict[str, ButtonStates]


class MappingStore:
    """Thin wrapper around HA's Store for the mapping schema."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[DeviceMap] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._data: DeviceMap = {}

    async def async_load(self) -> None:
        loaded = await self._store.async_load()
        self._data = loaded or {}

    async def _async_save(self) -> None:
        await self._store.async_save(self._data)

    def all_mappings(self) -> DeviceMap:
        """Return the full mapping tree (do not mutate)."""
        return self._data

    def device_mappings(self, device_id: str) -> ButtonStates:
        """Return all button/state mappings for one device."""
        return self._data.get(device_id, {})

    def actions_for(
        self, device_id: str, button_id: str, state_id: str
    ) -> list[ActionStep]:
        return (
            self._data.get(device_id, {}).get(button_id, {}).get(state_id, [])
        )

    async def async_set_actions(
        self,
        device_id: str,
        button_id: str,
        state_id: str,
        actions: list[ActionStep],
    ) -> None:
        """Set the action list for one (device, button, state).

        Empty action list removes the entry and cleans up empty parents.
        """
        if actions:
            self._data.setdefault(device_id, {}).setdefault(button_id, {})[
                state_id
            ] = actions
        else:
            buttons = self._data.get(device_id)
            if buttons is None:
                return
            states = buttons.get(button_id)
            if states is None:
                return
            states.pop(state_id, None)
            if not states:
                buttons.pop(button_id, None)
            if not buttons:
                self._data.pop(device_id, None)
        await self._async_save()

    async def async_clear_device(self, device_id: str) -> None:
        if self._data.pop(device_id, None) is not None:
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
