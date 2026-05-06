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
- IKEA BILRESA 2-button (E2489) — Matter + Z2M
- IKEA BILRESA scroll wheel (E2490) — Matter (3 dots × rotate / press / hold)
- Philips Hue Dimmer v2 (RWL022) — Z2M
- Aqara Mini Switch (WXKG11LM) — ZHA + Z2M

## Install

### Via HACS (recommended)

1. **HACS → Integrations → ⋮ menu → Custom repositories**
2. Add this repo:
   - **Repository:** `https://github.com/bitkill/remote-studio`
   - **Type:** `Integration`
3. Open the new "Remote Studio" card → **Download**.
4. **Settings → System → Restart** (full HA restart — required for HA to
   pick up custom integrations; reload won't do).
5. After HA is back: **Settings → Devices & Services → + Add Integration**
   → search **Remote Studio** → click it → **Submit** on the empty form.

The "Remote Studio" entry only appears in the sidebar **after step 5** —
the restart alone isn't enough. The custom_components folder makes HA
*aware* of the integration; the Add Integration step *activates* it,
which is what registers the sidebar panel.

### Manual install (no HACS)

1. Copy `custom_components/remote_studio/` into your HA config's
   `custom_components/` directory.
2. **Settings → System → Restart**.
3. **Settings → Devices & Services → + Add Integration → Remote Studio
   → Submit**.

### First-run check

- Sidebar shows a **Remote Studio** entry. If not, you skipped step 5.
- If the integration card in Devices & Services has a red error chip,
  check **Settings → System → Logs** for `remote_studio` lines.
- Backup before restarting is a one-click safety net:
  **Settings → System → Backups → Create backup**.

## Branding

The integration card in HACS and HA's Devices & Services pulls its icon
from the [home-assistant/brands][brands] repository — without an entry
there it shows a generic placeholder. Source assets live in this repo at
[`brands/`](brands/) and are mirrored to a brands PR. To refresh the
artwork, edit `brands/icon.svg` and re-render the PNGs:

```bash
magick -background none -density 384 brands/icon.svg -resize 256x256 brands/icon.png
magick -background none -density 768 brands/icon.svg -resize 512x512 brands/icon@2x.png
```

Then mirror `brands/icon.png` and `brands/icon@2x.png` to a PR against
`home-assistant/brands` under `custom_integrations/remote_studio/`.

[brands]: https://github.com/home-assistant/brands

## Licence

MIT.
