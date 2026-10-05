"""HA-free core of Remote Studio.

Nothing in this package imports ``homeassistant``. It is imported two
ways: as ``custom_components.remote_studio.core`` by the integration,
and as ``core`` by ``scripts/check.py`` and the test suite, which put
``custom_components/remote_studio`` on ``sys.path`` so the package can be
loaded without running the integration's ``__init__``.

Modules use relative imports so both routes work. See
``docs/adr/0001-ha-free-core.md``.
"""
