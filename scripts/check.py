"""Local sanity check for the integration.

Two passes:

1. Python compile — runs `py_compile` against every .py under
   custom_components/remote_studio/. Catches syntax errors without
   needing HA installed.
2. YAML schema — validates each remote definition under
   custom_components/remote_studio/remotes/ against a *mirror* of the
   schema in registry.py.

The mirror is kept terse on purpose. registry.py is the source of
truth — when you change the YAML schema there, mirror the change here
or this check will silently lie to you. If divergence becomes a real
risk we can pull the schema into its own HA-free module later.

Run:  make check
"""

from __future__ import annotations

import compileall
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "custom_components" / "remote_studio"
REMOTES = PKG / "remotes"


def _compile_python() -> bool:
    print("→ compiling python …")
    # quiet=1 keeps the output tidy; we surface our own summary line.
    ok = compileall.compile_dir(str(PKG), quiet=1, force=True)
    if not ok:
        print("✗ python compile failed")
    else:
        print("✓ python compiles")
    return bool(ok)


def _check_yamls() -> bool:
    print("→ validating remote yamls …")
    try:
        import voluptuous as vol  # type: ignore[import-not-found]
        import yaml  # type: ignore[import-not-found]
    except ModuleNotFoundError as err:
        print(f"✗ missing dependency: {err.name} — run `make setup`")
        return False

    # Mirror of registry._REMOTE (and its building blocks).
    _ZHA = vol.Schema(
        {
            vol.Required("command"): str,
            vol.Optional("args"): dict,
            vol.Optional("cluster"): vol.Coerce(int),
        }
    )
    _Z2M = vol.Schema({vol.Required("action"): str})
    _MATTER = vol.Schema(
        {
            vol.Required("event"): vol.Any(str, [str]),
            vol.Optional("endpoint", default=1): vol.Coerce(int),
            vol.Optional("attributes"): dict,
        }
    )
    _BLE = vol.Schema(
        {
            vol.Required("event"): vol.Any(str, [str]),
            vol.Optional("attributes"): dict,
        }
    )
    _MP = vol.Schema(
        {
            vol.Required("endpoint"): vol.Coerce(int),
            vol.Optional("edge", default="rising"): vol.In(("rising", "falling")),
        }
    )
    _SOURCES = vol.All(
        vol.Schema(
            {
                vol.Optional("zha"): _ZHA,
                vol.Optional("z2m"): _Z2M,
                vol.Optional("matter"): _MATTER,
                vol.Optional("matter_position"): _MP,
                vol.Optional("xiaomi_ble"): _BLE,
            }
        ),
        vol.Length(min=1),
    )
    _ROLES = (
        "turn_on",
        "turn_off",
        "toggle",
        "dim_up",
        "dim_down",
        "scene",
        "none",
    )
    _STATE = vol.Schema(
        {
            vol.Required("id"): str,
            vol.Optional("label"): str,
            vol.Optional("role", default="none"): vol.In(_ROLES),
            vol.Required("sources"): _SOURCES,
        }
    )
    _BUTTON = vol.Schema(
        {
            vol.Required("id"): str,
            vol.Optional("label"): str,
            vol.Optional("group", default="main"): str,
            vol.Required("states"): vol.All([_STATE], vol.Length(min=1)),
        }
    )
    _BATTERY = vol.Schema(
        {
            vol.Required("count"): vol.All(vol.Coerce(int), vol.Range(min=1)),
            vol.Required("type"): str,
        }
    )
    _REMOTE = vol.Schema(
        {
            vol.Required("id"): str,
            vol.Required("name"): str,
            vol.Optional("manufacturer"): str,
            vol.Optional("manufacturers", default=list): [str],
            vol.Optional("models", default=list): [str],
            vol.Optional("battery"): _BATTERY,
            vol.Required("svg"): str,
            vol.Required("buttons"): vol.All([_BUTTON], vol.Length(min=1)),
        }
    )

    failures: list[tuple[str, str]] = []
    paths = sorted(REMOTES.glob("*.yaml"))
    for path in paths:
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8"))
            _REMOTE(raw)
            # Also confirm the SVG sibling exists.
            svg = REMOTES / raw["svg"]
            if not svg.is_file():
                raise FileNotFoundError(f"missing svg sibling: {svg.name}")
        except Exception as err:  # noqa: BLE001 — surface every problem
            failures.append((path.name, str(err)))

    if failures:
        for name, err in failures:
            print(f"  ✗ {name}: {err}")
        return False
    print(f"✓ {len(paths)} layouts valid")
    return True


def main() -> int:
    ok = True
    ok = _compile_python() and ok
    ok = _check_yamls() and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
