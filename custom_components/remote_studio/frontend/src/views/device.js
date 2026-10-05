/**
 * Device view — controls cards, SVG layout, button list, advanced override editor.
 *
 * The big shift in v2: each remote has one or more "groups" (dot1/dot2/dot3
 * for the BILRESA wheel; a single "main" group for everything else). Pick a
 * target per group and the runtime turns role-tagged states (turn_on,
 * turn_off, dim_up, dim_down, toggle) into default actions automatically.
 * The advanced override editor is only there as an escape hatch.
 */
import { batteryChipHtml, integrationChipHtml } from "../chips.js";
import { escapeAttr, escapeHtml } from "../helpers.js";
import { renderEditor } from "./editor.js";
import { renderEventLogDevice } from "./log.js";
import { renderStateRow, rgbToHex } from "./state-row.js";

export function renderDevice() {
  if (!this._currentRemote) {
    return `
      <hass-subpage header="Loading…">
        <div class="page-content">
          ${this._error ? `<div class="error">${escapeHtml(this._error)}</div>` : ""}
        </div>
      </hass-subpage>
    `;
  }

  const { device, definition, svg } = this._currentRemote;
  const selectedButton =
    definition.buttons.find((b) => b.id === this._selectedButtonId) ||
    definition.buttons[0];

  const groupCards = (definition.groups || [])
    .map((g) => renderGroupCard.call(this, g))
    .join("");

  const batteryChip = batteryChipHtml(
    this._currentRemote.battery,
    this._currentRemote.definition?.battery,
  );
  const integrationChip = integrationChipHtml(device.integration);
  const pairing = renderPairingControl(this._currentRemote);
  const deviceCog = `<a slot="toolbar-icon" class="device-cog"
      href="/config/devices/device/${escapeAttr(device.id)}"
      title="Open this device in Home Assistant"
      aria-label="Open this device in Home Assistant"
      rel="noopener">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" />
      </svg>
    </a>`;

  return `
    <hass-subpage header="${escapeAttr(device.name || "Remote")}">
      ${deviceCog}
      <div class="page-content">
        <div class="device-meta">
          ${integrationChip}${batteryChip}
          <label class="test-toggle">
            <input type="checkbox" ${this._testMode ? "checked" : ""} data-test-toggle />
            <span>Test mode</span>
          </label>
          ${pairing}
        </div>
        ${this._error ? `<div class="error">${escapeHtml(this._error)}</div>` : ""}
        <div class="toast ${this._toast ? "show" : ""}" data-toast>${escapeHtml(this._toast || "")}</div>
        ${renderHealthWarning(this._currentRemote.health)}
        ${renderAutomationWarning(this._currentRemote.automations)}
        <section class="groups-section">${groupCards}</section>
        <div class="remote-layout">
          <div class="remote-stage">${svg || '<div class="empty">No SVG layout for this remote.</div>'}</div>
          <aside class="remote-side">${renderRemoteSideContent.call(this, definition, selectedButton)}</aside>
        </div>
        ${renderEventLogDevice.call(this, device.id)}
      </div>
    </hass-subpage>
  `;
}

// Pairing control. A stored pairing drives physical presses and test
// mode (see EventRuntime.definitions_for), so the view says which state
// it is in: previewing a layout that is not (yet) the pairing, or
// showing the paired one.
function renderPairingControl(remote) {
  const paired = remote.paired_definition_id || null;
  const shown = remote.definition?.id;
  if (paired && paired === shown) {
    return `<button type="button" class="pair-button is-paired"
      data-unpair-layout
      title="Stop using ${escapeAttr(remote.definition.name)} for this device and fall back to auto-detection">
      Change layout</button>`;
  }
  return `<button type="button" class="pair-button"
    data-pair-layout="${escapeAttr(shown || "")}"
    title="Store ${escapeAttr(remote.definition?.name || "this layout")} as this device's layout — presses and test mode will use it">
    Use this layout</button>`;
}

// Markup for the side-panel: button list + state list + (optional) editor.
// Extracted so panel.js can swap it in surgically when a remote event
// flips the selected button — full _render() during a press would reset
// the live state pane to a stale cached value (race vs. the
// state-trigger subscription).
export function renderRemoteSideContent(definition, selectedButton) {
  const buttonItems = definition.buttons
    .map((b) => renderButtonRow(b, selectedButton))
    .join("");
  const groupCfg = selectedButton ? this._group(selectedButton.group) : null;
  const overrides = this._currentRemote.overrides?.[selectedButton?.id] || {};
  const stateRows = (selectedButton?.states || [])
    .map((s) =>
      renderStateRow(s, groupCfg, overrides[s.id], s.id === this._selectedStateId),
    )
    .join("");
  const editor =
    selectedButton && this._selectedStateId && this._advancedOpen
      ? renderEditor.call(this, selectedButton)
      : "";
  return `
    <h2>Buttons</h2>
    <ul class="btn-list">${buttonItems}</ul>
    ${
      selectedButton
        ? `
      <h2>${escapeHtml(selectedButton.label || selectedButton.id)} states</h2>
      <div class="state-list">${stateRows}</div>`
        : ""
    }
    ${editor}
  `;
}


