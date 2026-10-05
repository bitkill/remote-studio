# AGENTS.md

Short notes for agents who weren't here for the build. Read alongside `README.md`.

## What this is

Home Assistant **custom integration** at `custom_components/remote_studio/` that ships a sidebar panel for visually configuring Zigbee/Matter remotes. Backend is Python; frontend is a vanilla ES module bundle (no build step) loaded via `panel_custom`.

## Workflow rules (do not skip)

- **Never restart, install, or otherwise touch the user's live HA without asking** — except when they explicitly say "deploy" or run `make update`.
- **Never `gh release create`.** `git push` to `main` is fine; the GitHub Actions release pipeline tags + bumps `manifest.json` automatically. Pull `--rebase` after the run to pick up its commit.
- **Conventional Commits matter:** `feat:` → minor, `fix:` → patch, anything else → no release. Pick deliberately.
- **No `Co-Authored-By: Claude` trailer** on commits in this project.

## Dev tooling — use it, don't reinvent

- `make update` = install latest tag onto live HA + restart + wait. The fast loop after a push.
- `make logs FILTER=remote_studio` = tail HA logs filtered by component.
- `make events` = stream live event bus (use to capture ZHA/Z2M signatures for new remotes).
- `make version` / `make wait` / `make restart` = self-explanatory.
- Tests: `/tmp/havenv/bin/python3 -m pytest` (after `make setup`). They are HA-free: only `custom_components/remote_studio/core/` is importable in tests, via `tests/conftest.py`. Never import `homeassistant` in `core/`.
- The CLI is `scripts/ha.py`; `Makefile` just wraps it. Long-lived token is in `.env`.
- Local frontend dev: `npm run dev` (Vite). `dev/shim.mjs` mounts the panel against the real HA over WebSocket so you get real devices/events without packaging.

## Traps we've already hit (don't pay for them again)

- **YAML 1.1 booleans (the Norway problem).** Unquoted `id: on` / `id: off` parses as `True` / `False`. Always quote button IDs: `id: "on"`. Same for `"off"`, `"yes"`, `"no"`.
- **HA Script helper needs SCRIPT_SCHEMA.** Don't hand a raw action-list dict to `Script(...)` — validate via `homeassistant.helpers.config_validation.SCRIPT_SCHEMA` first, or you get cryptic `'service_template'` KeyErrors at execution. And pass `context=Context()`, never `None`.
- **HassKey ≠ string.** `hass.data.get("automation")` returns `None` because the key is a `HassKey`, not the string `"automation"`. Import the canonical key (e.g. `from homeassistant.components.automation import DATA_COMPONENT`).
- **HA's `Store` calls `_async_migrate_func` on *minor* bumps too.** Returning `{}` there wipes user data. The decision lives in `core/mappings.py:migrate` — keep it tested.
- **Some remotes have no entities, only events.** Hue Dimmers (RWL021/RWL022) emit ZHA events but expose no button entities — match on `zha_event` payloads, not entity state. ZHA's Hue events use `<button>_<press_type>` (`on_press`, `up_short_release`); Z2M uses `_press_release` not `_short_release`.

## Adding a new remote

Two files in `custom_components/remote_studio/remotes/`:
1. `<id>.yaml` — declares buttons + states + per-source signatures (`zha:` / `z2m:` / `matter:`).
2. `<id>.svg` — hotspots are `<g id="button-<button_id>">` groups; the panel attaches handlers from those IDs.

No Python changes needed. Use `make events` to capture real signatures off the user's device while pairing.

## Frontend layout

- Entry: `custom_components/remote_studio/frontend/remote-studio-panel.js` (small — just registers the element).
- Real code: `frontend/src/{constants,helpers,chips,styles,panel}.js` and `frontend/src/views/{index,device,editor,log}.js`.
- Routes: `/remote-studio` (index) and `/remote-studio/device/<device_id>[:<def_id>]` (device view).
