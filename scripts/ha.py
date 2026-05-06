#!/usr/bin/env python3
"""Tiny HA WebSocket client + CLI used by the Makefile.

Reads HA_URL and HA_TOKEN from .env at the repo root (or the existing
shell environment).

Subcommands:
  version       Print the installed remote_studio integration version.
  restart       Trigger Home Assistant to restart.
  wait          Block until HA's WebSocket is responsive again.
  install       Tell HACS to fetch the latest remote_studio release.
  logs          Tail HA's system_log (--filter SUBSTRING to grep).
  events        Subscribe to zha_event for N seconds and print matches.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    import websocket  # type: ignore[import-untyped]
except ImportError:
    sys.exit(
        "websocket-client is not installed. Run `make setup` or "
        "`pip install websocket-client` (consider a venv)."
    )

REPO_ROOT = Path(__file__).resolve().parent.parent
HACS_REPO_ID = "1230376062"  # bitkill/remote-studio
HACS_INTEGRATION = "remote_studio"


# ---------------------------------------------------------------- env loader
def load_env() -> None:
    """Read .env at the repo root into os.environ. Existing vars win."""
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        key, _, value = s.partition("=")
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip()


def _ws_url(url: str) -> str:
    if url.startswith("https://"):
        return "wss://" + url[len("https://"):].rstrip("/") + "/api/websocket"
    if url.startswith("http://"):
        return "ws://" + url[len("http://"):].rstrip("/") + "/api/websocket"
    return url


# ---------------------------------------------------------------- WS client
class HA:
    """Authenticated WebSocket client. Use as a context manager."""

    def __init__(self, *, timeout: float = 10.0) -> None:
        load_env()
        self._url = os.environ.get("HA_URL")
        self._token = os.environ.get("HA_TOKEN")
        if not self._url or not self._token:
            sys.exit("HA_URL and HA_TOKEN must be set in .env or the environment")
        self._ws: websocket.WebSocket | None = None
        self._timeout = timeout
        self._next_id = 0

    def __enter__(self) -> "HA":
        self._ws = websocket.create_connection(_ws_url(self._url), timeout=self._timeout)
        self._recv()  # auth_required
        self._ws.send(json.dumps({"type": "auth", "access_token": self._token}))
        m = self._recv()
        if m.get("type") != "auth_ok":
            raise SystemExit(f"auth failed: {m}")
        return self

    def __exit__(self, *_exc: object) -> None:
        if self._ws is not None:
            try:
                self._ws.close()
            finally:
                self._ws = None

    def _recv(self) -> dict:
        assert self._ws is not None
        return json.loads(self._ws.recv())

    def rpc(self, payload: dict):
        assert self._ws is not None
        self._next_id += 1
        mid = self._next_id
        self._ws.send(json.dumps({"id": mid, **payload}))
        while True:
            m = self._recv()
            if m.get("id") == mid and m.get("type") == "result":
                if not m.get("success", True):
                    raise RuntimeError(f"RPC failed: {m.get('error')}")
                return m.get("result")

    def subscribe(self, event_type: str) -> int:
        assert self._ws is not None
        self._next_id += 1
        mid = self._next_id
        self._ws.send(
            json.dumps(
                {"id": mid, "type": "subscribe_events", "event_type": event_type}
            )
        )
        while True:
            m = self._recv()
            if m.get("id") == mid and m.get("type") == "result":
                break
        return mid

    def events(self, timeout: float | None = None):
        assert self._ws is not None
        if timeout is not None:
            self._ws.settimeout(timeout)
        try:
            while True:
                msg = self._recv()
                if msg.get("type") == "event":
                    yield msg["event"]
        except (
            websocket.WebSocketTimeoutException,
            websocket.WebSocketConnectionClosedException,
        ):
            return


# ---------------------------------------------------------------- subcommands
def cmd_version(_: argparse.Namespace) -> None:
    with HA() as ha:
        m = ha.rpc({"type": "manifest/get", "integration": HACS_INTEGRATION})
        print(m.get("version"))


def cmd_restart(_: argparse.Namespace) -> None:
    with HA() as ha:
        try:
            ha.rpc(
                {
                    "type": "call_service",
                    "domain": "homeassistant",
                    "service": "restart",
                }
            )
        except Exception:
            # Connection drops mid-restart — expected.
            pass
    print("restart triggered")


def cmd_wait(args: argparse.Namespace) -> None:
    print("waiting for HA…", flush=True)
    deadline = time.time() + args.timeout
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            with HA(timeout=4.0) as ha:
                m = ha.rpc(
                    {"type": "manifest/get", "integration": HACS_INTEGRATION}
                )
                print(f"HA ready, integration v{m.get('version')}")
                return
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(3)
    sys.exit(f"HA didn't come back within {args.timeout}s — last error: {last_err}")


def cmd_install(_: argparse.Namespace) -> None:
    with HA() as ha:
        try:
            ha.rpc(
                {"type": "hacs/repository/refresh", "repository": HACS_REPO_ID}
            )
        except Exception as e:  # noqa: BLE001
            print(f"hacs refresh: {e}", file=sys.stderr)
        time.sleep(3)
        ha.rpc(
            {
                "type": "call_service",
                "domain": "homeassistant",
                "service": "update_entity",
                "service_data": {"entity_id": "update.remote_studio_update"},
            }
        )
        time.sleep(3)
        repos = ha.rpc({"type": "hacs/repositories/list"})
        rs = next(r for r in repos if r["full_name"] == "bitkill/remote-studio")
        installed = rs.get("installed_version")
        latest = rs.get("available_version")
        if installed == latest:
            print(f"already at {installed}")
            return
        print(f"installing {latest} (was {installed})…", flush=True)
        try:
            ha.rpc(
                {
                    "type": "call_service",
                    "domain": "update",
                    "service": "install",
                    "service_data": {"entity_id": "update.remote_studio_update"},
                }
            )
        except Exception as e:
            sys.exit(f"install failed: {e}")
        for _ in range(60):
            time.sleep(2)
            repos = ha.rpc({"type": "hacs/repositories/list"})
            rs = next(
                r for r in repos if r["full_name"] == "bitkill/remote-studio"
            )
            if rs.get("installed_version") == latest:
                print(f"installed {latest}")
                return
        sys.exit(f"install timed out — last seen {rs.get('installed_version')}")


def cmd_logs(args: argparse.Namespace) -> None:
    with HA() as ha:
        entries = ha.rpc({"type": "system_log/list"})
    needle = (args.filter or "").lower() if args.filter else None
    shown = 0
    for e in entries:
        msg = e.get("message", "")
        if isinstance(msg, list):
            msg = msg[0] if msg else ""
        text = str(msg)
        name = e.get("name") or ""
        if needle and needle not in text.lower() and needle not in name.lower():
            continue
        print(f"[{e.get('level')}] {name}: {text[:280]}")
        shown += 1
        if shown >= args.limit:
            break


def cmd_events(args: argparse.Namespace) -> None:
    with HA() as ha:
        device_filter = set(args.device) if args.device else None
        device_names: dict[str, str] = {}
        if device_filter:
            for d in ha.rpc({"type": "config/device_registry/list"}):
                if d["id"] in device_filter:
                    device_names[d["id"]] = d.get("name_by_user") or d.get("name") or d["id"]
        ha.subscribe(args.event_type)
        print(
            f"listening for {args.event_type} for {args.duration}s "
            f"(filter: {len(device_filter) if device_filter else 'none'})…",
            flush=True,
        )
        deadline = time.time() + args.duration
        seen = 0
        while time.time() < deadline:
            timeout = max(0.5, deadline - time.time())
            for evt in ha.events(timeout=timeout):
                data = evt.get("data", {})
                did = data.get("device_id")
                if device_filter and did not in device_filter:
                    continue
                seen += 1
                ts = (evt.get("time_fired") or "")[11:19]
                name = device_names.get(did, did or "?")
                cmd = data.get("command")
                arg = data.get("args")
                print(f"[{ts}] {name:<28} command={cmd!r} args={arg!r}", flush=True)
        print(f"captured {seen} event(s)", flush=True)


# ---------------------------------------------------------------- entry
def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="ha", description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("version", help="print installed integration version")
    sub.add_parser("restart", help="restart Home Assistant")
    wait = sub.add_parser("wait", help="wait until HA is responsive")
    wait.add_argument("--timeout", type=int, default=180)
    sub.add_parser("install", help="install latest remote_studio via HACS")

    logs = sub.add_parser("logs", help="tail system_log")
    logs.add_argument("--filter", default=None)
    logs.add_argument("--limit", type=int, default=30)

    events = sub.add_parser("events", help="capture bus events")
    events.add_argument("--event-type", default="zha_event")
    events.add_argument("--duration", type=int, default=40)
    events.add_argument("--device", action="append", default=[])

    args = p.parse_args(argv)
    handlers = {
        "version": cmd_version,
        "restart": cmd_restart,
        "wait": cmd_wait,
        "install": cmd_install,
        "logs": cmd_logs,
        "events": cmd_events,
    }
    handlers[args.cmd](args)


if __name__ == "__main__":
    main()
