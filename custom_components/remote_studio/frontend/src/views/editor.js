/**
 * Action editor — the per-state JSON editor with quick-insert templates.
 *
 * Called as a method on RemoteStudioPanel (`this` is the panel) and
 * receives the currently selected button (so the title is meaningful).
 */
import {
  STATE_DEFAULT_TEMPLATE,
  TARGET_DOMAINS,
  TARGET_DOMAIN_LABELS,
} from "../constants.js";
import { escapeAttr, escapeHtml } from "../helpers.js";

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
      ${renderTargetPicker.call(this, selectedButton)}
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

// "Target" dropdown — picks the entity the quick-insert templates will
// fill in. Persisted per (device, button) in localStorage so each dot
// on a BILRESA can target a different light.
function renderTargetPicker(selectedButton) {
  const states = this._hass?.states || {};
  const buckets = Object.fromEntries(TARGET_DOMAINS.map((d) => [d, []]));
  for (const [id, st] of Object.entries(states)) {
    const dot = id.indexOf(".");
    if (dot < 0) continue;
    const domain = id.slice(0, dot);
    if (!(domain in buckets)) continue;
    const name = st.attributes?.friendly_name || id;
    buckets[domain].push({ id, name });
  }

  let optgroups = "";
  let totalEntities = 0;
  for (const domain of TARGET_DOMAINS) {
    const list = buckets[domain];
    if (!list.length) continue;
    list.sort((a, b) => a.name.localeCompare(b.name));
    totalEntities += list.length;
    optgroups += `<optgroup label="${escapeAttr(TARGET_DOMAIN_LABELS[domain])}">`;
    for (const { id, name } of list) {
      const selected =
        id === this._currentTarget ? " selected" : "";
      optgroups += `<option value="${escapeAttr(id)}"${selected}>${escapeHtml(name)}</option>`;
    }
    optgroups += "</optgroup>";
  }

  // If the current target isn't in HA's states (renamed / removed),
  // include it explicitly so the dropdown still shows it.
  const stale =
    this._currentTarget && !states[this._currentTarget]
      ? `<option value="${escapeAttr(this._currentTarget)}" selected>${escapeHtml(this._currentTarget)} (not found)</option>`
      : "";

  const helpText = totalEntities
    ? `Used by Insert · saved per ${escapeHtml(selectedButton.label || selectedButton.id)}`
    : `No targetable entities available — Insert will use placeholders.`;

  return `
    <div class="target-picker">
      <label>
        <span>Target</span>
        <select data-target>
          <option value="">(no target — use placeholder)</option>
          ${stale}
          ${optgroups}
        </select>
      </label>
      <small>${helpText}</small>
    </div>
  `;
}
