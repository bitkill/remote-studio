"""Config flow for Remote Studio.

Single-instance flow: the user simply confirms set-up. There is nothing
device-specific to configure here — the integration discovers remotes from
the device registry at runtime.
"""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN, PANEL_TITLE


class RemoteStudioConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a single-instance config flow for Remote Studio."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Confirm enabling Remote Studio."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is None:
            return self.async_show_form(step_id="user")

        return self.async_create_entry(title=PANEL_TITLE, data={})
