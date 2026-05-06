/**
 * Stateless utility helpers — escaping, formatting, battery icon picking.
 */
import { BATTERY_ICONS, MDI_PATHS } from "./constants.js";

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}

// Same encoding rules as escapeHtml work for HTML attributes too.
export const escapeAttr = escapeHtml;

export function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  // Sufficient for our state ids (alnum + underscore).
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

export function batteryPercent(state) {
  const n = Number(state);
  return Number.isFinite(n) ? n : null;
}

export function batteryIconPath(state) {
  const n = batteryPercent(state);
  if (n === null) return BATTERY_ICONS.unknown;
  if (n <= 15) return BATTERY_ICONS.alert;
  if (n <= 60) return BATTERY_ICONS.half;
  return BATTERY_ICONS.full;
}

export function batteryIcon(state) {
  return `<svg class="battery-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="${batteryIconPath(state)}" />
  </svg>`;
}

// Inline SVG icon. Entries in MDI_PATHS are either a path string (default
// 24×24 viewBox) or an object with a custom viewBox for non-MDI artwork.
export function mdiIcon(name, className = "") {
  const entry = MDI_PATHS[name];
  if (!entry) return "";
  const d = typeof entry === "string" ? entry : entry.d;
  const viewBox = typeof entry === "string" ? "0 0 24 24" : entry.viewBox;
  const cls = className ? ` class="${className}"` : "";
  return `<svg viewBox="${viewBox}" aria-hidden="true"${cls}><path d="${d}" /></svg>`;
}

export function batteryClass(state) {
  const n = batteryPercent(state);
  if (n === null) return "is-unknown";
  if (n <= 10) return "is-critical";
  if (n <= 25) return "is-low";
  if (n >= 80) return "is-good";
  return "";
}

// One-line summary of an action list — used in the side-panel state rows.
export function describeActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return "Not configured";
  if (actions.length === 1) {
    const a = actions[0];
    if (a.service) return `Call ${a.service}`;
    if (a.scene) return `Activate scene ${a.scene}`;
    if (a.choose) return "Choose / if-then";
    if (a.delay) return "Delay";
    return "Custom action";
  }
  return `${actions.length} steps`;
}
