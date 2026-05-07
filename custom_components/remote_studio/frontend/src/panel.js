/**
 * Remote Studio panel — the custom element that HA mounts.
 *
 * Two views, switched by URL:
 *   - list   — discovered remotes + unmatched candidates + layouts
 *   - device — one remote rendered as inline SVG, with per-group target
 *              cards above and an advanced override editor below.
 */
import {
  DEFAULT_DIM_STEP,
  PANEL_BASE,
  WS_GET,
  WS_LIST,
  WS_SET_GROUP,
  WS_SET_OVERRIDE,
  WS_SUBSCRIBE,
  WS_TEST,
  WS_TRIGGER,
  actionTemplate,
} from "./constants.js";
import { cssEscape } from "./helpers.js";
import { css } from "./styles.js";

// Tiny inline escapers — duplicated from helpers.js to keep the picker
// self-contained without a new import cycle.
function escapeHtmlInline(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
const escapeAttrInline = escapeHtmlInline;

function pickEntityIdFromTarget(target) {
  if (!target || typeof target !== "object") return null;
  const ids = target.entity_id;
  if (!ids) return null;
  return Array.isArray(ids) ? ids[0] : ids;
}

// Approximate colour temperature (Kelvin) → RGB for the swatch shown
// next to a light's status pill. Tanner Helland's algorithm — close
// enough for a 16×16 visual cue.
function kelvinToRgb(kelvin) {
  const k = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r;
  let g;
  let b;
  if (k <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(k) - 161.1195681661;
    b = k <= 19 ? 0 : 138.5177312231 * Math.log(k - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(k - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(k - 60, -0.0755148492);
    b = 255;
  }
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}
import { renderDevice } from "./views/device.js";
import { renderEditor } from "./views/editor.js";
import { renderIndex } from "./views/index.js";
import { renderEventListItems } from "./views/log.js";

export class RemoteStudioPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._hass = null;
    this._route = null;
    this._view = "index"; // 'index' | 'device'
    this._listLoaded = false;
    this._remotes = [];
    this._candidates = [];
    this._definitions = [];
    this._version = null;
    this._testMode = false;
    this._currentRemote = null;
    this._selectedButtonId = null;
    this._selectedStateId = null;
    this._advancedOpen = false;
    this._editorText = "";
    this._editorError = null;
    this._editorDirty = false;
    this._toast = null;
    this._error = null;

    this._eventUnsub = null;
    this._pulseTimers = new Map();
    this._groupSaveTimers = new Map();

    this._filterText = "";
    this._eventLog = [];
  }

  // ============================================================ lifecycle
  connectedCallback() {
    this._popstateHandler = () => {
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
    for (const t of this._groupSaveTimers.values()) clearTimeout(t);
    this._groupSaveTimers.clear();
  }

  // ============================================================ HA props
  set hass(hass) {
    const wasNull = !this._hass;
    this._hass = hass;
    if (wasNull && hass) {
      if (!this._listLoaded) this._loadRemotes();
      this._subscribeEvents();
      this._syncFromRoute();
      return;
    }
    // On subsequent updates, push hass through to any live ha-target-picker
    // elements so their state reflects the latest entity registry.
    this._syncTargetPickerHass();
  }

  get hass() {
    return this._hass;
  }

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
      this._version = result.version || null;
      if (!this._version) {
        this._version = await this._fetchManifestVersion();
      }
      this._error = null;
    } catch (err) {
      this._error =
        (err && (err.message || err.code)) || "Failed to load remotes.";
    }
    this._render();
  }

  async _fetchManifestVersion() {
    try {
      const m = await this._hass.connection.sendMessagePromise({
        type: "manifest/get",
        integration: "remote_studio",
      });
      return m?.version || null;
    } catch (_) {
      return null;
    }
  }

  async _loadRemote(deviceId, definitionId) {
    this._error = null;
    this._currentRemote = null;
    this._selectedButtonId = null;
    this._selectedStateId = null;
    this._advancedOpen = false;
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
        this._loadEditorFromOverride();
      }
    } catch (err) {
      this._error =
        (err && (err.message || err.code)) || "Failed to load remote.";
    }
    this._render();
  }

  // ============================================================ navigation
  _openDevice(deviceId, definitionId) {
    let path = `/device/${encodeURIComponent(deviceId)}`;
    if (definitionId) path += `:${encodeURIComponent(definitionId)}`;
    this._navigate(path);
  }

  _backToIndex() {
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
      if (this._view !== "index") {
        this._view = "index";
        this._currentRemote = null;
        this._selectedButtonId = null;
        this._selectedStateId = null;
        this._advancedOpen = false;
        this._error = null;
      }
      this._render();
      return;
    }
    if (rawPath.startsWith("device/")) {
      const remainder = rawPath.slice("device/".length);
      const [encodedDevice, encodedDef] = remainder.split(":", 2);
      const deviceId = decodeURIComponent(encodedDevice);
      const definitionId = encodedDef ? decodeURIComponent(encodedDef) : undefined;
      const sameDevice = this._currentRemote?.device?.id === deviceId;
      const sameDefinition =
        !definitionId ||
        this._currentRemote?.definition?.id === definitionId;
      if (this._view === "device" && sameDevice && sameDefinition) return;
      this._view = "device";
      this._loadRemote(deviceId, definitionId);
      return;
    }
    this._view = "index";
    history.replaceState(null, "", `/${PANEL_BASE}`);
    this._render();
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
    if (event.button_id && event.state_id) {
      this._eventLog.unshift({
        device_id: event.device_id,
        button_id: event.button_id,
        state_id: event.state_id,
        ts: Date.now(),
      });
      if (this._eventLog.length > 100) this._eventLog.length = 100;
      this._refreshEventLog();
    }
    if (this._view === "index") {
      this._pulseCard(event.device_id);
      return;
    }
    if (
      this._view !== "device" ||
      this._currentRemote?.device?.id !== event.device_id ||
      !event.button_id
    ) {
      return;
    }
    this._pulseButton(event.button_id);
    if (event.state_id) {
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
      ${this._view === "index" ? this._renderIndex() : this._renderDevice()}
    `;
    if (this._view === "index") {
      this._wireIndex();
    } else {
      const back = root.querySelector(".back");
      if (back) back.addEventListener("click", () => this._backToIndex());
      this._wireSvg();
      this._wireGroupCards();
      this._wireButtonList();
    }
  }

  _wireIndex() {
    const root = this.shadowRoot;
    root.querySelectorAll("[data-device-id]").forEach((el) =>
      el.addEventListener("click", () =>
        this._openDevice(el.dataset.deviceId),
      ),
    );
    root.querySelectorAll("[data-pair-device]").forEach((select) =>
      select.addEventListener("change", (e) => {
        const definitionId = e.target.value;
        if (!definitionId) return;
        this._openDevice(e.target.dataset.pairDevice, definitionId);
      }),
    );
    const filter = root.querySelector("[data-filter]");
    if (filter) {
      filter.addEventListener("input", (e) =>
        this._onFilterInput(e.target.value),
      );
      if (filter.value !== this._filterText) filter.value = this._filterText;
      if (this._filterFocused) {
        filter.focus();
        const len = filter.value.length;
        try { filter.setSelectionRange(len, len); } catch (_) {}
      }
    }
    const clearBtn = root.querySelector("[data-clear-filter]");
    if (clearBtn) clearBtn.addEventListener("click", () => this._onFilterInput(""));
  }

  _onFilterInput(value) {
    this._filterText = value;
    this._filterFocused = true;
    this._render();
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

  // ----------- group cards: custom entity picker + dim-step input
  // Note: HA's <ha-target-picker> is lazy-loaded by the frontend bundle and
  // isn't registered when our panel mounts cold, so the element renders as
  // an empty box. We ship our own searchable entity picker instead — it's
  // always available, always behaves the same, and styled to match HA.
  _wireGroupCards() {
    const root = this.shadowRoot;
    if (!root) return;
    root.querySelectorAll(".group-target-slot").forEach((slot) => {
      const groupId = slot.dataset.group;
      const stored = this._currentRemote?.groups?.[groupId];
      this._buildEntityPicker(slot, groupId, stored?.target || null);
    });
    this._refreshStatePanes();
    root.querySelectorAll("[data-dim-step]").forEach((input) => {
      input.addEventListener("change", (e) => {
        const groupId = e.target.dataset.dimStep;
        const raw = parseInt(e.target.value, 10);
        const dimStep = Number.isFinite(raw) && raw >= 1 && raw <= 100
          ? raw
          : DEFAULT_DIM_STEP;
        e.target.value = String(dimStep);
        this._onDimStepChange(groupId, dimStep);
      });
    });
  }

  _syncTargetPickerHass() {
    // Re-render entity options when hass updates (e.g. a new entity was
    // added). Cheap because we only touch the open popover.
    const root = this.shadowRoot;
    if (!root) return;
    root.querySelectorAll(".entity-picker").forEach((picker) => {
      const list = picker.querySelector(".entity-picker-options");
      if (list && !list.hidden) {
        const input = picker.querySelector("input.entity-picker-input");
        this._renderPickerOptions(list, input?.value || "");
      }
    });
    this._refreshStatePanes();
  }

  // Right-side info card next to each group's picker. Reads the picked
  // entity's state out of hass.states and renders a domain-aware summary
  // (status pill, brightness bar + colour swatch for lights, plain state
  // for everything else). Called both when the picker selection changes
  // and on every hass update so the readout stays live.
  _refreshStatePanes() {
    const root = this.shadowRoot;
    if (!root || !this._currentRemote) return;
    const groups = this._currentRemote.groups || {};
    root.querySelectorAll("[data-state-pane]").forEach((pane) => {
      const groupId = pane.dataset.statePane;
      const target = groups[groupId]?.target;
      const entityId = pickEntityIdFromTarget(target);
      this._renderEntityStatePane(pane, entityId);
    });
  }

  _renderEntityStatePane(pane, entityId) {
    if (!entityId) {
      pane.innerHTML = `<div class="state-empty">No entity picked</div>`;
      return;
    }
    const state = this._hass?.states?.[entityId];
    if (!state) {
      pane.innerHTML = `<div class="state-empty">Entity not found</div>`;
      return;
    }
    const dot = entityId.indexOf(".");
    const domain = dot > 0 ? entityId.slice(0, dot) : "";
    const value = state.state;
    const friendly = state.attributes?.friendly_name || entityId;
    const isOn = value === "on";

    const stateClass = isOn ? "is-on" : value === "off" ? "is-off" : "is-other";
    const pill = `<span class="state-pill ${stateClass}">${escapeHtmlInline(value)}</span>`;

    if (domain === "light") {
      const brightness = state.attributes?.brightness;
      const brightnessPct =
        Number.isFinite(brightness) ? Math.round((brightness / 255) * 100) : null;
      const rgb = state.attributes?.rgb_color;
      const ct = state.attributes?.color_temp_kelvin;
      let swatchStyle = "";
      let swatchTitle = "";
      if (isOn && Array.isArray(rgb) && rgb.length === 3) {
        swatchStyle = `background: rgb(${rgb.join(",")})`;
        swatchTitle = `rgb(${rgb.join(", ")})`;
      } else if (isOn && Number.isFinite(ct)) {
        swatchStyle = `background: ${kelvinToRgb(ct)}`;
        swatchTitle = `${ct}K`;
      }
      const swatch =
        swatchStyle
          ? `<span class="state-swatch" style="${swatchStyle}" title="${escapeAttrInline(swatchTitle)}"></span>`
          : "";
      const brightnessRow =
        isOn && brightnessPct !== null
          ? `
            <div class="state-row-bar">
              <div class="state-row-label">Brightness</div>
              <div class="state-bar"><div class="state-bar-fill" style="width: ${brightnessPct}%"></div></div>
              <div class="state-row-num">${brightnessPct}%</div>
            </div>`
          : "";
      pane.innerHTML = `
        <div class="state-head">
          ${pill}
          ${swatch}
        </div>
        ${brightnessRow}
        <div class="state-friendly">${escapeHtmlInline(friendly)}</div>
      `;
      return;
    }

    pane.innerHTML = `
      <div class="state-head">${pill}</div>
      <div class="state-friendly">${escapeHtmlInline(friendly)}</div>
    `;
  }

  // Build a self-contained entity picker into `slot`. Saves on selection
  // by calling _onGroupTargetChange. Closes on outside click or Escape.
  _buildEntityPicker(slot, groupId, currentTarget) {
    slot.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "entity-picker";

    const control = document.createElement("div");
    control.className = "entity-picker-control";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "entity-picker-input";
    input.placeholder = "Search entities…";
    input.autocomplete = "off";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "entity-picker-clear";
    clear.setAttribute("aria-label", "Clear");
    clear.textContent = "×";
    control.appendChild(input);
    control.appendChild(clear);

    const options = document.createElement("ul");
    options.className = "entity-picker-options";
    options.hidden = true;

    wrap.appendChild(control);
    wrap.appendChild(options);
    slot.appendChild(wrap);

    // Display the currently saved target as the input's display value.
    const currentEntity = pickEntityIdFromTarget(currentTarget);
    if (currentEntity) {
      input.value = this._friendlyForEntity(currentEntity) || currentEntity;
      input.dataset.entityId = currentEntity;
    }

    const openPopover = () => {
      this._renderPickerOptions(options, "");
      options.hidden = false;
    };
    const closePopover = () => {
      options.hidden = true;
    };

    input.addEventListener("focus", () => {
      // On focus, clear the displayed friendly name so the user can search
      // freely. We restore it if they close without picking something.
      input.dataset.previousValue = input.value;
      input.value = "";
      openPopover();
    });
    input.addEventListener("input", () => {
      this._renderPickerOptions(options, input.value);
      options.hidden = false;
    });
    input.addEventListener("blur", (e) => {
      // Defer so a click on an option fires before we close.
      setTimeout(() => {
        if (!input.dataset.entityId) {
          input.value = "";
        } else if (!input.value) {
          input.value =
            this._friendlyForEntity(input.dataset.entityId) ||
            input.dataset.entityId;
        }
        closePopover();
      }, 120);
    });

    options.addEventListener("mousedown", (e) => {
      // Keep focus on input so blur/close ordering is sane.
      const li = e.target.closest("li[data-entity-id]");
      if (!li) return;
      e.preventDefault();
      const entityId = li.dataset.entityId;
      input.dataset.entityId = entityId;
      input.value = this._friendlyForEntity(entityId) || entityId;
      closePopover();
      this._onGroupTargetChange(
        groupId,
        entityId ? { entity_id: entityId } : null,
      );
    });

    clear.addEventListener("click", (e) => {
      e.preventDefault();
      input.value = "";
      delete input.dataset.entityId;
      closePopover();
      this._onGroupTargetChange(groupId, null);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        input.blur();
      }
    });
  }

  _renderPickerOptions(listEl, query) {
    const states = this._hass?.states || {};
    const q = (query || "").trim().toLowerCase();
    const TARGET_DOMAINS = new Set([
      "light",
      "switch",
      "fan",
      "scene",
      "script",
      "automation",
      "cover",
      "media_player",
      "lock",
      "input_boolean",
      "humidifier",
      "climate",
      "vacuum",
    ]);
    const matches = [];
    for (const [id, st] of Object.entries(states)) {
      const dot = id.indexOf(".");
      if (dot < 0) continue;
      const domain = id.slice(0, dot);
      if (!TARGET_DOMAINS.has(domain)) continue;
      const friendly = st.attributes?.friendly_name || id;
      if (q && !id.toLowerCase().includes(q) && !friendly.toLowerCase().includes(q)) {
        continue;
      }
      matches.push({ id, friendly, domain });
    }
    matches.sort((a, b) => a.friendly.localeCompare(b.friendly));
    const top = matches.slice(0, 80);

    if (!top.length) {
      listEl.innerHTML = `<li class="entity-picker-empty">No matching entities</li>`;
      return;
    }
    listEl.innerHTML = top
      .map(
        (m) => `
          <li data-entity-id="${escapeAttrInline(m.id)}">
            <span class="entity-friendly">${escapeHtmlInline(m.friendly)}</span>
            <span class="entity-id">${escapeHtmlInline(m.id)}</span>
          </li>`,
      )
      .join("");
  }

  _friendlyForEntity(entityId) {
    return this._hass?.states?.[entityId]?.attributes?.friendly_name || null;
  }

  _onGroupTargetChange(groupId, target) {
    this._mergeGroupLocal(groupId, { target });
    this._scheduleGroupSave(groupId);
    // Refresh button-side state summaries + the right-column state pane
    // for this group, without losing focus on the picker.
    this._refreshStateRows();
    this._refreshStatePanes();
  }

  _onDimStepChange(groupId, dimStep) {
    this._mergeGroupLocal(groupId, { dim_step: dimStep });
    this._scheduleGroupSave(groupId);
    this._refreshStateRows();
  }

  _mergeGroupLocal(groupId, patch) {
    if (!this._currentRemote) return;
    const groups = { ...(this._currentRemote.groups || {}) };
    groups[groupId] = { ...(groups[groupId] || {}), ...patch };
    this._currentRemote = { ...this._currentRemote, groups };
  }

  // Debounced save so dragging through many entities in the picker doesn't
  // hammer the WebSocket. 350ms is short enough that test mode after a
  // pick feels instantaneous.
  _scheduleGroupSave(groupId) {
    const existing = this._groupSaveTimers.get(groupId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this._groupSaveTimers.delete(groupId);
      this._saveGroup(groupId);
    }, 350);
    this._groupSaveTimers.set(groupId, timer);
  }

  async _saveGroup(groupId) {
    if (!this._currentRemote) return;
    const stored = this._currentRemote.groups?.[groupId] || {};
    try {
      await this._hass.connection.sendMessagePromise({
        type: WS_SET_GROUP,
        device_id: this._currentRemote.device.id,
        group_id: groupId,
        target: stored.target || null,
        dim_step: stored.dim_step ?? DEFAULT_DIM_STEP,
      });
      this._showToast("Saved");
    } catch (err) {
      this._showToast(
        `Save failed: ${(err && (err.message || err.code)) || "error"}`,
      );
    }
  }

  _refreshStateRows() {
    // The Summary text in each state row depends on the group's target +
    // dim_step. Re-render the side panel without touching the SVG / picker.
    const root = this.shadowRoot;
    const aside = root?.querySelector(".remote-side");
    if (!aside) return;
    // Cheapest correct option: full re-render. The picker survives because
    // it's a property-driven component but losing focus inside its dialog
    // would be jarring — so we *don't* fully re-render. Instead, replace
    // each state row's summary by recomputing.
    const def = this._currentRemote?.definition;
    const button = def?.buttons?.find((b) => b.id === this._selectedButtonId);
    if (!button) return;
    const groupCfg = this._currentRemote?.groups?.[button.group] || {};
    const dimStep = groupCfg.dim_step ?? DEFAULT_DIM_STEP;
    const target = groupCfg.target;
    button.states.forEach((state) => {
      const row = aside.querySelector(
        `.state-row[data-state-id="${cssEscape(state.id)}"]`,
      );
      if (!row) return;
      const summaryEl = row.querySelector(".state-summary");
      if (!summaryEl) return;
      const override =
        this._currentRemote?.overrides?.[button.id]?.[state.id];
      const hasOverride = Array.isArray(override) && override.length > 0;
      let text;
      let cls = "default";
      if (hasOverride) {
        text = `Override · ${this._describeActionsShort(override)}`;
        cls = "override";
      } else if (state.role === "none") {
        text = "Unbound";
        cls = "muted";
      } else if (!target) {
        text = "Pick a target above";
        cls = "muted";
      } else {
        text = `Default · ${this._describeRole(state.role, target, dimStep)}`;
      }
      summaryEl.className = `state-summary ${cls}`;
      summaryEl.textContent = text;
    });
  }

  _describeActionsShort(actions) {
    if (!Array.isArray(actions) || actions.length === 0) return "Not configured";
    if (actions.length === 1) {
      const a = actions[0];
      if (a.service) return `Call ${a.service}`;
      if (a.scene) return `Activate scene ${a.scene}`;
      if (a.delay) return "Delay";
      return "Custom action";
    }
    return `${actions.length} steps`;
  }

  _describeRole(role, target, dimStep) {
    const t = this._describeTargetShort(target);
    switch (role) {
      case "turn_on": return `Turn on ${t}`;
      case "turn_off": return `Turn off ${t}`;
      case "toggle": return `Toggle ${t}`;
      case "dim_up": return `Brighten ${t} (+${dimStep}%)`;
      case "dim_down": return `Dim ${t} (-${dimStep}%)`;
      default: return "Unbound";
    }
  }

  _describeTargetShort(target) {
    if (!target || typeof target !== "object") return "";
    if (target.entity_id) {
      return Array.isArray(target.entity_id) ? target.entity_id[0] : target.entity_id;
    }
    if (target.device_id) return "device";
    if (target.area_id) return "area";
    return "";
  }

  // ----------- buttons / states / advanced editor

  _onSvgButtonClick(buttonId) {
    if (!this._testMode) {
      this._selectButton(buttonId);
      return;
    }
    const button = this._currentRemote?.definition?.buttons?.find(
      (b) => b.id === buttonId,
    );
    if (!button) return;
    const stateId =
      this._selectedButtonId === buttonId && this._selectedStateId
        ? this._selectedStateId
        : button.states?.[0]?.id;
    if (!stateId) return;
    this._pulseButton(buttonId);
    this._hass.connection
      .sendMessagePromise({
        type: WS_TRIGGER,
        device_id: this._currentRemote.device.id,
        button_id: buttonId,
        state_id: stateId,
      })
      .then((res) => {
        if (res && res.fired === false) {
          this._showToast(
            `${button.label || buttonId} / ${stateId} has nothing to fire`,
          );
        } else {
          this._showToast(`Triggered ${button.label || buttonId} / ${stateId}`);
        }
      })
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
      el.addEventListener("click", () => this._selectState(el.dataset.stateId));
    });
    this._wireAdvancedToggle();
    this._wireEditor();
  }

  _wireAdvancedToggle() {
    // Advanced toggle lives at the bottom of the state list — appended on
    // demand so it can show "Use advanced override" or "Hide editor".
    const root = this.shadowRoot;
    const aside = root?.querySelector(".remote-side");
    if (!aside) return;
    if (!this._selectedButtonId || !this._selectedStateId) return;
    let toggle = aside.querySelector(".advanced-toggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.className = "advanced-toggle";
      const stateList = aside.querySelector(".state-list");
      stateList?.after(toggle);
    }
    toggle.textContent = this._advancedOpen
      ? "Hide override editor"
      : "Use advanced override";
    toggle.onclick = () => {
      this._advancedOpen = !this._advancedOpen;
      if (this._advancedOpen) this._loadEditorFromOverride();
      this._render();
    };
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
        if (act === "save") this._saveOverride();
        else if (act === "test") this._testOverride();
        else if (act === "clear") this._clearOverride();
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
    this._loadEditorFromOverride();
    this._render();
  }

  _selectState(stateId) {
    this._selectedStateId = stateId;
    this._loadEditorFromOverride();
    this._render();
  }

  // ============================================================ override editor
  _loadEditorFromOverride() {
    const actions = this._currentOverride();
    this._editorText = actions.length ? JSON.stringify(actions, null, 2) : "";
    this._editorError = null;
    this._editorDirty = false;
  }

  _currentOverride() {
    if (
      !this._currentRemote ||
      !this._selectedButtonId ||
      !this._selectedStateId
    ) {
      return [];
    }
    return (
      this._currentRemote.overrides?.[this._selectedButtonId]?.[
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

  async _saveOverride() {
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
        type: WS_SET_OVERRIDE,
        device_id: this._currentRemote.device.id,
        button_id: this._selectedButtonId,
        state_id: this._selectedStateId,
        actions,
      });
      this._setOverrideLocal(actions);
      this._editorDirty = false;
      this._editorError = null;
      this._showToast("Override saved");
    } catch (err) {
      this._editorError =
        (err && (err.message || err.code)) || "Save failed.";
    }
    this._render();
  }

  async _clearOverride() {
    try {
      await this._hass.connection.sendMessagePromise({
        type: WS_SET_OVERRIDE,
        device_id: this._currentRemote.device.id,
        button_id: this._selectedButtonId,
        state_id: this._selectedStateId,
        actions: [],
      });
      this._setOverrideLocal([]);
      this._editorText = "";
      this._editorDirty = false;
      this._editorError = null;
      this._showToast("Cleared override");
    } catch (err) {
      this._editorError =
        (err && (err.message || err.code)) || "Clear failed.";
    }
    this._render();
  }

  async _testOverride() {
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

  _setOverrideLocal(actions) {
    if (!this._currentRemote) return;
    const overrides = { ...(this._currentRemote.overrides || {}) };
    const buttonMap = { ...(overrides[this._selectedButtonId] || {}) };
    if (actions.length) {
      buttonMap[this._selectedStateId] = actions;
      overrides[this._selectedButtonId] = buttonMap;
    } else {
      delete buttonMap[this._selectedStateId];
      if (Object.keys(buttonMap).length) {
        overrides[this._selectedButtonId] = buttonMap;
      } else {
        delete overrides[this._selectedButtonId];
      }
    }
    this._currentRemote = { ...this._currentRemote, overrides };
  }

  _insertTemplate(name) {
    // Quick-insert templates seed an action targeting the current group's
    // entity (when single-entity), otherwise fall back to a placeholder.
    const button = this._currentRemote?.definition?.buttons?.find(
      (b) => b.id === this._selectedButtonId,
    );
    const groupCfg = button
      ? this._currentRemote?.groups?.[button.group]
      : null;
    const target = groupCfg?.target || null;
    const entityId =
      target && typeof target === "object" && target.entity_id
        ? Array.isArray(target.entity_id)
          ? target.entity_id[0]
          : target.entity_id
        : "";
    const tpl = actionTemplate(name, entityId);
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
  }

  // ============================================================ event log
  _refreshEventLog() {
    const root = this.shadowRoot;
    if (!root) return;
    const lookup = this._buildEventLookup();
    root.querySelectorAll(".event-list").forEach((list) => {
      const filter = list.dataset.deviceFilter || "";
      list.innerHTML = renderEventListItems(this._eventLog, filter, lookup);
    });
    root.querySelectorAll("[data-event-count]").forEach((el) => {
      el.textContent = String(this._eventLog.length);
    });
  }

  _buildEventLookup() {
    const definitionsById = new Map(
      (this._definitions || []).map((d) => [d.id, d]),
    );
    const lookup = new Map();
    for (const r of this._remotes || []) {
      lookup.set(r.device_id, {
        name: r.device_name,
        definition: definitionsById.get(r.definition_id) || null,
      });
    }
    if (this._currentRemote?.device?.id) {
      lookup.set(this._currentRemote.device.id, {
        name: this._currentRemote.device.name,
        definition: this._currentRemote.definition,
      });
    }
    return lookup;
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

RemoteStudioPanel.prototype._renderIndex = renderIndex;
RemoteStudioPanel.prototype._renderDevice = renderDevice;
RemoteStudioPanel.prototype._renderEditor = renderEditor;
