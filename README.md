# Remote Studio

A Home Assistant custom integration that lets you configure Zigbee / Matter
remote controls (IKEA, Philips Hue, Aqara, …) through a friendly visual UI —
click a button on a picture of the actual remote and pick what it should do.

> Status: early development.

## What it does

- Adds a sidebar panel showing each paired remote as an interactive image of
  the physical hardware.
- Click a button → assign one or more actions (call a service, activate a
  scene, run a script, trigger an existing automation, full action-block).
- Per-button states: short press, long press / hold, release, double-tap, …
- Live indicator: the matching button pulses on screen when the physical
  remote sends an event.
- Test mode: click a button on screen to fire its configured action.

## Why a custom integration (not an add-on)

Works on every HA install type (OS, Supervised, Container, Core), distributes
through HACS, and integrates directly with HA's device/entity registries.

## Adding a new remote

A new remote is one YAML definition + one SVG. Drop them in either the
built-in `custom_components/remote_studio/remotes/` or your config directory
at `<config>/remote_studio/remotes/` to extend without forking. See the
full guide at [`docs/authoring-remotes.md`](docs/authoring-remotes.md).

### Built-in remotes

- IKEA STYRBAR (Remote Control N2) — ZHA + Z2M
- Philips Hue Dimmer v2 (RWL022) — Z2M
- Aqara Mini Switch (WXKG11LM) — ZHA + Z2M

## Install

Not yet on HACS. For local dev, copy `custom_components/remote_studio/` into
your HA config's `custom_components/` directory and restart.

## Licence

MIT.
