/**
 * The panel's one interface to its backend.
 *
 * Everything the panel needs from Home Assistant goes through the
 * eleven methods below, so HA's websocket command names, message
 * shapes (`subscribe_trigger`, `manifest/get`, `variables.trigger.to_state`)
 * and error objects live in this file only. A second adapter with the
 * same methods — dev/fixture-backend.mjs — serves canned data, so the
 * UI runs and is tested without a live HA.
 */
import {
  WS_ENABLE_ENTITIES,
  WS_GET,
  WS_LIST,
  WS_SET_GROUP,
  WS_SET_OVERRIDE,
  WS_SET_PAIRING,
  WS_SUBSCRIBE,
  WS_TEST,
  WS_TRIGGER,
} from "./constants.js";

export class BackendError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "BackendError";
    this.code = code || null;
  }
}

// One place for "what do we show the user when a call fails".
export function errorMessage(err, fallback = "Something went wrong.") {
  if (!err) return fallback;
  return err.message || err.code || fallback;
}

function toBackendError(err) {
  if (err instanceof BackendError) return err;
  // home-assistant-js-websocket rejects with {code, message} objects.
  const code = err?.code ?? null;
  const message = err?.message || (typeof err === "string" ? err : null) || code || "error";
  return new BackendError(String(message), code);
}

export function createBackend(connection) {
  const call = async (msg) => {
    try {
      return await connection.sendMessagePromise(msg);
    } catch (err) {
      throw toBackendError(err);
    }
  };
  const subscribe = async (msg, cb) => {
    try {
      return await connection.subscribeMessage(cb, msg);
    } catch (err) {
      throw toBackendError(err);
    }
  };

  return {
    listRemotes: () => call({ type: WS_LIST }),

    async getVersion() {
      try {
        const m = await call({ type: "manifest/get", integration: "remote_studio" });
        return m?.version || null;
      } catch (_) {
        return null;
      }
    },

    getRemote(deviceId, definitionId) {
      const msg = { type: WS_GET, device_id: deviceId };
      if (definitionId) msg.definition_id = definitionId;
      return call(msg);
    },

    // `fields` is the group config to store: {target, dim_step, and —
    // only when not default — scene_color, scene_brightness}. Absent
    // scene fields mean "reset". Resolves to {ok, group}.
    setGroup: (deviceId, groupId, fields) =>
      call({ type: WS_SET_GROUP, device_id: deviceId, group_id: groupId, ...fields }),

    // Empty `actions` clears the override.
    setOverride: (deviceId, buttonId, stateId, actions) =>
      call({
        type: WS_SET_OVERRIDE,
        device_id: deviceId,
        button_id: buttonId,
        state_id: stateId,
        actions,
      }),

    // null clears the pairing.
    setPairing: (deviceId, definitionId) =>
      call({ type: WS_SET_PAIRING, device_id: deviceId, definition_id: definitionId }),

    // Resolves to {ok, fired}.
    triggerButton: (deviceId, buttonId, stateId) =>
      call({ type: WS_TRIGGER, device_id: deviceId, button_id: buttonId, state_id: stateId }),

    testAction: (actions) => call({ type: WS_TEST, actions }),

    // Resolves to {ok, enabled: [...], failed: [{entity_id, error}]}.
    enableEntities: (entityIds) => call({ type: WS_ENABLE_ENTITIES, entity_ids: entityIds }),

    // cb({device_id, button_id, state_id}); resolves to an unsubscribe fn.
    subscribeRemoteEvents: (cb) => subscribe({ type: WS_SUBSCRIBE }, cb),

    // cb(stateObject) on every change of one entity; resolves to an
    // unsubscribe fn. Hides HA's trigger-subscription envelope.
    subscribeEntity: (entityId, cb) =>
      subscribe(
        { type: "subscribe_trigger", trigger: { platform: "state", entity_id: entityId } },
        (msg) => {
          const state = msg?.variables?.trigger?.to_state;
          if (state) cb(state);
        },
      ),
  };
}
