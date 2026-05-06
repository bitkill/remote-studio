/**
 * Home view — discovered remotes, unmatched candidates, available layouts.
 *
 * Called as a method on RemoteStudioPanel (`this` is the panel instance),
 * so it reads state via `this._remotes`, `this._definitions`, etc.
 */
import { batteryChipHtml, integrationChipHtml } from "../chips.js";
import { escapeAttr, escapeHtml } from "../helpers.js";

export function renderList() {
  const definitionsById = new Map(this._definitions.map((d) => [d.id, d]));

  const remotes = this._remotes.map((r) => renderCard(r, definitionsById)).join("");

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
    .map((c) => renderCandidate(c, layoutOptions))
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

function renderCard(remote, definitionsById) {
  const def = definitionsById.get(remote.definition_id);
  const thumb = def?.svg ? def.svg : "";
  const layoutName = def?.name || remote.definition_id;
  const battery = batteryChipHtml(remote.battery, def?.battery);
  const integration = integrationChipHtml(remote.integration);
  return `
    <button class="card" data-device-id="${escapeAttr(remote.device_id)}">
      <div class="card-thumb">${thumb}</div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(remote.device_name) || "Unnamed remote"}</div>
        <div class="card-meta">${escapeHtml(layoutName)}</div>
        <div class="card-meta-soft">${escapeHtml(remote.manufacturer || "")}${remote.model ? ` · ${escapeHtml(remote.model)}` : ""}</div>
        <div class="card-chips">${integration}${battery}</div>
      </div>
      <div class="card-arrow">›</div>
    </button>`;
}

function renderCandidate(candidate, layoutOptions) {
  return `
    <div class="candidate">
      <div class="candidate-info">
        <div class="title">${escapeHtml(candidate.device_name) || "Unnamed device"}</div>
        <div class="meta">${escapeHtml(candidate.manufacturer || "")} · ${escapeHtml(candidate.model || "")}</div>
        <div class="card-chips">${integrationChipHtml(candidate.integration)}</div>
      </div>
      <div class="candidate-actions">
        <select data-pair-device="${escapeAttr(candidate.device_id)}">
          <option value="">Pair with layout…</option>
          ${layoutOptions}
        </select>
      </div>
    </div>`;
}
