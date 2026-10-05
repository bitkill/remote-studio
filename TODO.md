# TODO — follow-ups

Tracked work that's known but deliberately deferred.

## Pending

### Submit brand icons to `home-assistant/brands`
Without this PR, HACS and HA's Devices & Services card show a generic
placeholder instead of our artwork.

Steps:
1. Fork https://github.com/home-assistant/brands.
2. Create `custom_integrations/remote_studio/` and copy in:
   - `brands/icon.png` → `icon.png` (256×256)
   - `brands/icon@2x.png` → `icon@2x.png` (512×512)
3. Open a PR against `home-assistant/brands:master`.
4. Once merged, the icon appears automatically — nothing to change in
   this repo.

If the design needs revising first, edit `brands/icon.svg` and re-render
with the magick commands in the [README](README.md#branding).

### Matter — late device discovery + endpoint mapping robustness
Matter event-entity listening landed in v0.2.0 but has two known sharp
edges:

1. ~~Entity-backed adapters discovered their entities once at start.~~
   Done: the runtime listens for `entity_registry_updated` and re-scans
   (debounced 2 s) when an entity on one of our platforms appears or a
   watched one changes. Reproduced on a Yeelight dimmer added after boot.
2. ~~Endpoint mapping sorted entities by unique_id.~~ Done: the endpoint
   is parsed from the unique_id (`core/events.py:matter_endpoint_from_unique_id`).

### Hue Dimmer v2 over ZHA
The Z2M sources are wired in `remotes/hue_dimmer_v2.yaml`, but the ZHA
path needs the Philips manufacturer-specific cluster (0xFC00) — events
arrive with non-standard `command` names that need their own mapping.
Worth doing once we test against a real Hue Dimmer paired to ZHA.

### Action editor — `ha-automation-action-row`
The current JSON textarea works but isn't friendly. HA's
`ha-automation-action-row` web component gives a guided editor with
service/scene/script pickers, target selectors, templates, etc. The
storage shape already mirrors HA's automation `action:` block, so swap
is UI-only. Sticking points: the component isn't auto-loaded into custom
panels — need to find a reliable way to force-load it across HA versions.

## Done (for context)

- HACS metadata + first release (v0.1.x).
- IKEA STYRBAR, Hue Dimmer v2, Aqara Mini Switch built-in remotes.
- Test mode + manual layout pairing for unmatched devices.
- Live event pulse on the SVG.
- Authoring guide for community-contributed remotes.
