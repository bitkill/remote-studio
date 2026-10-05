"""Generate dev/fixtures/remotes.json from the real remote definitions.

The fixture backend (dev/fixture-backend.mjs) serves this file so the
panel runs without a Home Assistant: `make dev-fixture`, `make
screenshot` against it, and the node tests. Regenerate with
`make fixture` after changing a shipped layout or the websocket payload
shape — the payloads here are built by the same core code the backend
uses (core.definitions.serialise, core.mappings.MappingData).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "custom_components" / "remote_studio"
REMOTES = PKG / "remotes"
OUT = ROOT / "dev" / "fixtures" / "remotes.json"

sys.path.insert(0, str(PKG))

import yaml  # type: ignore[import-not-found]  # noqa: E402

from core import definitions as defs  # noqa: E402
from core.mappings import GroupConfig, MappingData  # noqa: E402


def _load(name: str) -> defs.RemoteDefinition:
    path = REMOTES / f"{name}.yaml"
    return defs.build(yaml.safe_load(path.read_text("utf-8")), path)


def _state(entity_id: str, state: str, **attrs: object) -> dict:
    name = entity_id.split(".", 1)[1].replace("_", " ").title()
    return {
        "entity_id": entity_id,
        "state": state,
        "attributes": {"friendly_name": name, **attrs},
        "last_changed": "2026-10-05T10:00:00+00:00",
        "last_updated": "2026-10-05T10:00:00+00:00",
    }


def main() -> int:
    styrbar = _load("ikea_styrbar")
    bilresa = _load("ikea_bilresa_e2490")

    data = MappingData()
    data.set_group("fx-styrbar", "main", GroupConfig(target={"entity_id": "light.living_room"}, dim_step=10))
    data.set_override("fx-styrbar", "arrow_left", "press", [{"service": "scene.turn_on", "target": {"entity_id": "scene.movie"}}])
    data.set_group("fx-bilresa", "dot1", GroupConfig(target={"entity_id": "light.kitchen"}, scene_brightness=40, scene_color=(255, 217, 168)))
    data.set_group("fx-bilresa", "dot2", GroupConfig(target={"entity_id": "light.hallway"}))
    # dot3 deliberately unset: exercises "Pick a target above".

    devices = {
        "fx-styrbar": {
            "id": "fx-styrbar", "name": "Living room remote", "manufacturer": "IKEA of Sweden",
            "model": "Remote Control N2", "integration": "zha", "area": {"id": "living", "name": "Living room"},
        },
        "fx-bilresa": {
            "id": "fx-bilresa", "name": "Kitchen wheel", "manufacturer": "IKEA of Sweden",
            "model": "BILRESA scroll wheel", "integration": "matter", "area": {"id": "kitchen", "name": "Kitchen"},
        },
    }
    candidate = {
        "device_id": "fx-candidate", "device_name": "Mystery button", "manufacturer": "Acme",
        "model": "BTN-1", "integration": "zha", "area": None,
    }
    batteries = {
        "fx-styrbar": {"entity_id": "sensor.living_room_remote_battery", "state": "87", "unit": "%"},
        "fx-bilresa": {"entity_id": "sensor.kitchen_wheel_battery", "state": "23", "unit": "%"},
    }

    def svg(d: defs.RemoteDefinition) -> str:
        return d.svg_path.read_text("utf-8") if d.svg_path else ""

    def remote_entry(device: dict, d: defs.RemoteDefinition) -> dict:
        return {
            "device_id": device["id"], "device_name": device["name"], "manufacturer": device["manufacturer"],
            "model": device["model"], "definition_id": d.id, "integration": device["integration"],
            "area": device["area"], "battery": batteries[device["id"]],
            "targets": data.entity_targets(device["id"]),
        }

    def device_payload(device: dict, d: defs.RemoteDefinition) -> dict:
        return {
            "device": device,
            "definition": defs.serialise(d),
            "svg": svg(d),
            **data.device_payload(device["id"]),
            "battery": batteries[device["id"]],
            "automations": [] if device["id"] != "fx-styrbar" else [
                {"entity_id": "automation.living_room_remote", "name": "Living room remote (old)", "unique_id": "fx-auto"}
            ],
            "health": {"disabled_entities": [] if device["id"] != "fx-bilresa" else [
                {"entity_id": "sensor.kitchen_wheel_current_switch_position_1", "kind": "matter_position"}
            ]},
        }

    fixture = {
        "version": "0.0.0-fixture",
        "remotes": [remote_entry(devices["fx-styrbar"], styrbar), remote_entry(devices["fx-bilresa"], bilresa)],
        "candidates": [candidate],
        "definitions": [{**defs.serialise(d), "svg": svg(d)} for d in (styrbar, bilresa)],
        "devices": {
            "fx-styrbar": device_payload(devices["fx-styrbar"], styrbar),
            "fx-bilresa": device_payload(devices["fx-bilresa"], bilresa),
        },
        "states": {
            s["entity_id"]: s
            for s in (
                _state("light.living_room", "on", brightness=180, color_mode="color_temp", color_temp_kelvin=2700, supported_color_modes=["color_temp", "hs"]),
                _state("light.kitchen", "off", supported_color_modes=["hs", "color_temp"]),
                _state("light.hallway", "on", brightness=60, color_mode="brightness", supported_color_modes=["brightness"]),
                _state("light.bedroom", "off", supported_color_modes=["brightness"]),
                _state("switch.fan", "on"),
                _state("scene.movie", "unknown"),
                _state("script.goodnight", "off"),
                _state("sensor.living_room_remote_battery", "87", device_class="battery", unit_of_measurement="%"),
                _state("sensor.kitchen_wheel_battery", "23", device_class="battery", unit_of_measurement="%"),
            )
        },
        # Replayed on a timer by the fixture backend's subscribeRemoteEvents.
        "events": [
            {"device_id": "fx-styrbar", "button_id": "on", "state_id": "press"},
            {"device_id": "fx-bilresa", "button_id": "dot1", "state_id": "rotate_cw"},
            {"device_id": "fx-styrbar", "button_id": "off", "state_id": "hold"},
            {"device_id": "fx-bilresa", "button_id": "dot2", "state_id": "press"},
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
