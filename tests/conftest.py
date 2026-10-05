"""Test bootstrap.

Puts ``custom_components/remote_studio`` on ``sys.path`` so the HA-free
``core`` package imports as a top-level package, without running the
integration's ``__init__`` (which imports homeassistant).
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "custom_components" / "remote_studio"))
