/**
 * Static configuration shared across the panel modules.
 *
 *  - PANEL_BASE: the URL prefix the panel is mounted at.
 *  - WS_*: WebSocket command names exposed by the integration.
 *  - ACTION_TEMPLATES: pre-baked action lists for the editor's "Insert" row.
 *  - STATE_DEFAULT_TEMPLATE: which template the editor recommends per state-id.
 *  - INTEGRATION_INFO: human label + brand-icon URL per integration domain.
 *  - BATTERY_ICONS: MDI battery path data, picked by percentage.
 */

export const PANEL_BASE = "remote-studio";

export const WS_LIST = "remote_studio/list_remotes";
export const WS_GET = "remote_studio/get_remote";
export const WS_SET_GROUP = "remote_studio/set_group";
export const WS_SET_OVERRIDE = "remote_studio/set_override";
export const WS_TEST = "remote_studio/test_action";
export const WS_TRIGGER = "remote_studio/trigger_button";
export const WS_SUBSCRIBE = "remote_studio/subscribe_events";

export const DEFAULT_DIM_STEP = 20;

const PLACEHOLDER = {
  light: "light.REPLACE_ME",
  switch: "switch.REPLACE_ME",
  scene: "scene.REPLACE_ME",
  script: "script.REPLACE_ME",
  automation: "automation.REPLACE_ME",
};

function domainOf(entityId) {
  if (!entityId || !entityId.includes(".")) return "";
  return entityId.split(".", 1)[0];
}

// Build an action list for a quick-insert template. `target` is the
// per-button entity_id picked in the editor (may be empty / undefined,
// in which case a domain-appropriate REPLACE_ME placeholder is used).
export function actionTemplate(name, target) {
  const t = target || "";
  const d = domainOf(t);

  switch (name) {
    case "brighten":
      return [
        {
          service: "light.turn_on",
          target: { entity_id: t || PLACEHOLDER.light },
          data: { brightness_step_pct: 10, transition: 0.3 },
        },
      ];
    case "dim":
      return [
        {
          service: "light.turn_on",
          target: { entity_id: t || PLACEHOLDER.light },
          data: { brightness_step_pct: -10, transition: 0.3 },
        },
      ];
    case "toggle":
      // light/switch/fan/automation have their own toggle service;
      // scene only supports turn_on; everything else falls back to
      // homeassistant.toggle which works on any toggleable entity.
      if (d === "light" || d === "switch" || d === "fan" || d === "automation") {
        return [
          {
            service: `${d}.toggle`,
            target: { entity_id: t },
            ...(d === "light" ? { data: { transition: 0.3 } } : {}),
          },
        ];
      }
      if (d === "scene") {
        return [{ service: "scene.turn_on", target: { entity_id: t } }];
      }
      if (!d) {
        return [
          {
            service: "light.toggle",
            target: { entity_id: PLACEHOLDER.light },
            data: { transition: 0.3 },
          },
        ];
      }
      return [{ service: "homeassistant.toggle", target: { entity_id: t } }];
    case "light_scene":
      return [
        {
          service: "light.turn_on",
          target: { entity_id: t || PLACEHOLDER.light },
          data: {
            brightness_pct: 80,
            rgb_color: [255, 217, 168],
            transition: 0.5,
          },
        },
      ];
    case "service":
      return [
        {
          service: d ? `${d}.turn_on` : "light.turn_on",
          target: { entity_id: t || PLACEHOLDER.light },
        },
      ];
    case "scene":
      return [
        {
          service: "scene.turn_on",
          target: {
            entity_id: d === "scene" ? t : PLACEHOLDER.scene,
          },
        },
      ];
    case "script":
      return [
        {
          service: "script.turn_on",
          target: {
            entity_id: d === "script" ? t : PLACEHOLDER.script,
          },
        },
      ];
    case "automation":
      return [
        {
          service: "automation.trigger",
          target: {
            entity_id: d === "automation" ? t : PLACEHOLDER.automation,
          },
        },
      ];
    case "delay":
      return [{ delay: { seconds: 1 } }];
    default:
      return null;
  }
}

// State-id → recommended template, highlighted in the editor.
export const STATE_DEFAULT_TEMPLATE = {
  rotate_cw: "brighten",
  rotate_ccw: "dim",
  press: "toggle",
  hold: "light_scene",
};

