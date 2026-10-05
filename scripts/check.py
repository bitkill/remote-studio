"""Local sanity check for the integration.

Passes:

1. Python compile — ``py_compile`` every .py under the package. Catches
   syntax errors without HA installed.
2. Remote definitions — build every ``remotes/*.yaml`` through the real
   ``core.definitions.build`` (schema, duplicate ids, signature
   collisions), confirm the SVG sibling exists and has a hotspot for
   every button, and flag duplicate definition ids across files.
3. Tests — ``pytest`` on ``tests/`` and ``node --test`` on ``tests/frontend/``.

Run:  make check
"""

from __future__ import annotations

import compileall
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "custom_components" / "remote_studio"
REMOTES = PKG / "remotes"

# Import the HA-free core as a top-level package (see docs/adr/0001).
sys.path.insert(0, str(PKG))


def _compile_python() -> bool:
    print("→ compiling python …")
    ok = compileall.compile_dir(str(PKG), quiet=1, force=True)
    print("✓ python compiles" if ok else "✗ python compile failed")
    return bool(ok)


def _check_definitions() -> bool:
    print("→ validating remote definitions …")
    try:
        import yaml  # type: ignore[import-not-found]
        from core import definitions as defs
    except ModuleNotFoundError as err:
        print(f"✗ missing dependency: {err.name} — run `make setup`")
        return False

    failures: list[str] = []
    notes: list[str] = []
    seen_ids: dict[str, str] = {}
    paths = sorted(REMOTES.glob("*.yaml"))
    for path in paths:
        try:
            definition = defs.build(yaml.safe_load(path.read_text("utf-8")), path)
        except defs.DefinitionError as err:
            failures.append(str(err))
            continue
        except Exception as err:  # noqa: BLE001 — surface every problem
            failures.append(f"{path.name}: {err}")
            continue

        if definition.id in seen_ids:
            failures.append(
                f"{path.name}: id {definition.id!r} already used by {seen_ids[definition.id]}"
            )
        seen_ids[definition.id] = path.name

        svg_path = definition.svg_path
        if svg_path is None or not svg_path.is_file():
            failures.append(f"{path.name}: missing svg sibling {definition.svg}")
            continue
        svg_text = svg_path.read_text("utf-8")
        missing = defs.missing_hotspots(definition, svg_text)
        if missing:
            failures.append(
                f"{path.name}: svg has no <g id=\"button-…\"> for {', '.join(missing)}"
            )
        if defs.wants_wheel(definition) and 'id="wheel"' not in svg_text:
            notes.append(
                f"{path.name}: has rotate_* states but no #wheel element; "
                "rotation pulses will not animate"
            )

    for note in notes:
        print(f"  · {note}")
    if failures:
        for f in failures:
            print(f"  ✗ {f}")
        return False
    print(f"✓ {len(paths)} definitions valid")
    return True


def _run_tests() -> bool:
    print("→ running tests …")
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", str(ROOT / "tests")],
        cwd=ROOT,
        check=False,
    )
    ok = result.returncode == 0
    print("✓ tests pass" if ok else "✗ tests failed")
    return ok


def _run_node_tests() -> bool:
    print("→ running frontend tests …")
    try:
        result = subprocess.run(
            ["node", "--test", "tests/frontend/**/*.test.mjs"], cwd=ROOT, check=False
        )
    except FileNotFoundError:
        print("✗ node not found")
        return False
    ok = result.returncode == 0
    print("✓ frontend tests pass" if ok else "✗ frontend tests failed")
    return ok


def main() -> int:
    ok = _compile_python()
    ok = _check_definitions() and ok
    ok = _run_tests() and ok
    ok = _run_node_tests() and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
