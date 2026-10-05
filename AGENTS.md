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
- **No HA handy?** `make dev-fixture` runs the panel against `dev/fixture-backend.mjs` + `dev/fixtures/remotes.json` (regenerate with `make fixture`; it is built from the real layouts by `scripts/make_fixture.py`). `make screenshot` works against it too.

## Traps we've already hit (don't pay for them again)

- **YAML 1.1 booleans (the Norway problem).** Unquoted `id: on` / `id: off` parses as `True` / `False`. Always quote button IDs: `id: "on"`. Same for `"off"`, `"yes"`, `"no"`.
- **HA Script helper needs SCRIPT_SCHEMA.** Don't hand a raw action-list dict to `Script(...)` — validate via `homeassistant.helpers.config_validation.SCRIPT_SCHEMA` first, or you get cryptic `'service_template'` KeyErrors at execution. And pass `context=Context()`, never `None`. This lives in exactly one place: `runtime.ActionRunner.run`. Call it; don't build Scripts elsewhere.
- **HassKey ≠ string.** `hass.data.get("automation")` returns `None` because the key is a `HassKey`, not the string `"automation"`. Import the canonical key (e.g. `from homeassistant.components.automation import DATA_COMPONENT`).
- **HA's `Store` calls `_async_migrate_func` on *minor* bumps too.** Returning `{}` there wipes user data. The decision lives in `core/mappings.py:migrate` — keep it tested.
- **Adding a source = one adapter + one schema entry.** Subclass `SourceAdapter` (or `EntityStateAdapter` for entity-backed sources) in `runtime.py`, add the signature schema to `core/definitions.py`, put the pure decoding in `core/events.py` with a test. Nothing else should need to know the source exists.
- **Some remotes have no entities, only events.** Hue Dimmers (RWL021/RWL022) emit ZHA events but expose no button entities — match on `zha_event` payloads, not entity state. ZHA's Hue events use `<button>_<press_type>` (`on_press`, `up_short_release`); Z2M uses `_press_release` not `_short_release`.

## Adding a new remote

Two files in `custom_components/remote_studio/remotes/`:
1. `<id>.yaml` — declares buttons + states + per-source signatures (`zha:` / `z2m:` / `matter:`).
2. `<id>.svg` — hotspots are `<g id="button-<button_id>">` groups; the panel attaches handlers from those IDs.

No Python changes needed. Use `make events` to capture real signatures off the user's device while pairing. `make check` builds every YAML through the real schema, verifies the SVG has a `button-<id>` hotspot per button, and rejects two states claiming the same signature.

## Backend layout

- `core/` — HA-free (see `docs/adr/0001-ha-free-core.md`): `definitions.py` (schema, `build()`, `match(source, payload)`, `find_for_device()`), `events.py` (`RemoteEvent`, `match_event()`, per-source decoders), `mappings.py` (`GroupConfig`, `MappingData`, migration), `actions.py` (`resolve()`: override → role default → nothing). Tested in `tests/`.
- HA-side glue: `registry.py` (loads YAML, caches), `storage.py` (HA Store), `runtime.py` (one `SourceAdapter` per integration emitting `RemoteEvent`s, `definitions_for(device_id)` = pairing first then auto-match, dispatch → `core.actions.resolve` → `ActionRunner.run`, the only place SCRIPT_SCHEMA/Script are used), `api.py` (websocket commands), `panel.py` (sidebar registration).
- Domain words are in `GLOSSARY.md`; use them in code and docs.

## Frontend layout

- Entry: `custom_components/remote_studio/frontend/remote-studio-panel.js` (small — just registers the element).
- Real code: `frontend/src/{constants,helpers,chips,styles,panel}.js` and `frontend/src/views/{index,device,editor,log,state-row}.js`.
- `backend.js` is the panel's only route to HA: eleven methods, one `BackendError`. Never call `hass.connection` from panel code; add a method (and its fixture twin in `dev/fixture-backend.mjs`) instead.
- `views/state-row.js` is the one template for a state's summary line; both the full render and the surgical `_refreshStateRows` use it. Don't re-type role→text anywhere else.
- Views are string-in/string-out; test them with `npm test` (`node --test tests/frontend/`). The toast is toggled in place, never via `_render()`.
- Routes: `/remote-studio` (index) and `/remote-studio/device/<device_id>[:<def_id>]` (device view).
