"""Data logic for the per-device mapping store.

Stored shape (schema v2):

    {
      <device_id>: {
        "groups": {
          <group_id>: {
            "target": {"entity_id": "light.living"} | null,
            "dim_step": 20,                 # only when != default
            "scene_brightness": 60,         # only when != default
            "scene_color": [255, 217, 168]  # only when set
          }
        },
        "overrides": {<button_id>: {<state_id>: [<action_step>, ...]}},
        "definition_id": "ikea_styrbar"     # manual pairing, optional
      }
    }

The on-disk dict never leaves this module raw. Readers get
``GroupConfig`` (defaults applied) or a websocket payload; writers hand
in a ``GroupConfig`` and the module drops default-valued fields on the
way to disk. The HA-side ``storage.py`` owns loading and saving.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Any

STORAGE_VERSION = 2
# Minor 2: optional per-device ``definition_id`` (manual pairing).
STORAGE_MINOR_VERSION = 2

DEFAULT_DIM_STEP = 20
DEFAULT_SCENE_BRIGHTNESS = 100

ActionStep = dict[str, Any]
Rgb = tuple[int, int, int]


def migrate(old_major: int, old_minor: int, old_data: Any) -> dict[str, Any]:
    """Return the data to use after a stored version mismatch.

    * Major older than current: the pre-v2 shape has no mapping onto the
      current one, so start empty. The caller logs the warning.
    * Same major, any minor: every v2 minor adds optional fields only,
      so the stored data is returned unchanged.
    """
    if old_major < STORAGE_VERSION:
        return {}
    return dict(old_data) if isinstance(old_data, dict) else {}


# ---------------------------------------------------------------- GroupConfig
@dataclass(frozen=True)
class GroupConfig:
    """Per-(device, group) settings with defaults applied.

    ``scene_color`` is ``None`` when the user has not picked one; the
    scene role then changes brightness only. There is deliberately no
    default colour.
    """

    target: dict[str, Any] | None = None
    dim_step: int = DEFAULT_DIM_STEP
    scene_brightness: int = DEFAULT_SCENE_BRIGHTNESS
    scene_color: Rgb | None = None

    @property
    def scene_is_default(self) -> bool:
        return (
            self.scene_color is None
            and self.scene_brightness == DEFAULT_SCENE_BRIGHTNESS
        )

    @property
    def is_default(self) -> bool:
        """True when nothing user-meaningful is set (safe to drop from disk)."""
        return (
            not self.target
            and self.dim_step == DEFAULT_DIM_STEP
            and self.scene_is_default
        )

    @classmethod
    def from_stored(cls, raw: Mapping[str, Any] | None) -> GroupConfig:
        """Build from an on-disk dict, tolerating absent or odd fields."""
        if not isinstance(raw, Mapping):
            return cls()
        target = raw.get("target")
        return cls(
            target=dict(target) if isinstance(target, Mapping) and target else None,
            dim_step=_int_or(raw.get("dim_step"), DEFAULT_DIM_STEP),
            scene_brightness=_int_or(
                raw.get("scene_brightness"), DEFAULT_SCENE_BRIGHTNESS
            ),
            scene_color=_rgb_or_none(raw.get("scene_color")),
        )

    @classmethod
    def from_message(cls, msg: Mapping[str, Any]) -> GroupConfig:
        """Build from a websocket ``set_group`` message.

        Absent fields mean "default": the frontend omits the scene fields
        to reset them, so this is the one place that contract is read.
        """
        return cls.from_stored(
            {
                "target": msg.get("target"),
                "dim_step": msg.get("dim_step"),
                "scene_brightness": msg.get("scene_brightness"),
                "scene_color": msg.get("scene_color"),
            }
        )

    def to_stored(self) -> dict[str, Any] | None:
        """On-disk form with default-valued fields dropped; None if nothing to keep."""
        if self.is_default:
            return None
        out: dict[str, Any] = {"target": self.target}
        if self.dim_step != DEFAULT_DIM_STEP:
            out["dim_step"] = self.dim_step
        if self.scene_brightness != DEFAULT_SCENE_BRIGHTNESS:
            out["scene_brightness"] = self.scene_brightness
        if self.scene_color is not None:
            out["scene_color"] = list(self.scene_color)
        return out

    def to_payload(self) -> dict[str, Any]:
        """Websocket form: every field present, defaults applied."""
        return {
            "target": self.target,
            "dim_step": self.dim_step,
            "scene_brightness": self.scene_brightness,
            "scene_color": list(self.scene_color) if self.scene_color else None,
            "scene_is_default": self.scene_is_default,
        }

    def entity_ids(self) -> list[str]:
        """Entity ids in the target, in order (areas/devices not expanded)."""
        if not isinstance(self.target, Mapping):
            return []
        eid = self.target.get("entity_id")
        if isinstance(eid, list):
            return [str(e) for e in eid if e]
        return [str(eid)] if eid else []


DEFAULT_GROUP_PAYLOAD = GroupConfig().to_payload()


def _int_or(value: Any, default: int) -> int:
    try:
        return int(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _rgb_or_none(value: Any) -> Rgb | None:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        return None
    try:
        r, g, b = (max(0, min(255, int(c))) for c in value)
    except (TypeError, ValueError):
        return None
    return (r, g, b)


# ----------------------------------------------------------------- validation
def validate(data: Any) -> tuple[dict[str, Any], list[str]]:
    """Return (clean data, warnings). Malformed device entries are dropped.

    Group fields are coerced through ``GroupConfig`` so a bad colour or
    dim step degrades to its default rather than taking the device down.
    """
    warnings: list[str] = []
    if not isinstance(data, Mapping):
        return {}, ["store payload is not a mapping; starting empty"]
    clean: dict[str, Any] = {}
    for device_id, entry in data.items():
        if not isinstance(device_id, str) or not isinstance(entry, Mapping):
            warnings.append(f"dropping malformed entry for {device_id!r}")
            continue
        groups_in = entry.get("groups") or {}
        overrides_in = entry.get("overrides") or {}
        definition_id = entry.get("definition_id")
        if not isinstance(groups_in, Mapping) or not isinstance(overrides_in, Mapping):
            warnings.append(f"dropping device {device_id}: groups/overrides not mappings")
            continue
        groups: dict[str, Any] = {}
        for gid, g in groups_in.items():
            stored = GroupConfig.from_stored(g).to_stored()
            if stored is not None:
                groups[str(gid)] = stored
        overrides: dict[str, dict[str, list[ActionStep]]] = {}
        for bid, states in overrides_in.items():
            if not isinstance(states, Mapping):
                warnings.append(f"{device_id}: dropping overrides for button {bid!r}")
                continue
            kept = {
                str(sid): [dict(a) for a in actions if isinstance(a, Mapping)]
                for sid, actions in states.items()
                if isinstance(actions, list) and actions
            }
            if kept:
                overrides[str(bid)] = kept
        device: dict[str, Any] = {"groups": groups, "overrides": overrides}
        if isinstance(definition_id, str) and definition_id:
            device["definition_id"] = definition_id
        if groups or overrides or "definition_id" in device:
            clean[device_id] = device
    return clean, warnings


# ------------------------------------------------------------------ the data
class MappingData:
    """Pure, synchronous view over the stored dict.

    Every write mutates ``raw`` in place and leaves it in its canonical
    form (no default-valued fields, no empty devices), so the caller can
    persist ``raw`` as-is.
    """

    def __init__(self, data: Mapping[str, Any] | None = None) -> None:
        self.raw, self.warnings = validate(data or {})

    # ------------------------------------------------------------- reads
    def device_ids(self) -> list[str]:
        return list(self.raw)

    def group(self, device_id: str, group_id: str) -> GroupConfig:
        return GroupConfig.from_stored(
            self.raw.get(device_id, {}).get("groups", {}).get(group_id)
        )

    def groups(self, device_id: str) -> dict[str, GroupConfig]:
        return {
            gid: GroupConfig.from_stored(g)
            for gid, g in self.raw.get(device_id, {}).get("groups", {}).items()
        }

    def override(self, device_id: str, button_id: str, state_id: str) -> list[ActionStep]:
        return list(
            self.raw.get(device_id, {})
            .get("overrides", {})
            .get(button_id, {})
            .get(state_id, [])
        )

    def overrides(self, device_id: str) -> dict[str, dict[str, list[ActionStep]]]:
        return self.raw.get(device_id, {}).get("overrides", {})

    def pairing(self, device_id: str) -> str | None:
        return self.raw.get(device_id, {}).get("definition_id")

    def entity_targets(self, device_id: str) -> list[str]:
        """Entity ids picked across all groups, deduplicated, in order."""
        out: list[str] = []
        for cfg in self.groups(device_id).values():
            for eid in cfg.entity_ids():
                if eid not in out:
                    out.append(eid)
        return out

    def device_payload(self, device_id: str) -> dict[str, Any]:
        """The device's config as the websocket API ships it."""
        return {
            "groups": {gid: cfg.to_payload() for gid, cfg in self.groups(device_id).items()},
            "group_defaults": dict(DEFAULT_GROUP_PAYLOAD),
            "overrides": self.overrides(device_id),
            "paired_definition_id": self.pairing(device_id),
        }

    # ------------------------------------------------------------ writes
    def set_group(self, device_id: str, group_id: str, cfg: GroupConfig) -> GroupConfig:
        """Replace one group's config. Returns the canonical config."""
        device = self._device(device_id)
        stored = cfg.to_stored()
        if stored is None:
            device["groups"].pop(group_id, None)
        else:
            device["groups"][group_id] = stored
        self._cleanup(device_id)
        return GroupConfig.from_stored(stored)

    def set_override(
        self, device_id: str, button_id: str, state_id: str, actions: list[ActionStep]
    ) -> None:
        """Set or clear (empty list) the override for one (button, state)."""
        device = self._device(device_id)
        if actions:
            device["overrides"].setdefault(button_id, {})[state_id] = [dict(a) for a in actions]
        else:
            states = device["overrides"].get(button_id)
            if states is not None:
                states.pop(state_id, None)
                if not states:
                    device["overrides"].pop(button_id, None)
        self._cleanup(device_id)

    def set_pairing(self, device_id: str, definition_id: str | None) -> None:
        device = self._device(device_id)
        if definition_id:
            device["definition_id"] = definition_id
        else:
            device.pop("definition_id", None)
        self._cleanup(device_id)

    def clear_device(self, device_id: str) -> bool:
        return self.raw.pop(device_id, None) is not None

    # ----------------------------------------------------------- helpers
    def _device(self, device_id: str) -> dict[str, Any]:
        device = self.raw.setdefault(device_id, {})
        device.setdefault("groups", {})
        device.setdefault("overrides", {})
        return device

    def _cleanup(self, device_id: str) -> None:
        device = self.raw.get(device_id)
        if device is None:
            return
        if not device["groups"] and not device["overrides"] and not device.get("definition_id"):
            self.raw.pop(device_id, None)


__all__ = [
    "ActionStep",
    "DEFAULT_DIM_STEP",
    "DEFAULT_GROUP_PAYLOAD",
    "DEFAULT_SCENE_BRIGHTNESS",
    "GroupConfig",
    "MappingData",
    "STORAGE_MINOR_VERSION",
    "STORAGE_VERSION",
    "migrate",
    "replace",
    "validate",
]
