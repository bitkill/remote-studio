import pytest

from core import events
from core.definitions import build


def _def(id_, **sources_by_state):
    return build(
        {
            "id": id_,
            "name": id_,
            "manufacturer": "Acme",
            "models": ["X"],
            "svg": "x.svg",
            "buttons": [
                {"id": "b", "states": [{"id": sid, "sources": src} for sid, src in sources_by_state.items()]}
            ],
        }
    )


# ---------------------------------------------------------------- matching
def test_match_event_returns_first_definition_in_order():
    a = _def("a", press={"zha": {"command": "on"}})
    b = _def("b", press={"zha": {"command": "on"}})
    ev = events.RemoteEvent("dev", "zha", {"command": "on", "args": {}})
    assert events.match_event(ev, [a, b])[0] is a
    assert events.match_event(ev, [b, a])[0] is b
    assert events.match_event(ev, []) is None


def test_match_event_skips_definitions_without_the_source():
    z2m_only = _def("z", press={"z2m": {"action": "on"}})
    zha = _def("a", hold={"zha": {"command": "on"}})
    ev = events.RemoteEvent("dev", "zha", {"command": "on", "args": {}})
    assert events.match_event(ev, [z2m_only, zha]) == (zha, "b", "hold")


# ------------------------------------------------------------------ decoders
def test_decode_zha():
    ev = events.decode_zha({"device_id": "d1", "command": "press", "args": {"direction": "left"}})
    assert ev == events.RemoteEvent("d1", "zha", {"command": "press", "args": {"direction": "left"}})
    # list-shaped args (some quirks) become empty, never crash
    assert events.decode_zha({"device_id": "d1", "command": "on", "args": [1, 2]}).payload["args"] == {}
    assert events.decode_zha({"device_id": "d1"}) is None
    assert events.decode_zha({"command": "on"}) is None


@pytest.mark.parametrize(
    ("topic", "payload", "expect"),
    [
        ("zigbee2mqtt/Kitchen remote", '{"action": "on", "battery": 90}', ("Kitchen remote", "on")),
        ("zigbee2mqtt/Kitchen remote", {"action": "brightness_move_up"}, ("Kitchen remote", "brightness_move_up")),
        ("zigbee2mqtt/Kitchen remote", '{"action": ""}', None),  # empty action between presses
        ("zigbee2mqtt/Kitchen remote", '{"battery": 90}', None),
        ("zigbee2mqtt/Kitchen remote/availability", "online", None),
        ("zigbee2mqtt/Kitchen remote/set", '{"action": "on"}', None),
        ("zigbee2mqtt", '{"action": "on"}', None),
        ("zigbee2mqtt/x", "not json", None),
        ("zigbee2mqtt/x", "[1,2]", None),
    ],
)
def test_decode_z2m(topic, payload, expect):
    assert events.decode_z2m(topic, payload) == expect


def test_decode_event_entity():
    assert events.decode_event_entity({"event_type": "long_press", "multi_press_count": 2}) == {
        "event_type": "long_press",
        "attributes": {"event_type": "long_press", "multi_press_count": 2},
    }
    assert events.decode_event_entity({"friendly_name": "x"}) is None
    assert events.decode_event_entity(None) is None


@pytest.mark.parametrize(
    ("old", "new", "expect"),
    [
        ("0", "1", "rising"),
        (None, "1", "rising"),
        ("1", "0", "falling"),
        ("1", "2", "falling"),
        ("0", "0", None),
        ("1", "1", None),
        ("0", "unknown", None),
        ("1", "unavailable", None),
        ("1", None, None),
        ("unknown", "1", "rising"),
    ],
)
def test_decode_position_edge(old, new, expect):
    assert events.decode_position_edge(old, new) == expect


@pytest.mark.parametrize(
    ("uid", "expect"),
    [
        ("deadbeef-12-MatterNodeDevice-3-GenericSwitch-59-1", 3),
        ("a-b-c-7", 7),
        ("a-b-c", None),
        ("a-b-c-x-d", None),
        (None, None),
        ("", None),
    ],
)
def test_matter_endpoint_from_unique_id(uid, expect):
    assert events.matter_endpoint_from_unique_id(uid) == expect


@pytest.mark.parametrize(
    ("action", "entity_id", "platform", "expect"),
    [
        ("create", "event.new_dimmer", "xiaomi_ble", True),
        ("create", "event.new_button", "matter", True),
        ("update", "sensor.pos_1", "matter", True),
        ("create", "light.bulb", "hue", False),
        ("update", "sensor.temp", "xiaomi_ble", True),  # same platform: cheap to rescan
        ("remove", "event.old_dimmer", "xiaomi_ble", False),  # never indexed, gone anyway
        ("remove", "event.watched", None, True),  # was indexed → drop subscription
        ("update", "event.watched", None, True),
        ("bogus", "event.new_dimmer", "xiaomi_ble", False),
        ("create", None, "xiaomi_ble", False),
    ],
)
def test_registry_change_needs_resync(action, entity_id, platform, expect):
    assert (
        events.registry_change_needs_resync(
            action, entity_id, platform, {"matter", "xiaomi_ble"}, {"event.watched"}
        )
        is expect
    )
