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
const WS_SUBSCRIBE = "remote_studio/subscribe_events";

class RemoteStudioPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._hass = null;
    this._view = "list"; // 'list' | 'remote'
    this._listLoaded = false;
    this._remotes = [];
    this._definitions = [];
    this._currentRemote = null; // { device, definition, svg, mappings }
    this._selectedButtonId = null;
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

  async _openRemote(deviceId) {
    this._error = null;
    this._currentRemote = null;
    this._selectedButtonId = null;
    this._view = "remote";
    this._render();
    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: WS_GET,
        device_id: deviceId,
      });
      this._currentRemote = result;
      // Pre-select the first button for convenience.
      if (result.definition?.buttons?.length) {
        this._selectedButtonId = result.definition.buttons[0].id;
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
      this._view === "remote" &&
      this._currentRemote?.device?.id === event.device_id
    ) {
      this._pulseButton(event.button_id);
    }
    // Future: also surface a toast/list of recent events.
  }

  // -------------------------------------------------------- pulsing
  _pulseButton(buttonId) {
    const root = this.shadowRoot;
    if (!root) return;
    const node = root.getElementById(`button-${buttonId}`);
    if (!node) return;
    node.classList.add("is-pulsing");
    const key = buttonId;
    const existing = this._pulseTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      node.classList.remove("is-pulsing");
      this._pulseTimers.delete(key);
    }, 450);
    this._pulseTimers.set(key, timer);
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
      node.addEventListener("click", () => this._selectButton(buttonId));
      // Visual selection highlight
      if (buttonId === this._selectedButtonId) {
        node.classList.add("is-active");
      }
    });
  }

  _wireButtonList() {
    const root = this.shadowRoot;
    root.querySelectorAll("[data-button-id]").forEach((el) => {
      el.addEventListener("click", () =>
        this._selectButton(el.dataset.buttonId),
      );
    });
  }

  _selectButton(buttonId) {
    this._selectedButtonId = buttonId;
    this._render();
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
        return `
          <div class="state-row">
            <div class="state-label">${escapeHtml(s.label || s.id)}</div>
            <div class="state-summary">${describeActions(actions)}</div>
          </div>`;
      })
      .join("");

    return `
      <header class="page-header with-back">
        <button class="back">← Back</button>
        <div>
          <h1>${escapeHtml(device.name) || "Remote"}</h1>
          <p class="lead">${escapeHtml(definition.name)} · ${escapeHtml(device.manufacturer || "")}</p>
        </div>
      </header>
      ${this._error ? `<div class="error">${escapeHtml(this._error)}</div>` : ""}
      <div class="remote-layout">
        <div class="remote-stage">${svg || '<div class="empty">No SVG layout for this remote.</div>'}</div>
        <aside class="remote-side">
          <h2>Buttons</h2>
          <ul class="btn-list">${buttonItems}</ul>
          ${
            selectedButton
              ? `
            <h2>${escapeHtml(selectedButton.label || selectedButton.id)} states</h2>
            <div class="state-list">${stateRows}</div>
            <p class="hint">Click a state to assign actions (action editor coming next).</p>`
              : ""
          }
        </aside>
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
