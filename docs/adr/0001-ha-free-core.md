# ADR 0001: The core stays free of Home Assistant

**Status:** accepted · 2026-10-05

## Context

Until 0.23 the integration had no tests. `registry.py` imported
`homeassistant` at module top for one type hint and one YAML loader, which
made the schema, dataclasses and match indices unimportable without HA.
`scripts/check.py` kept an 80-line copy of the schema as a result, with a
docstring admitting it "will silently lie" once the two drifted.

Installing HA locally (`pytest-homeassistant-custom-component`) was
considered: it gives a real `hass` fixture but costs a few hundred MB,
slow setup, and version coupling, and it removes the pressure to keep
logic out of HA-bound code.

## Decision

- `custom_components/remote_studio/core/` holds the pure logic:
  definitions (schema, build, match), mappings (group config, overrides,
  migration), events (normalised remote events + matcher) and actions
  (role → action list). **No module in `core/` imports `homeassistant`.**
- Everything else in the package is HA-side glue: I/O, registries,
  subscriptions, websocket commands. It calls into `core`, never the
  reverse.
- Tests run in the HA-free venv at `/tmp/havenv`. `tests/conftest.py`
  puts `custom_components/remote_studio` on `sys.path` so `core` imports
  as a top-level package without executing the integration `__init__`.
  `scripts/check.py` does the same.
- `core` modules use relative imports so both import routes work.

## Consequences

- A behaviour that needs a `hass` object to test is in the wrong module;
  move the decision into `core` and leave the I/O outside.
- Two YAML loaders exist on purpose (HA's `load_yaml` in prod, PyYAML in
  check/tests). They are adapters over the same `build(dict)`.
- Adding HA-fixture tests later is additive and does not relax this rule.
