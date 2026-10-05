from core import mappings


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
