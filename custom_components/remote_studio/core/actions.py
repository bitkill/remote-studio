"""Action resolution: which action list a (button, state) should fire.

Pure. Takes the definition, the group's config and any override and
returns HA automation ``action:`` steps. Running them is the HA-side
executor's job (``runtime.ActionRunner``).

Resolution order:
  1. user override (Advanced editor) — wins if present, even when the
     group has no target (overrides may target anything).
  2. role default — built from the group's target and settings.
  3. nothing — ``[]``.
"""

from __future__ import annotations

from typing import Any

from .definitions import RemoteDefinition
from .mappings import ActionStep, GroupConfig

DIM_TRANSITION = 0.3
SCENE_TRANSITION = 0.5


def resolve(
    definition: RemoteDefinition,
    button_id: str,
    state_id: str,
    group: GroupConfig,
    override: list[ActionStep] | None = None,
) -> list[ActionStep]:
    if override:
        return list(override)
    role = definition.role_for(button_id, state_id)
    if role == "none":
        return []
    return role_default(role, group)


def role_default(role: str, group: GroupConfig) -> list[ActionStep]:
    """The action list a role produces for a group, or ``[]`` without a target."""
    target = group.target
    if not target:
        return []
    if role == "turn_on":
        return [{"service": "homeassistant.turn_on", "target": target}]
    if role == "turn_off":
        return [{"service": "homeassistant.turn_off", "target": target}]
    if role == "toggle":
        return [{"service": "homeassistant.toggle", "target": target}]
    if role in ("dim_up", "dim_down"):
        step = group.dim_step if role == "dim_up" else -group.dim_step
        return [
            {
                "service": "light.turn_on",
                "target": target,
                "data": {"brightness_step_pct": step, "transition": DIM_TRANSITION},
            }
        ]
    if role == "scene":
        # Group's scene brightness, in the user's chosen colour if any
        # (no colour by default). Lights without colour support drop the
        # rgb_color key — HA logs a warning but applies the brightness.
        data: dict[str, Any] = {
            "brightness_pct": group.scene_brightness,
            "transition": SCENE_TRANSITION,
        }
        if group.scene_color is not None:
            data["rgb_color"] = list(group.scene_color)
        return [{"service": "light.turn_on", "target": target, "data": data}]
    return []
