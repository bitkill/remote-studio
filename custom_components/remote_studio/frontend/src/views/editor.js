/**
 * Action editor — the per-state JSON editor with quick-insert templates.
 *
 * Called as a method on RemoteStudioPanel (`this` is the panel) and
 * receives the currently selected button (so the title is meaningful).
 */
import { STATE_DEFAULT_TEMPLATE } from "../constants.js";
import { escapeHtml } from "../helpers.js";

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
