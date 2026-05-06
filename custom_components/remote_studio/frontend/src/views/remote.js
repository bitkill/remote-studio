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
  const haDeviceLink = `<a class="ha-link"
      href="/config/devices/device/${escapeAttr(device.id)}"
      title="Open this device in Home Assistant"
      rel="noopener">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z" />
      </svg>
      <span>Open in HA</span>
    </a>`;
  return `
    <header class="page-header with-back">
      <button class="back">← Back</button>
      <div class="header-info">
        <h1>${escapeHtml(device.name) || "Remote"}</h1>
        <p class="lead">${escapeHtml(definition.name)} · ${escapeHtml(device.manufacturer || "")}</p>
      </div>
      ${integrationChip}
      ${batteryChip}
      ${haDeviceLink}
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
