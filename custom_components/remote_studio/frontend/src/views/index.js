/**
 * Index view — discovered remotes, unmatched candidates.
 *
 * Called as a method on RemoteStudioPanel (`this` is the panel instance),
 * so it reads state via `this._remotes`, `this._definitions`, etc.
 */
import { batteryChipHtml, integrationChipHtml } from "../chips.js";
import { escapeAttr, escapeHtml, mdiIcon } from "../helpers.js";

export function renderIndex() {
  const definitionsById = new Map(this._definitions.map((d) => [d.id, d]));

  const filterText = (this._filterText || "").trim().toLowerCase();
  const matches = this._remotes.filter((r) => matchesFilter(r, filterText));
  const filtered = filterText.length > 0;
  const total = this._remotes.length;

  const remotes = matches
    .map((r) => renderCard(r, definitionsById))
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

  const versionTag = this._version
    ? ` <span class="version-tag">v${escapeHtml(this._version)}</span>`
    : "";

  return `
    <header class="page-header">
      <h1>Remote Studio${versionTag}</h1>
      <p class="lead">Configure your Zigbee and Matter remotes visually.</p>
    </header>
    ${this._error ? `<div class="error">${escapeHtml(this._error)}</div>` : ""}
    <section>
      <div class="section-head">
        <h2>Discovered remotes</h2>
        ${
          total > 0
            ? `<div class="filter-bar">
                ${renderSearchInput(this._filterText)}
                <span class="filter-count">${
                  filtered
                    ? `${matches.length} of ${total}`
                    : `${total}`
                }</span>
              </div>`
            : ""
        }
      </div>
      ${renderRemotesGrid(remotes, total, matches.length, filtered)}
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
  `;
}

function matchesFilter(remote, filterText) {
  if (!filterText) return true;
  const haystack = [
    remote.device_name,
    remote.manufacturer,
    remote.model,
    remote.area?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(filterText);
}

function renderSearchInput(currentValue) {
  const value = escapeAttr(currentValue || "");
  const clearBtn = currentValue
    ? `<button class="filter-clear" data-clear-filter aria-label="Clear filter">×</button>`
    : "";
  return `
    <div class="filter-input-wrap">
      ${mdiIcon("magnify", "filter-icon")}
      <input
        type="search"
        class="filter-input"
        data-filter
        placeholder="Filter by name, manufacturer, or area"
        value="${value}"
      />
      ${clearBtn}
    </div>`;
}

function renderRemotesGrid(remotesHtml, total, shownCount, filtered) {
  if (!total) {
    return `<div class="empty">No matching remotes paired yet. Pair a supported remote in ZHA or Zigbee2MQTT to see it here.</div>`;
  }
  if (filtered && shownCount === 0) {
    return `<div class="empty">No remotes match the filter.</div>`;
  }
  return `<div class="grid">${remotesHtml}</div>`;
}

function renderCard(remote, definitionsById) {
  const def = definitionsById.get(remote.definition_id);
  const thumb = def?.svg ? def.svg : "";
  const layoutName = def?.name || remote.definition_id;
  const battery = batteryChipHtml(remote.battery, def?.battery, {
    hideTypeWhenOk: true,
  });
  const integration = integrationChipHtml(remote.integration);
  // The layout name already conveys make/model — drop the extra
  // "manufacturer · model" line. Show the area instead, if one is set.
  const areaLine = remote.area
    ? `<div class="card-meta-soft">${mdiIcon("mapMarker")}${escapeHtml(remote.area.name)}</div>`
    : "";
  return `
    <button class="card" data-device-id="${escapeAttr(remote.device_id)}">
      <div class="card-thumb">${thumb}</div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(remote.device_name) || "Unnamed remote"}</div>
        <div class="card-meta">${escapeHtml(layoutName)}</div>
        ${areaLine}
        <div class="card-chips">${integration}${battery}</div>
      </div>
      <div class="card-arrow">›</div>
    </button>`;
}

function renderCandidate(candidate, layoutOptions) {
  const areaLine = candidate.area
    ? ` · ${escapeHtml(candidate.area.name)}`
    : "";
  return `
    <div class="candidate">
      <div class="candidate-info">
        <div class="title">${escapeHtml(candidate.device_name) || "Unnamed device"}</div>
        <div class="meta">${escapeHtml(candidate.manufacturer || "")} · ${escapeHtml(candidate.model || "")}${areaLine}</div>
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
