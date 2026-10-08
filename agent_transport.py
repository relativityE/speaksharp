"""Supported Codex app-server queue transport for existing, explicitly named actors.

Queue acceptance is only transport evidence. The caller must keep the delivery open until an
actor/session-bound task receipt and result arrive through the board's authenticated callback.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from urllib.parse import urlparse


class RouteError(ValueError):
    pass


class QueueRejected(RuntimeError):
    """The app-server definitively refused to queue the message."""


class QueueUncertain(RuntimeError):
    """The client timed out or failed after the request may have reached the app-server."""


@dataclass(frozen=True)
class CodexRoute:
    actor_id: str
    session_id: str
    remote_url: str = ""
    auth_token_env: str = ""


_ACTOR = re.compile(r"^[a-z][a-z0-9_]{1,47}$")
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
_ENV = re.compile(r"^[A-Z_][A-Z0-9_]{0,63}$")


def configured_route(actor_id: str, env=None) -> CodexRoute:
    """Read a route from RWT_AGENT_ROUTES_JSON; never infer a recipient from worker defaults.

    Example: {"version":1,"routes":{"cli_dev":{"provider":"codex_app_server",
    "session_id":"<uuid>"}}}. Remote routes additionally set remote_url and auth_token_env.
    """
    env = os.environ if env is None else env
    if not _ACTOR.fullmatch(str(actor_id or "")):
        raise RouteError("invalid recipient actor id")
    raw = env.get("RWT_AGENT_ROUTES_JSON", "")
    if not raw:
        raise RouteError("RWT_AGENT_ROUTES_JSON is not configured")
    try:
        config = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise RouteError("RWT_AGENT_ROUTES_JSON is not valid JSON") from exc
    if not isinstance(config, dict) or config.get("version") != 1 or not isinstance(config.get("routes"), dict):
        raise RouteError("RWT_AGENT_ROUTES_JSON must be a version 1 routes object")
    entry = config["routes"].get(actor_id)
    if not isinstance(entry, dict):
        raise RouteError(f"no explicit route configured for {actor_id}")
    if entry.get("provider") != "codex_app_server":
        raise RouteError(f"unsupported provider for {actor_id}; expected codex_app_server")
    session_id = str(entry.get("session_id") or "")
    if not _UUID.fullmatch(session_id):
        raise RouteError(f"{actor_id} requires a full Codex session UUID")
    remote_url = str(entry.get("remote_url") or "").strip()
    auth_token_env = str(entry.get("auth_token_env") or "").strip()
    if remote_url:
        parsed = urlparse(remote_url)
        if parsed.scheme == "wss":
            if not parsed.netloc:
                raise RouteError("remote_url must include a WSS host")
            if not _ENV.fullmatch(auth_token_env):
                raise RouteError("remote routes require an auth_token_env name")
            if not env.get(auth_token_env):
                raise RouteError(f"remote route token environment variable {auth_token_env} is unset")
        elif parsed.scheme == "unix":
            if not parsed.path:
                raise RouteError("unix remote_url must include a socket path")
            if auth_token_env:
                raise RouteError("auth_token_env is not used for unix socket routes")
        else:
            raise RouteError("remote app-server routes must use wss:// or unix://")
    elif auth_token_env:
        raise RouteError("auth_token_env requires remote_url")
    return CodexRoute(actor_id, session_id, remote_url, auth_token_env)


def queue_command(binary: str, route: CodexRoute, message: str) -> list[str]:
    if not binary:
        raise RouteError("Codex CLI binary is not configured")
    if not message.strip():
        raise RouteError("task message is empty")
    cmd = [binary, "queue", "--thread", route.session_id, "--message", message]
    if route.remote_url:
        cmd += ["--remote", route.remote_url]
        if route.auth_token_env:
            cmd += ["--remote-auth-token-env", route.auth_token_env]
    return cmd


def queue_message(binary: str, route: CodexRoute, message: str, *, timeout=15, env=None):
    """Queue once. A timeout is uncertain and MUST NOT be blindly retried."""
    child_env = dict(os.environ if env is None else env)
    cmd = queue_command(binary, route, message)
    try:
        proc = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                              timeout=timeout, env=child_env, check=False)
    except subprocess.TimeoutExpired as exc:
        raise QueueUncertain("Codex queue timed out; delivery outcome is uncertain and must not be retried") from exc
    except OSError as exc:
        raise QueueRejected(f"Codex queue could not start: {type(exc).__name__}") from exc
    output = (proc.stdout or proc.stderr or "").strip()[-1000:]
    if proc.returncode:
        raise QueueRejected(f"Codex app-server rejected queue request (exit {proc.returncode}): {output}")
    return {"transport": "codex_app_server", "accepted": True,
            "session_id": route.session_id, "detail": output}


def task_message(*, action_id: str, actor_id: str, task_id: str, instruction: str, target_head: str,
                 target_tree: str, callback_url: str, callback_token: str) -> str:
    """Construct a task-aware prompt; transport acceptance does not satisfy its receipt contract."""
    if not action_id or not task_id or not callback_url or not callback_token:
        raise RouteError("task identity and authenticated callback are required")
    return (
        f"RWT-BOARD TASK {action_id}\n"
        f"Actor: {actor_id}\nTask: {task_id}\n"
        f"Frozen candidate: HEAD {target_head}; tree {target_tree or 'not supplied by source'}.\n"
        f"Requested action: {instruction.strip()}\n\n"
        "Before acting, POST a JSON task receipt to the callback URL with stage=receipt, "
        "this action_id, your configured actor_id and exact session_id, and the supplied token. "
        "After the bounded task, POST stage=result with the same identities and a concise evidence/result. "
        "A receipt proves pickup only; it does not imply task completion or authorize unrelated lifecycle actions.\n"
        f"Callback URL: {callback_url}\nSend the token as Authorization: Bearer {callback_token}.\n"
    )
