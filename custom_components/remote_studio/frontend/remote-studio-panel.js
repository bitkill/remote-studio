/**
 * Remote Studio panel — minimal skeleton.
 *
 * The panel is registered via panel_custom; HA sets `hass`, `narrow`, `route`,
 * and `panel` as JS properties (not attributes) on the custom element.
 *
 * For now this just lists discovered remotes and existing definitions; the
 * SVG-hotspot UI and action editor land in subsequent commits.
 */

const WS_LIST = "remote_studio/list_remotes";

class RemoteStudioPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    /** @type {import("home-assistant-js-websocket").HassEntities | null} */
    this._hass = null;
    this._loaded = false;
    this._remotes = [];
    this._definitions = [];
    this._error = null;
  }

  connectedCallback() {
    this._render();
  }

  set hass(hass) {
    const wasNull = !this._hass;
    this._hass = hass;
    if (wasNull && hass && !this._loaded) {
      this._loadRemotes();
    }
  }

  get hass() {
    return this._hass;
  }

  async _loadRemotes() {
    this._loaded = true;
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

  _render() {
    if (!this.shadowRoot) return;
    const remotes = this._remotes
      .map(
        (r) => `
        <div class="card">
          <div class="title">${escapeHtml(r.device_name) || "Unnamed remote"}</div>
          <div class="meta">${escapeHtml(r.manufacturer || "")} · ${escapeHtml(r.model || "")}</div>
          <div class="def">Layout: <code>${escapeHtml(r.definition_id)}</code></div>
        </div>`,
      )
      .join("");
    const defs = this._definitions
      .map(
        (d) => `
        <li>
          <strong>${escapeHtml(d.name)}</strong>
          <small>${d.buttons.length} buttons</small>
        </li>`,
      )
      .join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          padding: 24px;
          color: var(--primary-text-color);
          font-family: var(--paper-font-body1_-_font-family);
        }
        h1 { margin: 0 0 8px; font-size: 1.6rem; font-weight: 500; }
        p.lead { margin: 0 0 24px; opacity: 0.8; }
        section { margin-bottom: 32px; }
        section h2 { font-size: 1.1rem; margin: 0 0 12px; font-weight: 500; }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 12px;
        }
        .card {
          background: var(--card-background-color, #fff);
          border: 1px solid var(--divider-color, #e0e0e0);
          border-radius: 12px;
          padding: 16px;
        }
        .title { font-weight: 600; margin-bottom: 4px; }
        .meta { opacity: 0.7; font-size: 0.85rem; }
        .def { margin-top: 8px; font-size: 0.85rem; }
        code { background: var(--secondary-background-color, #f4f4f4); padding: 1px 6px; border-radius: 4px; }
        ul { padding-left: 20px; margin: 0; }
        li { margin: 4px 0; }
        .empty {
          padding: 32px;
          text-align: center;
          opacity: 0.7;
          border: 1px dashed var(--divider-color, #e0e0e0);
          border-radius: 12px;
        }
        .error {
          background: var(--error-color, #e57373);
          color: white;
          padding: 12px 16px;
          border-radius: 8px;
        }
      </style>
      <h1>Remote Studio</h1>
      <p class="lead">Configure your Zigbee and Matter remotes visually.</p>
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
}

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

if (!customElements.get("remote-studio-panel")) {
  customElements.define("remote-studio-panel", RemoteStudioPanel);
}