// Inline SVG glyphs used in the UI — mostly Material Design Icons paths
// from materialdesignicons.com (24×24), plus a couple of brand logos that
// carry their own viewBox. Inlined because HA's <ha-icon> doesn't always
// resolve its iconset inside our shadow DOM. Entries are either a path
// string or { d, viewBox } for non-MDI artwork.
export const MDI_PATHS = {
  cog: "M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z",
  magnify: "M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z",
  mapMarker: "M12,11.5A2.5,2.5 0 0,1 9.5,9A2.5,2.5 0 0,1 12,6.5A2.5,2.5 0 0,1 14.5,9A2.5,2.5 0 0,1 12,11.5M12,2A7,7 0 0,0 5,9C5,14.25 12,22 12,22C12,22 19,14.25 19,9A7,7 0 0,0 12,2Z",
  // Zigbee Alliance "bee + Z" stylised glyph (mdi:zigbee).
  zigbee: "M4.06 6.15c-.09.02-.18.07-.26.13A9.9 9.9 0 0 0 2 12a10 10 0 0 0 10 10c3 0 5.68-1.32 7.5-3.4l-2.5.25c-2.75.3-5.55.34-8.34.11c-.71-.02-1.42-.2-2.07-.51a2.62 2.62 0 0 1-1.52-2.16c-.01-.16.05-.29.16-.42l2.19-2.27l7.61-7.9v-.1h-4.19c-2.27.04-4.53.22-6.78.55M20.17 17.5c.09-.03.18-.06.26-.11A10 10 0 0 0 22 12A10 10 0 0 0 12 2C9.22 2 6.7 3.13 4.89 4.97h.28c3.11-.4 6.26-.5 9.39-.32c.94-.01 1.89.17 2.77.52A2.67 2.67 0 0 1 19 7.37c0 .16-.07.33-.18.45l-9.11 9.37l-.71.76v.11h4.14c2.36-.06 4.7-.25 7.03-.56",
  // Official Matter (CSA) trefoil logo, lifted from the wordmark SVG on
  // Wikimedia Commons. Native 0–74 / 0–73 coordinate space, so it carries
  // its own viewBox instead of the 24×24 grid the MDI glyphs use.
  matter: {
    viewBox: "0 0 74 73",
    d: "M65.715 32.905c-7.996 2.19-15.164 7.406-19.636 15.152s-5.407 16.568-3.306 24.587l7.835-4.526a23.9 23.9 0 0 1 1.105-11.836l18.309 10.569 4.303-2.487v-4.967L56.016 48.829a23.92 23.92 0 0 1 9.699-6.879zm-57.108 0v9.045a23.91 23.91 0 0 1 9.699 6.879L0 59.398v4.967l4.303 2.487 18.306-10.569c1.39 3.868 1.726 7.938 1.108 11.836l7.832 4.526c2.101-8.02 1.167-16.841-3.306-24.587A32.52 32.52 0 0 0 8.607 32.905zM37.161 0l-4.303 2.484v21.138c-4.046-.731-7.736-2.476-10.804-4.961l-7.838 4.522c5.895 5.83 14 9.429 22.946 9.429s17.051-3.599 22.946-9.429l-7.835-4.522a23.92 23.92 0 0 1-10.807 4.961V2.484z",
  },
  // Concentric arcs — radio waves (mdi:access-point).
  accessPoint: "M4.93 4.93A9.97 9.97 0 0 0 2 12c0 2.76 1.12 5.26 2.93 7.07l1.41-1.41A7.94 7.94 0 0 1 4 12c0-2.21.89-4.22 2.34-5.66zm14.14 0l-1.41 1.41A7.96 7.96 0 0 1 20 12c0 2.22-.89 4.22-2.34 5.66l1.41 1.41A9.97 9.97 0 0 0 22 12c0-2.76-1.12-5.26-2.93-7.07M7.76 7.76A5.98 5.98 0 0 0 6 12c0 1.65.67 3.15 1.76 4.24l1.41-1.41A4 4 0 0 1 8 12c0-1.11.45-2.11 1.17-2.83zm8.48 0l-1.41 1.41A4 4 0 0 1 16 12c0 1.11-.45 2.11-1.17 2.83l1.41 1.41A5.98 5.98 0 0 0 18 12c0-1.65-.67-3.15-1.76-4.24M12 10a2 2 0 0 0-2 2a2 2 0 0 0 2 2a2 2 0 0 0 2-2a2 2 0 0 0-2-2",
};

// Integration domain → human label + which monochrome MDI glyph to use.
export const INTEGRATION_INFO = {
  matter:      { label: "Matter", mdi: "matter" },
  zha:         { label: "ZHA",    mdi: "zigbee" },
  zigbee2mqtt: { label: "Z2M",    mdi: "zigbee" },
  zigbee:      { label: "Zigbee", mdi: "zigbee" },
  mqtt:        { label: "MQTT",   mdi: "accessPoint" },
};

// Material Design Icon paths used by HA's battery icons. We inline a few
// level icons so the panel renders the same battery glyph HA uses elsewhere.
export const BATTERY_ICONS = {
  // mdi:battery (full)
  full: "M16,20H8V6H16M16.67,4H15V2H9V4H7.33A1.33,1.33 0 0,0 6,5.33V20.67C6,21.4 6.6,22 7.33,22H16.67A1.33,1.33 0 0,0 18,20.67V5.33C18,4.6 17.4,4 16.67,4Z",
  // mdi:battery-50
  half: "M16,20H8V13H16V20M16.67,4H15V2H9V4H7.33A1.33,1.33 0 0,0 6,5.33V20.67C6,21.4 6.6,22 7.33,22H16.67A1.33,1.33 0 0,0 18,20.67V5.33C18,4.6 17.4,4 16.67,4Z",
  // mdi:battery-alert
  alert: "M16.67,4H15V2H9V4H7.33A1.33,1.33 0 0,0 6,5.33V20.67C6,21.4 6.6,22 7.33,22H16.67A1.33,1.33 0 0,0 18,20.67V5.33C18,4.6 17.4,4 16.67,4M11,8H13V14H11V8M11,16H13V18H11V16Z",
  // mdi:battery-unknown
  unknown: "M16.67,4H15V2H9V4H7.33A1.33,1.33 0 0,0 6,5.33V20.67C6,21.4 6.6,22 7.33,22H16.67A1.33,1.33 0 0,0 18,20.67V5.33C18,4.6 17.4,4 16.67,4M11,18V16H13V18H11M13,15H11C11,11.75 14,12 14,10A2,2 0 0,0 12,8A2,2 0 0,0 10,10H8A4,4 0 0,1 12,6A4,4 0 0,1 16,10C16,12.5 13,12.75 13,15Z",
};
