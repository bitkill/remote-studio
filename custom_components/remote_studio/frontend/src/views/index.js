/**
 * Index view — discovered remotes, unmatched candidates.
 *
 * Called as a method on RemoteStudioPanel (`this` is the panel instance),
 * so it reads state via `this._remotes`, `this._definitions`, etc.
 */
import { batteryChipHtml, integrationChipHtml } from "../chips.js";
import { escapeAttr, escapeHtml, mdiIcon } from "../helpers.js";
import { renderEventLogIndex } from "./log.js";

export function renderIndex() {
  const definitionsById = new Map(this._definitions.map((d) => [d.id, d]));
  const hassStates = this._hass?.states || {};

  const filterText = (this._filterText || "").trim().toLowerCase();
  const matches = this._remotes.filter((r) =>
    matchesFilter(r, filterText, definitionsById, hassStates),
  );
  const filtered = filterText.length > 0;
  const total = this._remotes.length;

  const remotes = matches
    .map((r) => renderCard(r, definitionsById, hassStates))
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

  const headerText = `Remote Studio${this._version ? ` v${this._version}` : ""}`;

  return `
    <hass-subpage header="${escapeAttr(headerText)}">
      <div class="page-content">
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
        ${renderEventLogIndex.call(this)}
      </div>
    </hass-subpage>
  `;
}

function matchesFilter(remote, filterText, definitionsById, hassStates) {
  if (!filterText) return true;
  const layoutName = definitionsById.get(remote.definition_id)?.name;
  const targetFriendlies = (remote.targets || []).map(
    (eid) => hassStates?.[eid]?.attributes?.friendly_name || "",
  );
  const haystack = [
    remote.device_name,
    remote.manufacturer,
    remote.model,
    remote.area?.name,
    layoutName,
    ...(remote.targets || []),
    ...targetFriendlies,
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
        placeholder="Filter by name, model, area, or controlled entity"
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

function renderCard(remote, definitionsById, hassStates) {
  const def = definitionsById.get(remote.definition_id);
  const thumb = def?.svg ? def.svg : "";
  const layoutName = def?.name || remote.definition_id;
  const battery = batteryChipHtml(remote.battery, def?.battery, {
    hideTypeWhenOk: true,
  });
  const integration = integrationChipHtml(remote.integration);
  const areaLine = remote.area
    ? `<div class="card-meta-soft">${mdiIcon("mapMarker")}${escapeHtml(remote.area.name)}</div>`
    : "";
  const controlsLine = renderControlsLine(remote.targets, hassStates);
  return `
    <button class="card" data-device-id="${escapeAttr(remote.device_id)}">
      <div class="card-thumb">${thumb}</div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(remote.device_name) || "Unnamed remote"}</div>
        <div class="card-meta">${escapeHtml(layoutName)}</div>
        ${areaLine}
        ${controlsLine}
        <div class="card-chips">${integration}${battery}</div>
      </div>
      <div class="card-arrow">›</div>
    </button>`;
}

// One-line summary of what the remote currently drives.
//   No targets yet  -> muted "Not controlling any devices"
//   1 target        -> friendly name
//   2-3             -> "A, B, C"
//   4+              -> "A, B + N more"
function renderControlsLine(targets, hassStates) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return `<div class="card-controls is-empty">Not controlling any devices</div>`;
  }
  const labels = targets.map(
    (eid) => hassStates?.[eid]?.attributes?.friendly_name || eid,
  );
  let body;
  if (labels.length <= 3) {
    body = labels.join(", ");
  } else {
    body = `${labels.slice(0, 2).join(", ")} +${labels.length - 2} more`;
  }
  return `<div class="card-controls">Controls ${escapeHtml(body)}</div>`;
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
