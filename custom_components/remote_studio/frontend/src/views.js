/**
 * Render functions for each panel view. They're attached to the panel
 * class via prototype assignment in panel.js, so they read state through
 * `this` and stay paired with the wiring logic in that file.
 *
 *   renderList         — home view: discovered remotes + candidates + layouts
 *   renderRemoteView   — single remote: SVG, button list, state list, editor
 *   renderEditor       — the per-state JSON action editor (used by remote view)
 */
import { STATE_DEFAULT_TEMPLATE } from "./constants.js";
import {
  countConfiguredStates,
  describeActions,
  escapeAttr,
  escapeHtml,
} from "./helpers.js";
import { batteryChipHtml, integrationChipHtml } from "./chips.js";

export function renderList() {
  const definitionsById = new Map(this._definitions.map((d) => [d.id, d]));

  const remotes = this._remotes
    .map((r) => {
      const def = definitionsById.get(r.definition_id);
      const thumb = def?.svg ? def.svg : "";
      const layoutName = def?.name || r.definition_id;
      const battery = batteryChipHtml(r.battery, def?.battery);
      const integration = integrationChipHtml(r.integration);
      return `
        <button class="card" data-device-id="${escapeAttr(r.device_id)}">
          <div class="card-thumb">${thumb}</div>
          <div class="card-body">
            <div class="card-title">${escapeHtml(r.device_name) || "Unnamed remote"}</div>
            <div class="card-meta">${escapeHtml(layoutName)}</div>
            <div class="card-meta-soft">${escapeHtml(r.manufacturer || "")}${r.model ? ` · ${escapeHtml(r.model)}` : ""}</div>
            <div class="card-chips">${integration}${battery}</div>
          </div>
          <div class="card-arrow">›</div>
        </button>`;
    })
    .join("");

  const defs = this._definitions
    .map(
      (d) =>
        `<li><strong>${escapeHtml(d.name)}</strong> <small>(${d.buttons.length} buttons)</small></li>`,
    )
    .join("");

  const layoutOptions = this._definitions
    .map(
      (d) =>
        `<option value="${escapeAttr(d.id)}">${escapeHtml(d.name)}</option>`,
    )
    .join("");

  const candidates = this._candidates
    .map(
      (c) => `
      <div class="candidate">
        <div class="candidate-info">
          <div class="title">${escapeHtml(c.device_name) || "Unnamed device"}</div>
          <div class="meta">${escapeHtml(c.manufacturer || "")} · ${escapeHtml(c.model || "")}</div>
          <div class="card-chips">${integrationChipHtml(c.integration)}</div>
        </div>
        <div class="candidate-actions">
          <select data-pair-device="${escapeAttr(c.device_id)}">
            <option value="">Pair with layout…</option>
            ${layoutOptions}
          </select>
        </div>
      </div>`,
    )
    .join("");

  return `
    <header class="page-header">
      <h1>Remote Studio</h1>
      <p class="lead">Configure your Zigbee and Matter remotes visually.</p>
    </header>
    ${this._error ? `<div class="error">${escapeHtml(this._error)}</div>` : ""}
    <section>
      <h2>Discovered remotes</h2>
      ${
        this._remotes.length
          ? `<div class="grid">${remotes}</div>`
          : `<div class="empty">No matching remotes paired yet. Pair a supported remote in ZHA or Zigbee2MQTT to see it here.</div>`
      }
    </section>
    ${
      this._candidates.length
        ? `<section>
          <h2>Unmatched Zigbee/Matter devices</h2>
          <p class="lead">These devices are paired but no layout matches automatically. Pick one to try.</p>
          <div class="candidate-list">${candidates}</div>
        </section>`
        : ""
    }
    <section>
      <h2>Available layouts</h2>
      ${this._definitions.length ? `<ul>${defs}</ul>` : "<p>No layouts loaded.</p>"}
    </section>
  `;
}

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
    .map((b) => {
      const isSelected = b.id === selectedButton?.id;
      const configured = countConfiguredStates(mappings?.[b.id]);
      return `
        <li
          class="btn-row ${isSelected ? "selected" : ""}"
          data-button-id="${escapeAttr(b.id)}"
        >
          <span class="btn-label">${escapeHtml(b.label || b.id)}</span>
          <span class="btn-meta">${configured}/${b.states.length} states</span>
        </li>`;
    })
    .join("");

  const stateRows = (selectedButton?.states || [])
    .map((s) => {
      const actions = mappings?.[selectedButton.id]?.[s.id] || [];
      const isSelected = s.id === this._selectedStateId;
      return `
        <div
          class="state-row ${isSelected ? "selected" : ""}"
          data-state-id="${escapeAttr(s.id)}"
        >
          <div class="state-label">${escapeHtml(s.label || s.id)}</div>
          <div class="state-summary">${describeActions(actions)}</div>
        </div>`;
    })
    .join("");

  const editor =
    selectedButton && this._selectedStateId
      ? renderEditor.call(this, selectedButton)
      : "";

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
    </header>
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

export function renderEditor(selectedButton) {
  const stateLabel =
    selectedButton.states.find((s) => s.id === this._selectedStateId)?.label ||
    this._selectedStateId;
  const recommended = STATE_DEFAULT_TEMPLATE[this._selectedStateId];
  const tplBtn = (key, label) =>
    `<button data-template="${key}" class="${key === recommended ? "recommended" : ""}">${escapeHtml(label)}</button>`;
  return `
    <div class="editor">
      <div class="editor-header">
        <h2>Actions for ${escapeHtml(selectedButton.label || selectedButton.id)} · ${escapeHtml(stateLabel)}</h2>
        ${this._editorDirty ? '<span class="dirty">unsaved</span>' : ""}
      </div>
      <div class="quick-insert">
        <span>Light:</span>
        ${tplBtn("brighten", "Brighten")}
        ${tplBtn("dim", "Dim")}
        ${tplBtn("toggle", "Toggle")}
        ${tplBtn("light_scene", "Set scene")}
      </div>
      <div class="quick-insert">
        <span>Other:</span>
        ${tplBtn("service", "Service call")}
        ${tplBtn("scene", "Scene")}
        ${tplBtn("script", "Script")}
        ${tplBtn("automation", "Trigger automation")}
        ${tplBtn("delay", "Delay")}
      </div>
      <textarea class="editor-text" spellcheck="false"
        placeholder='Empty — use Insert above, or paste a JSON action list.'
      >${escapeHtml(this._editorText)}</textarea>
      ${this._editorError ? `<div class="editor-error">${escapeHtml(this._editorError)}</div>` : ""}
      <div class="editor-actions">
        <button class="primary" data-act="save">Save</button>
        <button data-act="test">Test</button>
        <button data-act="clear">Clear</button>
      </div>
      <p class="hint">JSON list of action steps (matches HA's automation <code>action:</code> block).</p>
    </div>
  `;
}
