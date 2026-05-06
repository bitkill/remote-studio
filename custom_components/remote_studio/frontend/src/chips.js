/**
 * Reusable chip widgets — currently the integration brand chip and the
 * battery status chip. Both produce HTML strings and are used both on
 * the home cards and in the remote-detail header.
 */
import { INTEGRATION_INFO } from "./constants.js";
import {
  batteryClass,
  batteryIcon,
  escapeAttr,
  escapeHtml,
  mdiIcon,
} from "./helpers.js";

export function integrationChipHtml(integration) {
  if (!integration) return "";
  const info = INTEGRATION_INFO[integration] || { label: integration };
  const glyph = info.mdi ? mdiIcon(info.mdi) : "";
  return `<span class="integration-chip" title="${escapeAttr(integration)}">
    ${glyph}
    <span>${escapeHtml(info.label)}</span>
  </span>`;
}

export function batteryChipHtml(battery, batterySpec) {
  if (!battery && !batterySpec) return "";
  const status = battery
    ? `${escapeHtml(String(battery.state))}${escapeHtml(battery.unit || "%")}`
    : "no status reported";
  const specPart = batterySpec
    ? ` · ${escapeHtml(String(batterySpec.count))}×${escapeHtml(batterySpec.type)}`
    : "";
  const cls = battery ? batteryClass(battery.state) : "is-unknown";
  const titleAttr = battery?.entity_id
    ? ` title="${escapeAttr(battery.entity_id)}"`
    : "";
  return `<span class="battery ${cls}"${titleAttr}>${batteryIcon(battery?.state)}<span class="battery-text">${status}${specPart}</span></span>`;
}
