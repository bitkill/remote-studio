from core import mappings
from core.mappings import GroupConfig, MappingData


# ----------------------------------------------------------------- migrate
def test_minor_bump_preserves_data():
    data = {"dev1": {"groups": {"main": {"target": {"entity_id": "light.a"}}}}}
    out = mappings.migrate(mappings.STORAGE_VERSION, 1, data)
    assert out == data
    assert out is not data  # a copy, never the Store's own object


def test_major_bump_from_v1_wipes():
    legacy = {"dev1": {"on": {"press": [{"service": "light.turn_on"}]}}}
    assert mappings.migrate(1, 1, legacy) == {}


def test_non_dict_payload_becomes_empty():
    assert mappings.migrate(mappings.STORAGE_VERSION, 1, None) == {}
    assert mappings.migrate(mappings.STORAGE_VERSION, 1, ["junk"]) == {}


# ------------------------------------------------------------- GroupConfig
def test_defaults_apply_on_read_and_drop_on_write():
    cfg = GroupConfig.from_stored({"target": {"entity_id": "light.a"}})
    assert cfg.dim_step == 20
    assert cfg.scene_brightness == 100
    assert cfg.scene_color is None
    assert cfg.scene_is_default
    assert cfg.to_stored() == {"target": {"entity_id": "light.a"}}


def test_default_group_stores_as_nothing():
    assert GroupConfig().to_stored() is None
    assert GroupConfig(dim_step=20, scene_brightness=100).is_default


def test_non_default_fields_round_trip():
    cfg = GroupConfig(
        target={"entity_id": "light.a"},
        dim_step=10,
        scene_brightness=60,
        scene_color=(255, 217, 168),
    )
    stored = cfg.to_stored()
    assert stored == {
        "target": {"entity_id": "light.a"},
        "dim_step": 10,
        "scene_brightness": 60,
        "scene_color": [255, 217, 168],
    }
    assert GroupConfig.from_stored(stored) == cfg
    assert not cfg.scene_is_default


def test_payload_has_every_field_and_the_default_flag():
    assert GroupConfig().to_payload() == {
        "target": None,
        "dim_step": 20,
        "scene_brightness": 100,
        "scene_color": None,
        "scene_is_default": True,
    }
    assert GroupConfig(scene_color=(1, 2, 3)).to_payload()["scene_is_default"] is False


def test_message_absent_fields_mean_default():
    cfg = GroupConfig.from_message({"target": {"entity_id": "light.a"}, "dim_step": 25})
    assert cfg.dim_step == 25
    assert cfg.scene_is_default
    assert GroupConfig.from_message({"target": None}).is_default


def test_bad_values_degrade_to_defaults():
    cfg = GroupConfig.from_stored(
        {"target": "light.a", "dim_step": "x", "scene_color": [300, -5, "7"], "scene_brightness": None}
    )
    assert cfg.target is None  # not a mapping
    assert cfg.dim_step == 20
    assert cfg.scene_color == (255, 0, 7)  # clamped and coerced
    assert cfg.scene_brightness == 100
    assert GroupConfig.from_stored({"scene_color": [1, 2]}).scene_color is None


def test_entity_ids_from_target():
    assert GroupConfig(target={"entity_id": "light.a"}).entity_ids() == ["light.a"]
    assert GroupConfig(target={"entity_id": ["light.a", "", "light.b"]}).entity_ids() == ["light.a", "light.b"]
    assert GroupConfig(target={"area_id": "kitchen"}).entity_ids() == []


# ---------------------------------------------------------------- validate
def test_validate_drops_junk_and_warns():
    clean, warnings = mappings.validate(
        {
            "ok": {"groups": {"main": {"target": {"entity_id": "light.a"}}}, "overrides": {}},
            "junk": "nope",
            "empty": {"groups": {"main": {"dim_step": 20}}, "overrides": {}},
            "bad_override": {"groups": {}, "overrides": {"on": "not-a-map"}},
            "paired": {"definition_id": "ikea_styrbar"},
        }
    )
    assert set(clean) == {"ok", "paired"}
    assert clean["paired"] == {"groups": {}, "overrides": {}, "definition_id": "ikea_styrbar"}
    assert any("junk" in w for w in warnings)
    assert any("bad_override" in w for w in warnings)


def test_validate_non_mapping_root():
    clean, warnings = mappings.validate(["x"])
    assert clean == {} and warnings


# ------------------------------------------------------------- MappingData
def test_set_group_round_trip_and_cleanup():
    d = MappingData()
    d.set_group("dev", "main", GroupConfig(target={"entity_id": "light.a"}, dim_step=10))
    assert d.group("dev", "main").dim_step == 10
    assert d.raw == {"dev": {"groups": {"main": {"target": {"entity_id": "light.a"}, "dim_step": 10}}, "overrides": {}}}
    # Resetting everything to defaults removes the group and then the device.
    canonical = d.set_group("dev", "main", GroupConfig())
    assert canonical == GroupConfig()
    assert d.raw == {}


def test_reset_scene_via_message_omission():
    d = MappingData()
    d.set_group("dev", "main", GroupConfig.from_message(
        {"target": {"entity_id": "light.a"}, "dim_step": 20, "scene_color": [1, 2, 3], "scene_brightness": 50}
    ))
    assert not d.group("dev", "main").scene_is_default
    d.set_group("dev", "main", GroupConfig.from_message({"target": {"entity_id": "light.a"}, "dim_step": 20}))
    assert d.group("dev", "main").scene_is_default
    assert d.raw["dev"]["groups"]["main"] == {"target": {"entity_id": "light.a"}}


def test_overrides_set_and_clear():
    d = MappingData()
    d.set_override("dev", "on", "press", [{"service": "light.toggle"}])
    assert d.override("dev", "on", "press") == [{"service": "light.toggle"}]
    assert d.override("dev", "on", "hold") == []
    d.set_override("dev", "on", "press", [])
    assert d.raw == {}


def test_pairing_keeps_device_alive_and_wins_in_payload():
    d = MappingData()
    d.set_pairing("dev", "ikea_styrbar")
    assert d.pairing("dev") == "ikea_styrbar"
    assert d.device_payload("dev")["paired_definition_id"] == "ikea_styrbar"
    d.set_pairing("dev", None)
    assert d.raw == {}


def test_device_payload_shape():
    d = MappingData({"dev": {"groups": {"main": {"target": {"entity_id": "light.a"}}}}})
    p = d.device_payload("dev")
    assert p["groups"]["main"]["dim_step"] == 20
    assert p["groups"]["main"]["scene_is_default"] is True
    assert p["group_defaults"] == GroupConfig().to_payload()
    assert p["overrides"] == {}
    assert p["paired_definition_id"] is None
    assert d.device_payload("ghost")["groups"] == {}


def test_entity_targets_dedup_in_order():
    d = MappingData()
    d.set_group("dev", "dot1", GroupConfig(target={"entity_id": ["light.a", "light.b"]}))
    d.set_group("dev", "dot2", GroupConfig(target={"entity_id": "light.a"}))
    assert d.entity_targets("dev") == ["light.a", "light.b"]
    assert d.entity_targets("ghost") == []


def test_clear_device():
    d = MappingData({"dev": {"definition_id": "x"}})
    assert d.clear_device("dev") is True
    assert d.clear_device("dev") is False
