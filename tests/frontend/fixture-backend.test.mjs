import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createFixtureBackend } from "../../dev/fixture-backend.mjs";
import { BackendError } from "../../custom_components/remote_studio/frontend/src/backend.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../dev/fixtures/remotes.json", import.meta.url), "utf8"),
);

test("fixture file has the shape the panel expects", () => {
  assert.deepEqual(
    Object.keys(fixture).sort(),
    ["candidates", "definitions", "devices", "events", "remotes", "states", "version"],
  );
  for (const d of Object.values(fixture.devices)) {
    for (const k of ["device", "definition", "svg", "groups", "group_defaults", "overrides", "paired_definition_id", "battery", "automations", "health"]) {
      assert.ok(k in d, `device payload missing ${k}`);
    }
    for (const g of Object.values(d.groups)) assert.ok("scene_is_default" in g);
  }
  assert.ok(fixture.remotes.length >= 2 && fixture.candidates.length >= 1);
});

test("listRemotes and getRemote serve copies", async () => {
  const b = createFixtureBackend(fixture);
  const list = await b.listRemotes();
  assert.equal(list.version, fixture.version);
  list.remotes[0].device_name = "mutated";
  assert.notEqual((await b.listRemotes()).remotes[0].device_name, "mutated");
  const r = await b.getRemote("fx-styrbar");
  assert.equal(r.definition.id, "ikea_styrbar");
  await assert.rejects(b.getRemote("ghost"), BackendError);
  const preview = await b.getRemote("fx-styrbar", "ikea_bilresa_e2490");
  assert.equal(preview.definition.id, "ikea_bilresa_e2490");
});

test("setGroup round-trips, flags defaults and updates targets", async () => {
  const b = createFixtureBackend(fixture);
  const { group } = await b.setGroup("fx-bilresa", "dot3", {
    target: { entity_id: "light.bedroom" },
    dim_step: 20,
  });
  assert.equal(group.scene_is_default, true);
  assert.equal((await b.getRemote("fx-bilresa")).groups.dot3.target.entity_id, "light.bedroom");
  assert.ok((await b.listRemotes()).remotes.find((r) => r.device_id === "fx-bilresa").targets.includes("light.bedroom"));
  const { group: g2 } = await b.setGroup("fx-bilresa", "dot3", {
    target: { entity_id: "light.bedroom" },
    dim_step: 20,
    scene_brightness: 50,
  });
  assert.equal(g2.scene_is_default, false);
  // All-default config removes the group.
  await b.setGroup("fx-bilresa", "dot3", { target: null, dim_step: 20 });
  assert.equal((await b.getRemote("fx-bilresa")).groups.dot3, undefined);
});

test("overrides, pairing and trigger semantics", async () => {
  const b = createFixtureBackend(fixture);
  await b.setOverride("fx-styrbar", "on", "hold", [{ service: "x" }]);
  assert.deepEqual((await b.getRemote("fx-styrbar")).overrides.on.hold, [{ service: "x" }]);
  await b.setOverride("fx-styrbar", "on", "hold", []);
  assert.equal((await b.getRemote("fx-styrbar")).overrides.on, undefined);

  assert.deepEqual(await b.triggerButton("fx-styrbar", "on", "press"), { ok: true, fired: true });
  // dot3 has no target and no override → nothing fires
  assert.deepEqual(await b.triggerButton("fx-bilresa", "dot3", "press"), { ok: true, fired: false });
  await assert.rejects(b.triggerButton("fx-styrbar", "on", "nope"), BackendError);

  await b.setPairing("fx-styrbar", "ikea_bilresa_e2490");
  const paired = await b.getRemote("fx-styrbar");
  assert.equal(paired.paired_definition_id, "ikea_bilresa_e2490");
  assert.equal(paired.definition.id, "ikea_bilresa_e2490"); // pairing wins over auto-match
  await b.setPairing("fx-styrbar", null);
  assert.equal((await b.getRemote("fx-styrbar")).definition.id, "ikea_styrbar");
  await assert.rejects(b.testAction([]), BackendError);
});

test("subscriptions replay events and toggle lights, and unsubscribe", async () => {
  const b = createFixtureBackend(fixture, { eventIntervalMs: 5, stateIntervalMs: 5 });
  const events = [];
  const unsubE = await b.subscribeRemoteEvents((e) => events.push(e));
  const states = [];
  const unsubS = await b.subscribeEntity("light.living_room", (s) => states.push(s.state));
  await new Promise((r) => setTimeout(r, 40));
  unsubE();
  unsubS();
  const n = events.length;
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(n >= 2 && events.length === n);
  assert.deepEqual(events[0], fixture.events[0]);
  assert.ok(states.length >= 2 && states[0] !== states[1]);
  assert.equal(typeof (await b.subscribeEntity("sensor.nope", () => {})), "function");
});
