"""Sidebar panel registration."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.core import HomeAssistant

from .const import DOMAIN, PANEL_ICON, PANEL_TITLE, PANEL_URL_PATH

_PANEL_WEBCOMPONENT = "remote-studio-panel"
_PANEL_FILENAME = "remote-studio-panel.js"
_STATIC_URL = f"/api/{DOMAIN}/static"


async def async_register(hass: HomeAssistant) -> None:
    """Idempotently register the panel and its static-asset path."""
    if hass.data[DOMAIN].get("panel_registered"):
        return

    frontend_dir = Path(__file__).parent / "frontend"
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                _STATIC_URL,
                str(frontend_dir),
                cache_headers=False,
            )
        ]
    )

    await async_register_panel(
        hass,
        webcomponent_name=_PANEL_WEBCOMPONENT,
        frontend_url_path=PANEL_URL_PATH,
        module_url=f"{_STATIC_URL}/{_PANEL_FILENAME}",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        require_admin=True,
    )
    hass.data[DOMAIN]["panel_registered"] = True
