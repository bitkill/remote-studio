/**
 * Local-dev shim for the Remote Studio panel.
 *
 * Replicates just enough of HA's main app to make our panel runnable
 * outside HA: builds a minimal `hass` object and reflects URL changes
 * (pushState + 'location-changed' event) into the panel's `route`.
 *
 * Two backends:
 *   default              — real WebSocket connection to the HA in .env
 *                          (HA_URL + HA_TOKEN).
 *   VITE_BACKEND=fixture — dev/fixture-backend.mjs serving
 *                          dev/fixtures/remotes.json; no HA needed.
 *                          `make dev-fixture`.
 *
 * Edits under custom_components/remote_studio/frontend/ trigger Vite's
 * HMR — refresh the page to see them.
 */
import "../custom_components/remote_studio/frontend/remote-studio-panel.js";

const PANEL_BASE = "remote-studio";
const status = document.getElementById("status");

function setStatus(text, isError = false) {
  if (!status) return;
  status.textContent = text;
  status.style.color = isError ? "#ff7676" : "rgba(255,255,255,0.85)";
}

const hass = {
  connection: null,
  user: null,
  auth: null,
  // Minimal fields the panel reads. Add more if a render path needs them.
  states: {},
  themes: { darkMode: matchMedia("(prefers-color-scheme: dark)").matches },
  language: navigator.language || "en",
};
let backend = null;

if (import.meta.env.VITE_BACKEND === "fixture") {
  const [{ createFixtureBackend }, fixture] = await Promise.all([
    import("./fixture-backend.mjs"),
    fetch(new URL("./fixtures/remotes.json", import.meta.url)).then((r) => r.json()),
  ]);
  backend = createFixtureBackend(fixture);
  Object.assign(hass.states, fixture.states);
  hass.user = { name: "fixture" };
  setStatus("fixture backend — no HA connection");
} else {
  const { createConnection, createLongLivedTokenAuth } = await import(
    "home-assistant-js-websocket"
  );
  const HA_URL = import.meta.env.VITE_HA_URL;
  const HA_TOKEN = import.meta.env.VITE_HA_TOKEN;
  if (!HA_URL || !HA_TOKEN) {
    setStatus("missing HA_URL / HA_TOKEN in .env (or VITE_BACKEND=fixture)", true);
    throw new Error("HA_URL and HA_TOKEN must be set in .env");
  }
  setStatus(`connecting to ${HA_URL}…`);
  const auth = createLongLivedTokenAuth(HA_URL, HA_TOKEN);
  try {
    hass.connection = await createConnection({ auth });
  } catch (err) {
    setStatus(`connection failed: ${err?.message || err}`, true);
    throw err;
  }
  hass.auth = auth;
  hass.user = await hass.connection.sendMessagePromise({ type: "auth/current_user" });
  setStatus(`connected as ${hass.user.name}`);

  // Seed hass.states before mounting, then keep it fresh. The entity
  // picker reads it.
  for (const st of await hass.connection.sendMessagePromise({ type: "get_states" })) {
    hass.states[st.entity_id] = st;
  }
  hass.connection.subscribeEvents((evt) => {
    if (evt.event_type !== "state_changed") return;
    const { entity_id, new_state } = evt.data;
    if (new_state) hass.states[entity_id] = new_state;
    else delete hass.states[entity_id];
  }, "state_changed");
}

// Mount the panel. An injected backend wins over the one the panel
// would build from hass.connection.
const panel = document.createElement("remote-studio-panel");
if (backend) panel.backend = backend;
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
