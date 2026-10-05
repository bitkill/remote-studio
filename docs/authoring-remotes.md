# Authoring a new remote

Adding support for a new remote model is two files: a YAML *definition* and
an SVG *layout*. Drop them into either of these directories and restart Home
Assistant:

- **Built-in (PR welcome):** `custom_components/remote_studio/remotes/`
- **Local (override-friendly):** `<config>/remote_studio/remotes/`

User definitions with the same `id` as a built-in override the built-in.

---

## 1. The YAML definition

```yaml
id: my_remote                      # unique slug — also used as filename
name: My Brand Awesome Remote
manufacturer: Acme Corp            # match against device_registry.manufacturer
models:                            # match against device_registry.model
  - ACME-001
  - ACME-001A
svg: my_remote.svg                 # filename next to this YAML

buttons:
  - id: power
    label: "Power"
    states:
      - id: press
        label: "Press"
        sources:
          zha:    { command: "on" }
          z2m:    { action: "on" }
          matter: { event: "on_pressed" }
      - id: hold
        sources:
          zha: { command: "move_with_on_off" }
          z2m: { action: "brightness_move_up" }

  - id: arrow_left
    label: "←"
    states:
      - id: press
        sources:
          zha: { command: "press", args: { direction: "left", type: "short" } }
          z2m: { action: "arrow_left_click" }
```

> **Quote `on`, `off`, `yes`, `no`, `true`, `false`** as button or state
> ids. YAML 1.1 turns those into booleans, which fails string validation
> and the whole file gets skipped silently. Write `id: "on"` not `id: on`.

### Each button has one or more states

Common state IDs: `press`, `hold`, `release`, `double`, `single`. Pick names
that read well in the UI — they're shown as-is when you don't supply a
`label`.

### Sources — five integrations supported

| key               | shape                                                     | match logic                                                                                      |
|-------------------|-----------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| `zha`             | `{ command: "...", args: { k: v }, cluster: 6 }`          | `command` must equal; if `args` set, all keys/values must equal the event's args.               |
| `z2m`             | `{ action: "..." }`                                       | exact match on the MQTT payload's `action` field.                                               |
| `matter`          | `{ event: "..." \| ["...", ...], endpoint: 1, attributes: { k: v } }` | HA's matter `event` entity for that endpoint reports `event_type` in the list; `attributes` must all match. Debounced by HA (~0.5–1 s). |
| `matter_position` | `{ endpoint: 1, edge: rising \| falling }`                | the endpoint's `current_switch_position` sensor goes 0→1 (`rising`) or 1→0 (`falling`). Low latency; the sensors are disabled in HA by default and the panel offers a one-click enable. |
| `xiaomi_ble`      | `{ event: "..." \| ["...", ...], attributes: { k: v } }`  | the device's xiaomi_ble `event` entity reports `event_type`; `attributes` must all match.       |

Two states in one file may not claim the same signature — `make check`
rejects it, because one of them would silently never fire.

### Finding the right signature

- **ZHA**: open Developer Tools → Events → listen for `zha_event`, press the
  button, copy the `command` and `args`.
- **Zigbee2MQTT**: subscribe to `zigbee2mqtt/<friendly_name>` (Z2M dashboard
  has a live log too) and read the `action` value.
- **Matter**: pair the device, find the event entities (one per endpoint)
  in the device page, watch their history. The endpoint number is in the
  entity's unique id (`…-MatterNodeDevice-<endpoint>-…`).
- **Any source**: `make events DEVICE=<id>` streams the live event bus.

---

## 2. The SVG

The SVG is rendered inline in the panel, so styles you put in `<style>`
inside the SVG apply to the rendered hotspots. Conventions:

- Use a `<g id="button-<id>">` wrapper for every clickable button — the
  `id` after the `button-` prefix must match a `buttons[].id` in the YAML.
- Inside each group, draw `<rect>`, `<circle>`, or a `<path class="btn-shape">`.
  Those are the elements the panel re-fills during the live event pulse.
- Add the class `rs-button` on the group so the panel's hover/active styles
  pick it up.
- Keep colours in CSS custom properties (e.g. `var(--rs-btn-fill, #fff)`) so
  the layout reads well in HA's light and dark themes.
- If the remote has rotation states (`rotate_*`), give the wheel graphic
  `id="wheel"` so the panel can pulse it on live rotation events.

Example minimal SVG:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>
    .rs-button rect { fill: var(--rs-btn-fill, #fff); stroke: #ccc; }
    .rs-button:hover { filter: brightness(0.96); }
  </style>
  <g id="button-on" class="rs-button">
    <rect x="40" y="40" width="120" height="40" rx="8" />
    <text x="100" y="66" text-anchor="middle">ON</text>
  </g>
  <!-- … more groups for each button -->
</svg>
```

---

## 3. Quick-test loop

0. In a checkout: `make check` builds the YAML through the real schema and
   verifies the SVG has a `button-<id>` group for every button.
1. Drop the two files into `<config>/remote_studio/remotes/`.
2. Restart Home Assistant (definitions are cached at startup).
3. Open **Sidebar → Remote Studio**. The new layout shows up under
   *Available layouts*; if your manufacturer/model match a paired device,
   it appears under *Discovered remotes* automatically.
4. Pair an unmatched device manually: pick the layout in the *Unmatched
   devices* picker on the index page (a preview opens), then click **Use
   this layout**. The pairing is stored and drives physical presses and
   test mode, not just the view; **Change layout** on the device page
   clears it.
5. Use **Test mode** (toggle in the remote view) to fire actions by clicking
   the SVG instead of pressing the physical remote.

---

## 4. Contributing back

If your remote is widely used, open a PR adding the YAML + SVG to
`custom_components/remote_studio/remotes/` so it ships built-in. Try to
keep the SVG under ~5 KB; minify with `svgo` before committing.
