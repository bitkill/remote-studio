from pathlib import Path

import pytest
import yaml

from core import definitions as defs

REMOTES = Path(__file__).resolve().parent.parent / "custom_components" / "remote_studio" / "remotes"
SHIPPED = sorted(REMOTES.glob("*.yaml"))


def load(path: Path) -> defs.RemoteDefinition:
    return defs.build(yaml.safe_load(path.read_text("utf-8")), path)


def minimal(**overrides):
    raw = {
        "id": "t",
        "name": "T",
        "manufacturer": "Acme",
        "models": ["X1"],
        "svg": "t.svg",
        "buttons": [
            {
                "id": "on",
                "states": [
                    {"id": "press", "role": "turn_on", "sources": {"zha": {"command": "on"}}}
                ],
            }
        ],
    }
    raw.update(overrides)
    return raw


# ------------------------------------------------------------ shipped layouts
@pytest.mark.parametrize("path", SHIPPED, ids=[p.stem for p in SHIPPED])
def test_shipped_definition_builds_and_svg_has_every_hotspot(path):
    d = load(path)
    assert d.id == path.stem
    svg = d.svg_path.read_text("utf-8")
    assert defs.missing_hotspots(d, svg) == []


def _event_for(source: str, sig: dict) -> dict:
    """Derive the payload a state's own signature describes."""
    if source == "zha":
        return {"command": sig["command"], "args": dict(sig.get("args") or {})}
    if source == "z2m":
        return {"action": sig["action"]}
    if source == "matter":
        ev = sig["event"]
        return {
            "endpoint": sig.get("endpoint", 1),
            "event_type": ev if isinstance(ev, str) else ev[0],
            "attributes": dict(sig.get("attributes") or {}),
        }
    if source == "xiaomi_ble":
        ev = sig["event"]
        return {
            "event_type": ev if isinstance(ev, str) else ev[0],
            "attributes": dict(sig.get("attributes") or {}),
        }
    if source == "matter_position":
        return {"endpoint": sig["endpoint"], "edge": sig.get("edge", "rising")}
    raise AssertionError(source)


@pytest.mark.parametrize("path", SHIPPED, ids=[p.stem for p in SHIPPED])
def test_every_state_matches_its_own_signature(path):
    d = load(path)
    for button in d.buttons:
        for state in button.states:
            for source, sig in state.sources.items():
                got = d.match(source, _event_for(source, sig))
                assert got == (button.id, state.id), (source, sig, got)


# ------------------------------------------------- captured payloads (traps)
def test_hue_dimmer_v1_zha_on_press():
    d = load(REMOTES / "hue_dimmer_v1.yaml")
    assert d.match("zha", {"command": "on_press", "args": {}}) is not None


def test_z2m_uses_press_not_the_zha_release_names():
    # Trap from AGENTS.md: ZHA Hue events are `<button>_<press_type>`
    # (`on_short_release`), Z2M publishes `on_press` / `on_hold`.
    d = load(REMOTES / "hue_dimmer_v2.yaml")
    assert d.match("z2m", {"action": "on_press"}) is not None
    assert d.match("z2m", {"action": "on_short_release"}) is None


def test_bilresa_wheel_rotation_comes_from_position_sensors():
    d = load(REMOTES / "ikea_bilresa_e2490.yaml")
    assert d.match("matter_position", {"endpoint": 1, "edge": "rising"}) == ("dot1", "rotate_cw")
    assert d.match("matter_position", {"endpoint": 2, "edge": "rising"}) == ("dot1", "rotate_ccw")
    assert d.match("matter_position", {"endpoint": 4, "edge": "rising"}) == ("dot2", "rotate_cw")
    # Long press still rides the (debounced) matter event entity.
    assert d.match("matter", {"endpoint": 3, "event_type": "long_press", "attributes": {}}) == ("dot1", "hold")


def test_matter_position_edges_are_distinct_states():
    d = load(REMOTES / "ikea_bilresa_e2490.yaml")
    rising = d.match("matter_position", {"endpoint": 1, "edge": "rising"})
    falling = d.match("matter_position", {"endpoint": 1, "edge": "falling"})
    assert rising is not None
    assert rising != falling


def test_unknown_source_never_matches():
    d = defs.build(minimal())
    assert d.match("bogus", {"command": "on"}) is None


