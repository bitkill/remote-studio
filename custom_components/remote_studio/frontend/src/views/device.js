/**
 * Device view — SVG layout, button list, state list, editor.
 *
 * Called as a method on RemoteStudioPanel. The header includes the
 * integration chip, battery chip, cog link, and Test-mode toggle.
 */
import { batteryChipHtml, integrationChipHtml } from "../chips.js";
import {
  countConfiguredStates,
  describeActions,
  escapeAttr,
  escapeHtml,
} from "../helpers.js";
import { renderEditor } from "./editor.js";
import { renderEventLogDevice } from "./log.js";

export function renderDevice() {
  if (!this._currentRemote) {
    return `
      <header class="page-header">
        <button class="back">← Back</button>
        <h1>Loading…</h1>
      </header>
      ${this._error ? `<div class="error">${escapeHtml(this._error)}</div>` : ""}
    `;
  }

  const { device, definition, svg, mappings } = this._currentRemote;
  const selectedButton =
    definition.buttons.find((b) => b.id === this._selectedButtonId) ||
    definition.buttons[0];

  const buttonItems = definition.buttons
    .map((b) => renderButtonRow(b, selectedButton, mappings))
    .join("");

  const stateRows = (selectedButton?.states || [])
    .map((s) => renderStateRow(s, selectedButton, mappings, this._selectedStateId))
    .join("");

  const editor =
    selectedButton && this._selectedStateId
      ? renderEditor.call(this, selectedButton)
      : "";

  return `
    ${renderHeader.call(this, device, definition)}
    ${this._error ? `<div class="error">${escapeHtml(this._error)}</div>` : ""}
    ${this._toast ? `<div class="toast">${escapeHtml(this._toast)}</div>` : ""}
    ${renderAutomationWarning(this._currentRemote.automations)}
    <div class="remote-layout">
      <div class="remote-stage">${svg || '<div class="empty">No SVG layout for this remote.</div>'}</div>
      <aside class="remote-side">
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
      </aside>
    </div>
    ${renderEventLogDevice.call(this, device.id)}
  `;
}

function renderHeader(device, definition) {
  const batteryChip = batteryChipHtml(
    this._currentRemote.battery,
    this._currentRemote.definition?.battery,
  );
  const integrationChip = integrationChipHtml(device.integration);
  // Small cog next to the device name → jumps to the device's HA page.
  // Inline SVG using the MDI `cog` path (the same glyph HA's <ha-icon>
  // resolves to) so it always renders even when HA hasn't pre-loaded its
  // icon-set into our shadow DOM.
  const deviceCog = `<a class="device-cog"
      href="/config/devices/device/${escapeAttr(device.id)}"
      title="Open this device in Home Assistant"
      aria-label="Open this device in Home Assistant"
      rel="noopener">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" />
      </svg>
    </a>`;
  return `
    <header class="page-header with-back">
      <button class="back">← Back</button>
      <div class="header-info">
        <h1 class="device-title">
          <span>${escapeHtml(device.name) || "Remote"}</span>
          ${deviceCog}
        </h1>
        <p class="lead">${escapeHtml(definition.name)}${
          device.area ? ` · ${escapeHtml(device.area.name)}` : ""
        }</p>
      </div>
      ${integrationChip}
      ${batteryChip}
      <label class="test-toggle">
        <input type="checkbox" ${this._testMode ? "checked" : ""} data-test-toggle />
        <span>Test mode</span>
      </label>
    </header>`;
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

function renderButtonRow(button, selectedButton, mappings) {
  const isSelected = button.id === selectedButton?.id;
  const configured = countConfiguredStates(mappings?.[button.id]);
  return `
    <li
      class="btn-row ${isSelected ? "selected" : ""}"
      data-button-id="${escapeAttr(button.id)}"
    >
      <span class="btn-label">${escapeHtml(button.label || button.id)}</span>
      <span class="btn-meta">${configured}/${button.states.length} states</span>
    </li>`;
}

function renderStateRow(state, selectedButton, mappings, selectedStateId) {
  const actions = mappings?.[selectedButton.id]?.[state.id] || [];
  const isSelected = state.id === selectedStateId;
  return `
    <div
      class="state-row ${isSelected ? "selected" : ""}"
      data-state-id="${escapeAttr(state.id)}"
    >
      <div class="state-label">${escapeHtml(state.label || state.id)}</div>
      <div class="state-summary">${describeActions(actions)}</div>
    </div>`;
}
