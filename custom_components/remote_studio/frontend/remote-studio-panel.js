/**
 * Remote Studio panel — entry module.
 *
 * panel_custom loads this file as an ES module. The actual implementation
 * is split across `src/`:
 *
 *   backend.js       — the panel's interface to HA (11 methods, BackendError)
 *   constants.js     — WS command names, action templates, integration / battery info
 *   helpers.js       — escape, formatting, battery icon picker, etc.
 *   chips.js         — integration & battery chip HTML helpers
 *   styles.js        — all CSS for the shadow root
 *   views/index.js   — index page (cards + unmatched candidates)
 *   views/device.js  — device page (SVG + button & state lists)
 *   views/editor.js  — per-state JSON action editor
 *   views/state-row.js — the one template for a state's summary row
 *   panel.js         — the RemoteStudioPanel custom element class
 *
 * Routes:
 *   /remote-studio                            → index view
 *   /remote-studio/device/<device_id>         → device view
 *   /remote-studio/device/<device_id>:<def>   → device view, manual layout
 *
 * This file is intentionally tiny — it just registers the element.
 */
import { RemoteStudioPanel } from "./src/panel.js";

if (!customElements.get("remote-studio-panel")) {
  customElements.define("remote-studio-panel", RemoteStudioPanel);
}
