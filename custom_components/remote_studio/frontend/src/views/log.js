/**
 * Renderers for the recent-events log.
 *
 *   renderEventListItems(log, deviceFilter, lookup)
 *       — bare <li> rows for an .event-list container. Used by both
 *         the index view (collapsed log of all events) and the device
 *         view (always-open log filtered to the current device).
 *
 *   renderEventLogIndex.call(panel)
 *       — the <details> wrapper for the index view.
 *
 *   renderEventLogDevice.call(panel, deviceId)
 *       — the always-open section for the device view.
 *
 * Lookup format: a Map<device_id, { name, definition }> built from the
 * panel's `_remotes` + `_definitions`. The renderers fall back to raw
 * ids when the lookup misses.
 */
import { escapeAttr, escapeHtml } from "../helpers.js";

const MAX_VISIBLE = 50;

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function labelFor(definition, buttonId, stateId) {
  if (!definition) return { button: buttonId, state: stateId };
  const button = definition.buttons?.find((b) => b.id === buttonId);
  const state = button?.states?.find((s) => s.id === stateId);
  return {
    button: button?.label || buttonId,
    state: state?.label || stateId,
  };
}

export function renderEventListItems(log, deviceFilter, lookup) {
  const filtered = deviceFilter
    ? log.filter((e) => e.device_id === deviceFilter)
    : log;
  if (filtered.length === 0) {
    return `<li class="event-empty">No events recorded yet — press a button on a remote.</li>`;
  }
  return filtered
    .slice(0, MAX_VISIBLE)
    .map((e) => {
      const ctx = lookup.get(e.device_id) || {};
      const { button, state } = labelFor(ctx.definition, e.button_id, e.state_id);
      const deviceName = ctx.name || e.device_id;
      const deviceCol = deviceFilter
        ? ""
        : `<span class="event-device">${escapeHtml(deviceName)}</span>`;
      return `
        <li class="event-row">
          <time>${escapeHtml(formatTime(e.ts))}</time>
          ${deviceCol}
          <span class="event-action">${escapeHtml(button)}<span class="sep">·</span>${escapeHtml(state)}</span>
        </li>`;
    })
    .join("");
}

export function renderEventLogIndex() {
  const lookup = this._buildEventLookup();
  return `
    <section class="event-log-section">
      <details class="event-log">
        <summary>
          <span>Recent events</span>
          <span class="event-count" data-event-count>${this._eventLog.length}</span>
        </summary>
        <ul class="event-list" data-device-filter="">${renderEventListItems(
          this._eventLog,
          "",
          lookup,
        )}</ul>
      </details>
    </section>
  `;
}

export function renderEventLogDevice(deviceId) {
  const lookup = this._buildEventLookup();
  return `
    <section class="event-log-section device-log">
      <h2>Recent events</h2>
      <ul class="event-list" data-device-filter="${escapeAttr(deviceId)}">${renderEventListItems(
        this._eventLog,
        deviceId,
        lookup,
      )}</ul>
    </section>
  `;
}
