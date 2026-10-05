# Glossary

Domain terms for Remote Studio. Code, docs and architecture reviews use
these words exactly. Architecture vocabulary (module, interface, seam,
adapter, depth, locality, leverage) comes from the `codebase-design` skill
and is not repeated here.

**Remote definition** (also *layout*): one YAML + SVG pair under
`remotes/` describing a physical remote model: manufacturer/model
identifiers, buttons, states, and per-source signatures. Built-ins ship
with the integration; user definitions under `<config>/remote_studio/remotes/`
override by `id`.

**Button**: a physical control on a remote, identified by `id` and drawn
as `<g id="button-<id>">` in the SVG. Belongs to exactly one **group**.

**State**: one gesture on a button (`press`, `hold`, `rotate_cw`, …). Each
state carries a **role** and one **signature** per supported source.

**Role**: what a state does by default when its group has a target:
`turn_on`, `turn_off`, `toggle`, `dim_up`, `dim_down`, `scene`, or `none`.
The resolver turns role + group config into an action list.

**Group**: a set of buttons that share one target (a STYRBAR has one
`main` group; a BILRESA wheel has `dot1`/`dot2`/`dot3`). The unit the user
configures.

**Target**: the HA entity/device/area a group controls. Stored per
(device, group).

**Group config**: the per-(device, group) settings: target, dim step,
scene brightness, scene colour. Always read with defaults applied;
stored with defaults dropped.

**Override**: a user-supplied action list for one (button, state) that
replaces the role default. Wins even when the group has no target.

**Action list** / **action step**: a list of HA automation `action:`
steps, validated through `SCRIPT_SCHEMA` and run via the Script helper.

**Source**: the HA integration that delivers a remote's events: `zha`,
`z2m`, `matter`, `matter_position`, `xiaomi_ble`. Source names are the
keys under `sources:` in a definition.

**Signature**: the per-source pattern a state matches (`command`+`args`
for zha, `action` for z2m, `endpoint`+`event` for matter, …).

**Remote event**: a normalised, source-tagged event
`(device_id, source, payload)` produced by a source adapter and matched
against a definition to yield `(button, state)`.

**Source adapter**: the runtime piece that subscribes to one source,
resolves the HA device id, and emits remote events. Has `start`, `stop`,
`resync`.

**Device**: an HA device-registry entry. A device is a **remote** when a
definition matches its manufacturer/model, and a **candidate** when it
looks like a remote (radio integration, event entities, no controllable
entities) but nothing matches.

**Pairing**: the user's explicit choice of a definition for a device,
recorded in storage as `definition_id`. Takes precedence over auto-match
everywhere: runtime, test mode, and the device view.

**Test mode**: clicking an SVG hotspot fires the resolved action instead
of selecting the button, through the same resolver and executor as a
physical press.
