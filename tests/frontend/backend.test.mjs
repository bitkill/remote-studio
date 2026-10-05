import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BackendError,
  createBackend,
  errorMessage,
} from "../../custom_components/remote_studio/frontend/src/backend.js";

function fakeConnection({ reply = {}, fail = null } = {}) {
  const sent = [];
  const subs = [];
  return {
    sent,
    subs,
    async sendMessagePromise(msg) {
      sent.push(msg);
      if (fail) throw fail;
      return reply;
    },
    async subscribeMessage(cb, msg) {
      subs.push({ cb, msg });
      if (fail) throw fail;
      return () => subs.splice(subs.indexOf(msg), 1);
    },
  };
}

test("every command carries the right type and fields", async () => {
  const c = fakeConnection({ reply: { ok: true } });
  const b = createBackend(c);
  await b.listRemotes();
  await b.getRemote("d1");
  await b.getRemote("d1", "ikea_styrbar");
  await b.setGroup("d1", "main", { target: { entity_id: "light.a" }, dim_step: 10 });
  await b.setOverride("d1", "on", "press", [{ service: "x" }]);
  await b.setPairing("d1", null);
  await b.triggerButton("d1", "on", "press");
  await b.testAction([{ service: "x" }]);
  await b.enableEntities(["sensor.a"]);
  assert.deepEqual(
    c.sent.map((m) => m.type),
    [
      "remote_studio/list_remotes",
      "remote_studio/get_remote",
      "remote_studio/get_remote",
      "remote_studio/set_group",
      "remote_studio/set_override",
      "remote_studio/set_pairing",
      "remote_studio/trigger_button",
      "remote_studio/test_action",
      "remote_studio/enable_entities",
    ],
  );
  assert.equal(c.sent[1].definition_id, undefined);
  assert.equal(c.sent[2].definition_id, "ikea_styrbar");
  assert.deepEqual(c.sent[3], {
    type: "remote_studio/set_group",
    device_id: "d1",
    group_id: "main",
    target: { entity_id: "light.a" },
    dim_step: 10,
  });
  assert.equal(c.sent[5].definition_id, null);
  assert.deepEqual(c.sent[8].entity_ids, ["sensor.a"]);
});

test("getVersion reads manifest/get and swallows failure", async () => {
  assert.equal(await createBackend(fakeConnection({ reply: { version: "1.2.3" } })).getVersion(), "1.2.3");
  assert.equal(await createBackend(fakeConnection({ fail: { code: "nope" } })).getVersion(), null);
});

test("HA error objects become BackendError", async () => {
  const b = createBackend(fakeConnection({ fail: { code: "no_definition", message: "No matching layout" } }));
  await assert.rejects(b.listRemotes(), (err) => {
    assert.ok(err instanceof BackendError);
    assert.equal(err.message, "No matching layout");
    assert.equal(err.code, "no_definition");
    return true;
  });
  const codeOnly = createBackend(fakeConnection({ fail: { code: "timeout" } }));
  await assert.rejects(codeOnly.testAction([]), { message: "timeout", code: "timeout" });
});

test("errorMessage prefers message, then code, then fallback", () => {
  assert.equal(errorMessage({ message: "m", code: "c" }), "m");
  assert.equal(errorMessage({ code: "c" }), "c");
  assert.equal(errorMessage(null, "fb"), "fb");
  assert.equal(errorMessage({}, "fb"), "fb");
});

test("subscribeRemoteEvents and subscribeEntity hide HA envelopes", async () => {
  const c = fakeConnection();
  const b = createBackend(c);
  const got = [];
  const unsub = await b.subscribeRemoteEvents((e) => got.push(e));
  assert.equal(c.subs[0].msg.type, "remote_studio/subscribe_events");
  c.subs[0].cb({ device_id: "d", button_id: "on", state_id: "press" });
  assert.deepEqual(got, [{ device_id: "d", button_id: "on", state_id: "press" }]);
  assert.equal(typeof unsub, "function");

  const states = [];
  await b.subscribeEntity("light.a", (s) => states.push(s));
  assert.deepEqual(c.subs[1].msg, {
    type: "subscribe_trigger",
    trigger: { platform: "state", entity_id: "light.a" },
  });
  c.subs[1].cb({ variables: { trigger: { to_state: { entity_id: "light.a", state: "on" } } } });
  c.subs[1].cb({ variables: {} }); // no to_state → ignored
  assert.deepEqual(states, [{ entity_id: "light.a", state: "on" }]);
});
