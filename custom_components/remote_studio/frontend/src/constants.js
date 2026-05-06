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
export const WS_SAVE = "remote_studio/save_mapping";
export const WS_CLEAR = "remote_studio/clear_mapping";
export const WS_TEST = "remote_studio/test_action";
export const WS_SUBSCRIBE = "remote_studio/subscribe_events";

export const ACTION_TEMPLATES = {
  // Light-first defaults — most BILRESA / dimmer / button users want
  // these as the day-one mapping.
  brighten: [
    {
      service: "light.turn_on",
      target: { entity_id: "light.REPLACE_ME" },
      data: { brightness_step_pct: 10, transition: 0.3 },
    },
  ],
  dim: [
    {
      service: "light.turn_on",
      target: { entity_id: "light.REPLACE_ME" },
      data: { brightness_step_pct: -10, transition: 0.3 },
    },
  ],
  toggle: [
    {
      service: "light.toggle",
      target: { entity_id: "light.REPLACE_ME" },
      data: { transition: 0.3 },
    },
  ],
  light_scene: [
    {
      service: "light.turn_on",
      target: { entity_id: "light.REPLACE_ME" },
      data: {
        brightness_pct: 80,
        rgb_color: [255, 217, 168],
        transition: 0.5,
      },
    },
  ],
  // Generic fall-backs.
  service: [
    {
      service: "light.turn_on",
      target: { entity_id: "light.REPLACE_ME" },
    },
  ],
  scene: [{ service: "scene.turn_on", target: { entity_id: "scene.REPLACE_ME" } }],
  script: [{ service: "script.turn_on", target: { entity_id: "script.REPLACE_ME" } }],
  automation: [
    {
      service: "automation.trigger",
      target: { entity_id: "automation.REPLACE_ME" },
    },
  ],
  delay: [{ delay: { seconds: 1 } }],
};

// State-id → recommended template, highlighted in the editor.
export const STATE_DEFAULT_TEMPLATE = {
  rotate_cw: "brighten",
  rotate_ccw: "dim",
  press: "toggle",
  hold: "light_scene",
};

// HA brand icons (https://brands.home-assistant.io). Core integrations live
// under `_/`, community ones under their own folder.
export const INTEGRATION_INFO = {
  matter:      { label: "Matter", icon: "https://brands.home-assistant.io/_/matter/icon.png" },
  zha:         { label: "ZHA",    icon: "https://brands.home-assistant.io/_/zha/icon.png" },
  zigbee2mqtt: { label: "Z2M",    icon: "https://brands.home-assistant.io/zigbee2mqtt/icon.png" },
  mqtt:        { label: "MQTT",   icon: "https://brands.home-assistant.io/_/mqtt/icon.png" },
  zigbee:      { label: "Zigbee", icon: "https://brands.home-assistant.io/_/zha/icon.png" },
};

// Material Design Icon paths used elsewhere in the UI. Inlined as SVG
// because HA's <ha-icon> element doesn't always resolve its iconset
// inside our shadow DOM.
export const MDI_PATHS = {
  cog: "M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z",
  magnify: "M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z",
  mapMarker: "M12,11.5A2.5,2.5 0 0,1 9.5,9A2.5,2.5 0 0,1 12,6.5A2.5,2.5 0 0,1 14.5,9A2.5,2.5 0 0,1 12,11.5M12,2A7,7 0 0,0 5,9C5,14.25 12,22 12,22C12,22 19,14.25 19,9A7,7 0 0,0 12,2Z",
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
