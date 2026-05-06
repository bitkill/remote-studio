/**
 * All shadow-DOM CSS for the panel as a single string. Kept in its own
 * module so the class doesn't have a 300-line method body.
 */
export const css = `
  :host {
    display: block;
    padding: 24px;
    color: var(--primary-text-color);
    font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif);
  }
  h1 { margin: 0; font-size: 1.6rem; font-weight: 500; }
  h2 { font-size: 1.05rem; margin: 0 0 12px; font-weight: 500; }
  .page-header { margin-bottom: 24px; }
  .page-header.with-back { display: flex; gap: 16px; align-items: center; justify-content: flex-start; }
  .header-info { flex: 1; }
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
  ul { padding-left: 20px; margin: 0; }
  li { margin: 4px 0; }
  .empty {
    padding: 32px; text-align: center; opacity: 0.7;
    border: 1px dashed var(--divider-color, #e0e0e0);
    border-radius: 12px;
  }
  .error {
    background: var(--error-color, #e57373); color: white;
    padding: 12px 16px; border-radius: 8px; margin-bottom: 16px;
  }

  /* ============================ Cards (home view) ===================== */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 12px;
  }
  .card {
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
    background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color, #e0e0e0);
    border-radius: 14px;
    padding: 14px 16px;
    display: grid;
    grid-template-columns: 64px 1fr auto;
    align-items: center;
    gap: 16px;
    transition: transform 120ms ease-out, box-shadow 200ms ease-out, border-color 200ms ease-out;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  .card:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.07);
  }
  .card-thumb {
    width: 64px; height: 88px;
    display: flex; align-items: center; justify-content: center;
    background: var(--secondary-background-color, #f7f5f0);
    border-radius: 10px;
    overflow: hidden;
  }
  .card-thumb svg { width: 100%; height: 100%; pointer-events: none; }
  .card-thumb svg .rs-button { cursor: inherit; pointer-events: none; }
  .card-body { min-width: 0; }
  .card-title { font-weight: 600; font-size: 1.02rem; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-meta { font-size: 0.9rem; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-meta-soft { font-size: 0.78rem; opacity: 0.55; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-chips { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
  .card-chip {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px; border-radius: 999px;
    background: var(--secondary-background-color, #f4f4f4);
    font-size: 0.74rem; font-variant-numeric: tabular-nums;
  }
  .card-arrow {
    font-size: 1.4rem; opacity: 0.35;
    align-self: center; padding-right: 4px;
  }
  .card.is-pulsing { animation: rs-card-pulse 1.8s ease-out 1; }
  @keyframes rs-card-pulse {
    0%   { box-shadow: 0 0 0 0 rgba(255, 214, 110, 0.55), 0 1px 2px rgba(0,0,0,0.04); border-color: var(--rs-btn-pulse-fill, #ffd66e); }
    50%  { box-shadow: 0 0 0 14px rgba(255, 214, 110, 0); border-color: var(--rs-btn-pulse-fill, #ffd66e); }
    100% { box-shadow: 0 1px 2px rgba(0,0,0,0.04); border-color: var(--divider-color, #e0e0e0); }
  }

  /* ============================ Remote view =========================== */
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

  /* SVG hotspot pulse */
  .rs-button.is-pulsing rect,
  .rs-button.is-pulsing circle,
  .rs-button.is-pulsing path.btn-shape {
    fill: var(--rs-btn-pulse-fill, #ffd66e) !important;
    transition: fill 80ms ease-out;
  }

  /* State rows */
  .state-list { display: flex; flex-direction: column; gap: 8px; }
  .state-row {
    padding: 10px 14px;
    border-radius: 10px;
    background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color, #e0e0e0);
    cursor: pointer;
    transition: background 80ms ease-out, box-shadow 220ms ease-out;
  }
  .state-row:hover { filter: brightness(0.97); }
  .state-row.selected {
    border-color: var(--primary-color, #5b8def);
    background: var(--primary-color-light, #e3edff);
  }
  .state-row.is-pulsing { animation: rs-row-pulse 600ms ease-out 1; }
  @keyframes rs-row-pulse {
    0%   { background: var(--rs-btn-pulse-fill, #ffd66e); box-shadow: 0 0 0 4px rgba(255, 214, 110, 0.3); }
    100% { background: var(--card-background-color, #fff); box-shadow: 0 0 0 0 rgba(255, 214, 110, 0); }
  }
  .state-label { font-weight: 600; margin-bottom: 4px; }
  .state-summary { font-size: 0.85rem; opacity: 0.8; }
  .hint { font-size: 0.8rem; opacity: 0.65; margin-top: 12px; }

  /* ============================ Action editor ========================= */
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

  /* ============================ Toasts & header chips ================ */
  .toast {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: var(--primary-text-color, #222);
    color: var(--card-background-color, #fff);
    padding: 8px 18px; border-radius: 999px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10;
  }
  .test-toggle {
    display: inline-flex; align-items: center; gap: 8px;
    cursor: pointer; user-select: none;
    padding: 6px 12px; border-radius: 999px;
    background: var(--secondary-background-color, #f4f4f4);
    border: 1px solid var(--divider-color, #e0e0e0);
    font-size: 0.85rem;
  }
  .test-toggle input { accent-color: var(--primary-color, #5b8def); }

  /* Battery chip */
  .battery {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 12px; border-radius: 999px;
    background: var(--secondary-background-color, #f4f4f4);
    border: 1px solid var(--divider-color, #e0e0e0);
    font-size: 0.85rem; font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .battery .battery-icon { width: 1em; height: 1em; flex-shrink: 0; }
  .battery .battery-icon path { fill: currentColor; }
  .battery .battery-text { line-height: 1; }
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
  .battery.is-unknown { opacity: 0.7; }

  /* Smaller chip variant when used inside a card */
  .card-chips .battery { font-size: 0.78rem; padding: 3px 9px; }
  .card-chips .battery .battery-text { white-space: normal; }
  .card-chips .integration-chip { font-size: 0.78rem; padding: 3px 9px 3px 4px; }
  .card-chips .integration-chip img { width: 16px; height: 16px; }

  /* Integration brand chip */
  .integration-chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 12px 4px 6px; border-radius: 999px;
    background: var(--secondary-background-color, #f4f4f4);
    border: 1px solid var(--divider-color, #e0e0e0);
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .integration-chip img {
    width: 18px; height: 18px;
    border-radius: 4px;
    object-fit: contain;
    background: white;
  }

  /* "Open in HA" link in the remote-detail header */
  .ha-link {
    display: inline-flex; align-items: center; gap: 6px;
    text-decoration: none; color: inherit;
    padding: 6px 12px; border-radius: 999px;
    background: var(--secondary-background-color, #f4f4f4);
    border: 1px solid var(--divider-color, #e0e0e0);
    font-size: 0.85rem;
    transition: filter 120ms ease-out;
  }
  .ha-link:hover { filter: brightness(0.96); }
  .ha-link svg { width: 1em; height: 1em; flex-shrink: 0; fill: currentColor; }

  /* ============================ Candidate list ======================= */
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
