import pytest

from core import actions
from core.definitions import build
from core.mappings import GroupConfig

TARGET = {"entity_id": "light.a"}


def _def():
    return build(
        {
            "id": "t",
            "name": "T",
            "manufacturer": "Acme",
            "models": ["X"],
            "svg": "t.svg",
            "buttons": [
                {
                    "id": "on",
                    "group": "main",
                    "states": [
                        {"id": "press", "role": "turn_on", "sources": {"zha": {"command": "on"}}},
                        {"id": "hold", "role": "dim_up", "sources": {"zha": {"command": "move"}}},
                        {"id": "long", "role": "scene", "sources": {"zha": {"command": "long"}}},
                        {"id": "none", "sources": {"zha": {"command": "x"}}},
                    ],
                }
            ],
        }
    )


@pytest.mark.parametrize(
    ("role", "group", "expect"),
    [
        ("turn_on", GroupConfig(target=TARGET), [{"service": "homeassistant.turn_on", "target": TARGET}]),
        ("turn_off", GroupConfig(target=TARGET), [{"service": "homeassistant.turn_off", "target": TARGET}]),
        ("toggle", GroupConfig(target=TARGET), [{"service": "homeassistant.toggle", "target": TARGET}]),
        (
            "dim_up",
            GroupConfig(target=TARGET, dim_step=10),
            [{"service": "light.turn_on", "target": TARGET, "data": {"brightness_step_pct": 10, "transition": 0.3}}],
        ),
        (
            "dim_down",
            GroupConfig(target=TARGET),
            [{"service": "light.turn_on", "target": TARGET, "data": {"brightness_step_pct": -20, "transition": 0.3}}],
        ),
        (
            "scene",
            GroupConfig(target=TARGET),
            [{"service": "light.turn_on", "target": TARGET, "data": {"brightness_pct": 100, "transition": 0.5}}],
        ),
        (
            "scene",
            GroupConfig(target=TARGET, scene_brightness=40, scene_color=(255, 217, 168)),
            [{"service": "light.turn_on", "target": TARGET,
              "data": {"brightness_pct": 40, "transition": 0.5, "rgb_color": [255, 217, 168]}}],
        ),
        ("none", GroupConfig(target=TARGET), []),
        ("bogus", GroupConfig(target=TARGET), []),
        ("turn_on", GroupConfig(), []),  # no target → nothing
    ],
)
def test_role_default(role, group, expect):
    assert actions.role_default(role, group) == expect


def test_resolve_prefers_override_even_without_target():
    d = _def()
    override = [{"service": "script.party"}]
    assert actions.resolve(d, "on", "press", GroupConfig(), override) == override
    assert actions.resolve(d, "on", "press", GroupConfig(), override) is not override


def test_resolve_role_paths():
    d = _def()
    g = GroupConfig(target=TARGET, dim_step=5)
    assert actions.resolve(d, "on", "press", g)[0]["service"] == "homeassistant.turn_on"
    assert actions.resolve(d, "on", "hold", g)[0]["data"]["brightness_step_pct"] == 5
    assert actions.resolve(d, "on", "long", g)[0]["data"]["brightness_pct"] == 100
    assert actions.resolve(d, "on", "none", g) == []
    assert actions.resolve(d, "on", "press", GroupConfig()) == []
    assert actions.resolve(d, "ghost", "press", g) == []
