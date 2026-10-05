/**
 * Vite config for the local frontend dev server.
 *
 * Serves dev/index.html as the entry. The dev shim there mounts our
 * panel and connects to a real Home Assistant instance via WebSocket
 * using credentials from .env.
 *
 *   HA_URL=http://homeassistant.local:8123
 *   HA_TOKEN=<long-lived access token>
 *
 * The HA_* values from .env are surfaced to the client as
 * import.meta.env.VITE_HA_URL / VITE_HA_TOKEN.
 */
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // loadEnv with the "HA_" prefix lets us keep the same .env file the
  // playwright tooling already uses without renaming variables.
  const env = loadEnv(mode, process.cwd(), ["HA_"]);
  return {
    root: "dev",
    server: {
      port: 5173,
      strictPort: false,
      host: true,
    },
    define: {
      "import.meta.env.VITE_HA_URL": JSON.stringify(env.HA_URL || ""),
      "import.meta.env.VITE_HA_TOKEN": JSON.stringify(env.HA_TOKEN || ""),
      // `VITE_BACKEND=fixture npm run dev` runs the panel against
      // dev/fixture-backend.mjs with no HA at all.
      "import.meta.env.VITE_BACKEND": JSON.stringify(process.env.VITE_BACKEND || ""),
    },
  };
});
