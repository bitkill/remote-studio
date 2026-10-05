/**
 * State row — the one template for a button's state in the side panel.
 *
 * Both render paths use it: the full page render (views/device.js) and
 * the surgical refresh after a group-card change (panel.js
 * _refreshStateRows), so the two can never disagree about the text.
 *
 * Pure: string in, string out. `groupCfg` is the group's config with
 * defaults applied (see core/mappings.py), `override` the action list
 * from the advanced editor or undefined.
 */
import { describeActions, escapeAttr, escapeHtml } from "../helpers.js";

export const ROLE_LABELS = {
  turn_on: "On",
  turn_off: "Off",
  toggle: "Toggle",
  dim_up: "Dim ▲",
  dim_down: "Dim ▼",
  scene: "Scene",
  none: "—",
};

// Stored [r, g, b] → "#rrggbb" for <input type="color">, or null when
// no colour is set.
export function rgbToHex(rgb) {
  if (!Array.isArray(rgb) || rgb.length !== 3) return null;
  const [r, g, b] = rgb.map((v) => Math.max(0, Math.min(255, Number(v) || 0)));
  const h = (n) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

// First entity id in a target, or a word for area/device targets.
export function describeTargetShort(target) {
  if (!target || typeof target !== "object") return "";
  if (target.entity_id) {
    return Array.isArray(target.entity_id) ? target.entity_id[0] : target.entity_id;
  }
  if (target.device_id) return "device";
  if (target.area_id) return "area";
  return "";
}

export function describeRole(role, groupCfg) {
  const t = describeTargetShort(groupCfg.target);
  switch (role) {
    case "turn_on":
      return `Turn on ${t}`;
    case "turn_off":
      return `Turn off ${t}`;
    case "toggle":
      return `Toggle ${t}`;
    case "dim_up":
      return `Brighten ${t} (+${groupCfg.dim_step}%)`;
    case "dim_down":
      return `Dim ${t} (-${groupCfg.dim_step}%)`;
    case "scene": {
      const hex = rgbToHex(groupCfg.scene_color);
      const pct = groupCfg.scene_brightness;
      return hex ? `Scene on ${t} (${pct}% @ ${hex})` : `Scene on ${t} (${pct}%)`;
    }
    default:
      return "Unbound";
  }
}

// The summary line: what this state will do, and how to style it.
export function stateSummary(state, groupCfg, override) {
  if (Array.isArray(override) && override.length > 0) {
    return { text: `Override · ${describeActions(override)}`, cls: "override" };
  }
  if (state.role === "none") return { text: "Unbound", cls: "muted" };
  if (!groupCfg.target) return { text: "Pick a target above", cls: "muted" };
  return { text: `Default · ${describeRole(state.role, groupCfg)}`, cls: "default" };
}

export function renderStateRow(state, groupCfg, override, isSelected) {
  const { text, cls } = stateSummary(state, groupCfg, override);
  return `
    <div
      class="state-row ${isSelected ? "selected" : ""}"
      data-state-id="${escapeAttr(state.id)}"
    >
      <div class="state-main">
        <div class="state-label">
          ${escapeHtml(state.label || state.id)}
          <span class="role-pill role-${escapeAttr(state.role)}">${escapeHtml(ROLE_LABELS[state.role] || state.role)}</span>
        </div>
        <div class="state-summary ${cls}">${escapeHtml(text)}</div>
      </div>
    </div>`;
}
