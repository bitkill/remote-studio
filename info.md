# Remote Studio

Configure your Zigbee and Matter remotes through a friendly visual UI —
click a button on a picture of the actual remote and pick what it should do.

## Features

- Sidebar panel showing each paired remote as an interactive image of the
  physical hardware.
- Per-button states: short press, long press / hold, release, double-tap.
- Action editor: call a service, activate a scene, run a script, **trigger
  an existing automation**, chain multiple steps. The wire format mirrors HA's
  automation `action:` block.
- Live indicator: when the physical remote sends an event, the matching
  on-screen button pulses.
- Test mode: tap a button on screen to fire its configured action without
  touching the physical remote.
- Extensible — drop a YAML + SVG into `<config>/remote_studio/remotes/` to
  add a new model without forking.

## Built-in remotes

- IKEA STYRBAR
- (more coming)

## Install

Install via HACS, then **Add Integration → Remote Studio**. A new
"Remote Studio" entry appears in your sidebar.