// Surface required-but-disabled entities (e.g. matter
// current_switch_position sensors) with a one-click fix that calls
// the WS_ENABLE_ENTITIES command.
function renderHealthWarning(health) {
  const disabled = health?.disabled_entities;
  if (!Array.isArray(disabled) || disabled.length === 0) return "";
  const items = disabled
    .map((d) => `<li><code>${escapeHtml(d.entity_id)}</code></li>`)
    .join("");
  const n = disabled.length;
  return `
    <div class="automation-warning health-warning" role="status">
      <div class="warning-icon" aria-hidden="true">⚠</div>
      <div class="warning-body">
        <div class="warning-lead">${n} sensor${n === 1 ? " is" : "s are"} disabled — rotation and press won't fire until ${n === 1 ? "it's" : "they're"} on.</div>
        <p class="hint">Matter ships these <code>current_switch_position</code> sensors disabled by default; enabling them is what gives you low-latency dispatch.</p>
        <ul class="warning-list">${items}</ul>
        <button class="primary health-fix" data-enable-entities>Enable ${n} sensor${n === 1 ? "" : "s"}</button>
        <p class="hint">After enabling, allow ~30 s for HA's matter integration to start polling the new entities.</p>
      </div>
    </div>
  `;
}

function renderAutomationWarning(automations) {
  if (!Array.isArray(automations) || automations.length === 0) return "";
  const items = automations
    .map((a) => {
      const href = a.unique_id
        ? `/config/automation/edit/${encodeURIComponent(a.unique_id)}`
        : "/config/automation/dashboard";
      return `<li><a href="${escapeAttr(href)}" rel="noopener">${escapeHtml(a.name || a.entity_id)}</a></li>`;
    })
    .join("");
  const lead =
    automations.length === 1
      ? "An automation is also triggered by this remote — actions you wire here will run alongside it."
      : `${automations.length} automations are also triggered by this remote — actions you wire here will run alongside them.`;
  return `
    <div class="automation-warning" role="status">
      <div class="warning-icon" aria-hidden="true">⚠</div>
      <div class="warning-body">
        <div class="warning-lead">${escapeHtml(lead)}</div>
        <ul class="warning-list">${items}</ul>
        <p class="hint">Either disable / edit the automation, or skip configuring overlapping states here to avoid the action firing twice.</p>
      </div>
    </div>
  `;
}

// One card per group: target picker (HA's native ha-target-picker, wired
// up post-render) + dim-step input (only when the group has any dim role).
function renderGroupCard(group) {
  // Group config arrives with defaults applied (see core/mappings.py);
  // a group the user never touched is absent, so fall back to the
  // server-supplied defaults rather than literals.
  const stored =
    this._currentRemote.groups?.[group.id] || this._currentRemote.group_defaults;
  const dimStep = stored.dim_step;
  const targetSummary = describeTarget(stored.target);
  const dimRow = group.has_dim
    ? `
        <label class="dim-step">
          <span>Dim step</span>
          <input type="range" min="0" max="30" step="5"
            value="${dimStep}"
            data-dim-step="${escapeAttr(group.id)}"
            aria-label="Dim step (0-30% in 5% increments)" />
          <output class="dim-step-value">${dimStep}%</output>
        </label>`
    : "";
  // No colour by default: the input shows neutral white and is marked
  // `unset` until the user picks one; the runtime then applies only
  // brightness.
  const hasColor = Array.isArray(stored.scene_color);
  const sceneColor = rgbToHex(stored.scene_color) || "#ffffff";
  const sceneBrightness = stored.scene_brightness;
  const sceneOverridden = !stored.scene_is_default;
  const sceneRow = group.has_scene
    ? `
        <div class="scene-config">
          <div class="scene-config-head">
            <span>Long-press scene</span>
            <button type="button"
              class="scene-reset"
              data-scene-reset="${escapeAttr(group.id)}"
              ${sceneOverridden ? "" : "disabled"}
              title="Reset to default brightness, no colour"
              aria-label="Reset scene to default">↺</button>
          </div>
          <div class="scene-config-row">
            <input type="color"
              class="${hasColor ? "" : "unset"}"
              value="${escapeAttr(sceneColor)}"
              data-scene-color="${escapeAttr(group.id)}"
              title="${hasColor ? "Colour applied on long-press" : "No colour — brightness only. Click to pick one."}" />
            <input type="range" min="1" max="100" step="5"
              value="${sceneBrightness}"
              data-scene-brightness="${escapeAttr(group.id)}"
              aria-label="Scene brightness percent" />
            <output class="scene-brightness-value">${sceneBrightness}%</output>
          </div>
        </div>`
    : "";
  const tags = [];
  if (group.has_dim) tags.push('<span class="group-tag">dimmable</span>');
  if (group.has_scene) tags.push('<span class="group-tag">scene</span>');
  return `
    <div class="group-card">
      <div class="group-card-head">
        <h3>${escapeHtml(group.label)}</h3>
        ${tags.join("")}
      </div>
      <div class="group-card-body">
        <div class="group-card-controls">
          <div class="group-target-slot" data-group="${escapeAttr(group.id)}"></div>
          ${dimRow}
          ${sceneRow}
          <small class="group-summary">${escapeHtml(targetSummary)}</small>
        </div>
        <div class="group-card-state" data-state-pane="${escapeAttr(group.id)}"></div>
      </div>
    </div>`;
}

function describeTarget(target) {
  if (!target || typeof target !== "object") return "No target picked yet";
  const ids = []
    .concat(target.entity_id || [])
    .concat(target.device_id || [])
    .concat(target.area_id || []);
  if (!ids.length) return "No target picked yet";
  if (ids.length === 1) return `Controls ${ids[0]}`;
  return `Controls ${ids.length} targets`;
}

function renderButtonRow(button, selectedButton) {
  const isSelected = button.id === selectedButton?.id;
  return `
    <li
      class="btn-row ${isSelected ? "selected" : ""}"
      data-button-id="${escapeAttr(button.id)}"
    >
      <span class="btn-label">${escapeHtml(button.label || button.id)}</span>
      <span class="btn-meta">${escapeHtml(button.group)}</span>
    </li>`;
}

