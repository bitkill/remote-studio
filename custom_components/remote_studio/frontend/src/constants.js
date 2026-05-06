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
