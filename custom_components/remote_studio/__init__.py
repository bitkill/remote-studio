"""Remote Studio integration."""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .registry import async_get_registry
from .runtime import async_get_runtime, async_stop_runtime
from .storage import async_get_store

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Remote Studio from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {}
    await async_get_store(hass)
    await async_get_registry(hass)
    await async_get_runtime(hass)
    _LOGGER.debug("Remote Studio entry %s set up", entry.entry_id)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a Remote Studio config entry."""
    await async_stop_runtime(hass)
    hass.data[DOMAIN].pop(entry.entry_id, None)
    return True
