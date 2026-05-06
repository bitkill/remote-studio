/**
 * Remote Studio panel — the custom element that HA mounts.
 *
 * Two views, switched by URL:
 *   - list   — discovered remotes + unmatched candidates + layouts
 *   - remote — one remote rendered as inline SVG with the action editor
 *
 * The render functions live in views.js (attached to the prototype below)
 * and the CSS lives in styles.js. Helpers and constants are split into
 * helpers.js, chips.js and constants.js.
 */
import {
  ACTION_TEMPLATES,
  PANEL_BASE,
  WS_CLEAR,
  WS_GET,
  WS_LIST,
  WS_SAVE,
  WS_SUBSCRIBE,
  WS_TEST,
} from "./constants.js";
import { cssEscape } from "./helpers.js";
import { css } from "./styles.js";
import { renderEditor } from "./views/editor.js";
import { renderList } from "./views/list.js";
import { renderRemoteView } from "./views/remote.js";

export class RemoteStudioPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._hass = null;
    this._route = null;
    this._view = "list"; // 'list' | 'remote'
    this._listLoaded = false;
    this._remotes = [];
    this._candidates = [];
    this._definitions = [];
    this._testMode = false;
    this._currentRemote = null; // { device, definition, svg, mappings, battery }
    this._selectedButtonId = null;
    this._selectedStateId = null;
    this._editorText = "";
    this._editorError = null;
    this._editorDirty = false;
    this._toast = null;
    this._error = null;

    this._eventUnsub = null;
    this._pulseTimers = new Map();
  }

  // ============================================================ lifecycle
  connectedCallback() {
    this._popstateHandler = () => {
      // Mirror window.location back into _route so browser back/forward
      // navigation re-syncs the panel state, in case HA's own routing
      // didn't propagate the change.
      const pathname = window.location.pathname;
      const prefix = `/${PANEL_BASE}`;
      if (pathname.startsWith(prefix)) {
        this._route = {
          ...(this._route || {}),
          path: pathname.slice(prefix.length),
        };
      }
      if (this._hass) this._syncFromRoute();
    };
    window.addEventListener("popstate", this._popstateHandler);
    this._render();
  }

  disconnectedCallback() {
    if (this._popstateHandler) {
      window.removeEventListener("popstate", this._popstateHandler);
      this._popstateHandler = null;
    }
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

  // ============================================================ HA props
  set hass(hass) {
    const wasNull = !this._hass;
    this._hass = hass;
    if (wasNull && hass) {
      if (!this._listLoaded) this._loadRemotes();
      this._subscribeEvents();
      this._syncFromRoute();
    }
  }

  get hass() {
    return this._hass;
  }

  // HA passes the URL state to custom panels via `route`. The path is the
  // portion after the panel root, e.g. "/abc123" when the URL is
  // /remote-studio/abc123.
  set route(value) {
    this._route = value;
    if (this._hass) this._syncFromRoute();
  }

  get route() {
    return this._route;
  }

  // ============================================================ data load
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

  async _loadRemote(deviceId, definitionId) {
    this._error = null;
    this._currentRemote = null;
    this._selectedButtonId = null;
    this._selectedStateId = null;
    this._render();
    try {
      const msg = { type: WS_GET, device_id: deviceId };
      if (definitionId) msg.definition_id = definitionId;
      const result = await this._hass.connection.sendMessagePromise(msg);
      this._currentRemote = result;
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

  // ============================================================ navigation
  // Click handlers call this; it just updates the URL. The route setter
  // takes over and triggers `_loadRemote`.
  _openRemote(deviceId, definitionId) {
    let path = `/${encodeURIComponent(deviceId)}`;
    if (definitionId) path += `:${encodeURIComponent(definitionId)}`;
    this._navigate(path);
  }

  _backToList() {
    this._navigate("");
  }

  _navigate(path) {
    const url = `/${PANEL_BASE}${path}`;
    if (window.location.pathname + window.location.search === url) return;
    window.history.pushState({}, "", url);
    window.dispatchEvent(
      new CustomEvent("location-changed", {
        bubbles: true,
        composed: true,
        detail: { replace: false },
      }),
    );
  }

  _syncFromRoute() {
    const rawPath = (this._route?.path || "").replace(/^\//, "");
    if (!rawPath) {
      if (this._view !== "list") {
        this._view = "list";
        this._currentRemote = null;
        this._selectedButtonId = null;
        this._selectedStateId = null;
        this._error = null;
      }
      this._render();
      return;
    }
    // Path encodes the device id and (optionally) a layout override:
    //   <device_id>            — auto-matched layout
    //   <device_id>:<def_id>   — manual layout pairing
    const [encodedDevice, encodedDef] = rawPath.split(":", 2);
    const deviceId = decodeURIComponent(encodedDevice);
    const definitionId = encodedDef ? decodeURIComponent(encodedDef) : undefined;

    const sameDevice = this._currentRemote?.device?.id === deviceId;
    const sameDefinition =
      !definitionId ||
      this._currentRemote?.definition?.id === definitionId;
    if (this._view === "remote" && sameDevice && sameDefinition) return;
    this._view = "remote";
    this._loadRemote(deviceId, definitionId);
  }

  // ============================================================ live events
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
    if (!event || !event.device_id) return;

    // List view: highlight the matching card.
    if (this._view === "list") {
      this._pulseCard(event.device_id);
      return;
    }

    if (
      this._view !== "remote" ||
      this._currentRemote?.device?.id !== event.device_id ||
      !event.button_id
    ) {
      return;
    }
    this._pulseButton(event.button_id);
    if (event.state_id) {
      // Auto-jump to the firing button so the user sees its state list and
      // editor light up in response to physical input.
      if (this._selectedButtonId !== event.button_id) {
        this._selectedButtonId = event.button_id;
        this._render();
      }
      this._pulseStateRow(event.state_id);
      if (event.state_id.startsWith("rotate_")) this._pulseWheel();
    }
  }

  // ============================================================ pulsing
  _pulseCard(deviceId) {
    const root = this.shadowRoot;
    if (!root) return;
    const card = root.querySelector(
      `button.card[data-device-id="${cssEscape(deviceId)}"]`,
    );
    if (!card) return;
    // Restart the animation if it's already running.
    card.classList.remove("is-pulsing");
    void card.offsetWidth;
    card.classList.add("is-pulsing");
    this._scheduleClassRemoval(card, "is-pulsing", `card:${deviceId}`, 1900);
  }

  _pulseButton(buttonId) {
    this._addPulseById(`button-${buttonId}`, 450);
  }

  _pulseWheel() {
    this._addPulseById("wheel", 480);
  }

  _pulseStateRow(stateId) {
    const root = this.shadowRoot;
    if (!root) return;
    const row = root.querySelector(
      `.state-row[data-state-id="${cssEscape(stateId)}"]`,
    );
    if (!row) return;
    row.classList.add("is-pulsing");
    this._scheduleClassRemoval(row, "is-pulsing", `state:${stateId}`, 600);
  }

  _addPulseById(elementId, duration) {
    const root = this.shadowRoot;
    if (!root) return;
    const node = root.getElementById(elementId);
    if (!node) return;
    node.classList.add("is-pulsing");
    this._scheduleClassRemoval(node, "is-pulsing", elementId, duration);
  }

  _scheduleClassRemoval(node, className, key, duration) {
    const existing = this._pulseTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      node.classList.remove(className);
      this._pulseTimers.delete(key);
    }, duration);
    this._pulseTimers.set(key, timer);
  }

  // ============================================================ render
  _render() {
    const root = this.shadowRoot;
    if (!root) return;
    root.innerHTML = `
      <style>${css}</style>
      ${this._view === "list" ? this._renderList() : this._renderRemoteView()}
    `;
    if (this._view === "list") {
      this._wireList();
    } else {
      const back = root.querySelector(".back");
      if (back) back.addEventListener("click", () => this._backToList());
      this._wireSvg();
      this._wireButtonList();
    }
  }

  _wireList() {
    const root = this.shadowRoot;
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
  }

  _wireSvg() {
    const root = this.shadowRoot;
    const svg = root.querySelector(".remote-stage svg");
    if (!svg) return;
    svg.querySelectorAll('[id^="button-"]').forEach((node) => {
      const buttonId = node.id.replace(/^button-/, "");
      node.addEventListener("click", () => this._onSvgButtonClick(buttonId));
      if (buttonId === this._selectedButtonId) node.classList.add("is-active");
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
      this._showToast(
        `${button.label || buttonId} / ${stateId} is not configured`,
      );
      this._pulseButton(buttonId);
      return;
    }
    this._pulseButton(buttonId);
    this._hass.connection
      .sendMessagePromise({ type: WS_TEST, actions })
      .then(() =>
        this._showToast(`Triggered ${button.label || buttonId} / ${stateId}`),
      )
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

  // ============================================================ selection
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

  // ============================================================ editor
  _loadEditorFromMapping() {
    const actions = this._currentActions();
    this._editorText = actions.length ? JSON.stringify(actions, null, 2) : "";
    this._editorError = null;
    this._editorDirty = false;
  }

  _currentActions() {
    if (
      !this._currentRemote ||
      !this._selectedButtonId ||
      !this._selectedStateId
    ) {
      return [];
    }
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
    this._editorText = JSON.stringify([...current, ...tpl], null, 2);
    this._editorDirty = true;
    this._editorError = null;
    this._render();
  }

  _onEditorInput(value) {
    this._editorText = value;
    this._editorDirty = true;
    this._editorError = null;
    // No re-render — keeping the cursor stable matters more than refreshing.
  }

  _showToast(message) {
    this._toast = message;
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this._toast = null;
      this._render();
    }, 1800);
  }
}

// Render functions live in views.js but are called as methods. Attaching
// them on the prototype keeps `this` semantics intact while letting the
// view code live in its own file.
RemoteStudioPanel.prototype._renderList = renderList;
RemoteStudioPanel.prototype._renderRemoteView = renderRemoteView;
RemoteStudioPanel.prototype._renderEditor = renderEditor;
