/**
 * Remote Studio panel.
 *
 * Two views:
 *   - list:   discovered remotes + available layouts.
 *   - remote: one remote rendered as inline SVG with clickable hotspots.
 *
 * Live events from the backend pulse the matching SVG button so the user
 * gets instant visual feedback that the wiring works.
 *
 * The action editor (per-state action list) is wired in a follow-up commit.
 */

const WS_LIST = "remote_studio/list_remotes";
const WS_GET = "remote_studio/get_remote";
const WS_SAVE = "remote_studio/save_mapping";
const WS_CLEAR = "remote_studio/clear_mapping";
const WS_TEST = "remote_studio/test_action";
const WS_SUBSCRIBE = "remote_studio/subscribe_events";

const ACTION_TEMPLATES = {
  // Light-first defaults — most BILRESA / dimmer / button users want
  // these as the day-one mapping.
  brighten: [
    {
      service: "light.turn_on",
      target: { entity_id: "light.REPLACE_ME" },
      data: { brightness_step_pct: 10, transition: 0.3 },
    },
  ],
  dim: [
    {
      service: "light.turn_on",
      target: { entity_id: "light.REPLACE_ME" },
      data: { brightness_step_pct: -10, transition: 0.3 },
    },
  ],
  toggle: [
    {
      service: "light.toggle",
      target: { entity_id: "light.REPLACE_ME" },
      data: { transition: 0.3 },
    },
  ],
  light_scene: [
    {
      service: "light.turn_on",
      target: { entity_id: "light.REPLACE_ME" },
      data: {
        brightness_pct: 80,
        rgb_color: [255, 217, 168],
        transition: 0.5,
      },
    },
  ],
  // Generic fall-backs.
  service: [
    {
      service: "light.turn_on",
      target: { entity_id: "light.REPLACE_ME" },
    },
  ],
  scene: [{ service: "scene.turn_on", target: { entity_id: "scene.REPLACE_ME" } }],
  script: [{ service: "script.turn_on", target: { entity_id: "script.REPLACE_ME" } }],
  automation: [
    {
      service: "automation.trigger",
      target: { entity_id: "automation.REPLACE_ME" },
    },
  ],
  delay: [{ delay: { seconds: 1 } }],
};

// Map state-id prefix → recommended template, highlighted in the editor.
const STATE_DEFAULT_TEMPLATE = {
  rotate_cw: "brighten",
  rotate_ccw: "dim",
  press: "toggle",
  hold: "light_scene",
};

class RemoteStudioPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._hass = null;
    this._view = "list"; // 'list' | 'remote'
    this._listLoaded = false;
    this._remotes = [];
    this._candidates = [];
    this._definitions = [];
    this._testMode = false;
    this._currentRemote = null; // { device, definition, svg, mappings }
    this._selectedButtonId = null;
    this._selectedStateId = null;
    this._editorText = "";
    this._editorError = null;
    this._editorDirty = false;
    this._toast = null;
    this._error = null;

    this._eventUnsub = null;
    this._pulseTimers = new Map(); // device_id|button_id -> timer
  }

  // -------------------------------------------------------- lifecycle
  connectedCallback() {
    this._render();
  }

  disconnectedCallback() {
    if (this._eventUnsub) {
      try {
        this._eventUnsub();
      } catch (_) {
        /* noop */
      }
      this._eventUnsub = null;
    }
    for (const t of this._pulseTimers.values()) clearTimeout(t);
    this._pulseTimers.clear();
  }

  set hass(hass) {
    const wasNull = !this._hass;
    this._hass = hass;
    if (wasNull && hass) {
      if (!this._listLoaded) this._loadRemotes();
      this._subscribeEvents();
    }
  }

  get hass() {
    return this._hass;
  }

  // ------------------------------------------------------- data load
  async _loadRemotes() {
    this._listLoaded = true;
    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: WS_LIST,
      });
      this._remotes = Array.isArray(result.remotes) ? result.remotes : [];
      this._candidates = Array.isArray(result.candidates)
        ? result.candidates
        : [];
      this._definitions = Array.isArray(result.definitions)
        ? result.definitions
        : [];
      this._error = null;
    } catch (err) {
      this._error =
        (err && (err.message || err.code)) || "Failed to load remotes.";
    }
    this._render();
  }

  async _openRemote(deviceId, definitionId) {
    this._error = null;
    this._currentRemote = null;
    this._selectedButtonId = null;
    this._view = "remote";
    this._render();
    try {
      const msg = { type: WS_GET, device_id: deviceId };
      if (definitionId) msg.definition_id = definitionId;
      const result = await this._hass.connection.sendMessagePromise(msg);
      this._currentRemote = result;
      // Pre-select the first button + first state for convenience.
      if (result.definition?.buttons?.length) {
        this._selectedButtonId = result.definition.buttons[0].id;
        this._selectedStateId =
          result.definition.buttons[0].states?.[0]?.id ?? null;
        this._loadEditorFromMapping();
      }
    } catch (err) {
      this._error =
        (err && (err.message || err.code)) || "Failed to load remote.";
    }
    this._render();
  }

  _backToList() {
    this._view = "list";
    this._currentRemote = null;
    this._selectedButtonId = null;
    this._error = null;
    this._render();
  }

  async _subscribeEvents() {
    if (this._eventUnsub) return;
    try {
      this._eventUnsub = await this._hass.connection.subscribeMessage(
        (msg) => this._onRemoteEvent(msg),
        { type: WS_SUBSCRIBE },
      );
    } catch (err) {
      console.warn("Remote Studio: live event subscription failed", err);
    }
  }

  _onRemoteEvent(event) {
    if (!event || !event.device_id || !event.button_id) return;
    if (
      this._view !== "remote" ||
      this._currentRemote?.device?.id !== event.device_id
    ) {
      return;
    }
    this._pulseButton(event.button_id);
    if (event.state_id) {
      // Auto-jump to the firing button so the user sees its state list and
      // editor light up in response to physical input.
      if (this._selectedButtonId !== event.button_id) {
        this._selectedButtonId = event.button_id;
        // Don't reset the state's editor text — only update selection.
        this._render();
      }
      this._pulseStateRow(event.state_id);
      if (event.state_id.startsWith("rotate_")) {
        this._pulseWheel();
      }
    }
  }

  // -------------------------------------------------------- pulsing
  _pulseButton(buttonId) {
    this._addPulse(`button-${buttonId}`, 450);
  }

  _pulseStateRow(stateId) {
    const root = this.shadowRoot;
    if (!root) return;
    const row = root.querySelector(
      `.state-row[data-state-id="${cssEscape(stateId)}"]`,
    );
    if (!row) return;
    row.classList.add("is-pulsing");
    const key = `state:${stateId}`;
    const existing = this._pulseTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      row.classList.remove("is-pulsing");
      this._pulseTimers.delete(key);
    }, 600);
    this._pulseTimers.set(key, timer);
  }

  _pulseWheel() {
    this._addPulse("wheel", 480);
  }

  _addPulse(elementId, duration) {
    const root = this.shadowRoot;
    if (!root) return;
    const node = root.getElementById(elementId);
    if (!node) return;
    node.classList.add("is-pulsing");
    const existing = this._pulseTimers.get(elementId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      node.classList.remove("is-pulsing");
      this._pulseTimers.delete(elementId);
    }, duration);
    this._pulseTimers.set(elementId, timer);
  }

  // -------------------------------------------------------- render
  _render() {
    const root = this.shadowRoot;
    if (!root) return;

    root.innerHTML = `
      <style>${this._styles()}</style>
      ${this._view === "list" ? this._renderList() : this._renderRemoteView()}
    `;

    // Wire up event handlers after innerHTML.
    if (this._view === "list") {
      root
        .querySelectorAll("[data-device-id]")
        .forEach((el) =>
          el.addEventListener("click", () =>
            this._openRemote(el.dataset.deviceId),
          ),
        );
      root
        .querySelectorAll("[data-pair-device]")
        .forEach((select) =>
          select.addEventListener("change", (e) => {
            const definitionId = e.target.value;
            if (!definitionId) return;
            this._openRemote(e.target.dataset.pairDevice, definitionId);
          }),
        );
    } else {
      const back = root.querySelector(".back");
      if (back) back.addEventListener("click", () => this._backToList());
      this._wireSvg();
      this._wireButtonList();
    }
  }

  _wireSvg() {
    const root = this.shadowRoot;
    const svg = root.querySelector(".remote-stage svg");
    if (!svg) return;
    svg.querySelectorAll('[id^="button-"]').forEach((node) => {
      const buttonId = node.id.replace(/^button-/, "");
      node.addEventListener("click", () => this._onSvgButtonClick(buttonId));
      if (buttonId === this._selectedButtonId) {
        node.classList.add("is-active");
      }
    });
    const toggle = root.querySelector("[data-test-toggle]");
    if (toggle) {
      toggle.addEventListener("change", (e) => {
        this._testMode = !!e.target.checked;
        this._render();
      });
    }
  }

  _onSvgButtonClick(buttonId) {
    if (!this._testMode) {
      this._selectButton(buttonId);
      return;
    }
    // In test mode, fire the configured action for that button's currently
    // selected state, falling back to the first state if none selected on it.
    const button = this._currentRemote?.definition?.buttons?.find(
      (b) => b.id === buttonId,
    );
    if (!button) return;
    const stateId =
      this._selectedButtonId === buttonId && this._selectedStateId
        ? this._selectedStateId
        : button.states?.[0]?.id;
    if (!stateId) return;
    const actions =
      this._currentRemote?.mappings?.[buttonId]?.[stateId] || [];
    if (!actions.length) {
      this._showToast(`${button.label || buttonId} / ${stateId} is not configured`);
      this._pulseButton(buttonId);
      return;
    }
    this._pulseButton(buttonId);
    this._hass.connection
      .sendMessagePromise({ type: WS_TEST, actions })
      .then(() => this._showToast(`Triggered ${button.label || buttonId} / ${stateId}`))
      .catch((err) =>
        this._showToast(
          `Test failed: ${(err && (err.message || err.code)) || "error"}`,
        ),
      );
  }

  _wireButtonList() {
    const root = this.shadowRoot;
    root.querySelectorAll("[data-button-id]").forEach((el) => {
      el.addEventListener("click", () =>
        this._selectButton(el.dataset.buttonId),
      );
    });
    root.querySelectorAll("[data-state-id]").forEach((el) => {
      el.addEventListener("click", () =>
        this._selectState(el.dataset.stateId),
      );
    });
    this._wireEditor();
  }

  _wireEditor() {
    const root = this.shadowRoot;
    const textarea = root.querySelector(".editor-text");
    if (textarea) {
      textarea.addEventListener("input", (e) =>
        this._onEditorInput(e.target.value),
      );
    }
    root.querySelectorAll("[data-template]").forEach((btn) => {
      btn.addEventListener("click", () =>
        this._insertTemplate(btn.dataset.template),
      );
    });
    root.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        if (act === "save") this._saveActions();
        else if (act === "test") this._testActions();
        else if (act === "clear") this._clearActions();
      });
    });
  }

  _selectButton(buttonId) {
    this._selectedButtonId = buttonId;
    const btn = this._currentRemote?.definition?.buttons?.find(
      (b) => b.id === buttonId,
    );
    this._selectedStateId = btn?.states?.[0]?.id ?? null;
    this._loadEditorFromMapping();
    this._render();
  }

  _selectState(stateId) {
    this._selectedStateId = stateId;
    this._loadEditorFromMapping();
    this._render();
  }

  // -------------------------------------------------------- editor
  _loadEditorFromMapping() {
    const actions = this._currentActions();
    this._editorText = actions.length
      ? JSON.stringify(actions, null, 2)
      : "";
    this._editorError = null;
    this._editorDirty = false;
  }

  _currentActions() {
    if (!this._currentRemote || !this._selectedButtonId || !this._selectedStateId)
      return [];
    return (
      this._currentRemote.mappings?.[this._selectedButtonId]?.[
        this._selectedStateId
      ] || []
    );
  }

  _parseEditor() {
    const text = (this._editorText || "").trim();
    if (!text) return [];
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`Invalid JSON: ${err.message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error("Action list must be a JSON array.");
    }
    return parsed;
  }

  async _saveActions() {
    let actions;
    try {
      actions = this._parseEditor();
    } catch (err) {
      this._editorError = err.message;
      this._render();
      return;
    }
    try {
      await this._hass.connection.sendMessagePromise({
        type: WS_SAVE,
        device_id: this._currentRemote.device.id,
        button_id: this._selectedButtonId,
        state_id: this._selectedStateId,
        actions,
      });
      this._setMappingLocal(actions);
      this._editorDirty = false;
      this._editorError = null;
      this._showToast("Saved");
    } catch (err) {
      this._editorError =
        (err && (err.message || err.code)) || "Save failed.";
    }
    this._render();
  }

  async _clearActions() {
    try {
      await this._hass.connection.sendMessagePromise({
        type: WS_CLEAR,
        device_id: this._currentRemote.device.id,
        button_id: this._selectedButtonId,
        state_id: this._selectedStateId,
      });
      this._setMappingLocal([]);
      this._editorText = "";
      this._editorDirty = false;
      this._editorError = null;
      this._showToast("Cleared");
    } catch (err) {
      this._editorError =
        (err && (err.message || err.code)) || "Clear failed.";
    }
    this._render();
  }

  async _testActions() {
    let actions;
    try {
      actions = this._parseEditor();
    } catch (err) {
      this._editorError = err.message;
      this._render();
      return;
    }
    if (!actions.length) {
      this._editorError = "Nothing to test — add at least one action.";
      this._render();
      return;
    }
    try {
      await this._hass.connection.sendMessagePromise({
        type: WS_TEST,
        actions,
      });
      this._showToast("Triggered");
    } catch (err) {
      this._editorError =
        (err && (err.message || err.code)) || "Test failed.";
      this._render();
    }
  }

  _setMappingLocal(actions) {
    if (!this._currentRemote) return;
    const mappings = { ...(this._currentRemote.mappings || {}) };
    const buttonMap = { ...(mappings[this._selectedButtonId] || {}) };
    if (actions.length) {
      buttonMap[this._selectedStateId] = actions;
      mappings[this._selectedButtonId] = buttonMap;
    } else {
      delete buttonMap[this._selectedStateId];
      if (Object.keys(buttonMap).length) {
        mappings[this._selectedButtonId] = buttonMap;
      } else {
        delete mappings[this._selectedButtonId];
      }
    }
    this._currentRemote = { ...this._currentRemote, mappings };
  }

  _insertTemplate(name) {
    const tpl = ACTION_TEMPLATES[name];
    if (!tpl) return;
    let current;
    try {
      current = this._editorText.trim() ? this._parseEditor() : [];
    } catch (_) {
      current = [];
    }
    const merged = [...current, ...tpl];
    this._editorText = JSON.stringify(merged, null, 2);
    this._editorDirty = true;
    this._editorError = null;
    this._render();
  }

  _onEditorInput(value) {
    this._editorText = value;
    this._editorDirty = true;
    this._editorError = null;
    // No re-render — keep cursor stable.
  }

  _showToast(message) {
    this._toast = message;
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this._toast = null;
      this._render();
    }, 1800);
  }

  // -------------------------------------------------------- views
  _renderList() {
    const remotes = this._remotes
      .map(
        (r) => `
        <button class="card" data-device-id="${escapeAttr(r.device_id)}">
          <div class="title">${escapeHtml(r.device_name) || "Unnamed remote"}</div>
          <div class="meta">${escapeHtml(r.manufacturer || "")} · ${escapeHtml(r.model || "")}</div>
          <div class="def">Layout: <code>${escapeHtml(r.definition_id)}</code></div>
        </button>`,
      )
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
          <div>
            <div class="title">${escapeHtml(c.device_name) || "Unnamed device"}</div>
            <div class="meta">${escapeHtml(c.manufacturer || "")} · ${escapeHtml(c.model || "")}</div>
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

  _renderRemoteView() {
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

    const editor = selectedButton && this._selectedStateId
      ? this._renderEditor(selectedButton)
      : "";

    const battery = this._currentRemote.battery;
    const batterySpec = this._currentRemote.definition?.battery;
    const specPart = batterySpec
      ? ` · ${escapeHtml(String(batterySpec.count))}×${escapeHtml(batterySpec.type)}`
      : "";
    const batteryChip = battery || batterySpec
      ? `<span class="battery ${battery ? batteryClass(battery.state) : ""}"
              title="${escapeAttr(battery?.entity_id || "")}">
           ${battery
             ? `${batterySymbol(battery.state)} ${escapeHtml(battery.state)}${escapeHtml(battery.unit || "%")}`
             : "🔋"}${specPart}
         </span>`
      : "";

    return `
      <header class="page-header with-back">
        <button class="back">← Back</button>
        <div class="header-info">
          <h1>${escapeHtml(device.name) || "Remote"}</h1>
          <p class="lead">${escapeHtml(definition.name)} · ${escapeHtml(device.manufacturer || "")}</p>
        </div>
        ${batteryChip}
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

  _renderEditor(selectedButton) {
    const stateLabel =
      selectedButton.states.find((s) => s.id === this._selectedStateId)
        ?.label || this._selectedStateId;
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

  // -------------------------------------------------------- styles
  _styles() {
    return `
      :host {
        display: block;
        padding: 24px;
        color: var(--primary-text-color);
        font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif);
      }
      h1 { margin: 0; font-size: 1.6rem; font-weight: 500; }
      h2 { font-size: 1.05rem; margin: 0 0 12px; font-weight: 500; }
      .page-header { margin-bottom: 24px; }
      .page-header.with-back { display: flex; gap: 16px; align-items: flex-start; }
      .lead { margin: 4px 0 0; opacity: 0.75; font-size: 0.95rem; }
      .back {
        background: var(--secondary-background-color, #f4f4f4);
        border: 1px solid var(--divider-color, #e0e0e0);
        color: inherit;
        padding: 6px 14px;
        border-radius: 999px;
        cursor: pointer;
        font: inherit;
      }
      .back:hover { filter: brightness(0.96); }
      section { margin-bottom: 32px; }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 12px;
      }
      .card {
        text-align: left;
        font: inherit;
        color: inherit;
        cursor: pointer;
        background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 12px;
        padding: 16px;
      }
      .card:hover { filter: brightness(0.97); }
      .title { font-weight: 600; margin-bottom: 4px; }
      .meta { opacity: 0.7; font-size: 0.85rem; }
      .def { margin-top: 8px; font-size: 0.85rem; }
      code { background: var(--secondary-background-color, #f4f4f4); padding: 1px 6px; border-radius: 4px; }
      .empty {
        padding: 32px; text-align: center; opacity: 0.7;
        border: 1px dashed var(--divider-color, #e0e0e0);
        border-radius: 12px;
      }
      .error {
        background: var(--error-color, #e57373); color: white;
        padding: 12px 16px; border-radius: 8px; margin-bottom: 16px;
      }
      ul { padding-left: 20px; margin: 0; }
      li { margin: 4px 0; }

      /* Remote view layout */
      .remote-layout {
        display: grid;
        grid-template-columns: minmax(240px, 320px) 1fr;
        gap: 32px;
        align-items: start;
      }
      @media (max-width: 720px) {
        .remote-layout { grid-template-columns: 1fr; }
      }
      .remote-stage {
        background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 16px;
        padding: 24px;
        display: flex; align-items: center; justify-content: center;
      }
      .remote-stage svg { width: 100%; max-width: 280px; height: auto; }

      .remote-side h2 { margin-top: 0; }
      .btn-list { padding: 0; list-style: none; margin-bottom: 24px; }
      .btn-row {
        display: flex; justify-content: space-between; align-items: center;
        padding: 10px 14px; border-radius: 10px; cursor: pointer;
        background: var(--secondary-background-color, #f8f8f8);
        margin-bottom: 6px;
        border: 1px solid transparent;
      }
      .btn-row:hover { filter: brightness(0.97); }
      .btn-row.selected {
        border-color: var(--primary-color, #5b8def);
        background: var(--primary-color-light, #e3edff);
      }
      .btn-meta { opacity: 0.65; font-size: 0.85rem; }

      .state-list { display: flex; flex-direction: column; gap: 8px; }
      .state-row {
        padding: 10px 14px;
        border-radius: 10px;
        background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color, #e0e0e0);
      }
      .state-label { font-weight: 600; margin-bottom: 4px; }
      .state-summary { font-size: 0.85rem; opacity: 0.8; }
      .hint { font-size: 0.8rem; opacity: 0.65; margin-top: 12px; }

      /* Pulse: highlight a button when its physical event arrives. */
      .rs-button.is-pulsing rect,
      .rs-button.is-pulsing circle,
      .rs-button.is-pulsing path.btn-shape {
        fill: var(--rs-btn-pulse-fill, #ffd66e) !important;
        transition: fill 80ms ease-out;
      }

      /* State rows */
      .state-row { cursor: pointer; transition: background 80ms ease-out, box-shadow 220ms ease-out; }
      .state-row.selected {
        border-color: var(--primary-color, #5b8def);
        background: var(--primary-color-light, #e3edff);
      }
      .state-row:hover { filter: brightness(0.97); }
      .state-row.is-pulsing {
        animation: rs-row-pulse 600ms ease-out 1;
      }
      @keyframes rs-row-pulse {
        0%   { background: var(--rs-btn-pulse-fill, #ffd66e); box-shadow: 0 0 0 4px rgba(255, 214, 110, 0.3); }
        100% { background: var(--card-background-color, #fff); box-shadow: 0 0 0 0 rgba(255, 214, 110, 0); }
      }

      /* Action editor */
      .editor {
        margin-top: 24px;
        padding: 16px;
        background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 12px;
      }
      .editor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .editor-header h2 { margin: 0; font-size: 0.95rem; }
      .dirty {
        font-size: 0.75rem;
        background: var(--warning-color, #ffb74d);
        color: var(--text-primary-color, #fff);
        padding: 2px 8px; border-radius: 999px;
      }
      .quick-insert {
        display: flex; flex-wrap: wrap; gap: 6px;
        margin-bottom: 8px; align-items: center;
        font-size: 0.85rem;
      }
      .quick-insert span { opacity: 0.7; margin-right: 4px; }
      .quick-insert button {
        font: inherit; font-size: 0.8rem;
        background: var(--secondary-background-color, #f4f4f4);
        border: 1px solid var(--divider-color, #e0e0e0);
        color: inherit;
        padding: 3px 10px; border-radius: 999px;
        cursor: pointer;
      }
      .quick-insert button:hover { filter: brightness(0.96); }
      .quick-insert button.recommended {
        background: var(--primary-color, #5b8def);
        color: var(--text-primary-color, #fff);
        border-color: transparent;
        font-weight: 600;
      }
      .editor-text {
        width: 100%; min-height: 180px; box-sizing: border-box;
        padding: 12px; font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 0.85rem;
        background: var(--secondary-background-color, #fafafa);
        color: inherit;
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 8px;
        resize: vertical;
      }
      .editor-error {
        margin-top: 8px;
        padding: 8px 12px;
        background: var(--error-color, #e57373); color: white;
        border-radius: 8px; font-size: 0.85rem;
      }
      .editor-actions { display: flex; gap: 8px; margin-top: 12px; }
      .editor-actions button {
        font: inherit;
        background: var(--secondary-background-color, #f4f4f4);
        border: 1px solid var(--divider-color, #e0e0e0);
        color: inherit;
        padding: 6px 14px; border-radius: 8px; cursor: pointer;
      }
      .editor-actions button.primary {
        background: var(--primary-color, #5b8def);
        color: var(--text-primary-color, #fff);
        border-color: transparent;
      }
      .editor-actions button:hover { filter: brightness(0.96); }

      .toast {
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        background: var(--primary-text-color, #222);
        color: var(--card-background-color, #fff);
        padding: 8px 18px; border-radius: 999px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10;
      }

      /* Page header gets a flexible row so the test toggle pins right. */
      .page-header.with-back { align-items: center; justify-content: flex-start; }
      .header-info { flex: 1; }
      .test-toggle {
        display: inline-flex; align-items: center; gap: 8px;
        cursor: pointer; user-select: none;
        padding: 6px 12px; border-radius: 999px;
        background: var(--secondary-background-color, #f4f4f4);
        border: 1px solid var(--divider-color, #e0e0e0);
        font-size: 0.85rem;
      }
      .test-toggle input { accent-color: var(--primary-color, #5b8def); }

      .battery {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 6px 12px; border-radius: 999px;
        background: var(--secondary-background-color, #f4f4f4);
        border: 1px solid var(--divider-color, #e0e0e0);
        font-size: 0.85rem; font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .battery.is-low {
        background: var(--warning-color, #ffb74d);
        color: var(--text-primary-color, #fff);
        border-color: transparent;
      }
      .battery.is-critical {
        background: var(--error-color, #e57373);
        color: var(--text-primary-color, #fff);
        border-color: transparent;
      }

      /* Candidate list */
      .candidate-list { display: flex; flex-direction: column; gap: 8px; }
      .candidate {
        display: flex; align-items: center; justify-content: space-between;
        gap: 16px; padding: 12px 16px;
        background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 12px;
      }
      .candidate-actions select {
        font: inherit; padding: 6px 10px; border-radius: 8px;
        border: 1px solid var(--divider-color, #e0e0e0);
        background: var(--secondary-background-color, #fafafa);
        color: inherit;
      }
    `;
  }
}

// --------------------------------------------------------- helpers
function escapeHtml(value) {
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

function escapeAttr(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  // Sufficient for our state ids (alnum + underscore).
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function batteryPercent(state) {
  const n = Number(state);
  return Number.isFinite(n) ? n : null;
}

function batterySymbol(state) {
  const n = batteryPercent(state);
  if (n === null) return "🔋";
  if (n <= 10) return "🪫";
  return "🔋";
}

function batteryClass(state) {
  const n = batteryPercent(state);
  if (n === null) return "";
  if (n <= 10) return "is-critical";
  if (n <= 25) return "is-low";
  return "";
}

function countConfiguredStates(buttonMappings) {
  if (!buttonMappings) return 0;
  let n = 0;
  for (const stateActions of Object.values(buttonMappings)) {
    if (Array.isArray(stateActions) && stateActions.length > 0) n += 1;
  }
  return n;
}

function describeActions(actions) {
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

if (!customElements.get("remote-studio-panel")) {
  customElements.define("remote-studio-panel", RemoteStudioPanel);
}
