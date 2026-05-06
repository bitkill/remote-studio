/**
 * Local-dev shim for the Remote Studio panel.
 *
 * Replicates just enough of HA's main app to make our panel runnable
 * outside HA: builds a minimal `hass` object backed by a real
 * WebSocket connection to a Home Assistant instance, and reflects
 * URL changes (pushState + 'location-changed' event) into the panel's
 * `route` property.
 *
 * Auth is via a long-lived access token from .env.
 *
 * Edits to anything under custom_components/remote_studio/frontend/
 * trigger Vite's HMR — refresh the page to see them.
 */
import {
  createConnection,
  createLongLivedTokenAuth,
} from "home-assistant-js-websocket";

import "../custom_components/remote_studio/frontend/remote-studio-panel.js";

const PANEL_BASE = "remote-studio";
const HA_URL = import.meta.env.VITE_HA_URL;
const HA_TOKEN = import.meta.env.VITE_HA_TOKEN;
const status = document.getElementById("status");

function setStatus(text, isError = false) {
  if (!status) return;
  status.textContent = text;
  status.style.color = isError ? "#ff7676" : "rgba(255,255,255,0.85)";
}

if (!HA_URL || !HA_TOKEN) {
  setStatus("missing HA_URL / HA_TOKEN in .env", true);
  throw new Error("HA_URL and HA_TOKEN must be set in .env");
}

setStatus(`connecting to ${HA_URL}…`);

const auth = createLongLivedTokenAuth(HA_URL, HA_TOKEN);
let connection;
try {
  connection = await createConnection({ auth });
} catch (err) {
  setStatus(`connection failed: ${err?.message || err}`, true);
  throw err;
}

const me = await connection.sendMessagePromise({ type: "auth/current_user" });
setStatus(`connected as ${me.name}`);

const hass = {
  connection,
  user: me,
  auth,
  // Minimal fields the panel reads. Add more if a render path needs them.
  states: {},
  themes: { darkMode: matchMedia("(prefers-color-scheme: dark)").matches },
  language: navigator.language || "en",
};

// Mount the panel.
const panel = document.createElement("remote-studio-panel");
panel.hass = hass;
syncRoute();
document.body.appendChild(panel);

// Reflect URL into the panel's `route` whenever it changes.
function syncRoute() {
  const pathname = window.location.pathname;
  const prefix = `/${PANEL_BASE}`;
  let path = "";
  if (pathname.startsWith(prefix)) {
    path = pathname.slice(prefix.length);
  } else if (pathname === "/") {
    // Always start at the panel root in dev so navigation feels normal.
    history.replaceState(null, "", prefix);
    path = "";
  }
  panel.route = { path, prefix };
}

window.addEventListener("location-changed", syncRoute);
window.addEventListener("popstate", syncRoute);

// Seed hass.states with the current snapshot, then keep it fresh from
// state_changed events. The action editor's target picker reads this.
const initial = await connection.sendMessagePromise({ type: "get_states" });
for (const st of initial) {
  hass.states[st.entity_id] = st;
}
// Re-render so any view that already mounted picks up the populated states.
const panelEl = document.querySelector("remote-studio-panel");
if (panelEl?._render) panelEl._render();

connection.subscribeEvents((evt) => {
  if (evt.event_type !== "state_changed") return;
  const { entity_id, new_state } = evt.data;
  if (new_state) hass.states[entity_id] = new_state;
  else delete hass.states[entity_id];
}, "state_changed");