# ---------------------------------------------------------- device identity
@pytest.mark.parametrize(
    ("manufacturers", "models", "mfr", "model", "expect"),
    [
        (("IKEA of Sweden",), ("Remote Control N2",), "IKEA of Sweden", "Remote Control N2", True),
        (("IKEA",), ("BILRESA",), "IKEA of Sweden AB", "E2490 BILRESA three dots", True),
        (("IKEA of Sweden",), ("BILRESA",), "IKEA", "BILRESA", True),  # substring either way
        (("IKEA",), ("STYRBAR",), "IKEA", "RODRET", False),
        (("IKEA",), ("STYRBAR",), "Philips", "STYRBAR", False),
        (("IKEA",), ("STYRBAR",), "IKEA", None, True),  # unknown model, mfr ok
        (("IKEA",), ("STYRBAR",), None, "STYRBAR", True),  # unknown mfr, model ok
        ((), (), "Anyone", "Anything", False),  # declares nothing: never auto-matches
    ],
)
def test_matches_device(manufacturers, models, mfr, model, expect):
    raw = minimal(manufacturers=list(manufacturers), models=list(models))
    del raw["manufacturer"]
    d = defs.build(raw)
    assert d.matches_device(mfr, model) is expect


def test_find_for_device_keeps_input_order():
    a = defs.build(minimal(id="a"))
    b = defs.build(minimal(id="b"))
    assert [d.id for d in defs.find_for_device([a, b], "Acme", "X1")] == ["a", "b"]
    assert defs.find_for_device([a, b], "Other", "X1") == []


# -------------------------------------------------------------- build errors
def test_schema_error_names_the_source():
    with pytest.raises(defs.DefinitionError) as e:
        defs.build({"id": "x"}, Path("/tmp/x.yaml"))
    assert "/tmp/x.yaml" in str(e.value)
    assert e.value.source == "/tmp/x.yaml"


def test_z2m_collision_is_an_error():
    raw = minimal()
    raw["buttons"].append(
        {"id": "off", "states": [{"id": "press", "sources": {"z2m": {"action": "toggle"}}}]}
    )
    raw["buttons"][0]["states"][0]["sources"]["z2m"] = {"action": "toggle"}
    with pytest.raises(defs.DefinitionError, match="z2m action 'toggle'"):
        defs.build(raw)


def test_zha_same_command_different_args_is_fine_but_same_args_collides():
    raw = minimal()
    raw["buttons"][0]["states"][0]["sources"] = {"zha": {"command": "press", "args": {"direction": "left"}}}
    raw["buttons"].append(
        {"id": "right", "states": [{"id": "press", "sources": {"zha": {"command": "press", "args": {"direction": "right"}}}}]}
    )
    d = defs.build(raw)
    assert d.match("zha", {"command": "press", "args": {"direction": "right"}}) == ("right", "press")
    raw["buttons"][1]["states"][0]["sources"]["zha"]["args"] = {"direction": "left"}
    with pytest.raises(defs.DefinitionError, match="claimed by both"):
        defs.build(raw)


def test_duplicate_ids_are_errors():
    raw = minimal()
    raw["buttons"].append(dict(raw["buttons"][0]))
    with pytest.raises(defs.DefinitionError, match="duplicate button id"):
        defs.build(raw)
    raw = minimal()
    raw["buttons"][0]["states"].append(dict(raw["buttons"][0]["states"][0]))
    with pytest.raises(defs.DefinitionError, match="duplicate state id"):
        defs.build(raw)


def test_hotspot_detection_and_wheel_hint():
    d = defs.build(minimal())
    assert defs.missing_hotspots(d, '<svg><g id="button-on"/></svg>') == []
    assert defs.missing_hotspots(d, "<svg><g id='button-off'/></svg>") == ["on"]
    assert defs.wants_wheel(d) is False


def test_groups_and_roles():
    raw = minimal()
    raw["buttons"][0]["group"] = "dot1"
    raw["buttons"][0]["states"].append(
        {"id": "hold", "role": "dim_up", "sources": {"zha": {"command": "move"}}}
    )
    d = defs.build(raw)
    assert d.groups() == [
        {"id": "dot1", "label": "Dot 1", "has_dim": True, "has_scene": False, "button_ids": ["on"]}
    ]
    assert d.role_for("on", "hold") == "dim_up"
    assert d.role_for("on", "nope") == "none"
    assert d.group_for("on") == "dot1"
    assert d.group_for("ghost") == "main"
    assert d.sources == frozenset({"zha"})


def test_serialise_shape():
    d = load(REMOTES / "ikea_styrbar.yaml")
    out = defs.serialise(d)
    assert set(out) == {"id", "name", "models", "battery", "groups", "buttons"}
    assert out["id"] == "ikea_styrbar"
    assert out["groups"][0]["id"] == "main"
    btn = out["buttons"][0]
    assert set(btn) == {"id", "label", "group", "states"}
    assert set(btn["states"][0]) == {"id", "label", "role"}
    assert "sources" not in btn["states"][0]  # signatures never leave the backend
