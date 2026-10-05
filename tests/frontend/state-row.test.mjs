import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ROLE_LABELS,
  describeRole,
  describeTargetShort,
  renderStateRow,
  rgbToHex,
  stateSummary,
} from "../../custom_components/remote_studio/frontend/src/views/state-row.js";

const DEFAULTS = {
  target: null,
  dim_step: 20,
  scene_brightness: 100,
  scene_color: null,
  scene_is_default: true,
};
const withTarget = (extra = {}) => ({ ...DEFAULTS, target: { entity_id: "light.a" }, ...extra });

test("rgbToHex clamps and pads; null without a colour", () => {
  assert.equal(rgbToHex([255, 217, 168]), "#ffd9a8");
  assert.equal(rgbToHex([300, -1, 7]), "#ff0007");
  assert.equal(rgbToHex(null), null);
  assert.equal(rgbToHex([1, 2]), null);
});

test("describeTargetShort picks the first entity or names the kind", () => {
  assert.equal(describeTargetShort({ entity_id: "light.a" }), "light.a");
  assert.equal(describeTargetShort({ entity_id: ["light.a", "light.b"] }), "light.a");
  assert.equal(describeTargetShort({ area_id: "kitchen" }), "area");
  assert.equal(describeTargetShort({ device_id: "d" }), "device");
  assert.equal(describeTargetShort(null), "");
});

test("describeRole covers every role", () => {
  const g = withTarget({ dim_step: 10 });
  assert.equal(describeRole("turn_on", g), "Turn on light.a");
  assert.equal(describeRole("turn_off", g), "Turn off light.a");
  assert.equal(describeRole("toggle", g), "Toggle light.a");
  assert.equal(describeRole("dim_up", g), "Brighten light.a (+10%)");
  assert.equal(describeRole("dim_down", g), "Dim light.a (-10%)");
  assert.equal(describeRole("scene", g), "Scene on light.a (100%)");
  assert.equal(
    describeRole("scene", withTarget({ scene_brightness: 40, scene_color: [255, 217, 168] })),
    "Scene on light.a (40% @ #ffd9a8)",
  );
  assert.equal(describeRole("none", g), "Unbound");
  for (const role of Object.keys(ROLE_LABELS)) assert.ok(describeRole(role, g));
});

test("stateSummary precedence: override, none, no target, default", () => {
  const press = { id: "press", role: "turn_on" };
  assert.deepEqual(stateSummary(press, DEFAULTS, [{ service: "light.toggle" }]), {
    text: "Override · Call light.toggle",
    cls: "override",
  });
  assert.deepEqual(stateSummary(press, DEFAULTS, [{ choose: [] }]), {
    text: "Override · Choose / if-then",
    cls: "override",
  });
  assert.deepEqual(stateSummary({ id: "x", role: "none" }, withTarget(), undefined), {
    text: "Unbound",
    cls: "muted",
  });
  assert.deepEqual(stateSummary(press, DEFAULTS, []), { text: "Pick a target above", cls: "muted" });
  assert.deepEqual(stateSummary(press, withTarget(), undefined), {
    text: "Default · Turn on light.a",
    cls: "default",
  });
});

test("renderStateRow escapes and marks selection", () => {
  const html = renderStateRow(
    { id: 'a"b', label: "<Press>", role: "turn_on" },
    withTarget(),
    undefined,
    true,
  );
  assert.match(html, /class="state-row selected"/);
  assert.match(html, /data-state-id="a&quot;b"/);
  assert.match(html, /&lt;Press&gt;/);
  assert.match(html, /role-pill role-turn_on">On</);
  assert.match(html, /state-summary default">Default · Turn on light.a</);
  assert.doesNotMatch(renderStateRow({ id: "p", role: "none" }, DEFAULTS, undefined, false), /selected/);
});
