/**
 * Remote Studio panel — entry module.
 *
 * panel_custom loads this file as an ES module. The actual implementation
 * is split across `src/`:
 *
 *   constants.js     — WS commands, action templates, integration / battery info
 *   helpers.js       — escape, formatting, battery icon picker, etc.
 *   chips.js         — integration & battery chip HTML helpers
 *   styles.js        — all CSS for the shadow root
 *   views/list.js    — home view (cards + candidates + layouts)
 *   views/remote.js  — remote-detail view (SVG + button & state lists)
 *   views/editor.js  — per-state JSON action editor
 *   panel.js         — the RemoteStudioPanel custom element class
 *
 * This file is intentionally tiny — it just registers the element.
 */
import { RemoteStudioPanel } from "./src/panel.js";

if (!customElements.get("remote-studio-panel")) {
  customElements.define("remote-studio-panel", RemoteStudioPanel);
}
