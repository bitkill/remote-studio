/**
 * Remote-detail view — SVG layout, button list, state list, editor.
 *
 * Called as a method on RemoteStudioPanel. The header includes the
 * integration chip, battery chip, "Open in HA" link and Test-mode toggle.
 */
import { batteryChipHtml, integrationChipHtml } from "../chips.js";
import {
  countConfiguredStates,
  describeActions,
  escapeAttr,
  escapeHtml,
} from "../helpers.js";
import { renderEditor } from "./editor.js";

export function renderRemoteView() {
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
  `;
}

function renderHeader(device, definition) {
  const batteryChip = batteryChipHtml(
    this._currentRemote.battery,
    this._currentRemote.definition?.battery,
  );
  const integrationChip = integrationChipHtml(device.integration);
  // Small cog next to the device name → jumps to the device's HA page.
  // Uses HA's own <ha-icon> web component so the glyph matches the rest
  // of the HA UI exactly (and tracks any future icon-set changes).
  const deviceCog = `<a class="device-cog"
      href="/config/devices/device/${escapeAttr(device.id)}"
      title="Open this device in Home Assistant"
      aria-label="Open this device in Home Assistant"
      rel="noopener">
      <ha-icon icon="mdi:cog"></ha-icon>
    </a>`;
  return `
    <header class="page-header with-back">
      <button class="back">← Back</button>
      <div class="header-info">
        <h1 class="device-title">
          <span>${escapeHtml(device.name) || "Remote"}</span>
          ${deviceCog}
        </h1>
        <p class="lead">${escapeHtml(definition.name)} · ${escapeHtml(device.manufacturer || "")}</p>
      </div>
      ${integrationChip}
      ${batteryChip}
      <label class="test-toggle">
        <input type="checkbox" ${this._testMode ? "checked" : ""} data-test-toggle />
        <span>Test mode</span>
      </label>
    </header>`;
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
