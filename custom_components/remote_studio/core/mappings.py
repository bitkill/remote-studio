"""Data logic for the per-device mapping store.

Pure functions and types over the stored dict. The HA-side
``storage.py`` owns loading and saving; everything about the *shape* of
the data lives here so it can be tested on plain dicts.
"""

from __future__ import annotations

from typing import Any

STORAGE_VERSION = 2
STORAGE_MINOR_VERSION = 1


def migrate(
    old_major: int, old_minor: int, old_data: Any
) -> dict[str, Any]:
    """Return the data to use after a stored version mismatch.

    * Major older than current: the pre-v2 shape has no mapping onto the
      current one, so start empty. The caller logs the warning.
    * Same major, any minor: every v2 minor adds optional fields only,
      so the stored data is returned unchanged.
    """
    if old_major < STORAGE_VERSION:
        return {}
    return dict(old_data) if isinstance(old_data, dict) else {}
