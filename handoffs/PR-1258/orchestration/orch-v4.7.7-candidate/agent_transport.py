"""Existing Codex app-server and durable actor-inbox transports.

Queue acceptance is only transport evidence. The caller must keep the delivery open until an
actor/session-bound task receipt and result arrive through the board's authenticated callback.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
import shlex
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
    provider: str = "codex_app_server"


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
    if entry.get("provider") not in ("codex_app_server", "local_inbox"):
        raise RouteError(f"unsupported provider for {actor_id}; expected codex_app_server")
    provider = entry["provider"]
    session_id = str(entry.get("session_id") or "")
    if not _UUID.fullmatch(session_id):
        raise RouteError(f"{actor_id} requires a full Codex session UUID")
    remote_url = str(entry.get("remote_url") or "").strip()
    auth_token_env = str(entry.get("auth_token_env") or "").strip()
    if provider == "local_inbox" and (remote_url or auth_token_env):
        raise RouteError("local inbox routes cannot specify a remote endpoint")
    if remote_url:
        parsed = urlparse(remote_url)
        if parsed.scheme == 'ws' and parsed.hostname in ('127.0.0.1', 'localhost', '::1'):
            if auth_token_env and (not _ENV.fullmatch(auth_token_env) or not env.get(auth_token_env)):
                raise RouteError('local WebSocket token environment variable is invalid or unset')
        elif parsed.scheme == "wss":
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
            raise RouteError("remote app-server routes must use wss:// or unix://; ws:// is loopback only")
    elif auth_token_env:
        raise RouteError("auth_token_env requires remote_url")
    return CodexRoute(actor_id, session_id, remote_url, auth_token_env, provider)


def queue_message(binary: str, route: CodexRoute, message: str, *, timeout=15, env=None):
    """Queue once. A timeout is uncertain and MUST NOT be blindly retried."""
    if route.provider == "local_inbox":
        import actor_channels
        return actor_channels.enqueue(route, message)
    if route.provider != 'codex_app_server' or not _UUID.fullmatch(route.session_id) or not message.strip():
        raise RouteError('invalid existing-session delivery')
    import actor_channels
    # The callback helper reads private persisted credentials, not command arguments.
    # This is not an inbox delivery and never claims to wake or acknowledge anyone.
    if message.startswith('RWT-BOARD TASK '):
        actor_channels.remember_callback(route, message)
    import codex_rpc
    return codex_rpc.deliver(route, message, timeout=timeout, env=env)


def task_message(*, action_id: str, actor_id: str, task_id: str, instruction: str, target_head: str,
                 target_tree: str, callback_url: str, callback_token: str, session_id: str = "") -> str:
    """Construct a task-aware prompt; transport acceptance does not satisfy its receipt contract."""
    if not action_id or not task_id or not callback_url or not callback_token:
        raise RouteError("task identity and authenticated callback are required")
    helper = Path(__file__).resolve().with_name('orch-callback.py')
    command = shlex.join(['python3', str(helper), '--actor', actor_id, '--session', session_id,
                          '--action', action_id])
    callback_command = (f"Local recipient callback command (requires your normal runtime approval): {command} "
                        "--stage receipt --evidence 'Task picked up in the paired session'\n"
                        "For completion, invoke the same helper with --stage result and your actual evidence. ") if callback_url == 'http://127.0.0.1:4317/api/agent-task' else ''
    return (
        f"RWT-BOARD TASK {action_id}\n"
        f"Actor: {actor_id}\nTask: {task_id}\n"
        f"Paired session: {session_id or 'use the frozen recipient session'}\n"
        f"Frozen candidate: HEAD {target_head}; tree {target_tree or 'not supplied by source'}.\n"
        f"Requested action: {instruction.strip()}\n\n"
        "Before acting, POST a JSON task receipt to the callback URL with stage=receipt, "
        "this action_id, your configured actor_id and exact session_id, and the supplied token. "
        "After the bounded task, POST stage=result with the same identities and a concise evidence/result. "
        "A receipt proves pickup only; it does not imply task completion or authorize unrelated lifecycle actions.\n"
        f"Callback URL: {callback_url}\nSend the token as Authorization: Bearer {callback_token}.\n"
        + callback_command +
        "For wake probes the result must say wake=automatic or wake=manual truthfully. "
        "Do not modify permission settings or bypass a denied command. If blocked, report callback_blocked.\n"
    )
