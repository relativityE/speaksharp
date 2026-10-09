#!/usr/bin/env python3
import base64
import io
import zipfile
import json
import re
import hashlib
import hmac
import secrets
from guarded_pm import Executor, Hold, KINDS as PM_ACTION_KINDS, canonical_key
import os
import shlex
import shutil
import sqlite3
import subprocess
import sys
import pty
import fcntl
import threading
import time
import uuid
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote
import agent_transport

APP = Path(__file__).resolve().parent
DB = APP / ".agent-work" / "state.db"
UPLOADS = APP / "uploads"
HANDOFFS = APP / "handoffs"
STATIC = APP / "static"
HOST = "127.0.0.1"
PORT = int(os.environ.get("RWT_PORT", "4317"))
AGENT_CALLBACK_URL = os.environ.get("RWT_AGENT_CALLBACK_URL", "").strip()
AGENT_TRANSPORT_TIMEOUT = max(2, int(os.environ.get("RWT_AGENT_TRANSPORT_TIMEOUT_SECONDS", "15")))
AGENT_RECEIPT_TIMEOUT = max(10, int(os.environ.get("RWT_AGENT_RECEIPT_TIMEOUT_SECONDS", "120")))
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "/opt/homebrew/bin/claude")
BASE_REPO = os.environ.get("SPEAKSHARP_REPO", str(Path.home() / "SW_Dev" / "Antigravity_Dev" / "speaksharp"))
DEFAULT_CWD = ""
PERMISSION_MODE = os.environ.get("CLAUDE_PERMISSION_MODE", "bypassPermissions")
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "").strip()  # empty = user's Claude CLI default
CODEX_BIN = os.environ.get("CODEX_BIN", "codex").strip()
CODEX_MODEL = os.environ.get("CODEX_MODEL", "").strip()  # empty = user's Codex CLI default
PM_MODEL = os.environ.get("PM_MODEL", "gpt-5.6-sol").strip()  # legacy API fallback only
PM_MODE = os.environ.get("PM_MODE", "auto").strip().lower()  # auto | codex | command | openai | manual
PM_COMMAND = os.environ.get("PM_COMMAND", "").strip()
PM_INSTRUCTIONS_FILE = Path(os.environ.get("PM_INSTRUCTIONS_FILE", str(APP / "pm-instructions.md")))
PM_ROUTE_SCHEMA = Path(os.environ.get("PM_ROUTE_SCHEMA", str(APP / "pm-route.schema.json")))
PM_TIMEOUT = int(os.environ.get("PM_TIMEOUT_SECONDS", "180"))
# c5 (F12): a Dev invocation is bounded; on expiry the process is terminated and PM recovery is owed.
DEV_TIMEOUT = int(os.environ.get("DEV_TIMEOUT_SECONDS", "14400"))
# Legacy optional fallback only. Auto mode never prefers API billing when local Codex is available.
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
OPENAI_TIMEOUT = int(os.environ.get("OPENAI_TIMEOUT_SECONDS", str(PM_TIMEOUT)))
MAX_UPLOAD = 10 * 1024 * 1024
MAX_PACKET_FILES = 100
MAX_PACKET_FILE_BYTES = 10 * 1024 * 1024
MAX_PACKET_BYTES = 50 * 1024 * 1024
MAX_PACKET_MANIFEST_BYTES = 1024 * 1024
PACKET_VERIFY_TIMEOUT_SECONDS = 120
PACKET_VERIFY_RETRY_LIMIT = 5
PACKET_VERIFY_MAX_PER_POLL = 3
MAX_COMMENT_PAGES = 5
MAX_REVIEW_PAGES = 5
MAX_AFFECTED_REVIEW_TARGETS = 25
MAX_AFFECTED_REVIEW_REFRESH_PER_POLL = 2
AFFECTED_REVIEW_CACHE_TTL_SECONDS = 300
GH_REQUEST_WINDOW_SECONDS = 60
GH_REQUEST_BUDGET_PER_WINDOW = max(1, int(os.environ.get("RWT_GH_REQUEST_BUDGET_PER_MINUTE", "60")))
COMMENT_BOOTSTRAP_LOOKBACK_DAYS = 30
MAX_HANDOFF_DEPTH = int(os.environ.get("MAX_HANDOFF_DEPTH", "12"))
GITHUB_WATCH_INTERVAL = max(5, int(os.environ.get("GITHUB_WATCH_INTERVAL_SECONDS", "20")))
CONTROL_ISSUE = int(os.environ.get("RWT_CONTROL_ISSUE", "1258"))
WATCH_ISSUES = os.environ.get('RWT_WATCH_ISSUES', '1304')
BOARD_VERSION = "4.6.17"
BOARD_BUILD = "deadlock.5"
GH_BACKOFF_UNTIL = 0.0
PR_DISPLAY_CACHE = {}
PR_DISPLAY_LOCK = threading.RLock()

class PMTransportTimeout(RuntimeError):
    """Read-only PM reasoning expired before host actions or publication."""

EXTERNAL_STATUS_TTL = 1800
ASK_OVERDUE_SECONDS = int(os.environ.get("RWT_ASK_OVERDUE_SECONDS", "120"))
ASK_ESCALATE_SECONDS = int(os.environ.get("RWT_ASK_ESCALATE_SECONDS", "900"))
# Connector-readable per-PR share location. Publication still needs an explicit push pin.
HANDOFF_REMOTE_BRANCH = os.environ.get("RWT_HANDOFF_REMOTE_BRANCH", "docs/1258-orchestration-deadlock5-20261007").strip()
HANDOFF_REMOTE_REPO = "relativityE/speaksharp"
RELEASE_ORDER = (1555, 1558, 1554, 1559)

DB_LOCK = threading.RLock()
PROC_LOCK = threading.RLock()
ACTIVE_DEV_PROC = None
ACTIVE_DEV_QUEUE_ID = None
DEV_STOP_REQUESTED = None  # queue id whose Dev process an operator stopped
ACTIVE_PM_PROC = None
PM_CANCEL_GENERATION = 0
CODEX_AUTH_OK = None
CODEX_AUTH_DETAIL = "not checked"
STOP = threading.Event()
STATE_LOCK_FD = None
REPOSITORY_LOCK_FD = None


def acquire_state_dir_lock(state_dir=None):
    """Own the state directory before migration/recovery can reinterpret live claims."""
    directory = Path(state_dir) if state_dir is not None else DB.parent
    directory.mkdir(parents=True, exist_ok=True)
    lock_path = directory / '.board.lock'
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        os.close(fd)
        if exc.errno in (11, 35):
            raise RuntimeError(f'Another board process owns state directory {directory}') from exc
        raise
    os.fchmod(fd, 0o600)
    return fd


def release_state_dir_lock(fd):
    if fd is not None:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


def acquire_repository_lock(repo_identity=None, lock_root=None):
    """Permit one installed board/worker set per GitHub repository on this host user."""
    identity = str(repo_identity or repo_slug(BASE_REPO) or '').strip().lower()
    if not identity:
        raise RuntimeError('Cannot establish repository identity for the board worker lock')
    root = Path(lock_root) if lock_root is not None else Path.home() / '.rwt-board' / 'locks'
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.is_symlink():
        raise RuntimeError(f'Repository lock directory must not be a symlink: {root}')
    lock_path = root / (hashlib.sha256(identity.encode()).hexdigest() + '.lock')
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        os.fchmod(fd, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        os.close(fd)
        if exc.errno in (11, 35):
            raise RuntimeError(f'Another board process owns repository {identity}') from exc
        raise
    return fd


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def con():
    DB.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB, timeout=30, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


def _columns(c, table):
    return {r["name"] for r in c.execute(f"PRAGMA table_info({table})").fetchall()}


def _add_column(c, table, definition):
    name = definition.split()[0]
    if name not in _columns(c, table):
        c.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def init_db():
    with DB_LOCK, con() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agents(
          agent_id TEXT PRIMARY KEY, provider TEXT NOT NULL, session_id TEXT,
          cwd TEXT, status TEXT NOT NULL DEFAULT 'idle', paused INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS activity(
          id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, message TEXT NOT NULL,
          route TEXT NOT NULL DEFAULT 'none', status TEXT NOT NULL DEFAULT 'posted',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS attachments(
          id INTEGER PRIMARY KEY AUTOINCREMENT, activity_id INTEGER, filename TEXT NOT NULL,
          path TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS queue(
          id INTEGER PRIMARY KEY AUTOINCREMENT, activity_id INTEGER NOT NULL,
          recipient TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
          session_id TEXT, error TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
        );
        CREATE TABLE IF NOT EXISTS work_items(
          item_key TEXT PRIMARY KEY, priority INTEGER NOT NULL, title TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'blocked', owner TEXT NOT NULL DEFAULT 'unassigned',
          branch TEXT NOT NULL DEFAULT '', blocker TEXT NOT NULL DEFAULT '', blocker_since TEXT,
          next_action TEXT NOT NULL DEFAULT '', po_required INTEGER NOT NULL DEFAULT 0,
          release_blocker INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS player_status(
          player_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'available',
          task TEXT NOT NULL DEFAULT '', work_item_key TEXT NOT NULL DEFAULT '',
          blocker TEXT NOT NULL DEFAULT '', holding INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'board', updated_at TEXT NOT NULL, checkpoint_at TEXT NOT NULL DEFAULT ''
        );
        """)
        c.executescript('''CREATE TABLE IF NOT EXISTS pm_outbox(queue_id INTEGER PRIMARY KEY,status TEXT NOT NULL,comment_id INTEGER,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS pm_action_journal(action_key TEXT PRIMARY KEY,status TEXT NOT NULL,result TEXT NOT NULL);''')
        c.execute("""CREATE TABLE IF NOT EXISTS agent_notifications(
          notification_key TEXT PRIMARY KEY, handoff_id INTEGER NOT NULL, actor_id TEXT NOT NULL,
          task_id TEXT NOT NULL, action_id TEXT NOT NULL UNIQUE, target_transport TEXT NOT NULL,
          target_session_id TEXT NOT NULL, target_remote_url TEXT NOT NULL DEFAULT '', head TEXT NOT NULL,
          instruction TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
          accepted_at TEXT, transport_reference TEXT NOT NULL DEFAULT '', receipt_at TEXT,
          receipt_digest TEXT NOT NULL DEFAULT '', result_at TEXT, result_digest TEXT NOT NULL DEFAULT '',
          recovery_count INTEGER NOT NULL DEFAULT 0, recovery_at TEXT, error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
        c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('board_instance_id',?)", (uuid.uuid4().hex,))
        # v4.5.x delivery metadata. ALTER keeps v4.4.x state readable.
        _add_column(c, "queue", "source_actor TEXT NOT NULL DEFAULT 'PO'")
        _add_column(c, "queue", "parent_queue_id INTEGER")
        _add_column(c, "queue", "handoff_depth INTEGER NOT NULL DEFAULT 0")
        _add_column(c, "queue", "auto_handoff INTEGER NOT NULL DEFAULT 1")
        _add_column(c, "queue", "fanout_group TEXT")
        _add_column(c, "queue", "attempts INTEGER NOT NULL DEFAULT 0")
        _add_column(c, "queue", "available_after REAL NOT NULL DEFAULT 0")
        _add_column(c, "activity", "trigger_queue_id INTEGER")
        _add_column(c, "work_items", "pr_number INTEGER")
        _add_column(c, "work_items", "worktree TEXT NOT NULL DEFAULT ''")
        _add_column(c, "queue", "work_item_key TEXT NOT NULL DEFAULT ''")
        _add_column(c, "queue", "target_branch TEXT NOT NULL DEFAULT ''")
        _add_column(c, "queue", "target_worktree TEXT NOT NULL DEFAULT ''")
        _add_column(c, "queue", "target_head TEXT NOT NULL DEFAULT ''")
        _add_column(c, "queue", "target_tree TEXT NOT NULL DEFAULT ''")
        _add_column(c, "queue", "target_repo_common_dir TEXT NOT NULL DEFAULT ''")
        _add_column(c, "queue", "target_origin TEXT NOT NULL DEFAULT ''")
        _add_column(c, "queue", "target_lease_generation TEXT NOT NULL DEFAULT ''")
        _add_column(c, "queue", "target_dirty_fingerprint TEXT NOT NULL DEFAULT ''")
        _add_column(c, "work_items", "lease_generation TEXT NOT NULL DEFAULT ''")
        _add_column(c, "work_items", "assignment_generation TEXT NOT NULL DEFAULT ''")
        _add_column(c, "work_items", "owned_paths TEXT NOT NULL DEFAULT '[]'")
        # C11/R06: persist bootstrap as its own phase. Only a later exact queued
        # checkout readback may move required -> verified.
        for definition in ("bootstrap_state TEXT NOT NULL DEFAULT 'not_required'",
                           "bootstrap_verified_at TEXT", "bootstrap_verified_head TEXT NOT NULL DEFAULT ''",
                           "bootstrap_verified_tree TEXT NOT NULL DEFAULT ''"):
            _add_column(c, "work_items", definition)
        # deadlock.5: typed system deliveries and a durable "recovery owed" flag so a
        # crash between failure and recovery enqueue cannot lose the PM recovery.
        _add_column(c, "queue", "kind TEXT NOT NULL DEFAULT ''")
        _add_column(c, "queue", "preflight_recovery_due INTEGER NOT NULL DEFAULT 0")
        c.execute("UPDATE work_items SET bootstrap_state='required' WHERE bootstrap_state='not_required' AND "
                  "EXISTS(SELECT 1 FROM queue WHERE queue.kind='preflight_recovery' "
                  "AND queue.work_item_key=work_items.item_key)")
        for definition in ("kind TEXT NOT NULL DEFAULT ''", "action_json TEXT NOT NULL DEFAULT ''",
                           "phase TEXT NOT NULL DEFAULT ''", "review_state TEXT NOT NULL DEFAULT ''",
                           "pr_number INTEGER", "head TEXT NOT NULL DEFAULT ''", "updated_at TEXT",
                           "provenance TEXT NOT NULL DEFAULT '[]'", "lease_scope TEXT NOT NULL DEFAULT ''",
                           "review_error TEXT NOT NULL DEFAULT ''",
                           "security_review_state TEXT NOT NULL DEFAULT ''",
                           "pm_acceptance_state TEXT NOT NULL DEFAULT ''"):
            _add_column(c, "pm_action_journal", definition)
        for row in c.execute("SELECT action_key,action_json FROM pm_action_journal WHERE lease_scope='' ").fetchall():
            try:
                action = json.loads(row['action_json'] or '{}')
                scope = (f"pr:{int(action['pr_number'])}" if action.get('pr_number') else
                         f"branch:{str(action['branch']).strip()}" if action.get('branch') else '')
            except (ValueError, TypeError, KeyError):
                scope = ''
            if scope:
                c.execute("UPDATE pm_action_journal SET lease_scope=? WHERE action_key=?", (scope, row['action_key']))
        c.executescript('''
        CREATE TABLE IF NOT EXISTS asks(
          id INTEGER PRIMARY KEY AUTOINCREMENT, source_comment_id INTEGER NOT NULL, ask_index INTEGER NOT NULL,
          source_actor TEXT NOT NULL DEFAULT '', task_ref TEXT NOT NULL DEFAULT '', candidate TEXT NOT NULL DEFAULT '',
          request TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', source_at TEXT, recorded_at TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'pending', disposition TEXT NOT NULL DEFAULT '', disposition_owner TEXT NOT NULL DEFAULT '',
          disposition_ref TEXT NOT NULL DEFAULT '', dispositioned_at TEXT,
          recovery_count INTEGER NOT NULL DEFAULT 0, last_recovery_at TEXT, escalated INTEGER NOT NULL DEFAULT 0,
          UNIQUE(source_comment_id, ask_index));
        CREATE TABLE IF NOT EXISTS review_handoffs(
          id INTEGER PRIMARY KEY AUTOINCREMENT, pr_number INTEGER NOT NULL, head TEXT NOT NULL,
          reviewed_ref TEXT NOT NULL, disposition TEXT NOT NULL, owner TEXT NOT NULL, work_item_key TEXT NOT NULL DEFAULT '',
          instruction TEXT NOT NULL, token TEXT UNIQUE, state TEXT NOT NULL DEFAULT 'recorded',
          delivery_queue_id INTEGER, delivery_comment_id INTEGER, ack_ref TEXT NOT NULL DEFAULT '',
          source_queue_id INTEGER, created_at TEXT NOT NULL, delivered_at TEXT, received_at TEXT, acknowledged_at TEXT,
          UNIQUE(pr_number, head, reviewed_ref, owner));
        ''')
        _add_column(c, "asks", "handoff_id INTEGER")
        for definition in ("recovery_count INTEGER NOT NULL DEFAULT 0", "last_recovery_at TEXT", "escalated INTEGER NOT NULL DEFAULT 0"):
            _add_column(c, "review_handoffs", definition)
        # c5 (F01): one durable plan per PM turn. Its owed effects (ask dispositions, handoff delivery,
        # Dev dispatch) are applied by ONE idempotent continuation, from the turn itself or from recovery.
        c.execute("CREATE TABLE IF NOT EXISTS pm_turn_effects(queue_id INTEGER PRIMARY KEY, plan_json TEXT NOT NULL, "
                  "phase TEXT NOT NULL, updated_at TEXT NOT NULL)")
        # c5 (F05): exact packet reads survive a transient outage and route a terminal result to PM.
        c.execute("CREATE TABLE IF NOT EXISTS packet_verifications("
                  "request_key TEXT PRIMARY KEY, pr_or_task TEXT NOT NULL, packet_path TEXT NOT NULL, ref TEXT NOT NULL,"
                  "status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at REAL NOT NULL DEFAULT 0,"
                  "claim_until REAL NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', result_json TEXT NOT NULL DEFAULT '{}',"
                  "created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")
        # c5 (F01/F02): an atomic unique delivery key reconciles an enqueue that landed before its phase update.
        _add_column(c, "queue", "delivery_key TEXT NOT NULL DEFAULT ''")
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS queue_delivery_key ON queue(delivery_key) WHERE delivery_key<>''")
        for definition in ("target_assignment_generation TEXT NOT NULL DEFAULT ''", "task_action_id TEXT NOT NULL DEFAULT ''",
                           "claim_token TEXT NOT NULL DEFAULT ''", "claimed_at TEXT", "task_receipt_at TEXT",
                           "task_receipt_ref TEXT NOT NULL DEFAULT ''", "task_result_at TEXT",
                           "task_result_ref TEXT NOT NULL DEFAULT ''"):
            _add_column(c, "queue", definition)
        _add_column(c, "player_status", "checkpoint_at TEXT NOT NULL DEFAULT ''")
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS queue_task_action_id ON queue(task_action_id) WHERE task_action_id<>''")
        # c5 (F12): invocation stages are separate facts, not one 'delivering' status.
        for definition in ("launch_attempted_at TEXT", "process_started_at TEXT", "process_pid INTEGER",
                           "invocation_recovery_due INTEGER NOT NULL DEFAULT 0"):
            _add_column(c, "queue", definition)
        # Existing-session agent delivery is distinct from spawning a local worker process.
        for definition in (
            "target_actor_id TEXT NOT NULL DEFAULT ''", "target_transport TEXT NOT NULL DEFAULT ''",
            "target_session_id TEXT NOT NULL DEFAULT ''", "target_remote_url TEXT NOT NULL DEFAULT ''",
            "transport_accepted_at TEXT", "transport_reference TEXT NOT NULL DEFAULT ''",
            "transport_recovery_count INTEGER NOT NULL DEFAULT 0", "transport_recovery_at TEXT",
            "transport_escalated_at TEXT", "task_result_digest TEXT NOT NULL DEFAULT ''",
        ):
            _add_column(c, "queue", definition)
        # c5 (F02): a persisted prerequisite gate on the task, honored by every dispatch route.
        for definition in ("dispatch_hold TEXT NOT NULL DEFAULT ''", "dispatch_hold_since TEXT",
                           "dispatch_hold_release TEXT NOT NULL DEFAULT ''", "dispatch_hold_source INTEGER"):
            _add_column(c, "work_items", definition)
        # c5 (F03): typed ask envelope. 'held' is OPEN and keeps its owner, dependency and release event.
        for definition in ("kind TEXT NOT NULL DEFAULT 'request'", "owner TEXT NOT NULL DEFAULT ''",
                           "dependency TEXT NOT NULL DEFAULT ''", "release_event TEXT NOT NULL DEFAULT ''",
                           "held_at TEXT", "signals TEXT NOT NULL DEFAULT '[]'"):
            _add_column(c, "asks", definition)
        # c5 (F04): receipt, result and PM closure are separate stages with separate timeouts.
        for definition in ("result_ref TEXT NOT NULL DEFAULT ''", "result_at TEXT", "hold_reason TEXT NOT NULL DEFAULT ''",
                           "action_recovery_count INTEGER NOT NULL DEFAULT 0", "last_action_recovery_at TEXT",
                           "action_escalated INTEGER NOT NULL DEFAULT 0"):
            _add_column(c, "review_handoffs", definition)
        # Only asks posted after the ledger exists are tracked; history is not replayed as new work.
        c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('asks_ingest_since',?)", (now(),))
        c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('agent_delivery_hmac_secret',?)", (secrets.token_urlsafe(48),))
        for row in c.execute("SELECT item_key FROM work_items WHERE assignment_generation='' ").fetchall():
            c.execute("UPDATE work_items SET assignment_generation=? WHERE item_key=?", (uuid.uuid4().hex, row['item_key']))

        if not c.execute("SELECT 1 FROM agents WHERE agent_id='dev'").fetchone():
            c.execute(
                "INSERT INTO agents(agent_id,provider,session_id,cwd,status,paused,updated_at) VALUES(?,?,?,?,?,?,?)",
                ("dev", "claude", None, DEFAULT_CWD, "idle", 0, now()),
            )
        if not c.execute("SELECT 1 FROM agents WHERE agent_id='pm'").fetchone():
            c.execute(
                "INSERT INTO agents(agent_id,provider,session_id,cwd,status,paused,updated_at) VALUES(?,?,?,?,?,?,?)",
                ("pm", "codex", None, BASE_REPO, "idle", 0, now()),
            )
        c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('current_pr','')")
        c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('current_pr_explicit','0')")
        for key, value in {
            'auto_pm_github_review':'1', 'auto_pm_github_ci':'1', 'auto_pm_github_head':'1',
            'auto_pm_github_deploy':'1', 'auto_dev_github':'0', 'auto_dev_to_pm':'1',
            'auto_pm_to_dev':'1', 'github_watch_interval':str(GITHUB_WATCH_INTERVAL),
            'github_watch_snapshot':'', 'github_watch_pr':'', 'anti_idle_cli_dev_signature':'',
            'auto_pm_github_control':'1', 'pm_publish_control':'1', 'pm_bounded_actions':'1'
        }.items():
            c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (key, value))

        defaults = [
            (1555, 'Diagnostics', 'test/1258-feedback-practice-diagnostics'),
            (1558, 'Saved filler counts', 'fix/1258-filler-count-after-finalize'),
            (1554, 'PDF saved transcript', ''),
            (1559, 'Coaching', 'fix/1258-coaching-failure-reason'),
        ]
        # Order is a release contract; these are unverified queue entries, never execution leases.
        for priority, (prn, title, branch) in enumerate(defaults):
            c.execute("INSERT OR IGNORE INTO work_items(item_key,priority,title,state,owner,branch,blocker,next_action,release_blocker,notes,updated_at,pr_number) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                      (f'PR-{prn}', priority, f'#{prn} {title}', 'waiting', 'unassigned', branch,
                       'Awaiting live GitHub / PM reconciliation', 'Read exact-head gates and current checkpoint', 1,
                       'Queue order recorded 2026-10-05; state requires live verification', now(), prn))
        for key, title, prn, priority, required in (
            ('FEEDBACK-FIX', 'Share Feedback plain-insert fix + HTTP proof', None, 4, 1),
            ('PR-1561', '#1561 Feedback/Practice correlated evidence (issue; PR pending)', None, 5, 1),
            ('PR-1560', '#1560 Focus navigation evidence', 1560, 6, 0),
        ):
            c.execute("INSERT OR IGNORE INTO work_items(item_key,priority,title,state,owner,blocker,next_action,release_blocker,notes,updated_at,pr_number) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                      (key, priority, title, 'waiting', 'unassigned', 'Awaiting checkpoint reconciliation',
                       'Read latest accepted packet/disposition in #1258', required,
                       'Accepted task registry; not evidence of execution or final qualification', now(), prn))
        for pid in ('po', 'cli_pm', 'cli_dev', 'app_dev', 'browser_pm'):
            c.execute("INSERT OR IGNORE INTO player_status(player_id,status,task,source,updated_at) VALUES(?,?,?,?,?)",
                      (pid, 'unknown', 'Awaiting verified checkpoint', 'board', now()))
        c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('release_order',?)", (json.dumps(RELEASE_ORDER),))
        # Old template rows remain as historical records; seeded placeholders are not live work.
        for key in ('R0-1549', 'R1-PROD-DIAG', 'R2-CAUSAL-FIX', 'R3-Q2', 'R4-V4', 'R5-FINAL-RWT'):
            row = c.execute("SELECT * FROM work_items WHERE item_key=?", (key,)).fetchone()
            if row and row['branch'] in ('isolated v4 worktrees', 'test/rwt-diagnostic-watchdog', 'test/rwt-browser-identity', ''):
                c.execute("UPDATE work_items SET release_blocker=0, priority=99, blocker='Historical template: verify checkpoint before assigning', updated_at=? WHERE item_key=?", (now(), key))

        for row in c.execute("SELECT item_key FROM work_items WHERE owner IN ('cli_dev','app_dev') "
                             "AND state IN ('active','in_progress','doing') AND lease_generation=''").fetchall():
            c.execute("UPDATE work_items SET lease_generation=? WHERE item_key=?", (uuid.uuid4().hex, row['item_key']))



def recover_interrupted_state_after_lock():
    """Reconcile in-flight claims only after this process owns both singleton locks."""
    if STATE_LOCK_FD is None or REPOSITORY_LOCK_FD is None:
        raise RuntimeError('Startup recovery requires the exclusive state and repository locks')
    with DB_LOCK, con() as c:
        stamp = now()
        c.execute("UPDATE packet_verifications SET status='pending',claim_until=0,next_attempt_at=0,updated_at=? WHERE status='running'", (stamp,))
        c.execute("UPDATE pm_action_journal SET status='unconfirmed', result='Process restarted mid-execution; resume/readback required',updated_at=? WHERE status='running'", (stamp,))
        # Queue claims are not actor invocations. After the old singleton is gone, a claim
        # without a launch attempt can be safely returned to the queue; invoked work remains
        # uncertain under the existing recovery path.
        c.execute("UPDATE queue SET status='queued',claim_token='',claimed_at=NULL WHERE status='claimed' AND launch_attempted_at IS NULL")
        c.execute("UPDATE agents SET status='idle',updated_at=? WHERE status='claimed'", (stamp,))
        # A delivering turn is ambiguous: repeating it could duplicate a side effect.
        # Preserve the unknown outcome and queue PM recovery rather than retrying Dev.
        c.execute(
            "UPDATE queue SET invocation_recovery_due=1 WHERE status IN ('running','delivering') "
            "AND recipient='dev' AND launch_attempted_at IS NOT NULL",
        )
        c.execute(
            "UPDATE queue SET status='failed_uncertain', "
            "error='Process restarted while delivery was in progress; explicit retry required', finished_at=? "
            "WHERE status IN ('running','delivering')",
            (stamp,),
        )


def get_setting(k, default=""):
    with DB_LOCK, con() as c:
        r = c.execute("SELECT value FROM settings WHERE key=?", (k,)).fetchone()
        return r["value"] if r else default


def set_setting(k, v):
    with DB_LOCK, con() as c:
        c.execute(
            "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (k, str(v)),
        )



def bool_setting(key, default=False):
    raw = get_setting(key, '1' if default else '0').strip().lower()
    return raw in ('1','true','yes','on')

def automation_settings():
    return {
        'pm_github_control': bool_setting('auto_pm_github_control', True),
        'pm_github_review': bool_setting('auto_pm_github_review', True),
        'pm_github_ci': bool_setting('auto_pm_github_ci', True),
        'pm_github_head': bool_setting('auto_pm_github_head', True),
        'pm_github_deploy': bool_setting('auto_pm_github_deploy', True),
        'dev_github': bool_setting('auto_dev_github', False),
        'dev_to_pm': bool_setting('auto_dev_to_pm', True),
        'pm_to_dev': bool_setting('auto_pm_to_dev', True),
        'watch_interval_seconds': max(5, int(get_setting('github_watch_interval', str(GITHUB_WATCH_INTERVAL)) or GITHUB_WATCH_INTERVAL)),
    }

def set_automation_settings(values):
    mapping = {
        'pm_github_control':'auto_pm_github_control',
        'pm_github_review':'auto_pm_github_review', 'pm_github_ci':'auto_pm_github_ci',
        'pm_github_head':'auto_pm_github_head', 'pm_github_deploy':'auto_pm_github_deploy',
        'dev_github':'auto_dev_github', 'dev_to_pm':'auto_dev_to_pm', 'pm_to_dev':'auto_pm_to_dev',
    }
    for public, internal in mapping.items():
        if public in values:
            set_setting(internal, '1' if bool(values[public]) else '0')
    if 'watch_interval_seconds' in values:
        try: sec=max(5,min(300,int(values['watch_interval_seconds'])))
        except Exception: sec=GITHUB_WATCH_INTERVAL
        set_setting('github_watch_interval', str(sec))
    return automation_settings()

def force_github_reconcile_on_start():
    """Force one PM reconciliation after every process start/restart.

    A persisted watcher snapshot is useful for history but must never suppress the
    first PM wake of a new board process; otherwise an already-actionable PR can
    sit idle until a human sends a manual sync message.
    """
    set_setting('github_watch_pr', '')
    set_setting('github_watch_snapshot', '')



def reset_ephemeral_control_state_on_start():
    """History survives restart; process activity does not. Preserve real writer ownership."""
    force_github_reconcile_on_start()
    set_setting('anti_idle_cli_dev_signature', '')
    set_setting('dev_assignment_reconciled', '0')
    with DB_LOCK, con() as c:
        c.execute("UPDATE agents SET status='idle', updated_at=? WHERE status='running'", (now(),))
        c.execute("UPDATE player_status SET status='unknown', task='Awaiting checkpoint reconciliation', blocker='Activity unverified after restart', source='startup', updated_at=?", (now(),))
        # No task owner is displaced: PM must explicitly checkpoint/release a preserved lease.
    add_activity('SYSTEM', 'Startup: preserved history and branch ownership; marked player activity unknown until reconciliation.', 'none', 'system')


def get_agent(agent_id="dev"):
    with DB_LOCK, con() as c:
        r = c.execute("SELECT * FROM agents WHERE agent_id=?", (agent_id,)).fetchone()
        return dict(r) if r else None


def configured_actor_route(actor_id):
    """Resolve a configured route, rejecting a Dev route that aliases the local Claude worker.

    The app-server route is an explicit actor mapping, but a stale mapping can still name
    the auxiliary Claude session used by the local process. That session is not the
    Codex writer holding the task lease, so fail closed before snapshotting or dispatch.
    """
    route = agent_transport.configured_route(actor_id)
    local_key = {'cli_dev': 'dev'}.get(actor_id)
    local = get_agent(local_key) if local_key else None
    if (local and route.session_id and local.get('session_id') == route.session_id
            and str(local.get('provider') or '').lower() != 'codex_app_server'):
        provider = str(local.get('provider') or 'unknown')
        raise agent_transport.RouteError(
            f"{actor_id} route points to session registered to the local {provider} worker; "
            "configure the actual Codex writer session")
    return route


def list_agents():
    with DB_LOCK, con() as c:
        return {r["agent_id"]: dict(r) for r in c.execute("SELECT * FROM agents").fetchall()}


def set_agent(agent_id="dev", **fields):
    fields["updated_at"] = now()
    ks = list(fields)
    vals = [fields[k] for k in ks] + [agent_id]
    with DB_LOCK, con() as c:
        c.execute("UPDATE agents SET " + ",".join(f"{k}=?" for k in ks) + " WHERE agent_id=?", vals)


def add_activity(actor, msg, route="none", status="posted", trigger_queue_id=None):
    with DB_LOCK, con() as c:
        cur = c.execute(
            "INSERT INTO activity(actor,message,route,status,created_at,trigger_queue_id) VALUES(?,?,?,?,?,?)",
            (actor, msg, route, status, now(), trigger_queue_id),
        )
        return cur.lastrowid


def add_attachment(aid, filename, path, size):
    with DB_LOCK, con() as c:
        c.execute(
            "INSERT INTO attachments(activity_id,filename,path,size_bytes,created_at) VALUES(?,?,?,?,?)",
            (aid, filename, str(path), size, now()),
        )


def enqueue(aid, recipient, content, *, source_actor="PO", parent_queue_id=None,
            handoff_depth=0, auto_handoff=True, fanout_group=None, work_item_key="", kind="", delivery_key="",
            task_action_id=""):
    """Queue one delivery. With a delivery_key the insert is atomic and idempotent (c5 F01): a replay
    after a crash returns the delivery that already landed instead of creating a second one."""
    target = _delivery_assignment(work_item_key, kind) if recipient == 'dev' else None
    frozen = {}
    frozen_path = ''
    if target:
        path = target.get('worktree') or find_branch_worktree(target.get('branch', '')) or get_agent('dev').get('cwd')
        frozen_path = path or ''
        if path:
            validated = validate_worktree(path)
            if (validated.get('exists') and validated.get('is_git') and validated.get('branch') == target.get('branch')
                    and validated.get('snapshot_stable', True)):
                try:
                    owned_paths = json.loads(target.get('owned_paths') or '[]')
                except (ValueError, TypeError):
                    owned_paths = []
                if not isinstance(owned_paths, list) or any(not isinstance(p, str) for p in owned_paths):
                    owned_paths = []
                dirty = set(validated.get('dirty_paths') or [])
                if _dirty_paths_owned(dirty, owned_paths):
                    frozen = validated
    with DB_LOCK, con() as c:
        cur = c.execute(
            "INSERT OR IGNORE INTO queue(activity_id,recipient,content,status,created_at,source_actor,parent_queue_id,"
            "handoff_depth,auto_handoff,fanout_group,attempts,kind,delivery_key,target_head,target_tree,"
            "target_repo_common_dir,target_origin,target_lease_generation,target_dirty_fingerprint,"
            "target_assignment_generation,task_action_id) VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?)",
            (
                aid, recipient, content, "queued", now(), source_actor, parent_queue_id,
                int(handoff_depth), 1 if auto_handoff else 0, fanout_group, kind, delivery_key,
                frozen.get('head', ''), frozen.get('tree', ''), frozen.get('repo_common_dir', ''),
                frozen.get('origin', ''), target.get('lease_generation', '') if target else '',
                frozen.get('dirty_fingerprint', ''), target.get('assignment_generation', '') if target else '',
                task_action_id,
            ),
        )
        if delivery_key and cur.rowcount == 0:
            prior = c.execute("SELECT id FROM queue WHERE delivery_key=?", (delivery_key,)).fetchone()
            if prior:
                return prior['id']
        qid = cur.lastrowid
        if target:
            c.execute("UPDATE queue SET work_item_key=?,target_branch=?,target_worktree=? WHERE id=?",
                      (target['item_key'], target['branch'], frozen_path, qid))
            if recipient == 'dev' and work_item_key:
                actor_id = str(target.get('owner') or '')
                try:
                    route = configured_actor_route(actor_id)
                    transport, session_id, remote_url = 'codex_app_server', route.session_id, route.remote_url
                except agent_transport.RouteError:
                    # Keep the task durable; dispatch will expose the exact missing route.
                    transport, session_id, remote_url = 'codex_app_server', '', ''
                c.execute("UPDATE queue SET target_actor_id=?,target_transport=?,target_session_id=?,target_remote_url=? WHERE id=?",
                          (actor_id, transport, session_id, remote_url, qid))
                if not task_action_id:
                    stable_action = str(delivery_key or f'queue:{qid}')
                    c.execute("UPDATE queue SET task_action_id=? WHERE id=?", (stable_action, qid))
        return qid


def list_activity(limit=250):
    with DB_LOCK, con() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM activity ORDER BY id DESC LIMIT ?", (limit,)).fetchall()]
        rows.reverse()
        atts = [dict(r) for r in c.execute("SELECT * FROM attachments").fetchall()]
        qrows = [dict(r) for r in c.execute(
            "SELECT id,activity_id,parent_queue_id,recipient,source_actor,status FROM queue ORDER BY id"
        ).fetchall()]
    amap = {}
    for a in atts:
        amap.setdefault(a["activity_id"], []).append(a)
    qmap = {}
    for q in qrows:
        qmap.setdefault(q["activity_id"], []).append(q)
    for r in rows:
        r["attachments"] = amap.get(r["id"], [])
        r["deliveries"] = qmap.get(r["id"], [])
    return rows


def list_queue(limit=100):
    with DB_LOCK, con() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM queue ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()]
    rows.reverse()
    for row in rows:
        row['age_seconds'] = age_seconds(row.get('finished_at') or row.get('started_at') or row.get('created_at'))
        row['historical'] = row['status'] in ('responded', 'failed', 'failed_uncertain')
        row['delivery_label'] = ('REPLY RETURNED — task completion unverified' if row['status'] == 'responded' else row['status'])
        if row.get('recipient') == 'dev' and row.get('work_item_key'):
            if row['status'] == 'queued':
                row['delivery_stage'] = 'ASSIGNED → QUEUED · Dev not invoked'
            elif row['status'] == 'awaiting_receipt':
                row['delivery_stage'] = (f"TASK QUEUED TO {row.get('target_actor_id') or 'configured actor'} "
                                         f"SESSION {str(row.get('target_session_id') or '')[:12]} · recipient receipt pending")
                row['delivery_label'] = 'TRANSPORT ACCEPTED — recipient pickup/action unverified'
            elif row['status'] == 'received':
                row['delivery_stage'] = f"TASK RECEIPT FROM {row.get('target_actor_id')} SESSION {str(row.get('target_session_id') or '')[:12]} · result pending"
                row['delivery_label'] = 'RECIPIENT RECEIVED — result pending'
            elif row['status'] == 'transport_uncertain':
                row['delivery_stage'] = 'TRANSPORT OUTCOME UNCERTAIN · no automatic retry'
                row['delivery_label'] = 'DELIVERY UNCERTAIN — reconcile the exact session before any new action'
            elif row['status'] == 'claimed':
                row['delivery_stage'] = 'ASSIGNED → QUEUED → CLAIMED · actor not invoked'
            elif row['status'] == 'delivering' and row.get('process_started_at'):
                row['delivery_stage'] = f"ASSIGNED → QUEUED → DEV PROCESS STARTED (pid {row.get('process_pid')}) · awaiting reply"
            elif row['status'] == 'delivering':
                row['delivery_stage'] = 'ASSIGNED → QUEUED → LAUNCH ATTEMPTED · process not yet confirmed'
            elif row['status'] == 'responded':
                if row.get('task_action_id'):
                    receipt = 'TASK RECEIPT REPORTED' if row.get('task_receipt_at') else 'TASK RECEIPT MISSING'
                    result = 'TASK RESULT REPORTED' if row.get('task_result_at') else 'TASK RESULT MISSING'
                    row['delivery_stage'] = f"TASK-AWARE · {receipt} → {result} · actor/session verified"
                else:
                    row['delivery_stage'] = 'DEV REPLY RETURNED · receipt/result recorded per handoff; PM review pending'
            elif row['status'].startswith('failed') and not row.get('started_at') and not int(row.get('attempts') or 0):
                row['delivery_stage'] = 'BLOCKED BEFORE DEV INVOCATION'
            elif row['status'] == 'failed_uncertain' and row.get('process_started_at'):
                row['delivery_stage'] = 'DEV PROCESS ENDED WITHOUT A RESULT · writes unknown; PM readback owed, no retry'
            elif row['status'].startswith('failed'):
                row['delivery_stage'] = 'DEV INVOCATION FAILED · inspect result/error'
            else:
                row['delivery_stage'] = str(row['status']).upper()
        else:
            row['delivery_stage'] = str(row['status']).upper()
        with con() as receipt_db:
            outbox = receipt_db.execute('SELECT status,comment_id FROM pm_outbox WHERE queue_id=?', (row['id'],)).fetchone()
            recovery = receipt_db.execute(
                "SELECT id,status FROM queue WHERE parent_queue_id=? AND recipient='pm' AND source_actor='SYSTEM' ORDER BY id LIMIT 1",
                (row['id'],),
            ).fetchone()
        if outbox and outbox['comment_id']:
            row['delivery_label'] = 'PUBLISHED — recipient action unverified'
            row['github_comment_id'] = outbox['comment_id']
        elif outbox and outbox['status'] == 'local_only':
            row['delivery_label'] = 'RECONCILED LOCALLY — no GitHub post'
        if recovery:
            row['recovery_action'] = f"PM recovery queued #{recovery['id']} ({recovery['status']}); no Dev retry"
        else:
            row['recovery_action'] = ('PM must inspect exact failure before retry' if row['status'].startswith('failed') else '')
    return rows


def list_work_items(limit=None):
    sql = "SELECT * FROM work_items ORDER BY priority, item_key"
    args = ()
    if limit is not None:
        sql += " LIMIT ?"
        args = (int(limit),)
    with DB_LOCK, con() as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


DEV_OWNERS = {"cli_dev", "app_dev"}
WRITE_STATES = {"active", "assigned", "in_progress", "writing"}
READ_ONLY_TASK_STATES = {"waiting", "review"}
READ_ONLY_TASK_ACTIONS = {"receipt", "checkpoint", "release"}
READ_ONLY_DELIVERY_KINDS = {f"readonly_{action}" for action in READ_ONLY_TASK_ACTIONS}


class UnsupportedRecipientTransport(RuntimeError):
    """The assigned actor has no supported route from this board instance."""


def block_delivery_for_transport(q, detail):
    """Keep an undelivered request durable without waking the wrong worker or retrying it."""
    if not q or q.get('recipient') != 'dev' or not q.get('task_action_id') or not q.get('target_actor_id'):
        return False
    message = str(detail or 'No supported transport to the assigned actor')[:1000]
    with DB_LOCK, con() as c:
        row = c.execute("SELECT status,process_started_at,task_receipt_at FROM queue WHERE id=?", (q['id'],)).fetchone()
        if not row or row['status'] not in ('claimed', 'queued', 'delivering') or row['process_started_at'] or row['task_receipt_at']:
            return False
        c.execute("UPDATE queue SET status='blocked_transport',error=?,finished_at=?,claim_token='',claimed_at=NULL WHERE id=?",
                  (message, now(), q['id']))
        c.execute("UPDATE agents SET status='idle',updated_at=? WHERE agent_id='dev' AND status IN ('claimed','idle')", (now(),))
    add_activity('SYSTEM', f"Task delivery #{q['id']} remains open: {message}", 'none', 'blocker',
                 trigger_queue_id=q['id'])
    aid = add_activity('SYSTEM', f"Task delivery {q.get('task_action_id')} to {q.get('target_actor_id')} is blocked before actor invocation: {message}",
                       'pm', 'blocker', trigger_queue_id=q['id'])
    enqueue(aid, 'pm', f"Task delivery {q.get('task_action_id')} is blocked before invocation. Exact actor/session: "
            f"{q.get('target_actor_id')}/{q.get('target_session_id') or 'unconfigured'}. Blocker: {message}. "
            "Recover routing only; do not create a second actor task.", source_actor='SYSTEM',
            parent_queue_id=q['id'], auto_handoff=True, delivery_key=f"agent-route-recovery:{q['id']}")
    return True

def _dev_lease_conflict(c, item_key, owner, branch, state):
    """Return a human-readable conflict if this update would create two active Dev writers.

    Blocked/waiting/ready items are not WRITE leases. This preserves work-stealing: a Dev
    can checkpoint an externally blocked item, mark it waiting/blocked, then actively claim
    another independent item.
    """
    owner = str(owner or "unassigned")
    branch = str(branch or "").strip()
    state = str(state or "").lower()
    if owner not in DEV_OWNERS or state not in WRITE_STATES:
        return None
    rows = c.execute(
        "SELECT item_key,owner,branch,state,title FROM work_items WHERE item_key<>?",
        (item_key,),
    ).fetchall()
    for r in rows:
        rstate = str(r["state"] or "").lower()
        if rstate not in WRITE_STATES:
            continue
        rowner = str(r["owner"] or "")
        rbranch = str(r["branch"] or "").strip()
        if rowner == owner:
            return f"{owner} already holds active WRITE lease {r['item_key']} ({r['title']})"
        if branch and rbranch and branch == rbranch and rowner in DEV_OWNERS:
            return f"branch {branch} already has active Dev writer {rowner} on {r['item_key']}"
    return None

def _lease_transfer_error(old, merged):
    """A Dev WRITE lease may MOVE to another tuple only after that tuple is verified on disk.

    First registration may name a not-yet-created worktree (dispatch is gated separately);
    moving an existing bound tuple to an unverified path is how #34/#36 lost their worker.
    """
    if not old or str(merged.get('owner') or '') not in DEV_OWNERS:
        return None
    if str(merged.get('state') or '').lower() not in WRITE_STATES:
        return None
    old_wt, new_wt = str(old['worktree'] or '').strip(), str(merged.get('worktree') or '').strip()
    old_br, new_br = str(old['branch'] or '').strip(), str(merged.get('branch') or '').strip()
    if not old_wt or not new_wt or (old_wt == new_wt and old_br == new_br):
        return None
    v = validate_worktree(new_wt)
    if not v.get('exists') or not v.get('is_git') or v.get('branch') != new_br:
        return (f"lease transfer to unverified tuple {new_br or '?'} @ {new_wt} "
                f"(exists={bool(v.get('exists'))}, git={bool(v.get('is_git'))}, branch={v.get('branch')}); "
                "bootstrap and verify the checkout first")
    return None


def _owned_paths_json(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError as exc:
            raise ValueError('owned_paths must be a JSON array of repository-relative paths') from exc
    if not isinstance(value, list) or any(not isinstance(p, str) or not p or p == '.' or Path(p).is_absolute()
                                           or '..' in Path(p).parts or '\0' in p for p in value):
        raise ValueError('owned_paths must contain only safe repository-relative paths')
    return json.dumps(sorted(set(value)), ensure_ascii=False)


def _dirty_paths_owned(dirty, owned):
    return all(any(path == root or path.startswith(root.rstrip('/') + '/') for root in owned)
               for path in dirty)


def update_work_item(item_key, **fields):
    allowed = {"priority","title","state","owner","branch","blocker","blocker_since","next_action","po_required","release_blocker","notes","pr_number","worktree","owned_paths"}
    clean = {k:v for k,v in fields.items() if k in allowed}
    if not clean:
        return None
    if 'owned_paths' in clean:
        clean['owned_paths'] = _owned_paths_json(clean['owned_paths'])
    with DB_LOCK, con() as c:
        old = c.execute("SELECT * FROM work_items WHERE item_key=?", (item_key,)).fetchone()
        if not old:
            raise ValueError(f"unknown work item {item_key}")
        merged = dict(old)
        merged.update(clean)
        conflict = _dev_lease_conflict(c, item_key, merged.get("owner"), merged.get("branch"), merged.get("state"))
        if conflict:
            raise ValueError("WRITE lease conflict: " + conflict)
        transfer = _lease_transfer_error(old, merged)
        if transfer:
            raise ValueError("WRITE lease transfer rejected: " + transfer)
        if "blocker" in clean and "blocker_since" not in clean and old["blocker"] != str(clean["blocker"]):
            clean["blocker_since"] = now() if str(clean['blocker'] or '') else None
        identity_fields = ('owner', 'state', 'branch', 'worktree', 'owned_paths')
        if any(k in clean and str(old[k] or '') != str(clean[k] or '') for k in identity_fields):
            if merged.get('owner') in DEV_OWNERS and merged.get('state') in WRITE_STATES:
                clean['lease_generation'] = uuid.uuid4().hex
            if old['bootstrap_state'] == 'verified':
                clean.update(bootstrap_state='required', bootstrap_verified_at=None,
                             bootstrap_verified_head='', bootstrap_verified_tree='')
        if any(k in clean and str(old[k] or '') != str(clean[k] or '')
               for k in ('owner', 'branch', 'worktree', 'owned_paths')):
            clean['assignment_generation'] = uuid.uuid4().hex
        clean["updated_at"] = now()
        ks = list(clean)
        vals = [clean[k] for k in ks] + [item_key]
        c.execute("UPDATE work_items SET " + ",".join(f"{k}=?" for k in ks) + " WHERE item_key=?", vals)
    return None


def list_player_status():
    with DB_LOCK, con() as c:
        return {r["player_id"]: dict(r) for r in c.execute("SELECT * FROM player_status").fetchall()}


def update_player_status(player_id, **fields):
    allowed = {"status","task","work_item_key","blocker","holding","source"}
    clean = {k:v for k,v in fields.items() if k in allowed}
    if not clean:
        return
    clean["updated_at"] = now()
    ks = list(clean)
    vals = [clean[k] for k in ks] + [player_id]
    with DB_LOCK, con() as c:
        c.execute("UPDATE player_status SET " + ",".join(f"{k}=?" for k in ks) + " WHERE player_id=?", vals)


def apply_board_updates(updates):
    """Stage the entire PM patch and validate final leases before one commit."""
    if not isinstance(updates, dict):
        return True
    try:
        with DB_LOCK, con() as c:
            touched = []
            for item in updates.get('work_items') or []:
                if not isinstance(item, dict) or not item.get('item_key'):
                    raise ValueError('work item requires item_key')
                key = str(item['item_key'])
                allowed = {'priority','title','state','owner','branch','worktree','pr_number','blocker','blocker_since','next_action','po_required','release_blocker','notes','owned_paths'}
                clean = {k:v for k,v in item.items() if k in allowed and v is not None}
                if 'owned_paths' in clean:
                    clean['owned_paths'] = _owned_paths_json(clean['owned_paths'])
                old = c.execute('SELECT * FROM work_items WHERE item_key=?', (key,)).fetchone()
                if old is not None:
                    transfer = _lease_transfer_error(old, dict(dict(old), **clean))
                    if transfer:
                        raise ValueError(f'{key}: WRITE lease transfer rejected: {transfer}')
                if old is None:
                    c.execute("INSERT INTO work_items(item_key,priority,title,state,owner,updated_at) VALUES(?,?,?,?,?,?)",
                              (key, 99, key, 'waiting', 'unassigned', now()))
                if old is None:
                    old = c.execute('SELECT * FROM work_items WHERE item_key=?', (key,)).fetchone()
                identity_fields = ('owner', 'state', 'branch', 'worktree', 'owned_paths')
                if any(k in clean and str(old[k] or '') != str(clean[k] or '') for k in identity_fields):
                    resulting_owner = clean.get('owner', old['owner'])
                    resulting_state = clean.get('state', old['state'])
                    if resulting_owner in DEV_OWNERS and resulting_state in WRITE_STATES:
                        clean['lease_generation'] = uuid.uuid4().hex
                    if old['bootstrap_state'] == 'verified':
                        clean.update(bootstrap_state='required', bootstrap_verified_at=None,
                                     bootstrap_verified_head='', bootstrap_verified_tree='')
                if any(k in clean and str(old[k] or '') != str(clean[k] or '')
                       for k in ('owner', 'branch', 'worktree', 'owned_paths')):
                    clean['assignment_generation'] = uuid.uuid4().hex
                if 'blocker' in clean:
                    prior_blocker = str(old['blocker'] or '')
                    next_blocker = str(clean['blocker'] or '')
                    if next_blocker == prior_blocker:
                        # Repeated PM checkpoints do not make an old blocker look new.
                        clean['blocker_since'] = old['blocker_since']
                    else:
                        # The board owns blocker age; only a changed non-empty
                        # blocker starts a new clock, and clearing it clears the clock.
                        clean['blocker_since'] = now() if next_blocker else None
                clean['updated_at'] = now()
                c.execute('UPDATE work_items SET ' + ','.join(f'{k}=?' for k in clean) + ' WHERE item_key=?', list(clean.values()) + [key])
                touched.append(key)
            for key in touched:
                item = c.execute('SELECT * FROM work_items WHERE item_key=?', (key,)).fetchone()
                conflict = _dev_lease_conflict(c, key, item['owner'], item['branch'], item['state'])
                if conflict:
                    raise ValueError(f'{key}: WRITE lease conflict: {conflict}')
            for player in updates.get('players') or []:
                if not isinstance(player, dict) or player.get('player_id') not in ('po','cli_pm','cli_dev','app_dev','browser_pm'):
                    raise ValueError('invalid player_id')
                pid = player['player_id']
                clean = {k:v for k,v in player.items() if k in {'status','task','work_item_key','blocker','holding','source'} and v is not None}
                old = c.execute('SELECT * FROM player_status WHERE player_id=?', (pid,)).fetchone()
                previous = dict(old or {})
                merged = dict(previous)
                merged.update(clean)
                key = merged.get('work_item_key')
                if key:
                    wi = c.execute('SELECT * FROM work_items WHERE item_key=?', (key,)).fetchone()
                    if wi is None or (pid in DEV_OWNERS and wi['owner'] != pid):
                        raise ValueError(f'{pid}: task ownership does not match {key}')
                stamp = player.get('checkpoint_at')
                if stamp is not None:
                    dt = datetime.fromisoformat(str(stamp).replace('Z', '+00:00'))
                    if dt.tzinfo is None or dt.timestamp() > time.time() + 60:
                        raise ValueError('checkpoint timestamp must be timezone-aware and not in the future')
                    checkpoint_at = dt.astimezone(timezone.utc).isoformat()
                    prior_at = str(previous.get('checkpoint_at') or '')
                    if prior_at and checkpoint_at < prior_at:
                        raise ValueError(f'{pid}: stale checkpoint {checkpoint_at} is older than accepted attribution {prior_at}')
                    if prior_at and checkpoint_at == prior_at:
                        prior_values = {k: previous.get(k) for k in clean if k != 'updated_at'}
                        incoming_values = {k: v for k, v in clean.items() if k != 'updated_at'}
                        if prior_values != incoming_values:
                            raise ValueError(f'{pid}: conflicting checkpoint reuses accepted timestamp {checkpoint_at}')
                        continue  # exact duplicate receipt: preserve attribution and its original source
                    clean['checkpoint_at'] = checkpoint_at
                    clean['updated_at'] = checkpoint_at
                else:
                    clean['updated_at'] = now()
                c.execute('UPDATE player_status SET ' + ','.join(f'{k}=?' for k in clean) + ' WHERE player_id=?', list(clean.values()) + [pid])
            if any(c.execute("SELECT owner,state FROM work_items WHERE item_key=?", (key,)).fetchone()['owner'] == 'cli_dev' and c.execute("SELECT state FROM work_items WHERE item_key=?", (key,)).fetchone()['state'] in WRITE_STATES for key in touched):
                c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('dev_assignment_reconciled','1')")
        return True
    except (ValueError, sqlite3.Error) as e:
        add_activity('SYSTEM', f'Rejected board update atomically: {e}', 'none', 'error')
        return False


def dev_assignment(item_key=''):
    items = list_work_items()
    if item_key:
        return next((x for x in items if x['item_key'] == item_key and x['owner'] == 'cli_dev' and x['state'] in WRITE_STATES), None)
    candidates = [x for x in items if x['owner'] == 'cli_dev' and x['state'] in WRITE_STATES]
    return candidates[0] if len(candidates) == 1 else None


def _delivery_assignment(item_key, kind=''):
    """Resolve the exact task owner for either a WRITE lease or a typed read-only checkpoint."""
    if not item_key:
        return None
    if kind in READ_ONLY_DELIVERY_KINDS:
        item = next((x for x in list_work_items() if x['item_key'] == item_key), None)
        if not item or item.get('owner') != 'cli_dev':
            return None
        return item if str(item.get('state') or '').lower() in READ_ONLY_TASK_STATES else None
    return dev_assignment(item_key)


def find_branch_worktree(branch):
    try:
        proc = subprocess.run(['git','-C',BASE_REPO,'worktree','list','--porcelain'],
                              capture_output=True,text=True,timeout=5)
        if proc.returncode != 0:
            return None
        for block in proc.stdout.split('\n\n'):
            lines = dict(line.split(' ',1) for line in block.splitlines() if ' ' in line)
            if lines.get('branch') == 'refs/heads/' + branch:
                return lines.get('worktree')
    except (OSError, subprocess.TimeoutExpired):
        pass
    return None


def resolve_dev_target(q):
    """Only the assigned task can choose a Dev worktree. Dashboard selection is irrelevant."""
    readonly = q.get('kind') in READ_ONLY_DELIVERY_KINDS
    if not readonly and get_setting('dev_assignment_reconciled', '0') != '1':
        return {'ok': False, 'error': 'CLI Dev assignment needs a fresh PM checkpoint after startup'}
    item = _delivery_assignment(q.get('work_item_key') or '', q.get('kind') or '')
    if not item or not item.get('branch'):
        state_hint = 'waiting/review' if readonly else 'active WRITE'
        return {'ok': False, 'error': f'CLI Dev delivery needs an owned {state_hint} task with an explicit branch/worktree; ask PM to bind it'}
    if q.get('target_branch') and q['target_branch'] != item['branch']:
        return {'ok': False, 'error': 'Delivery branch changed after enqueue; request a new task handoff'}
    if q.get('target_worktree') and item.get('worktree') and q['target_worktree'] != item.get('worktree'):
        return {'ok': False, 'error': 'Delivery worktree changed after enqueue; request a new task handoff'}
    path = item.get('worktree')
    if not path:
        path = find_branch_worktree(item['branch']) or get_agent('dev').get('cwd')
    if not path:
        return {'ok': False, 'error': 'Assigned task has no local worktree; PM must supply its worktree path'}
    if q.get('target_worktree') and q.get('id') is not None and q['target_worktree'] != path:
        return {'ok': False, 'error': 'Resolved checkout path changed after enqueue; issue a fresh authorized handoff'}
    v = validate_worktree(path)
    if not v.get('exists'):
        return {'ok': False, 'error': f"Assigned task worktree is missing: expected branch '{item['branch']}' at '{path}'; bootstrap must finish before Dev dispatch", 'validation': v}
    if not v.get('is_git'):
        return {'ok': False, 'error': f"Assigned task path is not a Git worktree: expected branch '{item['branch']}' at '{path}'", 'validation': v}
    if v.get('branch') != item['branch']:
        return {'ok': False, 'error': f"Assigned worktree branch mismatch: expected '{item['branch']}' at '{path}', found '{v.get('branch')}' at HEAD {v.get('head')}", 'validation': v}
    if item.get('bootstrap_state') == 'verified':
        verified_head = str(item.get('bootstrap_verified_head') or '')
        verified_tree = str(item.get('bootstrap_verified_tree') or '')
        observed_head = str(v.get('head') or '')
        observed_tree = str(v.get('tree') or '')
        if (not v.get('snapshot_stable', True) or not verified_head or not verified_tree
                or observed_head != verified_head or observed_tree != verified_tree):
            # A receipt is bound to the checkout identity observed at bootstrap. A
            # same-path HEAD/tree change invalidates that proof and must stop this
            # dispatch; only a later exact queued readback can establish it again.
            with DB_LOCK, con() as c:
                c.execute("UPDATE work_items SET bootstrap_state='required',bootstrap_verified_at=NULL,"
                          "bootstrap_verified_head='',bootstrap_verified_tree='' WHERE item_key=? "
                          "AND bootstrap_state='verified' AND bootstrap_verified_head=? AND bootstrap_verified_tree=?",
                          (item['item_key'], verified_head, verified_tree))
            return {'ok': False,
                    'error': ('Bootstrap verification is stale: assigned checkout HEAD/tree changed or could not be '
                              'read as a stable snapshot; stale receipt cleared, fresh exact checkout verification required'),
                    'validation': v}
    # A queued delivery owns an immutable checkout/lease tuple. It may not silently
    # adopt a newer HEAD or a reassigned work item when a worker finally wakes.
    if q.get('id') is not None:
        if not q.get('target_head') or not q.get('target_tree') or not q.get('target_repo_common_dir') or not q.get('target_origin'):
            return {'ok': False, 'error': 'Delivery has no verified checkout snapshot from enqueue; issue a fresh handoff after checkout verification'}
        if readonly:
            if not q.get('task_action_id'):
                return {'ok': False, 'error': 'Read-only task delivery has no stable action identity'}
            if q.get('target_assignment_generation') != item.get('assignment_generation'):
                return {'ok': False, 'error': 'Task assignment changed after read-only delivery enqueue; issue a fresh authorized handoff'}
        elif q.get('target_lease_generation') != item.get('lease_generation'):
            return {'ok': False, 'error': 'WRITE lease generation changed after enqueue; issue a fresh authorized handoff'}
        if v.get('head') != q.get('target_head') or v.get('tree') != q.get('target_tree'):
            return {'ok': False, 'error': 'Checkout HEAD/tree changed after enqueue; issue a fresh authorized handoff'}
        if not v.get('snapshot_stable', True):
            return {'ok': False, 'error': 'Checkout changed while its tuple was being verified; issue a fresh handoff'}
        if v.get('repo_common_dir') != q.get('target_repo_common_dir') or v.get('origin') != q.get('target_origin'):
            return {'ok': False, 'error': 'Checkout repository identity changed after enqueue; issue a fresh authorized handoff'}
        if _origin_repo_identity(v.get('origin')) != 'relativitye/speaksharp':
            return {'ok': False, 'error': 'Checkout origin is not the authorized SpeakSharp repository'}
        expected_common = _git_common_dir(BASE_REPO)
        if expected_common and v.get('repo_common_dir') != expected_common:
            return {'ok': False, 'error': 'Checkout Git common directory is not the authorized SpeakSharp repository'}
        try:
            owned_paths = json.loads(item.get('owned_paths') or '[]')
        except (ValueError, TypeError):
            return {'ok': False, 'error': 'Task owned-path manifest is invalid; rebind through PM before dispatch'}
        if not isinstance(owned_paths, list) or any(not isinstance(p, str) for p in owned_paths):
            return {'ok': False, 'error': 'Task owned-path manifest is invalid; rebind through PM before dispatch'}
        dirty = set(v.get('dirty_paths') or [])
        if not _dirty_paths_owned(dirty, owned_paths):
            return {'ok': False, 'error': 'Checkout has dirty paths outside the task-owned path list'}
        if v.get('dirty_fingerprint', '') != q.get('target_dirty_fingerprint', ''):
            return {'ok': False, 'error': 'Task-owned checkout edits changed after enqueue; issue a fresh authorized handoff'}
    if q.get('target_head') and v.get('head') != q['target_head']:
        return {'ok': False, 'error': 'Worktree head changed after dispatch; explicit new handoff required'}
    # Bootstrap completion is a durable phase transition, not an inference from a PM
    # message or a worker receipt. It requires the newly queued immutable tuple to pass
    # the full repository, lease, head/tree and dirty-path checks above.
    if item.get('bootstrap_state') == 'required' and q.get('id') is not None:
        with DB_LOCK, con() as c:
            c.execute("UPDATE work_items SET bootstrap_state='verified',bootstrap_verified_at=?,"
                      "bootstrap_verified_head=?,bootstrap_verified_tree=? "
                      "WHERE item_key=? AND bootstrap_state='required'",
                      (now(), v.get('head') or '', v.get('tree') or '', item['item_key']))
    return {'ok': True, 'path': path, 'item_key': item['item_key'], 'validation': v}


def age_seconds(ts):
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return max(0, int((datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds()))
    except Exception:
        return None


def next_queue(recipient=None):
    """Atomically claim the highest-priority queued delivery for one idle agent.

    PO instructions always outrank machine events. PM/Dev handoffs outrank raw
    GitHub watcher events. FIFO is preserved inside a priority class. The claim
    closes the select-then-invoke race; startup returns only uninvoked claims.
    """
    where = "q.status='queued' AND a.paused=0 AND a.status IN ('idle','available') AND q.available_after<=?"
    args = [time.time()]
    if recipient:
        where += " AND q.recipient=?"
        args.append(recipient)
    priority = (
        "CASE "
        "WHEN q.source_actor='PO' THEN 0 "
        "WHEN q.source_actor IN ('PM','DEV') THEN 1 "
        "WHEN q.source_actor='GITHUB' THEN 3 "
        "ELSE 2 END"
    )
    with DB_LOCK, con() as c:
        r = c.execute(
            "SELECT q.* FROM queue q JOIN agents a ON a.agent_id=q.recipient "
            f"WHERE {where} ORDER BY {priority}, q.id LIMIT 1",
            args,
        ).fetchone()
        if not r:
            return None
        token = uuid.uuid4().hex
        stamp = now()
        claimed = c.execute("UPDATE queue SET status='claimed',claim_token=?,claimed_at=? WHERE id=? AND status='queued'",
                            (token, stamp, r['id']))
        if claimed.rowcount != 1:
            return None
        agent_claimed = c.execute("UPDATE agents SET status='claimed',updated_at=? WHERE agent_id=? AND status IN ('idle','available') AND paused=0",
                                  (stamp, r['recipient']))
        if agent_claimed.rowcount != 1:
            c.execute("UPDATE queue SET status='queued',claim_token='',claimed_at=NULL WHERE id=? AND claim_token=?",
                      (r['id'], token))
            return None
        row = c.execute("SELECT * FROM queue WHERE id=?", (r['id'],)).fetchone()
        return dict(row)


def release_uninvoked_claim(q):
    """Return a claimed-but-not-launched delivery to FIFO when its worker cannot start it."""
    if not q or q.get('status') != 'claimed' or not q.get('claim_token'):
        return False
    with DB_LOCK, con() as c:
        row = c.execute("SELECT status,claim_token,launch_attempted_at,recipient FROM queue WHERE id=?", (q['id'],)).fetchone()
        if (not row or row['status'] != 'claimed' or row['claim_token'] != q['claim_token']
                or row['launch_attempted_at'] is not None):
            return False
        changed = c.execute("UPDATE queue SET status='queued',claim_token='',claimed_at=NULL WHERE id=? AND status='claimed' AND claim_token=?",
                            (q['id'], q['claim_token']))
        if changed.rowcount == 1:
            c.execute("UPDATE agents SET status='idle',updated_at=? WHERE agent_id=? AND status='claimed'",
                      (now(), row['recipient']))
            return True
        return False


def update_queue(qid, **fields):
    ks = list(fields)
    vals = [fields[k] for k in ks] + [qid]
    with DB_LOCK, con() as c:
        c.execute("UPDATE queue SET " + ",".join(f"{k}=?" for k in ks) + " WHERE id=?", vals)


def gh_cli_call_has_one_known_request(args):
    """Reject gh modes that can paginate or fan out behind one reservation."""
    if not isinstance(args, (list, tuple)) or not args:
        return False
    args = list(args)
    if args[0] == 'api':
        return not any(str(arg) == '--paginate' or str(arg).startswith('--paginate=') for arg in args[1:])
    if len(args) >= 2 and args[0:2] == ['pr', 'view']:
        return True  # gh pr view is one GraphQL read; no list/pagination path.
    if len(args) >= 2 and args[0:2] == ['pr', 'list']:
        if any(str(arg) in ('--search', '-S') for arg in args[2:]):
            return False  # Search mode has a separate multi-request implementation.
        limit = 30
        for index, arg in enumerate(args[2:], start=2):
            arg = str(arg)
            if arg.startswith('--limit='):
                try:
                    limit = int(arg.split('=', 1)[1])
                except ValueError:
                    return False
            elif arg in ('--limit', '-L'):
                try:
                    limit = int(args[index + 1])
                except (IndexError, TypeError, ValueError):
                    return False
        # One GraphQL page can contain at most 100; larger caps require explicit page reads.
        return 1 <= limit <= 100
    return False


def gh_json(args):
    global GH_BACKOFF_UNTIL
    if not gh_cli_call_has_one_known_request(args):
        return None, 'GitHub CLI operation is not covered by a single-request budget adapter'
    backoff_until = github_backoff_until()
    if time.time() < backoff_until:
        return None, 'GitHub rate-limit backoff until ' + datetime.fromtimestamp(backoff_until, timezone.utc).isoformat()
    budget_ok, budget_state = reserve_github_request_budget()
    if not budget_ok:
        return None, f"Shared GitHub request budget exhausted ({budget_state['used']}/{budget_state['limit']}); resumes at {budget_state['reset_at']}"
    try:
        p = subprocess.run(["gh"] + args, capture_output=True, text=True, timeout=20)
        if p.returncode != 0:
            error = p.stderr.strip() or p.stdout.strip()
            if re.search(r'rate limit|secondary rate|abuse detection|HTTP 429', error, re.I):
                _record_github_rate_limit()
            return None, error
        return json.loads(p.stdout or "null"), None
    except Exception as e:
        return None, str(e)


def bounded_github_list(request, path, max_pages=MAX_REVIEW_PAGES):
    """Read a complete bounded API list; a full last page is an explicit incomplete read."""
    rows = []
    for page_no in range(1, max_pages + 1):
        separator = '&' if '?' in path else '?'
        obj = request(['api', f'{path}{separator}per_page=100&page={page_no}'])
        # Accept the prior gh --paginate --slurp shape during transition, but normalize
        # before applying completeness checks.
        if isinstance(obj, list) and len(obj) == 1 and isinstance(obj[0], list):
            obj = obj[0]
        if not isinstance(obj, list):
            return None, f'GitHub list returned {type(obj).__name__}, expected an array'
        rows.extend(x for x in obj if isinstance(x, dict))
        if len(obj) < 100:
            return rows, None
    return None, f'GitHub list exceeded the bounded {max_pages}-page read; completeness not established'


def bounded_github_object_list(request, path, field, max_pages=MAX_REVIEW_PAGES):
    """Read a bounded paginated array nested in a REST response object."""
    rows = []
    for page_no in range(1, max_pages + 1):
        separator = '&' if '?' in path else '?'
        obj = request(['api', f'{path}{separator}per_page=100&page={page_no}'])
        if not isinstance(obj, dict) or not isinstance(obj.get(field), list):
            return None, f'GitHub object list returned an invalid {field} page'
        page = obj[field]
        rows.extend(x for x in page if isinstance(x, dict))
        if len(page) < 100:
            return rows, None
    return None, f'GitHub object list exceeded the bounded {max_pages}-page read; completeness not established'


def github_action_runs(repo, branch):
    """Read one explicit, capped Actions page without gh's hidden workflow-name lookups."""
    query = 'per_page=30'
    if branch:
        query += '&branch=' + quote(str(branch), safe='')
    obj, error = gh_json(['api', f'repos/{repo}/actions/runs?{query}'])
    if error:
        return None, error
    if not isinstance(obj, dict) or not isinstance(obj.get('workflow_runs'), list):
        return None, 'GitHub Actions run list returned an invalid response'
    runs = []
    for run in obj['workflow_runs']:
        if not isinstance(run, dict):
            continue
        runs.append({
            'databaseId': run.get('id'),
            'workflowDatabaseId': run.get('workflow_id'),
            'workflowName': run.get('name') or '',
            'attempt': run.get('run_attempt'),
            'status': run.get('status'),
            'conclusion': run.get('conclusion'),
            'headSha': run.get('head_sha'),
            'createdAt': run.get('created_at'),
            'updatedAt': run.get('updated_at'),
            'event': run.get('event'),
        })
    # `per_page=30` is a hard first-page cap; never follow an unmetered Link header.
    return runs, None


def github_action_run_detail(repo, run_id, attempt):
    """Read one run attempt and a bounded, individually-budgeted set of job pages."""
    attempt_path = f'repos/{repo}/actions/runs/{int(run_id)}/attempts/{int(attempt)}'
    run, error = gh_json(['api', attempt_path])
    if error:
        return None, error
    if not isinstance(run, dict):
        return None, 'GitHub Actions run detail returned an invalid response'
    try:
        jobs, jobs_error = bounded_github_object_list(
            _pm_request, f'{attempt_path}/jobs', 'jobs', max_pages=MAX_REVIEW_PAGES)
    except Exception as exc:
        return None, str(exc)[:400]
    if jobs_error:
        return None, jobs_error
    return {
        'databaseId': run.get('id'),
        'attempt': run.get('run_attempt'),
        'status': run.get('status'),
        'conclusion': run.get('conclusion'),
        'headSha': run.get('head_sha'),
        'jobs': jobs,
    }, None


def github_backoff_until():
    """The read/write budget survives board restart and applies to every GitHub adapter."""
    try:
        persisted = float(get_setting('github_backoff_until', '0') or 0)
    except (ValueError, TypeError):
        persisted = 0.0
    return max(float(GH_BACKOFF_UNTIL or 0), persisted)


def github_request_budget_state():
    """Return the SQLite-shared request window used by watcher, PM, packet and UI readers."""
    now_epoch = time.time()
    window = int(now_epoch // GH_REQUEST_WINDOW_SECONDS)
    try:
        raw = json.loads(get_setting('github_request_budget', '{}') or '{}')
    except (ValueError, TypeError):
        raw = {'corrupt': True}
    used = _request_budget_used(raw, window)
    reset_epoch = (window + 1) * GH_REQUEST_WINDOW_SECONDS
    return {'window': window, 'used': used, 'limit': GH_REQUEST_BUDGET_PER_WINDOW,
            'reset_at': datetime.fromtimestamp(reset_epoch, timezone.utc).isoformat(),
            'remaining': max(0, GH_REQUEST_BUDGET_PER_WINDOW - used)}


def _request_budget_used(raw, window):
    if raw is None or raw == {}:
        return 0
    if not isinstance(raw, dict):
        return GH_REQUEST_BUDGET_PER_WINDOW
    try:
        saved_window = int(raw['window'])
        used = int(raw['used'])
    except (KeyError, ValueError, TypeError):
        return GH_REQUEST_BUDGET_PER_WINDOW
    if used < 0:
        return GH_REQUEST_BUDGET_PER_WINDOW
    return min(used, GH_REQUEST_BUDGET_PER_WINDOW) if saved_window == window else 0


def reserve_github_request_budget(cost=1):
    """Atomically reserve from one cross-thread/cross-process SQLite request window."""
    cost = max(1, int(cost))
    now_epoch = time.time()
    window = int(now_epoch // GH_REQUEST_WINDOW_SECONDS)
    reset_epoch = (window + 1) * GH_REQUEST_WINDOW_SECONDS
    with DB_LOCK, con() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute("SELECT value FROM settings WHERE key='github_request_budget'").fetchone()
        try:
            previous = json.loads(row['value']) if row else {}
        except (ValueError, TypeError):
            previous = {'corrupt': True}
        used = _request_budget_used(previous, window)
        if used + cost > GH_REQUEST_BUDGET_PER_WINDOW:
            state = {'window': window, 'used': used, 'limit': GH_REQUEST_BUDGET_PER_WINDOW,
                     'reset_at': datetime.fromtimestamp(reset_epoch, timezone.utc).isoformat(),
                     'remaining': max(0, GH_REQUEST_BUDGET_PER_WINDOW - used)}
            c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('github_request_budget',?)",
                      (json.dumps(state, sort_keys=True),))
            return False, state
        used += cost
        state = {'window': window, 'used': used, 'limit': GH_REQUEST_BUDGET_PER_WINDOW,
                 'reset_at': datetime.fromtimestamp(reset_epoch, timezone.utc).isoformat(),
                 'remaining': max(0, GH_REQUEST_BUDGET_PER_WINDOW - used)}
        c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('github_request_budget',?)",
                  (json.dumps(state, sort_keys=True),))
        return True, state


class GithubReadError(RuntimeError):
    def __init__(self, kind, message):
        super().__init__(message)
        self.kind = kind


def _record_github_rate_limit():
    global GH_BACKOFF_UNTIL
    GH_BACKOFF_UNTIL = time.time() + 900
    try:
        # This reset lookup consumes the same shared budget; if there is no
        # capacity, retain the conservative fallback backoff without probing.
        budget_ok, _ = reserve_github_request_budget()
        if budget_ok:
            rate = subprocess.run(['gh', 'api', 'rate_limit'], capture_output=True, text=True, timeout=10)
            resources = json.loads(rate.stdout).get('resources', {}) if rate.returncode == 0 else {}
            resets = [float(x['reset']) + 5 for x in resources.values() if x.get('remaining') == 0 and x.get('reset')]
            if resets:
                GH_BACKOFF_UNTIL = max(time.time() + 60, max(resets))
    except Exception:
        pass
    set_setting('github_backoff_until', str(GH_BACKOFF_UNTIL))


def _github_read_failure(stderr, returncode):
    message = (stderr or b'').decode(errors='replace')[:500]
    if re.search(r'rate limit|secondary rate|abuse detection|HTTP 429', message, re.I):
        return GithubReadError('rate_limited', message or f'GitHub CLI exited {returncode}')
    if re.search(r'HTTP 404|Not Found|\b404\b', message, re.I):
        return FileNotFoundError(message or 'GitHub object not found')
    if re.search(r'HTTP 401|HTTP 403|Bad credentials|requires authentication', message, re.I):
        return GithubReadError('authorization', message or f'GitHub CLI exited {returncode}')
    return GithubReadError('transport', message or f'GitHub CLI exited {returncode}')


def post_control_issue_comment(message):
    repo = repo_slug(BASE_REPO)
    if not repo:
        return False, "Could not determine GitHub repository"
    _obj, err = gh_json([
        "api", "-X", "POST", f"repos/{repo}/issues/{CONTROL_ISSUE}/comments",
        "-f", f"body={message}",
    ])
    return err is None, err


def repo_slug(cwd):
    try:
        p = subprocess.run(["git", "-C", cwd, "remote", "get-url", "origin"], capture_output=True, text=True, timeout=5)
        s = p.stdout.strip()
        if s.endswith(".git"):
            s = s[:-4]
        if "github.com:" in s:
            return s.split("github.com:", 1)[1]
        if "github.com/" in s:
            return s.split("github.com/", 1)[1]
    except Exception:
        pass
    return "relativityE/speaksharp"


def pr_worktree_path(pr_number):
    base = Path(BASE_REPO)
    return str(base.parent / f"{base.name}-pr-{int(pr_number)}")


def safe_link(target, link):
    link = Path(link)
    target = Path(target)
    if link.exists() or link.is_symlink():
        return
    if target.exists():
        link.symlink_to(target)


def ensure_pr_worktree(pr):
    """Ensure one dedicated clean worktree for the explicitly selected Current PR."""
    if not pr or not pr.get("number") or not pr.get("headRefOid"):
        return {"ok": False, "error": "Current PR does not have a resolvable number/head."}

    base = Path(BASE_REPO)
    if not base.exists():
        return {"ok": False, "error": f"Base repo not found: {BASE_REPO}"}

    prn = int(pr["number"])
    head = pr["headRefOid"]
    wt = Path(pr_worktree_path(prn))

    fetch = subprocess.run(["git", "-C", str(base), "fetch", "origin"], capture_output=True, text=True, timeout=60)
    if fetch.returncode != 0:
        return {"ok": False, "error": fetch.stderr.strip() or "git fetch origin failed"}

    if not wt.exists():
        add = subprocess.run(
            ["git", "-C", str(base), "worktree", "add", "--detach", str(wt), head],
            capture_output=True, text=True, timeout=60,
        )
        if add.returncode != 0:
            return {"ok": False, "error": add.stderr.strip() or "git worktree add failed"}
    else:
        chk = subprocess.run(["git", "-C", str(wt), "rev-parse", "--is-inside-work-tree"], capture_output=True, text=True, timeout=10)
        if chk.returncode != 0:
            return {"ok": False, "error": f"Existing PR path is not a Git worktree: {wt}"}
        status = subprocess.run(["git", "-C", str(wt), "status", "--porcelain"], capture_output=True, text=True, timeout=10)
        if status.stdout.strip():
            return {"ok": False, "error": f"PR worktree is dirty; refusing to retarget: {wt}"}
        cur = subprocess.run(["git", "-C", str(wt), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10)
        if cur.stdout.strip() != head:
            co = subprocess.run(["git", "-C", str(wt), "checkout", "--detach", head], capture_output=True, text=True, timeout=30)
            if co.returncode != 0:
                return {"ok": False, "error": co.stderr.strip() or "git checkout --detach failed"}

    safe_link(base / "node_modules", wt / "node_modules")
    safe_link(base / "frontend" / "node_modules", wt / "frontend" / "node_modules")
    safe_link(base / ".env", wt / ".env")

    v = validate_worktree(str(wt))
    if not v.get("is_git") or v.get("head") != head or not v.get("clean"):
        return {"ok": False, "error": "PR worktree validation failed", "validation": v}

    a = get_agent("dev")
    if a.get("cwd") != str(wt):
        kill_agent("dev")
        set_agent("dev", cwd=str(wt), session_id=None, status="idle")
    return {"ok": True, "path": str(wt), "validation": v}


def priority_prs(open_prs, current=None, limit=4):
    """Display current/train PRs first; remaining PRs newest by creation number."""
    try:
        order = json.loads(get_setting('release_order', json.dumps(RELEASE_ORDER)))
    except (ValueError, TypeError):
        order = list(RELEASE_ORDER)
    ranks = {int(n): i for i, n in enumerate(order)}
    by_number = {int(p['number']): p for p in open_prs or [] if p.get('number')}
    if current and current.get('number'):
        by_number[int(current['number'])] = current
    current_n = int((current or {}).get('number') or 0)
    return sorted(by_number.values(), key=lambda p: (
        0 if int(p['number']) == current_n else 1 if int(p['number']) in ranks else 2,
        ranks.get(int(p['number']), 999), -int(p['number'])
    ))[:max(1, int(limit))]


def _auto_select_current_pr(open_prs):
    """Explicit train order wins over update timestamps and newly opened Drafts."""
    try:
        order = json.loads(get_setting('release_order', json.dumps(RELEASE_ORDER)))
    except (ValueError, TypeError):
        order = list(RELEASE_ORDER)
    by_number = {int(p['number']): p for p in open_prs or [] if p.get('number')}
    return next((by_number[int(n)] for n in order if int(n) in by_number), None)


def reconcile_release_items(open_prs, completed):
    """PR facts update PR rows, never infer another actor's execution activity."""
    by_number = {int(p['number']): p for p in (completed or []) + (open_prs or []) if p.get('number')}
    with DB_LOCK, con() as c:
        for wi in c.execute('SELECT * FROM work_items WHERE pr_number IS NOT NULL').fetchall():
            pr = by_number.get(int(wi['pr_number']))
            if not pr:
                continue
            terminal = 'merged' if pr.get('mergedAt') or pr.get('state') == 'MERGED' else 'closed' if pr.get('state') == 'CLOSED' else None
            if terminal:
                c.execute("UPDATE work_items SET state=?,release_blocker=0,blocker='',updated_at=? WHERE item_key=?", (terminal, now(), wi['item_key']))
                c.execute("UPDATE player_status SET status='unknown',task='Previous PR completed; await next checkpoint',work_item_key='',updated_at=? WHERE work_item_key=?", (now(), wi['item_key']))
            elif pr.get('headRefName') and wi['branch'] != pr['headRefName']:
                # Do not silently repoint a writer when its branch differs from the live PR.
                if wi['state'] not in WRITE_STATES:
                    c.execute('UPDATE work_items SET branch=? WHERE item_key=?', (pr['headRefName'], wi['item_key']))


def pr_snapshot():
    repo = repo_slug(BASE_REPO)
    prs, err = gh_json([
        "pr", "list", "--repo", repo, "--state", "open", "--limit", "100",
        "--json", "number,title,headRefName,headRefOid,baseRefName,isDraft,createdAt,updatedAt,url,statusCheckRollup,reviewDecision",
    ])
    if prs is None:
        return {"repo": repo, "error": err, "current": None, "active": [], "priority": [], "recent_completed": []}

    completed, completed_err = gh_json([
        "pr", "list", "--repo", repo, "--state", "closed", "--limit", "10",
        "--json", "number,title,headRefName,headRefOid,baseRefName,isDraft,createdAt,updatedAt,url,state,closedAt,mergedAt,statusCheckRollup,reviewDecision",
    ])
    snapshot_err = completed_err
    completed = completed or []

    reconcile_release_items(prs, completed)
    # v4.6.16: explicit train order first. Never guess the current PR from "most recently updated".
    # The PO/PM must select it explicitly; this avoids worktree misrouting.
    explicit = bool_setting('current_pr_explicit', False)
    current = None if explicit else _auto_select_current_pr(prs)
    current_num = get_setting("current_pr", "").strip() if explicit else str(current['number']) if current else ''
    current = None
    if current_num:
        try:
            n = int(current_num)
            details, details_err = gh_json([
                "pr", "view", str(n), "--repo", repo,
                "--json", "number,title,body,headRefName,headRefOid,baseRefName,isDraft,state,createdAt,updatedAt,url,statusCheckRollup,reviewDecision,mergeStateStatus,mergedAt,closedAt",
            ])
            snapshot_err = snapshot_err or details_err
            if details and str(details.get("state") or "").upper() == "OPEN":
                current = details
            else:
                if explicit:
                    snapshot_err = snapshot_err or f"Explicitly selected PR #{n} is not currently readable and open"
                else:
                    set_setting("current_pr", "")
        except Exception:
            if explicit:
                snapshot_err = snapshot_err or f"Explicitly selected PR #{current_num} could not be read"
            else:
                set_setting("current_pr", "")
    if current is None and not explicit:
        current = _auto_select_current_pr(prs)
        set_setting('current_pr', str(current['number']) if current else '')
    return {"repo": repo, "error": snapshot_err, "current": current, "active": prs, "priority": priority_prs(prs, current, 4), "recent_completed": completed}


def display_pr_snapshot():
    """UI refreshes share a 90-second cache. Action guards still use fresh GH reads."""
    key = (str(DB), BASE_REPO, get_setting('current_pr', ''))
    with PR_DISPLAY_LOCK:
        cached = PR_DISPLAY_CACHE.get(key)
        if cached and time.monotonic() - cached[0] < 90:
            return json.loads(json.dumps(cached[1]))
        snapshot = pr_snapshot()
        snapshot['observed_at'] = now()
        # Auto-selection may have changed current_pr during the live read.
        key = (str(DB), BASE_REPO, get_setting('current_pr', ''))
        PR_DISPLAY_CACHE.clear()
        PR_DISPLAY_CACHE[key] = (time.monotonic(), snapshot)
        return json.loads(json.dumps(snapshot))


def fetch_watch_comments(repo, issue):
    """Fetch bounded overlapping pages; commit the staged cursor only after durable enqueue."""
    key = f'github_comments:{repo}:{issue}'
    try:
        state = json.loads(get_setting(key, '{}'))
    except (ValueError, TypeError):
        state = {}
    since = state.get('since')
    if not since:
        since = (datetime.now(timezone.utc) - timedelta(days=COMMENT_BOOTSTRAP_LOOKBACK_DAYS)).isoformat()
    fresh = []
    exhausted = True
    for page_no in range(1, MAX_COMMENT_PAGES + 1):
        url = f'repos/{repo}/issues/{issue}/comments?per_page=100&page={page_no}&since=' + quote(since, safe='')
        page, err = gh_json(['api', url])
        if err:
            return None, f'GitHub comments page {page_no} failed: {err}', None
        if isinstance(page, list) and page and all(isinstance(part, list) for part in page):
            page = [entry for part in page for entry in part]
        rows = page if isinstance(page, list) else [page] if isinstance(page, dict) else []
        fresh.extend(x for x in rows if isinstance(x, dict) and x.get('id'))
        if len(rows) < 100:
            exhausted = False
            break
    if exhausted:
        # A full final page means there may be unseen events. Do not advance a cursor past them.
        return None, f'GitHub comments exceeded the bounded {MAX_COMMENT_PAGES}-page read; cursor retained for recovery', None
    merged = {int(x['id']): x for x in state.get('comments', [])}
    merged.update({int(x['id']): x for x in fresh})
    rows = sorted(merged.values(), key=lambda x: int(x['id']))
    dates = [x.get('updated_at') or x.get('created_at') for x in fresh]
    dates = [x for x in dates if x]
    if dates:
        try:
            # Overlap handles tied timestamps; IDs deduplicate the repeat rows.
            candidate = (datetime.fromisoformat(max(dates).replace('Z', '+00:00')) - timedelta(seconds=1)).isoformat()
            since = max(since or '', candidate)
        except ValueError:
            pass  # Unknown timestamp: retain the old cursor, never skip unread rows.
    # An old comment edited today may have a low ID. Retain by most recently
    # updated time so the bounded cache does not discard that fresh event just
    # because 200 newer IDs already exist.
    retained = sorted(rows, key=lambda x: (x.get('updated_at') or x.get('created_at') or '', int(x['id'])))[-200:]
    return rows, None, (key, {'since': since, 'comments': retained})


def commit_watch_comment_cursors(snapshot):
    for key, state in snapshot.get('_pending_comment_cursors', []):
        set_setting(key, json.dumps(state, ensure_ascii=False))



def _terminal(value):
    return str(value or '').upper() in ('COMPLETED','SUCCESS','FAILURE','FAILED','CANCELLED','SKIPPED','NEUTRAL','TIMED_OUT','ACTION_REQUIRED','STALE')


def affected_review_targets():
    """Return explicitly active PR candidates; the caller applies the rotating read budget."""
    numbers = set()
    with DB_LOCK, con() as c:
        for row in c.execute("SELECT pr_number FROM work_items WHERE pr_number IS NOT NULL "
                              "AND lower(state) IN ('active','in_progress','doing','review','in_review','ready')").fetchall():
            numbers.add(int(row['pr_number']))
        for row in c.execute("SELECT DISTINCT pr_number FROM pm_action_journal WHERE pr_number IS NOT NULL "
                              "AND (status IN ('running','unconfirmed') OR review_state='pending')").fetchall():
            numbers.add(int(row['pr_number']))
        for row in c.execute("SELECT DISTINCT pr_number FROM review_handoffs WHERE state NOT IN "
                              "('result_returned','completed','superseded')").fetchall():
            numbers.add(int(row['pr_number']))
    # Do not cap this registry before applying the rotating refresh budget. A fixed
    # lowest-N slice permanently starves later active candidates no matter how fair
    # the per-poll cursor is.
    return sorted(numbers)


def latest_runs_per_workflow(rows):
    """Choose the newest run per workflow, then the newest attempt within that run.

    GitHub attempt numbers are local to a run ID and must never be ranked across
    separate workflow runs.
    """
    grouped = {}
    for row in rows or []:
        workflow = str(row.get('workflow_id') or row.get('workflowDatabaseId')
                       or row.get('name') or '').strip().lower()
        if not workflow:
            continue
        run_id = str(row.get('id') or row.get('databaseId') or '')
        try:
            attempt = int(row.get('attempt') or 0)
        except (TypeError, ValueError):
            attempt = 0
        try:
            numeric_id = int(run_id or 0)
        except (TypeError, ValueError):
            numeric_id = 0
        rank = (str(row.get('createdAt') or ''), numeric_id)
        current = grouped.get(workflow)
        if current is None or rank > current[0] or (rank == current[0] and run_id == current[1]
                                                    and attempt > current[2]):
            grouped[workflow] = (rank, run_id, attempt, row)
    return [value[3] for value in grouped.values()]


def _affected_review_cache_age(entry, observed_at):
    try:
        cached_at = float(entry.get('observed_at'))
        return max(0.0, observed_at - cached_at)
    except (AttributeError, TypeError, ValueError):
        return float('inf')


def affected_review_snapshot(repo, current_number=''):
    """Read a bounded, fair slice of affected PRs and serve the shared durable cache between reads."""
    targets = affected_review_targets()
    if current_number and str(current_number).isdigit():
        targets = [n for n in targets if n != int(current_number)]
    try:
        cache = json.loads(get_setting('affected_review_cache', '{}') or '{}')
    except (ValueError, TypeError):
        cache = {}
    cache = cache if isinstance(cache, dict) else {}
    stamp = time.time()
    stale = [n for n in targets if not isinstance(cache.get(str(n)), dict)
             or _affected_review_cache_age(cache[str(n)], stamp) >= AFFECTED_REVIEW_CACHE_TTL_SECONDS]
    try:
        cursor = int(get_setting('affected_review_cursor', '0') or 0)
    except (ValueError, TypeError):
        cursor = 0
    ordered = [n for n in stale if n > cursor] + [n for n in stale if n <= cursor]
    refresh = ordered[:MAX_AFFECTED_REVIEW_REFRESH_PER_POLL]
    refreshed = {}
    attempt_errors = {}
    last_processed = cursor
    for number in refresh:
        last_processed = number
        key = str(number)
        try:
            pr, err = gh_json(['pr', 'view', key, '--repo', repo,
                               '--json', 'number,state,headRefOid,baseRefOid,headRefName,baseRefName'])
            if err or not isinstance(pr, dict):
                if err and ('budget exhausted' in str(err).lower() or 'backoff' in str(err).lower()):
                    attempt_errors[key] = str(err)[:400]
                    break
                attempt_errors[key] = str(err or 'PR read returned no object')[:400]
                continue
            head = str(pr.get('headRefOid') or '')
            base = str(pr.get('baseRefOid') or '')
            reviews, review_error = bounded_github_list(_pm_request, f'repos/{repo}/pulls/{number}/reviews')
            comments, comment_error = bounded_github_list(_pm_request, f'repos/{repo}/pulls/{number}/comments')
            if review_error or comment_error:
                detail = str(review_error or comment_error)[:400]
                if 'budget exhausted' in detail.lower() or 'backoff' in detail.lower():
                    attempt_errors[key] = detail
                    break
                attempt_errors[key] = detail
                continue
            exact_reviews = [x for x in reviews if x.get('commit_id') == head]
            code_ids = sorted(int(x['id']) for x in exact_reviews if x.get('id') and
                              'codex' in str((x.get('user') or {}).get('login') or '').lower())
            exact_comments = [x for x in comments if (x.get('commit_id') or x.get('original_commit_id')) == head]
            comment_fingerprint = hashlib.sha256(json.dumps([
                (x.get('id'), x.get('updated_at'), x.get('body'), x.get('path'), x.get('position'))
                for x in exact_comments], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            refreshed[key] = {'head': head, 'base': base, 'state': pr.get('state'),
                              'code_review_ids': code_ids, 'security_review_state': 'NOT INFERRED',
                              'pm_acceptance_state': 'NOT RECORDED',
                              'inline_comment_count': len(exact_comments), 'inline_comment_fingerprint': comment_fingerprint,
                              'head_ref': pr.get('headRefName'), 'base_ref': pr.get('baseRefName'), 'error': ''}
        except Exception as exc:
            attempt_errors[key] = f'{type(exc).__name__}: {exc}'[:400]
    if refreshed or attempt_errors:
        # Merge under a write transaction so independent watcher processes using this
        # same state DB cannot overwrite each other's review snapshots.
        with DB_LOCK, con() as c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute("SELECT value FROM settings WHERE key='affected_review_cache'").fetchone()
            try:
                latest = json.loads(row['value']) if row else {}
            except (ValueError, TypeError):
                latest = {}
            latest = latest if isinstance(latest, dict) else {}
            active_keys = {str(n) for n in targets}
            latest = {k: v for k, v in latest.items() if k in active_keys}
            for key, value in refreshed.items():
                latest[key] = {'observed_at': stamp, 'snapshot': value}
            c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('affected_review_cache',?)",
                      (json.dumps(latest, sort_keys=True),))
            c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('affected_review_cursor',?)",
                      (str(last_processed),))
        cache.update({k: {'observed_at': stamp, 'snapshot': v} for k, v in refreshed.items()})
    out = {}
    for number in targets:
        key = str(number)
        cached = cache.get(key) or {}
        snapshot = cached.get('snapshot') if isinstance(cached, dict) else None
        if isinstance(snapshot, dict):
            age = _affected_review_cache_age(cached, stamp)
            out[key] = dict(snapshot, cache_age_seconds=(int(age) if age != float('inf') else None),
                            refresh_pending=number in stale and key not in refreshed,
                            refresh_error=attempt_errors.get(key, ''))
        elif key in attempt_errors:
            out[key] = {'error': attempt_errors[key], 'refresh_pending': True}
        else:
            out[key] = {'error': 'not yet observed within the shared per-poll review budget', 'refresh_pending': True}
    return out

def github_watch_snapshot():
    """Snapshot the shared RWT control issue even when no Current PR exists.

    A PR is optional coordination context; #1258 is the durable control plane.
    Pre-PR tasks (for example a newly assigned harness repair) must still wake CLI PM.
    """
    current = get_setting('current_pr','').strip()
    repo = repo_slug(BASE_REPO)
    control_comments, control_err, cursor = fetch_watch_comments(repo, CONTROL_ISSUE)
    if control_err:
        return None, control_err
    control_comments = control_comments or []
    pending_cursors = [cursor] if cursor else []
    # Future-track packets and selected-PR conversation must reach the same PM
    # queue; restricting ingestion to #1258 stranded #1304 push packets.
    watched = {int(x) for x in WATCH_ISSUES.split(',') if x.strip().isdigit()}
    if current.isdigit():
        watched.add(int(current))
    watched.discard(CONTROL_ISSUE)
    for issue in sorted(watched):
        comments, err, cursor = fetch_watch_comments(repo, issue)
        if err:
            return None, f'Watch #{issue}: {err}'
        control_comments.extend(comments or [])
        if cursor:
            pending_cursors.append(cursor)
    control_comments = list({int(x['id']): x for x in control_comments if isinstance(x, dict) and x.get('id')}.values())
    control_comments.sort(key=lambda x: int(x.get('id') or 0))
    if not control_err:
        set_setting('control_checkpoint_context', json.dumps([{'id':r.get('id'),'url':r.get('html_url'),'at':r.get('updated_at') or r.get('created_at'),'body':str(r.get('body') or '')[:12000]} for r in control_comments[-12:]], ensure_ascii=False))
    if not control_err:
        recover_pm_outbox(control_comments)
    # Automatic PM replies are context/outbox receipts, not fresh PM work — even
    # after a restart changes instance ID. Real Dev/PO/Browser PM posts still wake.
    incoming_comments = [c for c in control_comments if 'rwt-board-pm:' not in str(c.get('body') or '')]
    base = {
        'pr': None, 'title': None, 'head': None, 'draft': None, 'reviewDecision': None,
        'latest_review_id': 0, 'latest_review_comment_id': 0,
        'latest_control_comment_id': max([int(r.get('id') or 0) for r in incoming_comments] or [0]),
        'latest_control_comment': next(({'id':int(r.get('id') or 0),'body':str(r.get('body') or '')[:12000],'url':r.get('html_url')} for r in reversed(incoming_comments) if r.get('id')), None),
        'control_updates': [{'id':int(r['id']), 'body':str(r.get('body') or '')[:12000], 'url':r.get('html_url'),
                             'at':r.get('updated_at') or r.get('created_at'), 'updated_at':r.get('updated_at')}
                            for r in incoming_comments if r.get('id')],
        'runs': {}, 'deploy': [],
        '_pending_comment_cursors': pending_cursors,
    }
    base['affected_reviews'] = affected_review_snapshot(repo, current)
    if not current:
        return base, control_err
    pr, err = gh_json(['pr','view',current,'--repo',repo,'--json','number,title,headRefName,headRefOid,baseRefOid,baseRefName,isDraft,state,reviewDecision,updatedAt,url,statusCheckRollup'])
    if pr is None:
        # Do not lose #1258 monitoring merely because the selected PR is stale/closed/unreadable.
        return base, err or control_err or 'PR lookup failed'
    try:
        reviews, reviews_err = bounded_github_list(_pm_request, f'repos/{repo}/pulls/{current}/reviews')
        comments, comments_err = bounded_github_list(_pm_request, f'repos/{repo}/pulls/{current}/comments')
    except Exception as exc:
        reviews, comments, reviews_err, comments_err = None, None, str(exc), None
    if reviews_err or comments_err:
        detail = f'PR #{current} review monitor incomplete: {reviews_err or comments_err}'
        base['review_monitor_error'] = detail
        return base, detail
    runs, runs_error = github_action_runs(repo, pr.get('headRefName', ''))
    if runs_error:
        base['workflow_runs_error'] = str(runs_error)[:400]
    reviews = reviews if isinstance(reviews,list) else []
    comments = comments if isinstance(comments,list) else []
    runs = [r for r in (runs if isinstance(runs,list) else []) if r.get('headSha') == pr.get('headRefOid')]
    latest_runs={}
    for r in runs:
        name=str(r.get('databaseId') or r.get('workflowName') or 'workflow')
        entry={'id':r.get('databaseId'),'workflow_id':r.get('workflowDatabaseId'),
               'attempt':r.get('attempt'),'name':r.get('workflowName'),
               'headSha':r.get('headSha'),
               'status':r.get('status'),'conclusion':r.get('conclusion'),
               'createdAt':r.get('createdAt'),'updatedAt':r.get('updatedAt')}
        prior=latest_runs.get(name)
        try:
            attempt=int(entry.get('attempt') or 0)
            prior_attempt=int((prior or {}).get('attempt') or 0)
        except (TypeError, ValueError):
            attempt,prior_attempt=0,0
        if prior is None or attempt > prior_attempt:
            latest_runs[name]=entry
    # For a non-draft PR, `report` is the CI workflow's aggregate engineering
    # lane. The overall workflow conclusion also includes review-qualification
    # and merge-qualification, so those failures must not circularly block the
    # authorized review refresh. Fetch details only for the newest completed
    # exact-head CI run; the queue gate still checks its exact attempt/head.
    if str(pr.get('state') or '').upper() == 'OPEN' and pr.get('isDraft') is False:
        for run in latest_runs_per_workflow(latest_runs.values()):
            if (str(run.get('name') or '').strip().lower() != 'ci - test audit'
                    or str(run.get('headSha') or '') != str(pr.get('headRefOid') or '')
                    or str(run.get('status') or '').lower() != 'completed'):
                continue
            try:
                attempt = int(run.get('attempt') or 0)
                run_id = int(run.get('id') or 0)
            except (TypeError, ValueError):
                run['jobs_error'] = 'CI summary omitted a numeric run ID or attempt'
                continue
            if run_id < 1 or attempt < 1:
                run['jobs_error'] = 'CI summary omitted a numeric run ID or attempt'
                continue
            detail, detail_error = github_action_run_detail(repo, run_id, attempt)
            if detail_error:
                run['jobs_error'] = str(detail_error)
            elif not isinstance(detail, dict):
                run['jobs_error'] = 'CI run detail read returned no object'
            else:
                try:
                    detail_attempt = int(detail.get('attempt') or 0)
                except (TypeError, ValueError):
                    detail_attempt = 0
                if (str(detail.get('databaseId') or '') != str(run_id)
                        or detail_attempt != attempt
                        or str(detail.get('headSha') or '') != str(pr.get('headRefOid') or '')):
                    run['jobs_error'] = 'CI run detail identity/attempt/head changed during read'
                else:
                    run['jobs'] = detail.get('jobs') if isinstance(detail.get('jobs'), list) else []
                    run['jobs_attempt'] = detail_attempt
                    run['jobs_head_sha'] = detail.get('headSha')
                    run['status'] = detail.get('status') or run.get('status')
                    run['conclusion'] = detail.get('conclusion') or run.get('conclusion')
    deploy=[]
    for x in pr.get('statusCheckRollup') or []:
        name=(x.get('name') or x.get('context') or x.get('workflowName') or '').strip()
        if any(k in name.lower() for k in ('vercel','deploy','deployment')):
            deploy.append({'name':name,'status':x.get('status') or x.get('state'),'conclusion':x.get('conclusion')})
    base.update({
        'pr':pr.get('number'),'title':pr.get('title'),'head':pr.get('headRefOid'),'draft':pr.get('isDraft'),
        'state':pr.get('state'),
        'base':pr.get('baseRefOid'),
        'reviewDecision':pr.get('reviewDecision'),
        'latest_review_id':max([int(r.get('id') or 0) for r in reviews] or [0]),
        'latest_review_comment_id':max([int(r.get('id') or 0) for r in comments] or [0]),
        'runs':latest_runs,'deploy':sorted(deploy,key=lambda x:x['name']),
    })
    return base, err or control_err

def github_watch_events(prev, cur, cfg):
    if not prev or not cur:
        return []
    if prev.get('pr') != cur.get('pr') and prev.get('pr') is not None and cur.get('pr') is not None:
        return []
    events=[]
    prior_targets = prev.get('affected_reviews') or {}
    current_targets = cur.get('affected_reviews') or {}
    for number, target in current_targets.items():
        old = prior_targets.get(number) or {}
        if target.get('error') and target.get('error') != old.get('error'):
            events.append(f"Affected PR #{number} review monitor failed: {target['error']}; Code/Security/PM status remains unqualified")
        elif not old or target.get('head') != old.get('head') or target.get('base') != old.get('base'):
            events.append(f"Affected PR #{number} candidate changed/registered: head {target.get('head') or 'unknown'}, base {target.get('base') or 'unknown'}; inspect exact-head Code and Security review separately")
        elif (target.get('code_review_ids') != old.get('code_review_ids')
              or target.get('inline_comment_fingerprint') != old.get('inline_comment_fingerprint')):
            events.append(f"Affected PR #{number} exact-head review evidence changed at {target.get('head')}; Code review IDs {target.get('code_review_ids') or []}; Security status is NOT inferred; read and disposition every finding")
    if cfg.get('pm_github_head') and prev.get('head') != cur.get('head'):
        events.append(f"PR head changed: {(prev.get('head') or '')[:9]} → {(cur.get('head') or '')[:9]}")
    if cfg.get('pm_github_review'):
        if cur.get('latest_review_id',0) > prev.get('latest_review_id',0):
            events.append('A new pull-request review completed')
        if cur.get('latest_review_comment_id',0) > prev.get('latest_review_comment_id',0):
            events.append('A new inline review finding/comment appeared')
        if prev.get('reviewDecision') != cur.get('reviewDecision'):
            events.append(f"Review decision changed: {prev.get('reviewDecision')} → {cur.get('reviewDecision')}")
    if cfg.get('pm_github_control', True):
        old_updates = {int(c.get('id') or 0): c for c in (prev.get('control_updates') or []) if c.get('id')}
        old_max = int(prev.get('latest_control_comment_id') or 0)
        updates = []
        for comment in cur.get('control_updates') or []:
            try:
                comment_id = int(comment.get('id') or 0)
            except (TypeError, ValueError):
                continue
            prior = old_updates.get(comment_id)
            changed = (comment_id > old_max or
                       (prior is not None and (str(comment.get('body') or '') != str(prior.get('body') or '')
                        or str(comment.get('updated_at') or comment.get('at') or '')
                        != str(prior.get('updated_at') or prior.get('at') or ''))))
            if changed:
                updates.append(comment)
        if not updates and cur.get('latest_control_comment_id', 0) > old_max:
            updates = [cur.get('latest_control_comment') or {}]
        for cc in updates:
            events.append(f"RWT control issue #{CONTROL_ISSUE} comment {cc.get('id')}: {cc.get('url') or ''}\n{cc.get('body') or 'new or edited comment'}")
    if cfg.get('pm_github_ci'):
        old=prev.get('runs') or {}; new=cur.get('runs') or {}
        for name,r in new.items():
            oldr=old.get(name) or {}
            if str(r.get('status')).lower()=='completed' and (oldr.get('status') != r.get('status') or oldr.get('id') != r.get('id') or oldr.get('conclusion') != r.get('conclusion')):
                events.append(f"CI terminal: {r.get('name') or name} → {r.get('conclusion') or 'completed'} (run {r.get('id')})")
    if cfg.get('pm_github_deploy') and prev.get('deploy') != cur.get('deploy') and cur.get('deploy'):
        events.append('Deployment/status changed: '+', '.join(f"{x['name']}={x.get('conclusion') or x.get('status')}" for x in cur['deploy']))
    return events

def _coalesced_github_enqueue(aid, recipient, msg):
    """Keep at most one queued raw GitHub wake per recipient.

    A delivering wake is never mutated. If another watcher transition arrives
    while an older GitHub wake is still queued, replace the queued payload with
    the latest authoritative state instead of growing stale backlog.
    """
    with DB_LOCK, con() as c:
        row = c.execute(
            "SELECT id,activity_id,content FROM queue WHERE status='queued' AND recipient=? "
            "AND source_actor='GITHUB' ORDER BY id DESC LIMIT 1",
            (recipient,),
        ).fetchone()
        if row:
            c.execute(
                "UPDATE queue SET activity_id=?,content=?,error=NULL WHERE id=?",
                (aid, row["content"] if msg in row["content"] else row["content"] + "\n\nPENDING EVENT:\n" + msg, row["id"]),
            )
            # The new activity now owns the existing delivery id; leave the old
            # activity as history but mark it superseded for human readability.
            c.execute("UPDATE activity SET status='superseded' WHERE id=?", (row['activity_id'],))
            return int(row['id'])
    return enqueue(aid, recipient, msg, source_actor='GITHUB', handoff_depth=0, auto_handoff=True)


def emit_github_event(events, snap, cfg):
    if not events:
        return None
    if snap.get('pr'):
        scope = "Current PR #{} ({}) on head {}".format(snap.get('pr'), snap.get('title') or '', (snap.get('head') or '')[:12])
    else:
        scope = f"RWT control issue #{CONTROL_ISSUE} (no Current PR selected)"
    msg = "GitHub state transition for {}:\n- {}\nInspect the exact GitHub evidence now and advance the release path. Do not wait for PO unless explicit PO authority is required or an existing PO delegation does not cover the action.".format(
        scope, '\n- '.join(events))
    set_setting('github_watch_last_wake', now())
    aid=add_activity('GITHUB', msg, 'pm', 'posted')
    qids=[]
    if any(cfg.get(k) for k in ('pm_github_control','pm_github_review','pm_github_ci','pm_github_head','pm_github_deploy')):
        qids.append(_coalesced_github_enqueue(aid,'pm',msg))
    if cfg.get('dev_github'):
        qids.append(_coalesced_github_enqueue(aid,'dev',msg))
    return qids

def _parse_ts(value):
    try:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return dt if dt.tzinfo else None
    except (ValueError, TypeError):
        return None


REQUEST_LINE = re.compile(r'REQUEST\s*:\s*(.*)', re.I)
LIST_ITEM = re.compile(r'^\s*(?:\(\d+\)|\d+[.)]|[-*])\s+(.+)$')
DISPOSITION_WORDS = re.compile(r'\b(PUSH PIN|PIN(?:NED)?|HOLD|ACCEPT(?:ED)?|REJECT(?:ED)?|DISPOSITION(?:S|ED)?|DECISION|DONE|COMPLETED?|NOT VALID|DEFER(?:RED)?|FIX NOW)\b', re.I)
# c5 (F03): only these words CLOSE an ask externally; HOLD keeps it open as held.
CLOSING_WORDS = re.compile(r'\b(NOT VALID|PUSH PIN|PIN(?:NED)?|ACCEPT(?:ED)?|REJECT(?:ED)?|DONE|COMPLETED?|DEFER(?:RED)?|SUPERSEDED)\b', re.I)
HOLD_WORD = re.compile(r'\bHOLD\b', re.I)
NEGATED = re.compile(r"\b(?:not|no|never|isn['’]t|aren['’]t|wasn['’]t|without|pending|awaiting|unless|until|before|yet to)\b(?:\W+\w+){0,2}\W*$", re.I)
# External roles whose source-linked, line-scoped decision may disposition an ask. Board PM text never does.
DISPOSITION_AUTHORITIES = ('po', 'browser pm')


def _header_actor(body):
    header = str(body or '').splitlines()[0] if str(body or '').strip() else ''
    return header.split('→')[0].strip()[:80] if '→' in header else ''


def _unquoted_lines(text):
    """Lines that are the author's own words: quoted (>) lines and fenced code are someone else's."""
    fence = False
    for line in str(text or '').splitlines():
        if line.strip().startswith('```'):
            fence = not fence
            continue
        if fence or line.lstrip().startswith('>'):
            continue
        yield line


def _in_backticks(line, pos):
    return line[:pos].count('`') % 2 == 1


def _live_word(pattern, line):
    """First match of `pattern` that is neither inside backticks nor negated (e.g. 'NOT DONE')."""
    for m in pattern.finditer(line):
        if _in_backticks(line, m.start()):
            continue
        if m.group(0).upper() != 'NOT VALID' and NEGATED.search(line[:m.start()]):
            continue
        return m
    return None


def parse_asks(body):
    """Split one post into independent actionable asks (c5 F03).

    Every unquoted REQUEST line is an ask; inline (1)/(2) items and the numbered/bulleted items listed
    directly under a REQUEST line are each their own ask. 'REQUEST: none' is not an ask. A PO post with no
    REQUEST line is still an instruction: it is recorded for PM classification rather than dropped.
    """
    text = str(body or '')
    if 'rwt-board-pm:' in text:
        return []  # board PM replies are outbox context, never new asks
    raw_lines = text.splitlines()
    header = raw_lines[0] if raw_lines else ''
    lines = list(_unquoted_lines(text))
    items = []
    i = 0
    while i < len(lines):
        m = REQUEST_LINE.search(lines[i])
        if not m or _in_backticks(lines[i], m.start()):
            i += 1
            continue
        request = m.group(1).strip()
        j = i + 1
        listed = []
        while j < len(lines):
            lm = LIST_ITEM.match(lines[j])
            if not lm:
                break
            listed.append(lm.group(1).strip())
            j += 1
        if request and not re.match(r'(none|n/?a)\b', request, re.I):
            parts = [x.strip(' ,;') for x in re.split(r'\(\d+\)', request) if x.strip(' ,;')]
            numbered = re.findall(r'\((\d+)\)', request)
            if len(numbered) >= 2 and len(parts) >= len(numbered):
                items.extend(('request', p) for p in parts[-len(numbered):])
            else:
                items.append(('request', request))
        if not re.match(r'(none|n/?a)\b', request, re.I):
            items.extend(('request', x) for x in listed)
        i = j
    actor = _header_actor(text)
    if not items and actor.lower() == 'po':
        after = header.split('→', 1)[1]
        instruction = after.split('—', 1)[1] if '—' in after else after
        rest = ' '.join(x.strip() for x in lines[1:] if x.strip())
        instruction = (instruction.strip(' —-:') + (' ' + rest if rest else '')).strip()
        if instruction:
            items.append(('instruction', instruction))
    task = ' '.join(sorted(set(re.findall(r'#\d{3,5}', header))))
    out = []
    for index, (kind, request) in enumerate(items, start=1):
        candidate = ' '.join(sorted(set(re.findall(r'\b[0-9a-f]{40}\b', header + ' ' + request))))
        out.append({'ask_index': index, 'request': request[:500], 'source_actor': actor, 'task_ref': task,
                    'candidate': candidate, 'kind': kind})
    return out


def _external_decisions(body, src):
    """Line-scoped decisions in an external post about source `src`: {ask_index|None: ('close'|'hold', line)}.

    A numbered line decides only its own item; otherwise a line that names the source decides every item.
    Negated ('NOT DONE'), quoted and backticked words decide nothing.
    """
    decisions = {}
    for line in _unquoted_lines(body):
        numbered = re.match(r'^\s*(\d+)[.)]\s', line)
        if not numbered and str(src) not in line:
            continue
        index = int(numbered.group(1)) if numbered else None
        if _live_word(CLOSING_WORDS, line):
            decisions[index] = ('close', line.strip())
        elif _live_word(HOLD_WORD, line):
            decisions[index] = ('hold', line.strip())
    return decisions


def _add_signal(c, ask_id, signal):
    row = c.execute("SELECT signals FROM asks WHERE id=?", (ask_id,)).fetchone()
    try:
        signals = json.loads(row['signals'] or '[]') if row else []
    except (ValueError, TypeError):
        signals = []
    if signal not in signals:
        signals = (signals + [signal])[-10:]
        c.execute("UPDATE asks SET signals=? WHERE id=?", (json.dumps(signals, ensure_ascii=False), ask_id))


def ingest_control_asks(comments):
    since = get_setting('asks_ingest_since', '')
    added = 0
    with DB_LOCK, con() as c:
        for cm in sorted(comments or [], key=lambda x: int(x.get('id') or 0)):
            at = cm.get('at') or ''
            if since and at and _parse_ts(at) and _parse_ts(since) and _parse_ts(at) < _parse_ts(since):
                continue
            for ask in parse_asks(cm.get('body')):
                cur = c.execute(
                    "INSERT OR IGNORE INTO asks(source_comment_id,ask_index,source_actor,task_ref,candidate,request,url,source_at,recorded_at,kind) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (int(cm['id']), ask['ask_index'], ask['source_actor'], ask['task_ref'], ask['candidate'],
                     ask['request'], cm.get('url') or '', at or None, now(), ask['kind']))
                added += cur.rowcount
        # External source-linked dispositions. c5 (F03): only an authority role (PO / Browser PM) decides,
        # line by line; a non-authority mention, negation or quotation is kept as a visible signal for PM and
        # never retires the ask. HOLD keeps the ask OPEN as held. Board PM text never closes an ask: PM closes
        # asks only through typed ask_dispositions.
        open_sources = {r['source_comment_id'] for r in c.execute(
            "SELECT DISTINCT source_comment_id FROM asks WHERE state IN ('pending','held')")}
        for cm in sorted(comments or [], key=lambda x: int(x.get('id') or 0)):
            body = str(cm.get('body') or '')
            if 'rwt-board-pm:' in body:
                continue
            cid = int(cm.get('id') or 0)
            actor = _header_actor(body)
            for src in open_sources:
                if cid <= src or str(src) not in body:
                    continue
                rows = c.execute("SELECT id,ask_index,state FROM asks WHERE source_comment_id=? AND state IN ('pending','held')",
                                 (src,)).fetchall()
                decisions = _external_decisions(body, src)
                ref = str(cm.get('url') or cm.get('id'))
                if actor.lower() not in DISPOSITION_AUTHORITIES:
                    if DISPOSITION_WORDS.search(body):
                        for r in rows:
                            _add_signal(c, r['id'], f"{actor or 'unknown actor'} mentioned source {src} in {ref} (not an authority disposition)")
                    continue
                for r in rows:
                    decision = decisions.get(r['ask_index']) or (decisions.get(None) if not any(isinstance(k, int) for k in decisions) else None)
                    if not decision:
                        if DISPOSITION_WORDS.search(body):
                            _add_signal(c, r['id'], f"{actor} referenced source {src} in {ref} without a decision for item {r['ask_index']}")
                        continue
                    if decision[0] == 'close':
                        c.execute("UPDATE asks SET state='dispositioned',disposition='external',disposition_owner=?,disposition_ref=?,dispositioned_at=? WHERE id=?",
                                  (actor, f"{ref} · {decision[1][:200]}", now(), r['id']))
                    elif r['state'] == 'pending':
                        c.execute("UPDATE asks SET state='held',disposition='hold',disposition_owner=?,owner=?,dependency=?,release_event=?,"
                                  "held_at=?,disposition_ref=? WHERE id=?",
                                  (actor, actor, decision[1][:300], decision[1][:300], now(), ref, r['id']))
    return added


VALID_DISPOSITIONS = ('pin', 'hold', 'po_decision', 'completed', 'superseded', 'dispatched', 'reopen')
OPEN_ASK_STATES = ('pending', 'held', 'dispatched')


def _ask_evidence_error(row, kind, evidence, handoff_token=''):
    """Require closure evidence to identify this ask's source/task/candidate, not merely any link."""
    shas = set(re.findall(r'\b[0-9a-f]{40}\b', evidence))
    wanted = set(str(row.get('candidate') or '').split())
    task_refs = set(re.findall(r'#\d{3,5}', str(row.get('task_ref') or '')))
    cited_refs = set(re.findall(r'(?<!\w)#\d{3,5}\b', evidence))
    source_id = str(row.get('source_comment_id') or '')
    source_url = str(row.get('url') or '').strip()
    source_cited = bool(source_id and re.search(rf'(?<!\d){re.escape(source_id)}(?!\d)', evidence)) or bool(source_url and source_url in evidence)
    task_cited = bool(task_refs and task_refs.issubset(cited_refs))
    candidate_cited = bool(wanted and wanted.issubset(shas))
    handoff_cited = bool(handoff_token and handoff_token.lower() in evidence.lower())
    if cited_refs and task_refs and not task_refs.issubset(cited_refs):
        return f"evidence for ask {row['id']} names task {', '.join(sorted(cited_refs))}, expected {', '.join(sorted(task_refs))}"
    if kind == 'pin' and (not wanted or not candidate_cited):
        return f"pin evidence must name ask {row['id']}'s exact candidate {', '.join(sorted(wanted)) or '(missing)'}"
    if kind == 'completed' and wanted and not (candidate_cited or handoff_cited):
        return f"completion evidence must name ask {row['id']}'s exact candidate {', '.join(sorted(wanted))}"
    if kind in ('po_decision', 'completed', 'superseded') and not (source_cited or task_cited or candidate_cited or handoff_cited):
        return f"{kind} evidence must identify ask {row['id']} by source comment, task, or exact candidate"
    return ''


def apply_ask_dispositions(q, dispositions, published_ref, handoff_index=None):
    """Close asks only with a typed, evidenced, source-linked disposition validated against the ask (c5 F03/F04).

    'hold' keeps the ask OPEN (held) with its owner and release event. A dispatched ask closes only as
    'completed' after its handoff RESULT returned (receipt alone is not completion), or 'superseded'.
    Replay-safe: a disposition this turn already applied (same published_ref) is not re-applied or rejected.
    """
    applied, rejected = [], []
    for d in dispositions or []:
        if not isinstance(d, dict):
            rejected.append('non-object disposition'); continue
        kind = str(d.get('disposition') or '')
        evidence = str(d.get('evidence') or '').strip()
        owner = str(d.get('owner') or '').strip()
        dependency = str(d.get('dependency') or '').strip()
        release_event = str(d.get('release_event') or '').strip()
        why = None
        hid = (handoff_index or {}).get(d.get('review_handoff_index')) if isinstance(d.get('review_handoff_index'), int) else None
        if kind not in VALID_DISPOSITIONS:
            why = f'unknown disposition {kind!r}'
        elif kind == 'dispatched' and not hid:
            why = 'dispatched needs review_handoff_index naming a handoff recorded in this turn'
        elif kind != 'dispatched' and d.get('review_handoff_index') is not None:
            why = 'review_handoff_index is only valid with disposition=dispatched'
        elif kind == 'pin' and not re.search(r'\b[0-9a-f]{40}\b', evidence):
            why = 'pin needs the full 40-hex candidate in evidence'
        elif kind == 'hold' and not (owner and dependency and release_event and evidence):
            why = 'HOLD needs exact reason, dependency, named release event and owner'
        elif kind == 'reopen' and (not re.search(r'https://|\b\d{6,}\b|\b[0-9a-f]{40}\b', evidence)
                                   or not release_event or release_event.lower() not in evidence.lower()):
            why = 'reopen needs source-linked evidence that names the exact release event'
        elif kind in ('po_decision', 'completed', 'superseded') and not re.search(r'https://|\b\d{6,}\b|\b[0-9a-f]{40}\b', evidence):
            why = f'{kind} needs a source link, comment id or SHA as evidence'
        with DB_LOCK, con() as c:
            row = c.execute("SELECT * FROM asks WHERE id=?", (int(d.get('ask_id') or 0),)).fetchone()
            if row and row['state'] != 'pending' and str(row['disposition_ref'] or '').startswith(published_ref + ' · ') \
                    and row['state'] == {'dispatched': 'dispatched', 'hold': 'held'}.get(kind, 'dispositioned'):
                continue  # replay of this same turn's already-applied disposition (F01 continuation)
            if row and kind == 'reopen' and row['state'] == 'pending' and row['disposition'] == 'reopened' \
                    and published_ref in str(row['disposition_ref'] or ''):
                continue  # replay after a crash does not reject the already-applied release
            if row and row['state'] == 'dispositioned' and f' · {kind} {published_ref} · ' in str(row['disposition_ref'] or ''):
                continue  # replay of this turn's completion of a dispatched ask
            if not row:
                why = why or 'unknown ask_id'
            elif row['state'] not in OPEN_ASK_STATES:
                why = why or f"ask {row['id']} already {row['state']}"
            elif row['state'] == 'dispatched' and kind not in ('completed', 'superseded', 'hold'):
                why = why or f"ask {row['id']} is dispatched; only completed (after the owner RESULT), superseded or hold apply"
            elif kind == 'reopen' and row['state'] != 'held':
                why = why or f"ask {row['id']} is {row['state']}; only a held ask can be reopened"
            elif kind == 'reopen' and (not release_event or release_event != str(row['release_event'] or '').strip()):
                why = why or f"release_event must exactly match ask {row['id']}'s named event"
            elif row['state'] == 'held' and kind == 'hold' and not why:
                pass  # re-hold with a newer dependency is allowed
            handoff_token = ''
            if row and row['state'] == 'dispatched' and kind == 'completed':
                handoff = c.execute("SELECT token FROM review_handoffs WHERE id=?", (row['handoff_id'],)).fetchone()
                handoff_token = handoff['token'] if handoff else ''
            if not why and row and kind in ('pin', 'po_decision', 'completed', 'superseded'):
                why = _ask_evidence_error(dict(row), kind, evidence, handoff_token)
            if not why and row and row['state'] == 'dispatched' and kind == 'completed':
                h = c.execute("SELECT token,state FROM review_handoffs WHERE id=?", (row['handoff_id'],)).fetchone()
                if not h or h['state'] != 'result_returned':
                    why = (f"ask {row['id']} handoff has no owner RESULT yet (state {h['state'] if h else 'missing'}); "
                           "a receipt is not completion")
                elif h['token'].lower() not in evidence.lower():
                    why = f"completion evidence must name handoff {h['token']}"
            if why:
                rejected.append(f"ask {d.get('ask_id')}: {why}"); continue
            if kind == 'dispatched':
                # Still OPEN: receipt → result → PM-typed completion.
                h = c.execute("SELECT token,owner FROM review_handoffs WHERE id=?", (hid,)).fetchone()
                c.execute("UPDATE asks SET state='dispatched',disposition='dispatched',disposition_owner=?,disposition_ref=?,handoff_id=? WHERE id=?",
                          (h['owner'], f"{published_ref} · {h['token']} · {evidence[:300]}", hid, row['id']))
            elif kind == 'hold':
                c.execute("UPDATE asks SET state='held',disposition='hold',disposition_owner=?,owner=?,dependency=?,release_event=?,"
                          "held_at=?,disposition_ref=? WHERE id=?",
                          (owner, owner, dependency[:300], release_event[:300], now(), f"{published_ref} · {evidence[:300]}", row['id']))
            elif kind == 'reopen':
                c.execute("UPDATE asks SET state='pending',disposition='reopened',disposition_owner=?,disposition_ref=?,"
                          "recovery_count=0,last_recovery_at=NULL,escalated=0 WHERE id=?",
                          (owner or row['owner'] or 'cli_pm',
                           f"{row['disposition_ref']} · release event {release_event[:200]} · {published_ref} · {evidence[:300]}",
                           row['id']))
                _add_signal(c, row['id'], f"Named release event observed: {release_event[:200]} ({evidence[:200]})")
            elif row['state'] == 'dispatched':
                # Keep the dispatch → receipt → result trail; the completion is appended, not substituted.
                c.execute("UPDATE asks SET state='dispositioned',disposition=?,disposition_owner=?,disposition_ref=?,dispositioned_at=? WHERE id=?",
                          (kind, owner, f"{row['disposition_ref']} · {kind} {published_ref} · {evidence[:300]}", now(), row['id']))
            else:
                c.execute("UPDATE asks SET state='dispositioned',disposition=?,disposition_owner=?,disposition_ref=?,dispositioned_at=? WHERE id=?",
                          (kind, owner, f"{published_ref} · {evidence[:300]}", now(), row['id']))
            applied.append(row['id'])
    if rejected:
        add_activity('SYSTEM', 'Rejected ask dispositions (ask stays open): ' + '; '.join(rejected)[:1000], 'none', 'error',
                     trigger_queue_id=q.get('id'))
    return applied, rejected


def list_asks(state=None):
    sql, args = "SELECT * FROM asks", ()
    if state == 'open':
        sql += " WHERE state IN ('pending','held','dispatched')"
    elif state:
        sql += " WHERE state=?"; args = (state,)
    with DB_LOCK, con() as c:
        rows = [dict(r) for r in c.execute(sql + " ORDER BY source_comment_id, ask_index", args).fetchall()]
        stages = {r['id']: r['state'] for r in c.execute("SELECT id,state FROM review_handoffs").fetchall()}
    for r in rows:
        try:
            r['signals'] = json.loads(r.get('signals') or '[]')
        except (ValueError, TypeError):
            r['signals'] = []
        r['age_seconds'] = age_seconds(r.get('source_at') or r.get('recorded_at'))
        if r['state'] == 'dispatched':
            stage = stages.get(r.get('handoff_id'), 'missing')
            r['next_action'] = {
                'recorded': 'Dispatch owed: handoff recorded, delivery not yet applied',
                'held': 'Dispatch held by a prerequisite gate; delivered when it releases',
                'delivered': 'Dispatched to owner; awaiting the owner\'s task-specific RECEIPT',
                'received': 'Owner invoked; awaiting the owner\'s task-specific RECEIPT',
                'acknowledged': 'Owner RECEIPT recorded (started); awaiting the owner RESULT',
                'result_returned': 'Owner RESULT returned; awaiting PM review and typed completion',
            }.get(stage, f'Handoff {stage}; PM must reconcile')
        elif r['state'] == 'held':
            r['next_action'] = f"HELD ({r.get('owner') or 'owner?'}) until: {r.get('release_event') or r.get('dependency') or 'release event not named'}"
        elif r['state'] == 'pending':
            r['next_action'] = ('ESCALATED board blocker: PM recovery did not disposition it' if r['escalated']
                                else 'PM recovery woke once; awaiting typed disposition' if r['recovery_count']
                                else 'Awaiting PM classification (instruction)' if r.get('kind') == 'instruction'
                                else 'Awaiting PM typed disposition')
    return rows


def pending_ask_watchdog():
    """One bounded, deduplicated PM recovery per overdue ask; then an explicit board blocker."""
    if not bool_setting('auto_pm_github_control', True):
        return None
    open_asks = list_asks('pending')
    stale = [a for a in open_asks if a['recovery_count'] and not a['escalated']
             and (age_seconds(a.get('last_recovery_at')) or 0) >= ASK_ESCALATE_SECONDS]
    if stale:
        with DB_LOCK, con() as c:
            for a in stale:
                c.execute("UPDATE asks SET escalated=1 WHERE id=?", (a['id'],))
        set_setting('pm_ask_blocker', f"{len(stale)} ask(s) still undispositioned after one PM recovery: " +
                    ', '.join(f"#{a['id']} (source {a['source_comment_id']})" for a in stale))
        add_activity('SYSTEM', 'BOARD BLOCKER: ' + get_setting('pm_ask_blocker'), 'none', 'error')
    overdue = [a for a in open_asks if not a['recovery_count'] and (a['age_seconds'] or 0) >= ASK_OVERDUE_SECONDS
               and str(a['source_comment_id']) != get_setting('pm_watchdog_packet', '')]
    if not overdue:
        return None
    agent = get_agent('pm') or {}
    if agent.get('paused') or agent.get('status') in ('running', 'auth_required', 'error') or _has_pending_delivery('pm'):
        return None
    with DB_LOCK, con() as c:
        if c.execute("SELECT 1 FROM pm_outbox WHERE status IN ('publishing','unconfirmed') LIMIT 1").fetchone():
            return None
    lines = [f"- ask {a['id']} · source {a['source_comment_id']} ({a['source_actor'] or 'unknown'}, {a['age_seconds']}s): {a['request']}"
             for a in open_asks if not a['escalated']]
    msg = ('PM ask watchdog: these independent asks are open; the first ' + str(len(overdue)) + ' are overdue. '
           'Return a typed ask_dispositions entry for each one you can disposition now (pin / hold with owner+dependency / '
           'po_decision / completed / superseded, with evidence). A generic reply does not close an ask. '
           'Unrelated PR HOLDs do not block independent asks. This wake retries reconciliation only, never an action or publication.\n'
           + '\n'.join(lines))
    with DB_LOCK, con() as c:
        aid = c.execute("INSERT INTO activity(actor,message,route,status,created_at) VALUES(?,?,?,?,?)",
                        ('SYSTEM', msg, 'pm', 'posted', now())).lastrowid
        qid = c.execute("INSERT INTO queue(activity_id,recipient,content,status,created_at,source_actor,handoff_depth,auto_handoff,attempts,kind) "
                        "VALUES(?,?,?,?,?,?,?,?,0,?)", (aid, 'pm', msg, 'queued', now(), 'SYSTEM', 0, 1, 'ask_recovery')).lastrowid
        for a in overdue:
            c.execute("UPDATE asks SET recovery_count=recovery_count+1,last_recovery_at=? WHERE id=? AND recovery_count=0", (now(), a['id']))
    return qid


def queue_ci_review_followup(snapshot):
    """Durably wake local PM once after the exact Ready candidate's required CI is green.

    The PM worker must still find source-authored refresh_reviews authorization; CI status itself
    cannot grant lifecycle authority. The unique candidate key and refresh journal make restart and
    repeated watcher polls idempotent.
    """
    if not isinstance(snapshot, dict):
        return None
    try:
        pr_number = int(snapshot.get('pr') or 0)
    except (TypeError, ValueError):
        return None
    head, base = str(snapshot.get('head') or ''), str(snapshot.get('base') or '')
    if (pr_number < 1 or not re.fullmatch(r'[0-9a-f]{40}', head)
            or not re.fullmatch(r'[0-9a-f]{40}', base)
            or str(snapshot.get('state') or '').lower() != 'open' or snapshot.get('draft') is not False):
        return None
    runs = [r for r in (snapshot.get('runs') or {}).values()
            if str(r.get('name') or '').strip().lower() == 'ci - test audit']
    runs = latest_runs_per_workflow(runs)
    if not runs:
        return None
    report_runs = []
    for run in runs:
        if (str(run.get('status') or '').lower() != 'completed'
                or str(run.get('headSha') or '') != head
                or str(run.get('jobs_head_sha') or '') != head
                or str(run.get('attempt') or '') != str(run.get('jobs_attempt') or '')
                or run.get('jobs_error')):
            return None
        reports = [job for job in (run.get('jobs') or [])
                   if str(job.get('name') or '').strip().lower() == 'report']
        if (len(reports) != 1 or str(reports[0].get('status') or '').lower() != 'completed'
                or str(reports[0].get('conclusion') or '').lower() != 'success'):
            return None
        full_lane = [job for job in (run.get('jobs') or [])
                     if str(job.get('name') or '').strip().lower() == 'full-evidence']
        if (len(full_lane) != 1 or str(full_lane[0].get('status') or '').lower() != 'completed'
                or str(full_lane[0].get('conclusion') or '').lower() != 'success'):
            return None
        report_runs.append(run)
    run_signature = '|'.join(sorted(
        f"{r.get('workflow_id') or r.get('name')}:{r.get('id')}:{r.get('attempt')}:{r.get('jobs_head_sha')}"
        for r in report_runs))
    with DB_LOCK, con() as c:
        journal = c.execute("SELECT status,review_state,head,action_json FROM pm_action_journal "
                            "WHERE kind='refresh_reviews' AND pr_number=? AND head=? ORDER BY updated_at DESC LIMIT 1",
                            (pr_number, head)).fetchone()
        if journal:
            try:
                action = json.loads(journal['action_json'] or '{}')
            except (ValueError, TypeError):
                action = {}
            if (str(action.get('base') or '') == base
                    and str(journal['status'] or '') in ('completed', 'observed')):
                return None
        delivery_key = f'ci-review-followup:{pr_number}:{head}:{base}:{run_signature}'
        prior = c.execute('SELECT id FROM queue WHERE delivery_key=?', (delivery_key,)).fetchone()
        if prior:
            return int(prior['id'])
    run_ids = ', '.join(f"{r.get('id') or '?'} attempt {r.get('attempt') or '?'}" for r in report_runs)
    message = (f"CI REVIEW FOLLOW-UP: #{pr_number} is Ready at exact head {head} on base {base}; "
               f"the newest CI - Test Audit run per workflow is complete and its engineering `report` job passed (run(s) {run_ids}). "
               "The overall workflow conclusion can still fail because exact-head review/merge qualification is downstream. "
               "The local PM worker must read live PR/base/check state and find the source-authorized "
               "refresh_reviews action for this exact candidate. Execute it once through the guarded "
               "journal if authorized; otherwise persist the precise HOLD and route it to the responsible PM. "
               "Do not ask PO to relay or infer lifecycle authorization from CI success.")
    aid = add_activity('SYSTEM', message, 'pm', 'posted')
    return enqueue(aid, 'pm', message, source_actor='SYSTEM', auto_handoff=True,
                    delivery_key=delivery_key, kind='ci_review_followup')


REVIEW_DISPOSITIONS = ('fix_now', 'defer', 'not_valid', 'accepted', 'hold')
RECEIPT = re.compile(r'RECEIPT\s+(RH-\d+-[0-9a-f]{8})', re.I)
RESULT = re.compile(r'RESULT\s+(RH-\d+-[0-9a-f]{8})', re.I)
OWNER_ROLE = {'cli_dev': 'cli dev', 'app_dev': 'app dev'}
HANDOFF_OWNERS = {'cli_dev', 'app_dev', 'browser_pm', 'cli_pm'}
HANDOFF_ACTION_SECONDS = int(os.environ.get("RWT_HANDOFF_ACTION_SECONDS", "3600"))


def _handoff_text(h):
    return (f"REVIEW HANDOFF {h['token']} → {h['owner']}: #{h['pr_number']} reviewed at exact head {h['head']} ({h['reviewed_ref']}); "
            f"disposition {str(h['disposition']).upper()}. Instruction: {h['instruction']}\n"
            f"Receipt required: start a line of your reply with RECEIPT {h['token']} and the action you started; "
            f"when the action is done, start a line with RESULT {h['token']} and the exact evidence. "
            "A receipt is not completion; PM reviews the result.")


def record_review_handoffs(q, handoffs):
    """Persist exact reviewed head + disposition + instruction; deliver with a receipt token.

    Returns (cli_dev_rows, published_blocks, index_map). A review log entry is never delivery completion:
    states go recorded → delivered → received (Dev invoked) → acknowledged (RECEIPT) → result_returned (RESULT).
    c5 (F01): a duplicate of a handoff that is still only 'recorded' (or 'held') is returned again, so the delivery
    it is owed is finished instead of stranded; one already delivered is never delivered twice.
    """
    dev_rows, blocks, rejected, index_map = [], [], [], {}
    items = {x['item_key']: x for x in list_work_items()}
    for index, h in enumerate(handoffs or []):
        if not isinstance(h, dict):
            rejected.append('non-object handoff'); continue
        head = str(h.get('head') or '').lower()
        owner = str(h.get('owner') or '')
        key = str(h.get('work_item_key') or '')
        instruction = str(h.get('instruction') or '').strip()
        disposition = str(h.get('disposition') or '')
        ref = str(h.get('reviewed_ref') or '').strip()
        why = None
        if not re.fullmatch(r'[0-9a-f]{40}', head):
            why = 'exact 40-hex reviewed head required'
        elif owner not in HANDOFF_OWNERS:
            why = 'owner must be a configured agent id'
        elif disposition not in REVIEW_DISPOSITIONS:
            why = f'disposition must be one of {REVIEW_DISPOSITIONS}'
        elif not ref or not instruction:
            why = 'reviewed_ref and an explicit instruction are required'
        elif owner == 'cli_dev' and (items.get(key) or {}).get('owner') != 'cli_dev':
            why = f'cli_dev handoff must name a cli_dev-owned work item (got {key!r})'
        if why:
            rejected.append(f"#{h.get('pr_number')}: {why}"); continue
        with DB_LOCK, con() as c:
            cur = c.execute("INSERT OR IGNORE INTO review_handoffs(pr_number,head,reviewed_ref,disposition,owner,work_item_key,instruction,source_queue_id,created_at) "
                            "VALUES(?,?,?,?,?,?,?,?,?)", (int(h.get('pr_number') or 0), head, ref, disposition, owner, key, instruction, q.get('id'), now()))
            if cur.rowcount:
                hid = cur.lastrowid
                c.execute("UPDATE review_handoffs SET token=? WHERE id=?", (f"RH-{hid}-{head[:8]}", hid))
            row = c.execute("SELECT * FROM review_handoffs WHERE pr_number=? AND head=? AND reviewed_ref=? AND owner=?",
                            (int(h.get('pr_number') or 0), head, ref, owner)).fetchone()
        if not row:
            continue
        index_map[index] = row['id']
        if row['state'] not in ('recorded', 'held', 'blocked'):
            continue  # already delivered once: a duplicate event/restart never delivers it again
        text = _handoff_text(row)
        if owner == 'cli_dev':
            dev_rows.append((row['id'], row['work_item_key'], text))
        else:
            blocks.append((row['id'], text))
    if rejected:
        add_activity('SYSTEM', 'Rejected review handoffs: ' + '; '.join(rejected)[:1000], 'none', 'error', trigger_queue_id=q.get('id'))
    return dev_rows, blocks, index_map


def _mark_handoff(hid, **fields):
    ks = list(fields)
    with DB_LOCK, con() as c:
        c.execute("UPDATE review_handoffs SET " + ",".join(f"{k}=?" for k in ks) + " WHERE id=?", [fields[k] for k in ks] + [hid])


def _dispatch_review_handoff_notification(hid, comment_id=None):
    """Send one exact handoff to its configured actor session; GitHub comment is only audit evidence."""
    with DB_LOCK, con() as c:
        row = c.execute("SELECT * FROM review_handoffs WHERE id=?", (hid,)).fetchone()
        old_notice = c.execute("SELECT * FROM agent_notifications WHERE handoff_id=?", (hid,)).fetchone()
    if not row:
        return {'status': 'missing_handoff', 'handoff_id': hid}
    handoff = dict(row)
    actor_id = handoff['owner']
    action_id = 'review-handoff:' + str(handoff['token'])
    task_id = handoff.get('work_item_key') or f"PR-{handoff['pr_number']}"
    try:
        route = configured_actor_route(actor_id)
        callback_url = _task_callback_url(route.remote_url)
        route_error = ''
    except agent_transport.RouteError as exc:
        route = None
        callback_url = ''
        route_error = str(exc)
    if old_notice:
        notice = dict(old_notice)
        if notice['status'] in ('awaiting_receipt', 'received', 'responded', 'transport_uncertain', 'transport_stalled'):
            return {'status': notice['status'], 'handoff_id': hid}
        if int(notice['attempts'] or 0) > 0:
            return {'status': notice['status'], 'handoff_id': hid, 'error': notice['error']}
        if route is None:
            _mark_handoff(hid, state='blocked', hold_reason=route_error, delivery_comment_id=comment_id)
            with DB_LOCK, con() as c:
                c.execute("UPDATE agent_notifications SET status='blocked_transport',error=?,updated_at=? WHERE handoff_id=? AND attempts=0",
                          (route_error, now(), hid))
            return {'status': 'blocked_transport', 'handoff_id': hid, 'error': route_error}
        if notice['target_session_id'] and (notice['target_session_id'] != route.session_id
                or notice['target_remote_url'] != route.remote_url):
            detail = 'configured recipient session changed after handoff snapshot; issue a new source-authorized handoff'
            _mark_handoff(hid, state='blocked', hold_reason=detail)
            return {'status': 'blocked_transport', 'handoff_id': hid, 'error': detail}
        with DB_LOCK, con() as c:
            c.execute("UPDATE agent_notifications SET target_session_id=?,target_remote_url=?,status='prepared',error='',updated_at=? WHERE handoff_id=? AND attempts=0",
                      (route.session_id, route.remote_url, now(), hid))
    else:
        status = 'blocked_transport' if route is None else 'prepared'
        with DB_LOCK, con() as c:
            c.execute("INSERT OR IGNORE INTO agent_notifications(notification_key,handoff_id,actor_id,task_id,action_id,target_transport,target_session_id,target_remote_url,head,instruction,status,error,created_at,updated_at) "
                      "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (f'handoff:{hid}', hid, actor_id, task_id, action_id, 'codex_app_server',
                       route.session_id if route else '', route.remote_url if route else '', handoff['head'],
                       _handoff_text(handoff), status, route_error, now(), now()))
        if route is None:
            _mark_handoff(hid, state='blocked', hold_reason=route_error, delivery_comment_id=comment_id)
            return {'status': 'blocked_transport', 'handoff_id': hid, 'error': route_error}
    try:
        callback_url = _task_callback_url(route.remote_url)
    except agent_transport.RouteError as exc:
        detail = str(exc)
        with DB_LOCK, con() as c:
            c.execute("UPDATE agent_notifications SET status='blocked_transport',error=?,updated_at=? WHERE handoff_id=? AND attempts=0",
                      (detail, now(), hid))
        _mark_handoff(hid, state='blocked', hold_reason=detail, delivery_comment_id=comment_id)
        return {'status': 'blocked_transport', 'handoff_id': hid, 'error': detail}
    token = _notification_callback_token(action_id, actor_id, route.session_id)
    message = agent_transport.task_message(action_id=action_id, actor_id=actor_id, task_id=task_id,
        instruction=_handoff_text(handoff), target_head=handoff['head'], target_tree='',
        callback_url=callback_url, callback_token=token)
    with DB_LOCK, con() as c:
        changed = c.execute("UPDATE agent_notifications SET status='dispatching',attempts=1,updated_at=? WHERE handoff_id=? AND status='prepared' AND attempts=0",
                            (now(), hid)).rowcount
    if not changed:
        return {'status': 'not_claimed', 'handoff_id': hid}
    try:
        result = agent_transport.queue_message(CODEX_BIN, route, message, timeout=AGENT_TRANSPORT_TIMEOUT)
    except agent_transport.QueueUncertain as exc:
        with DB_LOCK, con() as c:
            c.execute("UPDATE agent_notifications SET status='transport_uncertain',error=?,updated_at=? WHERE handoff_id=? AND status='dispatching'",
                      (str(exc), now(), hid))
        _mark_handoff(hid, state='blocked', hold_reason='Transport outcome uncertain; no retry issued')
        return {'status': 'transport_uncertain', 'handoff_id': hid, 'error': str(exc)}
    except agent_transport.QueueRejected as exc:
        with DB_LOCK, con() as c:
            c.execute("UPDATE agent_notifications SET status='blocked_transport',error=?,updated_at=? WHERE handoff_id=? AND status='dispatching'",
                      (str(exc), now(), hid))
        _mark_handoff(hid, state='blocked', hold_reason=str(exc))
        return {'status': 'blocked_transport', 'handoff_id': hid, 'error': str(exc)}
    stamp = now()
    with DB_LOCK, con() as c:
        c.execute("UPDATE agent_notifications SET status='awaiting_receipt',accepted_at=?,transport_reference=?,updated_at=? WHERE handoff_id=? AND status='dispatching'",
                  (stamp, str(result.get('detail') or '')[:1000], stamp, hid))
        c.execute("UPDATE review_handoffs SET state='delivered',delivered_at=?,delivery_comment_id=?,delivery_queue_id=NULL,hold_reason='' WHERE id=? AND state IN ('recorded','held','blocked')",
                  (stamp, comment_id, hid))
    add_activity('SYSTEM', f"Review handoff {handoff['token']} queued to {actor_id} session {route.session_id}; awaiting actor receipt.",
                 'none', 'delivered', trigger_queue_id=handoff.get('source_queue_id'))
    return {'status': 'awaiting_receipt', 'handoff_id': hid, 'session_id': route.session_id}


def dispatch_review_handoff_notifications(handoff_ids, comment_id=None):
    return [_dispatch_review_handoff_notification(int(hid), comment_id) for hid in handoff_ids]


def _owner_tokens(body, pattern):
    """Tokens the author asserts in their own words: never from quoted lines or a negated mention."""
    found = []
    for line in _unquoted_lines(body):
        for m in pattern.finditer(line):
            if NEGATED.search(line[:m.start()]):
                continue
            found.append(m.group(1))
    return found


def _after_delivery(row, cm):
    """A GitHub receipt must be posted after the delivery that carried its token."""
    if row['delivery_comment_id']:
        return int(cm.get('id') or 0) > int(row['delivery_comment_id'])
    delivered, at = _parse_ts(row['delivered_at']), _parse_ts(cm.get('at'))
    return bool(delivered and at and at >= delivered)


def record_handoff_receipts(comments=None, dev_result=None, queue_id=None):
    """Legacy comment/process evidence is not an authenticated task receipt.

    Actor/session-bound callbacks are the only path that may move a handoff to acknowledged or
    result_returned. Keep this adapter as a no-op for old callers so a GitHub post or subprocess
    transcript cannot impersonate an independently routed actor.
    """
    del comments, dev_result, queue_id
    return []


def list_review_handoffs():
    with DB_LOCK, con() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM review_handoffs ORDER BY id").fetchall()]
    for r in rows:
        r['age_seconds'] = age_seconds(r.get('result_at') or r.get('acknowledged_at') or r.get('received_at')
                                       or r.get('delivered_at') or r.get('created_at'))
    return rows


def _pm_watchdog_wake(kind, msg):
    with DB_LOCK, con() as c:
        aid = c.execute("INSERT INTO activity(actor,message,route,status,created_at) VALUES(?,?,?,?,?)",
                        ('SYSTEM', msg, 'pm', 'posted', now())).lastrowid
        return c.execute("INSERT INTO queue(activity_id,recipient,content,status,created_at,source_actor,handoff_depth,auto_handoff,attempts,kind) "
                         "VALUES(?,?,?,?,?,?,?,?,0,?)", (aid, 'pm', msg, 'queued', now(), 'SYSTEM', 0, 1, kind)).lastrowid


def pending_handoff_watchdog():
    """Receipt and action have separate clocks (c5 F04); each gets ONE PM recovery, then a board blocker.

    - receipt overdue: recorded-but-undelivered (owed delivery, F01), delivered/received/blocked without RECEIPT;
    - action overdue: RECEIPT recorded but no RESULT within RWT_HANDOFF_ACTION_SECONDS.
    A held handoff waits on its prerequisite gate and is not overdue.
    """
    if not bool_setting('auto_pm_github_control', True):
        return None
    all_h = list_review_handoffs()
    with DB_LOCK, con() as c:
        owed_turns = {r['queue_id'] for r in c.execute("SELECT queue_id FROM pm_turn_effects WHERE phase<>'applied'")}
    receipt_open = [h for h in all_h if h['state'] in ('delivered', 'received', 'blocked')
                    or (h['state'] == 'recorded' and h['source_queue_id'] not in owed_turns)]
    action_open = [h for h in all_h if h['state'] == 'acknowledged']
    stale = [h for h in receipt_open if h['recovery_count'] and not h['escalated']
             and (age_seconds(h.get('last_recovery_at')) or 0) >= ASK_ESCALATE_SECONDS]
    stale_action = [h for h in action_open if h['action_recovery_count'] and not h['action_escalated']
                    and (age_seconds(h.get('last_action_recovery_at')) or 0) >= ASK_ESCALATE_SECONDS]
    if stale or stale_action:
        with DB_LOCK, con() as c:
            for h in stale:
                c.execute("UPDATE review_handoffs SET escalated=1 WHERE id=?", (h['id'],))
            for h in stale_action:
                c.execute("UPDATE review_handoffs SET action_escalated=1 WHERE id=?", (h['id'],))
        parts = []
        if stale:
            parts.append(f"{len(stale)} review handoff(s) without owner receipt after one PM recovery: " +
                         ', '.join(f"{h['token']} ({h['owner']}, {h['state']})" for h in stale))
        if stale_action:
            parts.append(f"{len(stale_action)} review handoff(s) received but without owner RESULT after one PM recovery: " +
                         ', '.join(f"{h['token']} ({h['owner']})" for h in stale_action))
        set_setting('pm_handoff_blocker', '; '.join(parts))
        add_activity('SYSTEM', 'BOARD BLOCKER: ' + get_setting('pm_handoff_blocker'), 'none', 'error')
    overdue = [h for h in receipt_open if not h['recovery_count'] and (h['age_seconds'] or 0) >= ASK_OVERDUE_SECONDS]
    overdue_action = [h for h in action_open if not h['action_recovery_count'] and (h['age_seconds'] or 0) >= HANDOFF_ACTION_SECONDS]
    if not (overdue or overdue_action):
        return None
    agent = get_agent('pm') or {}
    if agent.get('paused') or agent.get('status') in ('running', 'auth_required', 'error') or _has_pending_delivery('pm'):
        return None
    lines = [f"- {h['token']} → {h['owner']} ({h['work_item_key'] or 'no task'}): "
             + ('RECORDED, delivery never applied' if h['state'] == 'recorded' else f"state {h['state'].upper()}")
             + f" for {h['age_seconds']}s; no RECEIPT" + (f"; {h['ack_ref']}" if h['ack_ref'] else '') for h in overdue]
    lines += [f"- {h['token']} → {h['owner']} ({h['work_item_key'] or 'no task'}): RECEIPT {h['ack_ref']} but no RESULT for {h['age_seconds']}s"
              for h in overdue_action]
    msg = ('PM handoff watchdog: these review handoffs lack a task-specific owner stage (receipt or result). Inspect each delivery record. '
           'Re-dispatch only through a verified tuple (a NEW handoff for changed facts); never replay a write. '
           'A HOLD needs owner+dependency. This wake retries reconciliation only.\n' + '\n'.join(lines))
    qid = _pm_watchdog_wake('handoff_recovery', msg)
    with DB_LOCK, con() as c:
        for h in overdue:
            c.execute("UPDATE review_handoffs SET recovery_count=recovery_count+1,last_recovery_at=? WHERE id=? AND recovery_count=0",
                      (now(), h['id']))
        for h in overdue_action:
            c.execute("UPDATE review_handoffs SET action_recovery_count=action_recovery_count+1,last_action_recovery_at=? "
                      "WHERE id=? AND action_recovery_count=0", (now(), h['id']))
    return qid


def pending_pin_watchdog():
    """One read-only reconciliation wake per complete packet, never an action retry."""
    if not bool_setting('auto_pm_github_control', True):
        return None
    try:
        comments = json.loads(get_setting('control_checkpoint_context', '[]'))
    except (ValueError, TypeError):
        return None
    pending = []
    for row in comments:
        body = str(row.get('body') or '')
        if not (re.search(r'COMPLETE', body, re.I) and re.search(r'REQUEST[^\n]*push pin', body, re.I)):
            continue
        if not re.search(r'\b[0-9a-f]{40}\b', body):
            continue
        later = [x for x in comments if int(x.get('id') or 0) > int(row.get('id') or 0)]
        # An explicit source-linked pin/HOLD closes the request; no generic ACK does.
        handled = any(str(row.get('id')) in str(x.get('body') or '') and
                      re.search(r'PUSH PIN|HOLD|packet[^\n]*accepted', str(x.get('body') or ''), re.I)
                      for x in later)
        if not handled:
            pending.append(row)
    if not pending:
        set_setting('pm_pending_packet', '')
        return None
    row = pending[0]
    key = str(row.get('id'))
    set_setting('pm_pending_packet', 'Complete packet #' + key + ' requires source-linked pin or HOLD')
    age = age_seconds(row.get('at'))
    if age is None or age < 120 or get_setting('pm_watchdog_packet', '') == key:
        return None
    agent = get_agent('pm') or {}
    if agent.get('paused') or agent.get('status') in ('running', 'auth_required', 'error') or _has_pending_delivery('pm'):
        return None
    # An uncertain publication must be recovered by marker, never replayed by this wake.
    with DB_LOCK, con() as c:
        if c.execute("SELECT 1 FROM pm_outbox WHERE status IN ('publishing','unconfirmed') LIMIT 1").fetchone():
            return None
    msg = ('PM watchdog: complete packet #' + key + ' has waited over 2 minutes without a source-linked pin/HOLD. '
           'Read #1258 and fresh live guards. You are the local delegated PM: issue the exact guarded push pin in your '
           'reconciled reply if evidence/scope permits, otherwise name the precise HOLD. Do not wait for Browser PM chat. '
           'The host publishes your reply; no direct write from your read-only model. Do not duplicate any later actor operation. '
           'This wake retries reconciliation only, not a push, CI dispatch, lifecycle transition or uncertain publication.')
    aid = add_activity('SYSTEM', msg, 'pm', 'posted')
    qid = enqueue(aid, 'pm', msg, source_actor='SYSTEM', auto_handoff=True)
    set_setting('pm_watchdog_packet', key)
    return qid


def github_watcher():
    resumed = False
    while not STOP.is_set():
        try:
            if not resumed and time.time() >= github_backoff_until():
                resume_interrupted_actions()
                resumed = True
            cfg=automation_settings()
            snap, err=github_watch_snapshot()
            set_setting('github_watch_last_poll', now())
            set_setting('github_watch_last_error', str(err or ''))
            if snap is not None:
                current_pr=str(snap.get('pr') or '')
                prior_pr=get_setting('github_watch_pr','')
                raw=get_setting('github_watch_snapshot','')
                prev=None
                try: prev=json.loads(raw) if raw else None
                except Exception: prev=None
                # Durable ask/receipt ledger first: newer coalesced events cannot erase older asks.
                ingest_control_asks(snap.get('control_updates') or [])
                record_handoff_receipts(snap.get('control_updates') or [])
                if prior_pr != current_pr or prev is None:
                    set_setting('github_watch_pr',current_pr)
                    # Anti-idle startup/reselection behavior: the first observed state may already
                    # contain actionable review/CI/head information. Wake PM once to reconcile it
                    # instead of requiring the PO to send a manual sync message.
                    if any(cfg.get(k) for k in ('pm_github_control','pm_github_review','pm_github_ci','pm_github_head','pm_github_deploy')):
                        emit_github_event([
                            'Watcher initialized/reselected this PR; reconcile the current exact-head review/CI state now'
                        ], snap, cfg)
                else:
                    events=github_watch_events(prev,snap,cfg)
                    if events:
                        emit_github_event(events,snap,cfg)
                    # Commit cursor only after durable enqueue succeeds.
                queue_ci_review_followup(snap)
                # Commit cursors and snapshot together only after enqueue above succeeds.
                with DB_LOCK, con() as c:
                    for key, state in snap.get('_pending_comment_cursors', []):
                        c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (key, json.dumps(state, ensure_ascii=False)))
                    saved_snapshot = {k: v for k, v in snap.items() if k != '_pending_comment_cursors'}
                    c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('github_watch_snapshot',?)", (json.dumps(saved_snapshot, sort_keys=True),))
            if not err:
                # c5 (F01): finish owed PM-turn effects (after marker recovery above confirmed any uncertain post).
                resume_owed_pm_turns()
                pending_pin_watchdog()
                recover_packet_verification_notices()
                recover_pending_packet_verifications()
                if time.time() >= github_backoff_until():
                    poll_refreshed_reviews()
                pending_ask_watchdog()
                pending_handoff_watchdog()
            STOP.wait(cfg.get('watch_interval_seconds',GITHUB_WATCH_INTERVAL))
        except Exception as e:
            add_activity('SYSTEM', f'GitHub watcher error: {type(e).__name__}: {e}', 'none', 'error')
            STOP.wait(GITHUB_WATCH_INTERVAL)

def handoff_location(pr_or_task=None):
    """Where agents share files for one PR/task: the local packet root plus its connector-readable remote.

    The remote is a documentation branch, never product main. The board only names it;
    publishing there still requires the actor's explicit push pin and a remote readback.
    """
    n = str(pr_or_task or CONTROL_ISSUE).strip().lstrip('#')
    n = n[3:] if n.upper().startswith('PR-') else n
    if not re.fullmatch(r'[1-9][0-9]{0,8}', n):
        raise ValueError('Handoff PR/task must be a positive number')
    branch = get_setting('handoff_remote_branch', '') or HANDOFF_REMOTE_BRANCH
    path = f'handoffs/PR-{n}/'
    return {
        'pr_or_task': int(n),
        'local_dir': f'<board>/handoffs/PR-{n}/',
        'remote_repo': HANDOFF_REMOTE_REPO,
        'remote_branch': branch,
        'remote_path': path,
        'tree_url': f'https://github.com/{HANDOFF_REMOTE_REPO}/tree/{quote(branch, safe="/")}/{path}' if branch else '',
        'raw_base': f'https://raw.githubusercontent.com/{HANDOFF_REMOTE_REPO}/{quote(branch, safe="/")}/{path}' if branch else '',
        'publication': 'immutable <packet-id>/ directories; UTF-8 patch/source + manifest with SHA-256; explicit push pin + remote readback required',
        'verify': f'GET /api/handoff-verify?pr={n}&path=<packet dir under {path}>&ref=<40-hex commit>',
    }


def _gh_raw(path, ref):
    backoff_until = github_backoff_until()
    if time.time() < backoff_until:
        raise GithubReadError('rate_limited', 'GitHub rate-limit backoff until ' + datetime.fromtimestamp(backoff_until, timezone.utc).isoformat())
    budget_ok, budget_state = reserve_github_request_budget()
    if not budget_ok:
        raise GithubReadError('budget_exhausted',
                              f"Shared GitHub request budget exhausted ({budget_state['used']}/{budget_state['limit']}); resumes at {budget_state['reset_at']}")
    try:
        p = subprocess.run(['gh', 'api', '-H', 'Accept: application/vnd.github.raw',
                            f'repos/{HANDOFF_REMOTE_REPO}/contents/{quote(path)}?ref={ref}'], capture_output=True, timeout=15)
    except subprocess.TimeoutExpired as exc:
        raise GithubReadError('timeout', f'GitHub packet read timed out: {path}') from exc
    except OSError as exc:
        raise GithubReadError('transport', f'GitHub CLI packet read failed: {exc}') from exc
    if p.returncode:
        failure = _github_read_failure(p.stderr or p.stdout, p.returncode)
        if isinstance(failure, GithubReadError) and failure.kind == 'rate_limited':
            _record_github_rate_limit()
        raise failure
    raw = p.stdout or b''
    limit = MAX_PACKET_MANIFEST_BYTES if Path(path).name.lower() == 'manifest.json' else MAX_PACKET_FILE_BYTES
    if len(raw) > limit:
        raise GithubReadError('size_limit', f'GitHub packet file exceeds {limit} bytes: {path}')
    return raw


def _verify_remote_packet(pr_or_task, packet_path, ref, fetch=None):
    """Read a published packet back at an EXACT commit and verify every manifest hash.

    A branch name is mutable and is refused: immutability means a 40-hex commit.
    Supports the board's own manifests (files[].sha256) and packet manifests (packet_files_sha256).
    """
    loc = handoff_location(pr_or_task)
    ref = str(ref or '').lower()
    if not re.fullmatch(r'[0-9a-f]{40}', ref):
        raise ValueError('ref must be the exact 40-hex commit that was read back, not a branch')
    packet_path = str(packet_path or '').strip().strip('/')
    if not packet_path.startswith(loc['remote_path']) or '..' in packet_path.split('/') or '\\' in packet_path:
        raise ValueError(f"packet path must be inside {loc['remote_path']}")
    fetch = fetch or _gh_raw
    deadline = time.monotonic() + PACKET_VERIFY_TIMEOUT_SECONDS
    manifest_name, manifest_bytes = '', None
    for candidate in ('manifest.json', 'MANIFEST.json'):
        if time.monotonic() >= deadline:
            return {'ok': False, 'ref': ref, 'path': packet_path, 'error': 'packet verification exceeded its time budget'}
        try:
            manifest_bytes = fetch(f'{packet_path}/{candidate}', ref)
            manifest_name = candidate
            break
        except FileNotFoundError:
            continue
    if not manifest_name:
        return {'ok': False, 'ref': ref, 'path': packet_path, 'error': 'no manifest.json at this commit'}
    if len(manifest_bytes) > MAX_PACKET_MANIFEST_BYTES:
        return {'ok': False, 'ref': ref, 'path': packet_path, 'manifest': manifest_name, 'error': 'manifest exceeds size limit'}
    try:
        manifest = json.loads(manifest_bytes.decode('utf-8'))
    except (UnicodeError, ValueError) as exc:
        return {'ok': False, 'ref': ref, 'path': packet_path, 'manifest': manifest_name, 'error': f'invalid manifest: {exc}'}
    expected = dict(manifest.get('packet_files_sha256') or {})
    for f in manifest.get('files') or []:
        if isinstance(f, dict) and f.get('name') and f.get('sha256'):
            expected[f['name']] = f['sha256']
    if not expected:
        return {'ok': False, 'ref': ref, 'path': packet_path, 'manifest': manifest_name, 'verified': [], 'mismatched': [], 'missing': [],
                'error': 'manifest lists no per-file SHA-256 in a supported format (files[].sha256 or packet_files_sha256)'}
    if len(expected) > MAX_PACKET_FILES:
        return {'ok': False, 'ref': ref, 'path': packet_path, 'manifest': manifest_name, 'verified': [], 'mismatched': [], 'missing': [],
                'error': f'manifest exceeds the {MAX_PACKET_FILES}-file limit'}
    verified, mismatched, missing = [], [], []
    total_bytes = 0
    for name, sha in sorted(expected.items()):
        if time.monotonic() >= deadline:
            return {'ok': False, 'ref': ref, 'path': packet_path, 'manifest': manifest_name,
                    'verified': verified, 'mismatched': mismatched, 'missing': missing,
                    'error': 'packet verification exceeded its time budget'}
        rel = Path(name)
        if not name or rel.is_absolute() or '..' in rel.parts or '\\' in name or not re.fullmatch(r'[0-9a-fA-F]{64}', str(sha)):
            mismatched.append(name); continue
        try:
            raw = fetch(f'{packet_path}/{name}', ref)
        except FileNotFoundError:
            raw = None
        if raw is not None:
            if len(raw) > MAX_PACKET_FILE_BYTES:
                mismatched.append(name); continue
            total_bytes += len(raw)
            if total_bytes > MAX_PACKET_BYTES:
                return {'ok': False, 'ref': ref, 'path': packet_path, 'manifest': manifest_name,
                        'verified': verified, 'mismatched': mismatched, 'missing': missing,
                        'error': f'packet exceeds the {MAX_PACKET_BYTES}-byte total read limit'}
        if raw is None:
            missing.append(name)
        elif hashlib.sha256(raw).hexdigest() == sha:
            verified.append(name)
        else:
            mismatched.append(name)
    return {'ok': bool(verified) and not mismatched and not missing, 'ref': ref, 'path': packet_path,
            'manifest': manifest_name, 'verified': verified, 'mismatched': mismatched, 'missing': missing}


def _packet_verification_key(pr_or_task, packet_path, ref):
    raw = '\n'.join((str(pr_or_task), str(packet_path), str(ref).lower()))
    return hashlib.sha256(raw.encode()).hexdigest()


def list_packet_verifications(limit=30):
    with DB_LOCK, con() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM packet_verifications ORDER BY updated_at DESC LIMIT ?", (max(1, min(int(limit), 100)),)
        ).fetchall()]
    for row in rows:
        try:
            row['result'] = json.loads(row.pop('result_json') or '{}')
        except (ValueError, TypeError):
            row['result'] = {}
        row['age_seconds'] = age_seconds(row.get('created_at'))
        row['next_attempt_in_seconds'] = max(0, int(row.get('next_attempt_at') or 0) - int(time.time()))
        row.pop('claim_until', None)
    return rows


def _packet_verification_notice(request_key, status, pr_or_task, packet_path, ref, detail):
    delivery_key = f'packet-read:{request_key}:{status}'
    with DB_LOCK, con() as c:
        if c.execute('SELECT 1 FROM queue WHERE delivery_key=?', (delivery_key,)).fetchone():
            return None
    message = (f'PACKET READ {status.upper()} for #{pr_or_task} at exact commit {ref}: {packet_path}. '
               f'{detail[:700]} Read the durable packet_verifications record and route any source findings to its owner.')
    aid = add_activity('SYSTEM', message, 'pm', 'blocker' if status == 'blocked' else 'responded')
    return enqueue(aid, 'pm', message, source_actor='SYSTEM', auto_handoff=True,
                   kind='packet_read', delivery_key=delivery_key)


def recover_packet_verification_notices(limit=50):
    """Close the crash gap between recording a terminal packet result and queueing its PM notice."""
    with DB_LOCK, con() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM packet_verifications WHERE status IN ('verified','blocked') ORDER BY updated_at LIMIT ?",
            (max(1, min(int(limit), 100)),)).fetchall()]
    queued = 0
    for row in rows:
        delivery_key = f"packet-read:{row['request_key']}:{row['status']}"
        with DB_LOCK, con() as c:
            exists = c.execute('SELECT 1 FROM queue WHERE delivery_key=?', (delivery_key,)).fetchone()
        if exists:
            continue
        try:
            result = json.loads(row.get('result_json') or '{}')
        except (ValueError, TypeError):
            result = {}
        detail = row.get('last_error') or ('All manifest hashes verified.' if result.get('ok')
                                           else 'Terminal packet verification result needs PM review.')
        if _packet_verification_notice(row['request_key'], row['status'], row['pr_or_task'],
                                       row['packet_path'], row['ref'], detail):
            queued += 1
    return queued


def _record_packet_verification(pr_or_task, packet_path, ref, result=None, error=None):
    key = _packet_verification_key(pr_or_task, packet_path, ref)
    timestamp = now()
    transient = isinstance(error, GithubReadError) and error.kind in ('rate_limited', 'timeout', 'transport')
    detail = str(error)[:700] if error else str((result or {}).get('error') or '')[:700]
    with DB_LOCK, con() as c:
        previous = c.execute('SELECT status,attempts FROM packet_verifications WHERE request_key=?', (key,)).fetchone()
        attempts = (int(previous['attempts']) if previous else 0) + 1
        if result and result.get('ok'):
            status, next_attempt = 'verified', 0
            detail = ''
        elif transient and attempts < PACKET_VERIFY_RETRY_LIMIT:
            status = 'pending'
            next_attempt = time.time() + min(60 * (2 ** (attempts - 1)), 900)
        else:
            status, next_attempt = 'blocked', 0
        result_json = json.dumps(result or {}, ensure_ascii=False, sort_keys=True)
        c.execute("INSERT INTO packet_verifications(request_key,pr_or_task,packet_path,ref,status,attempts,next_attempt_at,"
                  "claim_until,last_error,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,0,?,?,?,?) "
                  "ON CONFLICT(request_key) DO UPDATE SET status=excluded.status,attempts=excluded.attempts,"
                  "next_attempt_at=excluded.next_attempt_at,claim_until=0,last_error=excluded.last_error,"
                  "result_json=excluded.result_json,updated_at=excluded.updated_at",
                  (key, str(pr_or_task), str(packet_path), str(ref).lower(), status, attempts, next_attempt,
                   detail, result_json, timestamp, timestamp))
        was_pending = bool(previous and previous['status'] in ('pending', 'running'))
    if status == 'blocked' or (status == 'verified' and was_pending):
        _packet_verification_notice(key, status, pr_or_task, packet_path, ref, detail or 'All manifest hashes verified.')
    return {'request_key': key, 'status': status, 'attempts': attempts, 'next_attempt_at': next_attempt,
            'error': detail}


def verify_remote_packet(pr_or_task, packet_path, ref, fetch=None):
    """Verify an immutable packet and persist enough state to recover transient read failures."""
    try:
        result = _verify_remote_packet(pr_or_task, packet_path, ref, fetch)
    except (ValueError, TypeError):
        raise
    except GithubReadError as exc:
        _record_packet_verification(pr_or_task, packet_path, ref, error=exc)
        raise
    _record_packet_verification(pr_or_task, packet_path, ref, result=result)
    return result


def recover_pending_packet_verifications(verifier=None):
    """Retry exact-commit packet reads after persisted backoff; route one terminal result to local PM."""
    if time.time() < github_backoff_until():
        return 0
    verifier = verifier or verify_remote_packet
    claimed = []
    now_ts = time.time()
    with DB_LOCK, con() as c:
        rows = c.execute("SELECT * FROM packet_verifications WHERE status='pending' AND next_attempt_at<=? "
                         "AND claim_until<=? ORDER BY created_at LIMIT ?",
                         (now_ts, now_ts, PACKET_VERIFY_MAX_PER_POLL)).fetchall()
        for row in rows:
            changed = c.execute("UPDATE packet_verifications SET status='running',claim_until=?,updated_at=? "
                                "WHERE request_key=? AND status='pending' AND claim_until<=?",
                                (now_ts + PACKET_VERIFY_TIMEOUT_SECONDS + 30, now(), row['request_key'], now_ts)).rowcount
            if changed:
                claimed.append(dict(row))
    finished = 0
    for row in claimed:
        try:
            verifier(row['pr_or_task'], row['packet_path'], row['ref'])
        except GithubReadError:
            pass  # The wrapper persists the categorized retry/terminal state.
        except Exception as exc:
            _record_packet_verification(row['pr_or_task'], row['packet_path'], row['ref'],
                                        error=GithubReadError('transport', f'{type(exc).__name__}: {exc}'))
        finally:
            with DB_LOCK, con() as c:
                # A crash/reentrant verifier must not leave a claimed row looking active forever.
                c.execute("UPDATE packet_verifications SET status='pending',claim_until=0,next_attempt_at=MIN(next_attempt_at,?),updated_at=? "
                          "WHERE request_key=? AND status='running'", (time.time() + 60, now(), row['request_key']))
            finished += 1
    return finished


def _try_fetch(fetch, path, ref):
    try:
        return fetch(path, ref)
    except FileNotFoundError:
        return None


def save_files(files, handoff_pr=None, handoff_topic="attachments"):
    """Immutable per-task packets. Validate every file before publishing a packet."""
    if not files:
        return []
    scope = str(handoff_pr or CONTROL_ISSUE).strip()
    match = re.fullmatch(r"(?:#|PR-)?([1-9][0-9]{0,8})", scope)
    if not match:
        raise ValueError("Handoff PR/task must be a positive number")
    topic = str(handoff_topic or "attachments").strip()
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}", topic):
        raise ValueError("Handoff topic must contain only letters, numbers, _ or -")
    pending = {}
    total = 0
    def include(name, raw):
        nonlocal total
        if name in pending:
            raise ValueError(f"Duplicate attachment path: {name}")
        if len(raw) > MAX_UPLOAD:
            raise ValueError(f"{name} exceeds 10 MB")
        total += len(raw)
        if len(pending) >= 100 or total > 50 * 1024 * 1024:
            raise ValueError("Handoff packet exceeds 100 files or 50 MB")
        pending[name] = raw
    for f in files:
        name = str(f.get("name", "attachment.bin"))
        if name in ("", ".", "..", "manifest.json") or "/" in name or "\\" in name or any(ord(c) < 32 for c in name):
            raise ValueError("Attachment must have a plain filename")
        data = f.get("data", "")
        if "," in data and data.startswith("data:"):
            data = data.split(",", 1)[1]
        raw = base64.b64decode(data, validate=True)
        include(name, raw)
        if name.lower().endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                for entry in archive.infolist():
                    path = Path(entry.filename)
                    if path.is_absolute() or ".." in path.parts or "\\" in entry.filename or ":" in entry.filename or any(ord(c) < 32 for c in entry.filename):
                        raise ValueError("Unsafe ZIP path")
                    if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                        raise ValueError("ZIP symlinks are not supported")
                    if entry.is_dir():
                        continue
                    if entry.file_size > MAX_UPLOAD or entry.file_size + total > 50 * 1024 * 1024:
                        raise ValueError("ZIP extraction exceeds packet limit")
                    include("unpacked/" + entry.filename, archive.read(entry))
    packet = HANDOFFS / ("PR-" + match.group(1)) / topic / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + "-" + uuid.uuid4().hex[:12])
    packet.mkdir(parents=True, exist_ok=False)
    saved = []
    try:
        remote = handoff_location(match.group(1))
        manifest = {"pr_or_task": int(match.group(1)), "topic": topic, "created_at": datetime.now(timezone.utc).isoformat(),
                    "remote_share": {"branch": remote['remote_branch'], "path": f"{remote['remote_path']}{topic}/{packet.name}/",
                                     "state": "local only until explicitly published and read back"},
                    "files": []}
        for name, raw in pending.items():
            dest = packet / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(raw)
            saved.append((name, dest, len(raw)))
            manifest["files"].append({"name": name, "size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
        manifest_path = packet / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        saved.append(("manifest.json", manifest_path, manifest_path.stat().st_size))
    except Exception:
        shutil.rmtree(packet)
        raise
    return saved


def compose_user_message(message, attachments):
    if not attachments:
        return message
    lines = [message, "", "Attached local files:"]
    for name, path, size in attachments:
        lines.append(f"- {name}: {path} ({size} bytes)")
    return "\n".join(lines)


def resolved_bin(name):
    if not name:
        return None
    p = Path(name).expanduser()
    if p.is_absolute() or "/" in name:
        return str(p) if p.exists() else None
    return shutil.which(name)


def subscription_env(provider):
    """Child environment that favors already-authenticated subscription CLI sessions over API billing."""
    env = os.environ.copy()
    if provider == "codex":
        for key in ("OPENAI_API_KEY", "OPENAI_ADMIN_KEY", "CODEX_API_KEY"):
            env.pop(key, None)
    elif provider == "claude":
        for key in (
            "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
            "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
        ):
            env.pop(key, None)
    return env


def refresh_codex_auth():
    global CODEX_AUTH_OK, CODEX_AUTH_DETAIL
    binary = resolved_bin(CODEX_BIN)
    if not binary:
        CODEX_AUTH_OK = False
        CODEX_AUTH_DETAIL = "Codex CLI not found"
        return False
    try:
        r = subprocess.run(
            [binary, "login", "status"],
            stdin=subprocess.DEVNULL,
            capture_output=True, text=True, timeout=15, env=subscription_env("codex"),
        )
        msg = (r.stdout or r.stderr or "").strip().splitlines()
        CODEX_AUTH_OK = r.returncode == 0
        CODEX_AUTH_DETAIL = (msg[-1][:180] if msg else ("signed in" if CODEX_AUTH_OK else "not signed in"))
        return CODEX_AUTH_OK
    except Exception as e:
        CODEX_AUTH_OK = False
        CODEX_AUTH_DETAIL = f"auth check failed: {type(e).__name__}"
        return False


def pm_transport_mode():
    if PM_MODE == "auto":
        if resolved_bin(CODEX_BIN):
            return "codex"
        if PM_COMMAND:
            return "command"
        if OPENAI_API_KEY:
            return "openai"  # legacy fallback; not preferred
        return "manual"
    return PM_MODE


def load_pm_instructions():
    if PM_INSTRUCTIONS_FILE.exists():
        return PM_INSTRUCTIONS_FILE.read_text(encoding="utf-8")
    return (
        "You are the PM agent for an RWT/MVP software release. Return only JSON with keys message and next. "
        "next must be dev, po, or none. Keep work-in-progress low and remove avoidable handoff latency."
    )


def compact_pr_context():
    snap = pr_snapshot()
    p = snap.get("current")
    if not p:
        return "Current PR: none explicitly selected."
    checks = p.get("statusCheckRollup") or []
    green = sum(1 for x in checks if x.get("conclusion") == "SUCCESS")
    return (
        f"Current PR: #{p.get('number')} {p.get('title')} | head={p.get('headRefOid')} | "
        f"{'Draft' if p.get('isDraft') else 'Ready'} | checks={green}/{len(checks)} | "
        f"reviewDecision={p.get('reviewDecision')}"
    )


def pm_ledger_context():
    """Open asks, review handoffs and the share location travel with EVERY PM turn,
    so a coalesced newer event cannot hide an older unresolved ask."""
    open_asks = list_asks('open')
    asks = [{k: a.get(k) for k in ('id', 'state', 'kind', 'source_comment_id', 'ask_index', 'source_actor', 'task_ref', 'candidate', 'request',
                                    'age_seconds', 'recovery_count', 'escalated', 'handoff_id', 'owner', 'dependency', 'release_event',
                                    'next_action', 'signals')} for a in open_asks]
    linked = {a.get('handoff_id') for a in open_asks if a.get('handoff_id')}
    # c5 (F04): receipt and result are stages, not completion; a RESULT stays visible until PM closes its ask.
    handoffs = [{k: h[k] for k in ('id', 'token', 'pr_number', 'head', 'owner', 'work_item_key', 'disposition', 'state', 'age_seconds',
                                   'ack_ref', 'result_ref', 'hold_reason')}
                for h in list_review_handoffs() if h['state'] != 'result_returned' or h['id'] in linked]
    gates = [{k: w[k] for k in ('item_key', 'dispatch_hold', 'dispatch_hold_since', 'dispatch_hold_release')}
             for w in list_work_items() if w.get('dispatch_hold')]
    try:
        blockers = json.loads(get_setting('pm_action_blockers', '[]'))[-5:]
    except (ValueError, TypeError):
        blockers = []
    return ("OPEN ASKS (pending, held and dispatched; each needs a typed ask_dispositions entry; a generic reply closes nothing; "
            "re-evaluate each HELD ask against its release_event every turn):\n"
            + json.dumps(asks, ensure_ascii=False)
            + "\nOPEN REVIEW HANDOFFS (stages: recorded → delivered → received → acknowledged = owner RECEIPT/started → "
            "result_returned = owner RESULT; close the dispatched ask with a typed completed disposition naming the token only after "
            "you review the RESULT):\n"
            + json.dumps(handoffs, ensure_ascii=False)
            + "\nHELD DEV DISPATCH GATES (persisted; anti-idle honors them; released only by your explicit Dev directive for the task "
            "after its prerequisite completes):\n" + json.dumps(gates, ensure_ascii=False)
            + "\nNAMED EXECUTOR BLOCKERS:\n" + json.dumps(blockers, ensure_ascii=False)
            + "\nDURABLE PACKET READ REQUESTS (exact commit; pending retries remain visible; terminal results route once to CLI PM):\n"
            + json.dumps(list_packet_verifications(10), ensure_ascii=False)
            + "\nSHARED ARTIFACTS for #" + str(CONTROL_ISSUE) + ": " + json.dumps(handoff_location(), ensure_ascii=False) + "\n\n")


def compose_for_pm(q):
    return (
        f"Incoming orchestrator message from {q.get('source_actor','UNKNOWN')}.\n"
        f"Delivery id: {q['id']}; handoff depth: {q.get('handoff_depth',0)}.\n"
        f"{compact_pr_context()}\n\n"
        "RECORDED BOARD (preserve leases; reconcile from checkpoint evidence):\n"
        + json.dumps({"work_items": list_work_items(), "players": list_player_status()}, ensure_ascii=False)
        + "\nLATEST CONTROL CHECKPOINTS (reported facts, not process observations):\n"
        + get_setting("control_checkpoint_context", "No checkpoint fetched; leave external activity unknown") + "\n\n"
        "FIVE-PLAYER RWT PROTOCOL:\n"
        "- PO: one decision owner; provides product decisions and bounded delegation. Do not re-ask for an action already covered by PO delegation.\n"
        "- CLI PM (you): READ-ONLY observer/reconciler in this bundled Codex transport. Do not call GitHub mutation tools in your read-only Codex process. Return typed pm_actions for the separate bounded executor when existing scope authorizes them: " + ', '.join(sorted(PM_ACTION_KINDS)) + ". It rechecks source packet/head/base/concurrency and qualifier. No merge/deploy/Production action is exposed. Actionable reconciled messages are published to #1258 so App Dev can read them; routine status remains on the board. Never tell PO to relay messages.\n"
        "- CLI Dev: engineering worker. One branch/task WRITE lease at a time. If its owned release task is externally blocked, it may claim the highest-priority independent READY RWT task unless another Dev owns it; current release repair preempts lower-priority work.\n"
        "- Browser PM: PM/research worker. May own any non-conflicting PM task, audit GitHub, preflight upcoming gates, prepare acceptance/merge packets, and detect stalls. Never duplicate a CLI PM mutation lease.\n"
        "- App Dev: engineering worker. May claim any independent READY RWT task in an isolated worktree. It is read-only on branches leased to CLI Dev. No push/merge without the appropriate PM/PO authority.\n"
        "QUEUE RULE: one writer per branch/task and one PM mutator per GitHub mutation. The board mechanically rejects conflicting active Dev WRITE leases by owner or branch. Otherwise both PMs and both Devs may work in parallel on independent READY RWT items. P0 release-path work preempts only the actor needed to service it. The board owns waiting and work stealing.\n"
        "DELIVERY PRIORITY: PO > PM/Dev handoff > other > coalesced GitHub watcher events.\n\n"
        + pm_ledger_context() +
        f"MESSAGE:\n{q['content']}\n\n"
        "Return the next PM disposition. Route to dev for executable work owned by CLI Dev; do not block it from independent READY queue work merely because the current PR is externally waiting. "
        "Route to po only for a genuinely uncovered governed decision. Otherwise route to none. "
        "When an existing PO delegation covers merge/deploy/one authorized Production diagnostic, advance without stopping at PO."
    )


def compose_for_dev(q):
    if q.get('kind') in READ_ONLY_DELIVERY_KINDS:
        return (
            "READ-ONLY TASK DELIVERY\n"
            "This is a receipt/checkpoint/release-status request, not a WRITE assignment. Claude Code is launched in Plan mode. This request does not authorize edits, mutations, publication, or lease actions.\n"
            "Do not edit files, run commands, publish, mutate task/player state, transfer/release a lease, or infer permission from a prior task.\n"
            f"DELIVERY #{q['id']} · TASK ACTION {q.get('task_action_id') or '?'} · recipient CLI Dev\n"
            f"FROZEN TARGET: {q.get('target_branch') or '?'} @ {q.get('target_worktree') or '?'}, "
            f"HEAD {q.get('target_head') or '?'}, tree {q.get('target_tree') or '?'}\n"
            f"REQUEST:\n{q['content']}"
        )
    return (
        "CLI DEV CONTRACT:\n"
        "- You hold a WRITE lease only for the branch/task named by the incoming directive. One branch has one writer at a time.\n"
        "- If your owned release task is externally blocked, you may claim the highest-priority independent READY RWT item unless App Dev already owns it. Use an isolated worktree and checkpoint cleanly.\n"
        "- P0/P1 release work on your owned branch preempts your lower-priority task; it does not stop other actors from advancing independent work.\n"
        "- NEVER PUSH unless the incoming directive contains explicit exact push authority/pin for the exact commit/head being pushed. Local-only authorized evidence runs do not need a PM pin when no push is involved.\n"
        "- Never mix bytes from separate queue items or edit a branch leased to App Dev.\n"
        "- Return exact head/tree, tests/gates, clean-tree proof, blockers, and the next required PM action.\n"
        f"- Share files for PR/task N under {handoff_location()['remote_branch']}:handoffs/PR-N/<packet-id>/ (connector-readable) only with an explicit push pin; read back remote head/tree.\n\n"
        f"DELIVERY #{q['id']} from {q.get('source_actor','UNKNOWN')}:\n{q['content']}"
    )


def parse_claude(stdout):
    raw = (stdout or "").strip()
    if not raw:
        return "", None, "empty Claude stdout"
    try:
        obj = json.loads(raw)
    except Exception:
        return raw, None, None
    if isinstance(obj, dict):
        result = obj.get("result") or obj.get("message") or obj.get("content") or raw
        return str(result), obj.get("session_id"), str(result) if obj.get("is_error") else None
    return raw, None, None


def _claude_command(content, sid, existing):
    mode = 'plan' if content.startswith('READ-ONLY TASK DELIVERY\n') else PERMISSION_MODE
    cmd = [CLAUDE_BIN, "-p", content, "--output-format", "json", "--permission-mode", mode]
    if CLAUDE_MODEL:
        cmd += ["--model", CLAUDE_MODEL]
    cmd += ["--resume", sid] if existing else ["--session-id", sid]
    return cmd


def _run_claude_once(content, cwd, sid, existing):
    """Run one bounded Claude turn (c5 F12). Process start is recorded as its own stage; a turn that exceeds
    DEV_TIMEOUT is terminated (then killed) and reported as an error whose writes are unknown."""
    global ACTIVE_DEV_PROC
    cmd = _claude_command(content, sid, existing)
    with PROC_LOCK:
        ACTIVE_DEV_PROC = proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=subscription_env("claude"))
    if ACTIVE_DEV_QUEUE_ID:
        update_queue(ACTIVE_DEV_QUEUE_ID, process_started_at=now(), process_pid=proc.pid)
    timeout_error = None
    try:
        out, err = proc.communicate(timeout=DEV_TIMEOUT)
    except subprocess.TimeoutExpired:
        proc.terminate()
        try:
            out, err = proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            out, err = proc.communicate()
        timeout_error = (f"Dev invocation exceeded {DEV_TIMEOUT}s; process {proc.pid} terminated (exit {proc.returncode}); "
                         "its writes are unknown")
    rc = proc.returncode
    with PROC_LOCK:
        ACTIVE_DEV_PROC = None
    result, ret_sid, parse_err = parse_claude(out)
    return rc, result, ret_sid or sid, timeout_error or parse_err, (err or '').strip()




def claude_transport_error(rc, parse_err, stderr):
    """Return a fatal Claude transport error, or an empty string on success.

    Claude Code legitimately writes warnings/progress to stderr. A successful
    exit with a valid parsed stdout result must not be converted into a board
    transport failure merely because stderr is non-empty.
    """
    if parse_err:
        return parse_err
    if rc != 0:
        return (stderr or f"Claude exited {rc}").strip()
    return ""


def record_readonly_task_stages(queue_id, result):
    """Record worker-reported receipt/result separately from the process-start fact."""
    with DB_LOCK, con() as c:
        row = c.execute("SELECT kind,task_action_id FROM queue WHERE id=?", (queue_id,)).fetchone()
    if not row or row['kind'] not in READ_ONLY_DELIVERY_KINDS or not row['task_action_id']:
        return False
    action_id = re.escape(row['task_action_id'])
    receipt = re.search(rf"(?m)^\s*TASK-RECEIPT\s+{action_id}(?:\s|$)", str(result or ''))
    outcome = re.search(rf"(?m)^\s*TASK-RESULT\s+{action_id}(?:\s|$)", str(result or ''))
    stamp = now()
    with DB_LOCK, con() as c:
        if receipt:
            c.execute("UPDATE queue SET task_receipt_at=COALESCE(task_receipt_at,?),task_receipt_ref=? WHERE id=?",
                      (stamp, f'worker-output:{queue_id}:{row["task_action_id"]}', queue_id))
        if receipt and outcome and receipt.start() < outcome.start():
            c.execute("UPDATE queue SET task_result_at=COALESCE(task_result_at,?),task_result_ref=? WHERE id=?",
                      (stamp, f'worker-output:{queue_id}:{row["task_action_id"]}', queue_id))
    return bool(receipt and outcome and receipt.start() < outcome.start())


def _task_callback_token(queue_id, action_id, actor_id, session_id):
    secret = get_setting('agent_delivery_hmac_secret', '')
    if len(secret) < 32:
        raise RuntimeError('durable task callback secret is unavailable')
    identity = '\0'.join((str(queue_id), str(action_id), str(actor_id), str(session_id)))
    return hmac.new(secret.encode(), identity.encode(), hashlib.sha256).hexdigest()


def _notification_callback_token(action_id, actor_id, session_id):
    secret = get_setting('agent_delivery_hmac_secret', '')
    if len(secret) < 32:
        raise RuntimeError('durable task callback secret is unavailable')
    identity = '\0'.join(('notification', str(action_id), str(actor_id), str(session_id)))
    return hmac.new(secret.encode(), identity.encode(), hashlib.sha256).hexdigest()


def _task_callback_url(remote_url=''):
    configured = os.environ.get('RWT_AGENT_CALLBACK_URL', AGENT_CALLBACK_URL).strip()
    if remote_url:
        if not configured or urlparse(configured).scheme != 'https':
            raise agent_transport.RouteError('remote Codex routes require RWT_AGENT_CALLBACK_URL on HTTPS')
        return configured.rstrip('/') + '/api/agent-task'
    if configured:
        parsed = urlparse(configured)
        if parsed.scheme not in ('http', 'https') or not parsed.netloc:
            raise agent_transport.RouteError('RWT_AGENT_CALLBACK_URL must be an absolute HTTP(S) URL')
        return configured.rstrip('/') + '/api/agent-task'
    return f'http://127.0.0.1:{PORT}/api/agent-task'


def _deliver_existing_codex_task(q, target):
    """Queue to the exact configured Codex session; keep receipt/action pending after acceptance."""
    item = _delivery_assignment(q.get('work_item_key') or '', q.get('kind') or '')
    actor_id = str(target.get('owner') or (item or {}).get('owner') or '')
    try:
        route = configured_actor_route(actor_id)
        callback_url = _task_callback_url(route.remote_url)
    except agent_transport.RouteError as exc:
        raise UnsupportedRecipientTransport(str(exc)) from exc
    if (q.get('target_actor_id') != actor_id or q.get('target_transport') != 'codex_app_server'
            or q.get('target_session_id') != route.session_id or q.get('target_remote_url') != route.remote_url):
        raise UnsupportedRecipientTransport(
            'configured actor/session route differs from the immutable task delivery target; issue a new authorized task action')
    action_id = str(q.get('task_action_id') or '')
    if not action_id or not q.get('target_head') or not q.get('target_tree'):
        raise UnsupportedRecipientTransport('task action or frozen candidate identity is missing')
    token = _task_callback_token(q['id'], action_id, actor_id, route.session_id)
    message = agent_transport.task_message(
        action_id=action_id, actor_id=actor_id, task_id=q['work_item_key'],
        instruction=q['content'], target_head=q['target_head'],
        target_tree=q['target_tree'], callback_url=callback_url, callback_token=token)
    update_queue(q['id'], status='delivering', started_at=now(), launch_attempted_at=now(),
                 attempts=(q.get('attempts') or 0) + 1)
    try:
        result = agent_transport.queue_message(CODEX_BIN, route, message, timeout=AGENT_TRANSPORT_TIMEOUT)
    except agent_transport.QueueUncertain as exc:
        update_queue(q['id'], status='transport_uncertain', error=str(exc), finished_at=now())
        add_activity('SYSTEM', f"Task {action_id} transport outcome is uncertain; no retry was issued.", 'none', 'blocker', trigger_queue_id=q['id'])
        return
    except agent_transport.QueueRejected as exc:
        raise UnsupportedRecipientTransport(str(exc)) from exc
    update_queue(q['id'], status='awaiting_receipt', transport_accepted_at=now(),
                 transport_reference=result.get('detail', '')[:1000], error='')
    add_activity('SYSTEM', f"Task {action_id} queued to {actor_id} session {route.session_id}; awaiting task-specific receipt.",
                 'none', 'delivered', trigger_queue_id=q['id'])


def record_agent_task_callback(payload, token):
    """Accept actor receipt/result only for the frozen task, action and configured session."""
    if not isinstance(payload, dict):
        return 400, {'error': 'JSON object required'}
    action_id = str(payload.get('action_id') or '')
    actor_id = str(payload.get('actor_id') or '')
    session_id = str(payload.get('session_id') or '')
    stage = str(payload.get('stage') or '')
    evidence = str(payload.get('evidence') or '').strip()
    if stage not in ('receipt', 'result') or not evidence or len(evidence) > 4000:
        return 400, {'error': 'stage must be receipt/result and evidence must be 1..4000 characters'}
    with DB_LOCK, con() as c:
        row = c.execute("SELECT * FROM queue WHERE task_action_id=?", (action_id,)).fetchone()
        if not row:
            notice = c.execute("SELECT * FROM agent_notifications WHERE action_id=?", (action_id,)).fetchone()
            if not notice:
                return 404, {'error': 'unknown task action'}
            n = dict(notice)
            if n['actor_id'] != actor_id or n['target_session_id'] != session_id or n['target_transport'] != 'codex_app_server':
                return 403, {'error': 'actor/session does not match the immutable notification route'}
            expected = _notification_callback_token(action_id, actor_id, session_id)
            if not hmac.compare_digest(token, expected):
                return 403, {'error': 'invalid task callback token'}
            digest = hashlib.sha256(evidence.encode()).hexdigest()
            if stage == 'receipt':
                if n['status'] in ('received', 'responded'):
                    return (200, {'ok': True, 'duplicate': True}) if n['receipt_digest'] == digest else (409, {'error': 'conflicting receipt already recorded'})
                if n['status'] != 'awaiting_receipt':
                    return 409, {'error': 'notification is not awaiting recipient receipt'}
                c.execute("UPDATE agent_notifications SET status='received',receipt_at=?,receipt_digest=?,updated_at=? WHERE action_id=? AND status='awaiting_receipt'",
                          (now(), digest, now(), action_id))
                c.execute("UPDATE review_handoffs SET state='acknowledged',ack_ref=?,acknowledged_at=? WHERE id=? AND state='delivered'",
                          (f'callback:{actor_id}:{session_id}:{digest}', now(), n['handoff_id']))
                c.execute("UPDATE asks SET disposition_ref=disposition_ref || ' · receipt notification:' || ? WHERE handoff_id=? AND state='dispatched'",
                          (action_id, n['handoff_id']))
            else:
                if n['status'] == 'responded' and n['result_digest'] == digest:
                    return 200, {'ok': True, 'duplicate': True}
                if n['status'] != 'received' or not n['receipt_at']:
                    return 409, {'error': 'task receipt must be recorded before result'}
                c.execute("UPDATE agent_notifications SET status='responded',result_at=?,result_digest=?,updated_at=? WHERE action_id=? AND status='received'",
                          (now(), digest, now(), action_id))
                c.execute("UPDATE review_handoffs SET state='result_returned',result_ref=?,result_at=? WHERE id=? AND state='acknowledged'",
                          (f'callback:{actor_id}:{session_id}:{digest}', now(), n['handoff_id']))
                c.execute("UPDATE asks SET disposition_ref=disposition_ref || ' · result notification:' || ? WHERE handoff_id=? AND state='dispatched'",
                          (action_id, n['handoff_id']))
                notification_handoff = n['handoff_id']
            notification = dict(n)
            if stage == 'receipt':
                c.execute("UPDATE agent_notifications SET receipt_digest=? WHERE action_id=?", (digest, action_id))
        else:
            notification = None
        if not row and notification:
            pass
        else:
            q = dict(row)
            if (q['target_actor_id'] != actor_id or q['target_session_id'] != session_id
                    or q['target_transport'] != 'codex_app_server'):
                return 403, {'error': 'actor/session does not match the immutable recipient route'}
            expected = _task_callback_token(q['id'], action_id, actor_id, session_id)
            if not hmac.compare_digest(token, expected):
                return 403, {'error': 'invalid task callback token'}
            digest = hashlib.sha256(evidence.encode()).hexdigest()
            if stage == 'receipt':
                if q['status'] in ('received', 'responded'):
                    return (200, {'ok': True, 'duplicate': True}) if q['task_receipt_ref'].endswith(digest) else (409, {'error': 'conflicting receipt already recorded'})
                if q['status'] != 'awaiting_receipt':
                    return 409, {'error': 'task is not awaiting recipient receipt'}
                c.execute("UPDATE queue SET status='received',task_receipt_at=?,task_receipt_ref=? WHERE id=? AND status='awaiting_receipt'",
                          (now(), f'callback:{actor_id}:{session_id}:{digest}', q['id']))
                if q.get('kind') == 'review_handoff':
                    c.execute("UPDATE review_handoffs SET state='acknowledged',ack_ref=?,acknowledged_at=? WHERE delivery_queue_id=? AND state IN ('delivered','received')",
                              (f'callback:{actor_id}:{session_id}:{digest}', now(), q['id']))
                    c.execute("UPDATE asks SET disposition_ref=disposition_ref || ' · receipt dev:' || ? WHERE handoff_id IN (SELECT id FROM review_handoffs WHERE delivery_queue_id=?) AND state='dispatched'",
                              (q['id'], q['id']))
            else:
                if q['status'] == 'responded' and q['task_result_digest'] == digest:
                    return 200, {'ok': True, 'duplicate': True}
                if q['status'] != 'received' or not q['task_receipt_at']:
                    return 409, {'error': 'task receipt must be recorded before result'}
                c.execute("UPDATE queue SET status='responded',task_result_at=?,task_result_ref=?,task_result_digest=?,finished_at=? WHERE id=? AND status='received'",
                          (now(), f'callback:{actor_id}:{session_id}:{digest}', digest, now(), q['id']))
                if q.get('kind') == 'review_handoff':
                    c.execute("UPDATE review_handoffs SET state='result_returned',result_ref=?,result_at=? WHERE delivery_queue_id=? AND state='acknowledged'",
                              (f'callback:{actor_id}:{session_id}:{digest}', now(), q['id']))
                    c.execute("UPDATE asks SET disposition_ref=disposition_ref || ' · result dev:' || ? WHERE handoff_id IN (SELECT id FROM review_handoffs WHERE delivery_queue_id=?) AND state='dispatched'",
                              (q['id'], q['id']))
    if stage == 'result':
        trigger_id = q['id'] if row else None
        aid = add_activity(f"AGENT:{actor_id}", f"TASK-RESULT {action_id}: {evidence}", 'pm', 'responded', trigger_queue_id=trigger_id)
        if bool_setting('auto_pm_github_control', True):
            enqueue(aid, 'pm', f"Actor {actor_id} returned task result {action_id}: {evidence}",
                    source_actor='SYSTEM', auto_handoff=True, delivery_key=f'task-result:{action_id}')
    else:
        trigger_id = q['id'] if row else None
        add_activity(f"AGENT:{actor_id}", f"TASK-RECEIPT {action_id}: {evidence}", 'none', 'received', trigger_queue_id=trigger_id)
    return 200, {'ok': True, 'action_id': action_id, 'stage': stage}


def sweep_agent_delivery_stalls(at=None):
    """One PM recovery for a missed recipient receipt, then an explicit terminal blocker."""
    at = time.time() if at is None else float(at)
    with DB_LOCK, con() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM queue WHERE status='awaiting_receipt' ORDER BY id").fetchall()]
    actions = []
    with DB_LOCK, con() as c:
        notices = [dict(r) for r in c.execute(
            "SELECT handoff_id,status,attempts,updated_at FROM agent_notifications "
            "WHERE status IN ('prepared','blocked_transport','dispatching') ORDER BY handoff_id").fetchall()]
    for notice in notices:
        if notice['status'] == 'dispatching' and (age_seconds(notice['updated_at']) or 0) >= AGENT_TRANSPORT_TIMEOUT + 5:
            with DB_LOCK, con() as c:
                c.execute("UPDATE agent_notifications SET status='transport_uncertain',error=?,updated_at=? WHERE handoff_id=? AND status='dispatching'",
                          ('Board restarted or queue call did not settle; no automatic replay', now(), notice['handoff_id']))
                c.execute("UPDATE review_handoffs SET state='blocked',hold_reason=? WHERE id=? AND state NOT IN ('acknowledged','result_returned')",
                          ('Transport outcome uncertain; reconcile exact session before any new action', notice['handoff_id']))
            actions.append({'handoff_id': notice['handoff_id'], 'status': 'transport_uncertain'})
        elif notice['status'] in ('prepared','blocked_transport') and int(notice['attempts'] or 0) == 0:
            actions.extend(dispatch_review_handoff_notifications([notice['handoff_id']]))
    for row in rows:
        anchor = row.get('transport_recovery_at') or row.get('transport_accepted_at')
        age = age_seconds(anchor) or 0
        if age < AGENT_RECEIPT_TIMEOUT:
            continue
        if int(row.get('transport_recovery_count') or 0) == 0:
            msg = (f"Task delivery {row['task_action_id']} was accepted by the app-server but no matching "
                   f"receipt arrived within {AGENT_RECEIPT_TIMEOUT}s. Recipient={row['target_actor_id']} "
                   f"session={row['target_session_id']}. Reconcile this exact session; do not enqueue a duplicate.")
            aid = add_activity('SYSTEM', msg, 'pm', 'blocker', trigger_queue_id=row['id'])
            recovery_id = enqueue(aid, 'pm', msg, source_actor='SYSTEM', parent_queue_id=row['id'],
                                 auto_handoff=True, delivery_key=f"agent-receipt-recovery:{row['id']}")
            with DB_LOCK, con() as c:
                c.execute("UPDATE queue SET transport_recovery_count=1,transport_recovery_at=? WHERE id=? AND transport_recovery_count=0",
                          (now(), row['id']))
            actions.append({'queue_id': row['id'], 'recovery_queue_id': recovery_id})
        elif age_seconds(row.get('transport_recovery_at')) >= AGENT_RECEIPT_TIMEOUT:
            with DB_LOCK, con() as c:
                c.execute("UPDATE queue SET status='transport_stalled',transport_escalated_at=?,error=? WHERE id=? AND status='awaiting_receipt' AND transport_recovery_count=1",
                          (now(), 'No actor-bound task receipt after one PM recovery; no retry issued', row['id']))
            actions.append({'queue_id': row['id'], 'status': 'transport_stalled'})
    return actions

def _is_stale_model_error(message):
    low = (message or "").lower()
    return "404" in low and ("model:" in low or "model " in low) and ("not_found_error" in low or "not found" in low)


def _is_auth_error(message):
    low = (message or "").lower()
    return "401" in low or "authentication_error" in low or "oauth access token has expired" in low


def _openai_request(path, body):
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        OPENAI_BASE_URL + path,
        data=data,
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=OPENAI_TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI HTTP {e.code}: {detail[:1200]}") from e


def _openai_output_text(obj):
    out = []
    for item in obj.get("output") or []:
        if item.get("type") != "message":
            continue
        for part in item.get("content") or []:
            if part.get("type") in ("output_text", "text") and isinstance(part.get("text"), str):
                out.append(part["text"])
    return "\n".join(out).strip()


def _ensure_pm_conversation(existing):
    if existing:
        return existing
    obj = _openai_request("/conversations", {"metadata": {"app": "rwt-board", "role": "pm", "version": BOARD_VERSION}})
    cid = obj.get("id")
    if not cid:
        raise RuntimeError("OpenAI Conversations API returned no conversation id")
    return cid


# c5 (F10): one route contract for every PM transport. A field the transport omitted takes its
# documented default; anything present must satisfy pm-route.schema.json exactly (no coercion).
ROUTE_DEFAULTS = {"publish": True, "pm_actions": [], "ask_dispositions": [], "review_handoffs": [],
                  "task_deliveries": [], "dev_action_id": None, "dev_depends_on_actions": True}
_ROUTE_SCHEMA_CACHE = {}


def _route_schema():
    key = (str(PM_ROUTE_SCHEMA), PM_ROUTE_SCHEMA.stat().st_mtime_ns if PM_ROUTE_SCHEMA.exists() else 0)
    if key not in _ROUTE_SCHEMA_CACHE:
        _ROUTE_SCHEMA_CACHE.clear()
        _ROUTE_SCHEMA_CACHE[key] = json.loads(PM_ROUTE_SCHEMA.read_text())
    return _ROUTE_SCHEMA_CACHE[key]


_JSON_TYPES = {"object": dict, "array": list, "string": str, "boolean": bool, "null": type(None)}


def _schema_errors(value, schema, path="route"):
    """The JSON Schema subset pm-route.schema.json uses: type, enum, properties,
    additionalProperties=false, items, minItems/maxItems, minLength, pattern.

    `required` is not enforced here: the schema lists every property as required for Codex strict
    output, where null means "no change". At the host an omitted property means the same as null.
    """
    types = schema.get("type")
    if types is not None:
        allowed = types if isinstance(types, list) else [types]
        def ok(t):
            if t == "integer":
                return isinstance(value, int) and not isinstance(value, bool)
            if t == "number":
                return isinstance(value, (int, float)) and not isinstance(value, bool)
            return isinstance(value, _JSON_TYPES[t])
        if not any(ok(t) for t in allowed):
            return [f"{path} must be {'/'.join(allowed)}, got {type(value).__name__}"]
    errors = []
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path} must be one of {schema['enum']}, got {value!r}")
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            errors.append(f"{path} is shorter than {schema['minLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{path} does not match {schema['pattern']}")
    if isinstance(value, list):
        if len(value) > schema.get("maxItems", len(value)):
            errors.append(f"{path} has more than {schema['maxItems']} items")
        if len(value) < schema.get("minItems", 0):
            errors.append(f"{path} has fewer than {schema['minItems']} items")
        if isinstance(schema.get("items"), dict):
            for i, item in enumerate(value):
                errors += _schema_errors(item, schema["items"], f"{path}[{i}]")
    if isinstance(value, dict):
        props = schema.get("properties", {})
        for k, v in value.items():
            if k in props:
                errors += _schema_errors(v, props[k], f"{path}.{k}")
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}.{k} is not an allowed field")
    return errors


def parse_pm_route(raw):
    text = (raw or "").strip()
    if not text:
        return {"message": "PM returned an empty response.", "next": "po", "parse_error": "empty"}
    candidate = text
    if "```" in candidate:
        chunks = [x.strip() for x in candidate.split("```") if x.strip()]
        for ch in chunks:
            if ch.startswith("json"):
                ch = ch[4:].strip()
            if ch.startswith("{") and ch.endswith("}"):
                candidate = ch
                break
    try:
        obj = json.loads(candidate)
        if not isinstance(obj, dict):
            raise ValueError("route must be a JSON object")
        route = dict(obj)
        for k, v in ROUTE_DEFAULTS.items():
            route.setdefault(k, json.loads(json.dumps(v)))
        if isinstance(route.get("message"), str):
            route["message"] = route["message"].strip()
        if route.get("board_updates") is None:
            route.pop("board_updates", None)  # absent/null = no board change
        updates = route.get('board_updates')
        if isinstance(updates, dict) and isinstance(updates.get('work_items'), list):
            for item in updates['work_items']:
                if isinstance(item, dict):
                    item.setdefault('owned_paths', None)
        if isinstance(route.get('ask_dispositions'), list):
            for disposition in route['ask_dispositions']:
                if isinstance(disposition, dict):
                    disposition.setdefault('release_event', None)
        missing = [k for k in ("message", "next") if k not in route]
        errors = [f"route.{k} is required" for k in missing] + _schema_errors(route, _route_schema())
        if errors:
            raise ValueError("; ".join(errors[:8]))
        return {"message": route["message"], "next": route["next"], "publish": route["publish"],
                "board_updates": route.get("board_updates"), "pm_actions": route["pm_actions"],
                "ask_dispositions": route["ask_dispositions"], "review_handoffs": route["review_handoffs"],
                "task_deliveries": route["task_deliveries"],
                "dev_action_id": route["dev_action_id"],
                "dev_depends_on_actions": route["dev_depends_on_actions"], "parse_error": None}
    except Exception as e:
        # Fail safe: never auto-send malformed PM output to Dev.
        return {"message": text, "next": "po", "board_updates": None, "parse_error": str(e)}


def _codex_prompt(content):
    return (
        "PM OPERATING CONTRACT:\n" + load_pm_instructions().strip() +
        "\n\nCURRENT TURN:\n" + content.strip() +
        "\n\nReturn only the JSON object required by the output schema."
    )


def _codex_jsonl_thread_id(stdout):
    thread_id = None
    last_agent_text = None
    for line in (stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except Exception:
            continue
        if event.get("type") == "thread.started" and isinstance(event.get("thread_id"), str):
            thread_id = event["thread_id"]
        item = event.get("item") if isinstance(event.get("item"), dict) else None
        if event.get("type") == "item.completed" and item and item.get("type") in ("agent_message", "message"):
            text = item.get("text") or item.get("content")
            if isinstance(text, str):
                last_agent_text = text
    return thread_id, last_agent_text


def _codex_command(content, session_id, output_file):
    binary = resolved_bin(CODEX_BIN)
    if not binary:
        raise RuntimeError(f"Codex CLI not found: {CODEX_BIN}")
    # Use Codex's explicit stdin sentinel (`-`) instead of a positional prompt.
    # Current Codex treats piped stdin beside a positional prompt as optional
    # appended input; wrappers can then hang or exit when stdin/TTY semantics
    # differ. `codex exec -` and `codex exec resume <id> -` make stdin the
    # intentional prompt source. Popen.communicate(input=...) writes the complete
    # prompt and then closes stdin deterministically.
    common = [binary, "--ask-for-approval", "never", "--sandbox", "read-only", "exec", "--json"]
    if CODEX_MODEL:
        common += ["--model", CODEX_MODEL]
    common += ["--output-schema", str(PM_ROUTE_SCHEMA), "-o", str(output_file)]
    if session_id:
        return common + ["resume", session_id, "-"]
    return common + ["-"]


def _run_pm_codex(content, session_id):
    global ACTIVE_PM_PROC
    if not PM_ROUTE_SCHEMA.exists():
        raise RuntimeError(f"PM route schema not found: {PM_ROUTE_SCHEMA}")
    if CODEX_AUTH_OK is False:
        # Recheck at turn time in case the user logged in after startup.
        refresh_codex_auth()
        if CODEX_AUTH_OK is False:
            raise RuntimeError("Codex CLI is not signed in with ChatGPT; run `codex` and sign in, then retry")
    work = APP / ".agent-work"
    work.mkdir(parents=True, exist_ok=True)
    output_file = work / f"pm-last-{uuid.uuid4().hex}.json"
    cmd = _codex_command(content, session_id, output_file)
    prompt = _codex_prompt(content)
    env = subscription_env("codex")
    cwd = BASE_REPO if Path(BASE_REPO).exists() else str(APP)
    try:
        with PROC_LOCK:
            ACTIVE_PM_PROC = subprocess.Popen(
                cmd, cwd=cwd, stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
            )
        out, err = ACTIVE_PM_PROC.communicate(input=prompt, timeout=PM_TIMEOUT)
        rc = ACTIVE_PM_PROC.returncode
    except subprocess.TimeoutExpired:
        ACTIVE_PM_PROC.kill()
        out, err = ACTIVE_PM_PROC.communicate()
        rc = ACTIVE_PM_PROC.returncode
        output_file.unlink(missing_ok=True)
        raise PMTransportTimeout(f"Codex PM turn timed out after {PM_TIMEOUT}s")
    finally:
        with PROC_LOCK:
            ACTIVE_PM_PROC = None
    thread_id, fallback_text = _codex_jsonl_thread_id(out)
    try:
        raw = output_file.read_text(encoding="utf-8").strip() if output_file.exists() else (fallback_text or "")
    finally:
        try:
            output_file.unlink(missing_ok=True)
        except Exception:
            pass
    if rc != 0:
        # Some Codex failures are emitted as JSONL on stdout rather than stderr.
        # Preserve enough diagnostics for the board instead of collapsing to
        # the unhelpful "Codex exited 1" message.
        detail = (err or fallback_text or out or raw or f"Codex exited {rc}").strip()
        raise RuntimeError(detail[-2000:])
    if not raw:
        raise RuntimeError("Codex CLI returned no PM output")
    return parse_pm_route(raw), (thread_id or session_id)

def _is_codex_auth_error(message):
    low = (message or "").lower()
    return any(x in low for x in (
        "not signed in", "not logged in", "authentication", "unauthorized", "401", "codex login",
    ))


def _run_pm_openai(content, conversation_id):
    cid = _ensure_pm_conversation(conversation_id)
    payload = {
        "model": PM_MODEL,
        "conversation": cid,
        "instructions": load_pm_instructions(),
        "input": [{"role": "user", "content": content}],
    }
    obj = _openai_request("/responses", payload)
    raw = _openai_output_text(obj)
    if not raw:
        raise RuntimeError("OpenAI Responses API returned no PM output text")
    return parse_pm_route(raw), cid


def _run_pm_command(content, session_id):
    global ACTIVE_PM_PROC
    if not PM_COMMAND:
        raise RuntimeError("PM_COMMAND is not configured")
    payload = json.dumps({
        "content": content,
        "session_id": session_id,
        "instructions": load_pm_instructions(),
    })
    with PROC_LOCK:
        ACTIVE_PM_PROC = subprocess.Popen(
            shlex.split(PM_COMMAND), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
    try:
        out, err = ACTIVE_PM_PROC.communicate(payload, timeout=PM_TIMEOUT)
        rc = ACTIVE_PM_PROC.returncode
    except subprocess.TimeoutExpired:
        ACTIVE_PM_PROC.kill()
        out, err = ACTIVE_PM_PROC.communicate()
        rc = ACTIVE_PM_PROC.returncode
        raise RuntimeError(f"PM command timed out after {PM_TIMEOUT}s")
    finally:
        with PROC_LOCK:
            ACTIVE_PM_PROC = None
    if rc != 0:
        raise RuntimeError(err.strip() or f"PM command exited {rc}")
    try:
        obj = json.loads(out)
    except Exception as e:
        raise RuntimeError(f"PM command must return JSON: {e}") from e
    if not isinstance(obj, dict):
        raise RuntimeError("PM command must return a JSON object")
    # c5 (F10): pass the whole route through; only the transport's own session_id is removed.
    sid = obj.pop("session_id", None) or session_id or str(uuid.uuid4())
    raw = json.dumps(obj)
    return parse_pm_route(raw), sid


def run_dev(q):
    if not q.get('work_item_key'):
        raise RuntimeError('Unbound historical delivery: request a new task handoff')
    with DB_LOCK, con() as c:
        current = c.execute("SELECT status FROM queue WHERE id=?", (q['id'],)).fetchone()
    if not current or current['status'] not in ('queued', 'claimed'):
        raise RuntimeError(f"Delivery {q['id']} is not dispatchable from status {current['status'] if current else 'missing'}")
    target = resolve_dev_target(q)
    if not target.get('ok'):
        raise RuntimeError(target['error'])
    # Assigned CLI Dev work belongs to its existing Codex session. Never substitute
    # the bundled Claude subprocess, which could become a second writer.
    _deliver_existing_codex_task(q, target)
    return


def recover_dev_invocation(queue_id):
    """ONE named PM recovery for a Dev invocation that ended without a result (c5 F12).

    Covers launch failure, transport error, timeout, operator stop and a restart mid-turn. It is a
    reconciliation request, never a Dev retry: PM reads back what the turn wrote (task worktree head/tree/
    status, remote branch, published posts) and issues a NEW authorized continuation if work remains.
    Idempotent by delivery key; the owed flag makes it crash-safe.
    """
    with DB_LOCK, con() as c:
        row = c.execute("SELECT * FROM queue WHERE id=?", (queue_id,)).fetchone()
        if not row or not row['invocation_recovery_due']:
            return None
        row = dict(row)
    stage = ('process started (pid %s) at %s' % (row.get('process_pid'), row.get('process_started_at')) if row.get('process_started_at')
             else 'launch attempted at %s; no process started' % row.get('launch_attempted_at') if row.get('launch_attempted_at')
             else 'not launched')
    content = (f"CLI Dev delivery #{queue_id} for {row.get('work_item_key') or 'unbound task'} ended without a Dev result. "
               f"Stage reached: {stage}. Status: {row.get('status')}. Exact error: {row.get('error') or 'unknown'}. "
               f"Tuple: {row.get('target_branch') or '?'} @ {row.get('target_worktree') or '?'} (head at dispatch {row.get('target_head') or '?'}). "
               "Do NOT retry this delivery. Read back what it may have written (task worktree head/tree/status, remote branch, "
               "published comments) and return the reconciled state; issue a NEW authorized continuation only if work remains.")
    with DB_LOCK, con() as c:
        prior = c.execute("SELECT id FROM queue WHERE delivery_key=?", (f'invocation-recovery:{queue_id}',)).fetchone()
        if prior:
            c.execute("UPDATE queue SET invocation_recovery_due=0 WHERE id=?", (queue_id,))
            return prior['id']
        aid = c.execute("INSERT INTO activity(actor,message,route,status,created_at,trigger_queue_id) VALUES(?,?,?,?,?,?)",
                        ('SYSTEM', content, 'pm', 'error', now(), queue_id)).lastrowid
        qid = c.execute(
            "INSERT INTO queue(activity_id,recipient,content,status,created_at,source_actor,parent_queue_id,handoff_depth,"
            "auto_handoff,attempts,kind,work_item_key,target_branch,target_worktree,delivery_key) VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?,?,?)",
            (aid, 'pm', content, 'queued', now(), 'SYSTEM', queue_id, 0, 1, 'dev_invocation_recovery',
             row.get('work_item_key') or '', row.get('target_branch') or '', row.get('target_worktree') or '',
             f'invocation-recovery:{queue_id}')).lastrowid
        c.execute("UPDATE queue SET invocation_recovery_due=0 WHERE id=?", (queue_id,))
        return qid


def sweep_invocation_recoveries():
    """Restart/crash gap: an invoked Dev turn with recovery owed but no recovery row yet."""
    with DB_LOCK, con() as c:
        owed = [r['id'] for r in c.execute("SELECT id FROM queue WHERE invocation_recovery_due=1 ORDER BY id").fetchall()]
    return [recover_dev_invocation(qid) for qid in owed]


def _actionable_cli_dev_assignment(updates):
    """Return an actionable CLI-Dev assignment created/touched by this PM turn, if any.

    Board state is not execution. If PM says CLI Dev owns active work, the board must ensure
    there is a delivery that can actually wake Claude.
    """
    if not isinstance(updates, dict):
        return None
    touched = []
    for item in updates.get('work_items') or []:
        if not isinstance(item, dict):
            continue
        if str(item.get('owner') or '') == 'cli_dev' and str(item.get('state') or '').lower() in WRITE_STATES:
            touched.append(str(item.get('item_key') or ''))
    for player in updates.get('players') or []:
        if not isinstance(player, dict) or player.get('player_id') != 'cli_dev':
            continue
        if str(player.get('status') or '').lower() in ('active','working','running','assigned'):
            if player.get('work_item_key'):
                touched.append(str(player.get('work_item_key')))
    if not touched:
        return None
    items = {x['item_key']: x for x in list_work_items()}
    for key in touched:
        item = items.get(key)
        if item and item.get('owner') == 'cli_dev' and str(item.get('state') or '').lower() in WRITE_STATES:
            signature = json.dumps([item.get(k) for k in ('item_key','branch','worktree','next_action')], sort_keys=True)
            if get_setting('last_executable_assignment', '') == signature or _has_pending_delivery('dev'):
                return None
            if not resolve_dev_target({'work_item_key': item['item_key']}).get('ok'):
                return None
            return item
    return None

def _has_pending_delivery(recipient):
    with DB_LOCK, con() as c:
        return c.execute(
            "SELECT 1 FROM queue WHERE recipient=? AND status IN ('queued','delivering') LIMIT 1",
            (recipient,),
        ).fetchone() is not None

def _wake_cli_dev_for_item(item, reason='PM board assignment'):
    """Create one executable Dev delivery for an active persisted CLI-Dev lease.

    c5 (F02): every wake re-reads the persisted dispatch gate under DB_LOCK and holds the lock through
    the enqueue, so a caller's stale item snapshot cannot dispatch past a HOLD set in between.
    """
    if not item:
        return None
    with DB_LOCK:
        with con() as c:
            fresh = c.execute("SELECT dispatch_hold FROM work_items WHERE item_key=?", (item.get('item_key'),)).fetchone()
        if not fresh or fresh['dispatch_hold'] or _has_pending_delivery('dev'):
            return None
        return _enqueue_cli_dev_wake(item, reason)


def _enqueue_cli_dev_wake(item, reason):
    msg = (
        f"{reason}. Execute RWT work item {item.get('item_key')}: {item.get('title')}. "
        f"Branch/worktree: {item.get('branch') or 'create/use the isolated worktree specified by PM'}. "
        f"Next action: {item.get('next_action') or 'advance the assigned item and return exact evidence to PM'}. "
        "Respect the single-writer lease and current PO/PM authorization boundaries."
    )
    aid = add_activity('SYSTEM', msg, 'dev', 'posted')
    qid = enqueue(aid, 'dev', msg, source_actor='PM', handoff_depth=0, auto_handoff=True, work_item_key=item['item_key'])
    set_setting('anti_idle_cli_dev_signature', f"{item.get('item_key')}|{item.get('updated_at')}")
    return qid

def anti_idle_reconciler():
    """Repair an active CLI-Dev assignment that has no delivery.

    One wake per work-item update signature prevents response loops: after Dev responds, the same
    unchanged assignment is not repeatedly re-enqueued. A new PM assignment/update changes updated_at.
    """
    while not STOP.is_set():
        try:
            sweep_preflight_recoveries()
            sweep_invocation_recoveries()
            sweep_agent_delivery_stalls()
            players = list_player_status()
            p = players.get('cli_dev') or {}
            key = str(p.get('work_item_key') or '')
            items = {x['item_key']: x for x in list_work_items()}
            item = items.get(key) if key else None
            if item and item.get('owner') == 'cli_dev' and str(item.get('state') or '').lower() in WRITE_STATES:
                if item.get('dispatch_hold'):
                    # c5 (F02): the same persisted prerequisite gate the PM route arbiter honors.
                    signature = f"held:{item['item_key']}|{item['updated_at']}|{item.get('dispatch_hold_since')}"
                    if get_setting('anti_idle_cli_dev_signature', '') != signature:
                        update_player_status('cli_dev', status='blocked', blocker='Dispatch held: ' + item['dispatch_hold'][:300],
                                             source='reconciler')
                        set_setting('anti_idle_cli_dev_signature', signature)
                    STOP.wait(2.0)
                    continue
                # An independent task is valid even while another release PR is selected.
                target = resolve_dev_target({'work_item_key': item['item_key']})
                if not target.get('ok'):
                    signature = f"blocked:{item['item_key']}|{item['updated_at']}"
                    if get_setting('anti_idle_cli_dev_signature', '') != signature:
                        update_player_status('cli_dev', status='blocked', blocker=target['error'], source='reconciler')
                        add_activity('SYSTEM', f"Dev dispatch blocked: {target['error']}", 'none', 'error')
                        set_setting('anti_idle_cli_dev_signature', signature)
                    STOP.wait(2.0)
                    continue
                agent = get_agent('dev')
                signature = f"{item.get('item_key')}|{item.get('updated_at')}"
                last = get_setting('anti_idle_cli_dev_signature','')
                if (not agent.get('paused') and agent.get('status') not in ('running','auth_required')
                        and not _has_pending_delivery('dev') and signature != last):
                    _wake_cli_dev_for_item(item, 'Anti-idle repair: CLI Dev has active assigned work but no executable delivery')
            STOP.wait(2.0)
        except Exception as e:
            add_activity('SYSTEM', f'Anti-idle reconciler error: {type(e).__name__}: {e}', 'none', 'error')
            STOP.wait(5.0)

def _pm_request(args):
    obj, err = gh_json(args)
    if err:
        mutation = ('-X' in args and args[args.index('-X')+1] in ('POST', 'PATCH', 'PUT', 'DELETE')
                    or 'graphql' in args and any('mutation(' in x for x in args))
        message = 'GitHub operation failed: ' + err[:300]
        if mutation:
            raise RuntimeError(message)
        if re.search(r'rate limit|secondary rate|HTTP 429|backoff|request budget|timed? ?out|timeout|connection|network|transport|HTTP 50[0-9]', err, re.I):
            kind = ('rate_limited' if re.search(r'rate limit|secondary rate|HTTP 429|backoff', err, re.I) else
                    'budget_exhausted' if 'request budget' in err.lower() else
                    'timeout' if re.search(r'timed? ?out|timeout', err, re.I) else 'transport')
            raise GithubReadError(kind, message)
        raise Hold(message)
    return obj


def _pm_qualify(pr_number, head):
    # Existing gh session only; token is kept in child environment, never output/logged.
    backoff_until = github_backoff_until()
    if time.time() < backoff_until:
        raise Hold('Exact-head qualifier deferred by shared GitHub backoff until ' +
                   datetime.fromtimestamp(backoff_until, timezone.utc).isoformat())
    p = subprocess.run(['gh', 'auth', 'token'], capture_output=True, text=True, timeout=20)
    if p.returncode or not p.stdout.strip():
        raise Hold('Existing GitHub login cannot supply qualification access')
    env = os.environ.copy()
    env.update(GITHUB_TOKEN=p.stdout.strip(), GITHUB_REPOSITORY='relativityE/speaksharp',
               PR_NUMBER=str(pr_number), EXPECTED_HEAD_SHA=head, GITHUB_EVENT_NAME='workflow_dispatch')
    env.pop('REVIEW_QUALIFICATION_FILE', None)
    budget_state = github_request_budget_state()
    if budget_state['remaining'] < 1:
        raise Hold(f"Exact-head qualifier held by shared GitHub request budget ({budget_state['used']}/{budget_state['limit']}); resumes at {budget_state['reset_at']}")
    # Do not estimate the script's cost here. Its Node fetch adapter reserves one unit from
    # this same SQLite window immediately before every api.github.com request, including
    # pagination and optional protection/ruleset reads.
    env.update(
        RWT_GH_BUDGET_APP=str(APP),
        RWT_GH_BUDGET_DB=str(DB),
        RWT_GH_BUDGET_PYTHON=sys.executable,
        RWT_GH_REQUEST_BUDGET_PER_MINUTE=str(GH_REQUEST_BUDGET_PER_WINDOW),
        NODE_OPTIONS=f'--require={APP / "github_budget_preload.cjs"}',
    )
    check = subprocess.run(['node', 'scripts/collect-review-qualification.mjs'], cwd=BASE_REPO,
                           env=env, capture_output=True, text=True, timeout=90)
    if check.returncode or 'REVIEW-QUALIFIED:' not in check.stdout:
        combined = (check.stdout or '') + '\n' + (check.stderr or '')
        if re.search(r'rate limit|secondary rate|abuse detection|HTTP 429', combined, re.I):
            _record_github_rate_limit()
        raise Hold('Exact-head repo qualifier did not pass; no recovery started')


def record_pm_action_blocker(q, detail):
    """Unsupported/invalid typed actions are named, recoverable board blockers — never a generic HOLD."""
    try:
        blockers = json.loads(get_setting('pm_action_blockers', '[]'))
    except (ValueError, TypeError):
        blockers = []
    entry = {'queue_id': q.get('id'), 'detail': detail[:500], 'at': now()}
    if not any(b.get('detail') == entry['detail'] for b in blockers):
        blockers = (blockers + [entry])[-20:]
        set_setting('pm_action_blockers', json.dumps(blockers, ensure_ascii=False))
    add_activity('EXECUTOR', detail, 'none', 'blocker', trigger_queue_id=q.get('id'))


def _journal_phase(key):
    def phase(name):
        with DB_LOCK, con() as c:
            c.execute('UPDATE pm_action_journal SET phase=?,updated_at=? WHERE action_key=?', (name, now(), key))
    return phase


def _executor_for(key):
    return Executor(_pm_request, _pm_qualify, phase=_journal_phase(key))


def _pm_action_scope(action):
    if action.get('pr_number'):
        return f"pr:{int(action['pr_number'])}"
    if action.get('branch'):
        return f"branch:{str(action['branch']).strip()}"
    return ''


def _finish_journal(key, kind, state, result):
    review_state = ('pending' if state == 'completed' else 'code_review_observed' if state == 'observed' else '') if kind == 'refresh_reviews' else ''
    security_state = 'pending' if kind == 'refresh_reviews' and state in ('completed', 'observed') else ''
    acceptance_state = 'pending' if kind == 'refresh_reviews' and state in ('completed', 'observed') else ''
    with DB_LOCK, con() as c:
        c.execute('UPDATE pm_action_journal SET status=?,result=?,updated_at=?, '
                  'review_state=CASE WHEN ?<>\'\' THEN ? ELSE review_state END, '
                  'security_review_state=CASE WHEN ?<>\'\' THEN ? ELSE security_review_state END, '
                  'pm_acceptance_state=CASE WHEN ?<>\'\' THEN ? ELSE pm_acceptance_state END '
                  'WHERE action_key=?', (state, result, now(), review_state, review_state,
                                         security_state, security_state, acceptance_state, acceptance_state, key))


def _resume_refresh(key, action, phase):
    try:
        result = _executor_for(key).resume_refresh(action, phase)
        state = 'completed'
    except Exception as e:
        transient_read = (isinstance(e, GithubReadError) and e.kind in ('rate_limited', 'budget_exhausted', 'timeout', 'transport')
                          or isinstance(e, Hold) and re.search(r'transient|backoff|rate limit|request budget|timed? ?out|timeout|connection|transport', str(e), re.I))
        state = 'unconfirmed' if transient_read or not isinstance(e, Hold) else 'held'
        result = ('HOLD: ' if state == 'held' else 'UNCONFIRMED: ') + str(e)[:500]
    _finish_journal(key, 'refresh_reviews', state, result)
    return state, result


def _resolve_uncertain_action(key, action):
    try:
        result = _executor_for(key).resolve_uncertain(action)
        state = 'completed'
    except Exception as e:
        state = 'unconfirmed'
        result = 'UNCONFIRMED: ' + str(e)[:500]
    _finish_journal(key, action.get('kind', ''), state, result)
    return state, result


def _record_provenance(c, key, action, q):
    """Authorization provenance is kept per request, separate from the semantic operation identity."""
    row = c.execute('SELECT provenance FROM pm_action_journal WHERE action_key=?', (key,)).fetchone()
    try:
        prov = json.loads(row['provenance']) if row else []
    except (ValueError, TypeError):
        prov = []
    entry = {'source_comment_id': action.get('source_comment_id'), 'queue_id': q.get('id'), 'at': now()}
    if not any(p.get('source_comment_id') == entry['source_comment_id'] and p.get('queue_id') == entry['queue_id'] for p in prov):
        prov = (prov + [entry])[-50:]
        c.execute('UPDATE pm_action_journal SET provenance=? WHERE action_key=?', (json.dumps(prov), key))


BLOCKING_RESULT_PREFIXES = ('HOLD:', 'BLOCKED', 'UNCONFIRMED:', 'RECORDED: running', 'RECORDED: unconfirmed')


def action_results_block(results):
    """Typed gate: any action that did not reach a safe terminal state blocks DEPENDENT continuation."""
    return [r for r in results if str(r).startswith(BLOCKING_RESULT_PREFIXES)]


def execute_pm_actions(q, actions):
    if not isinstance(actions, list) or len(actions)>2:
        record_pm_action_blocker(q, 'BLOCKED (invalid PM action batch): pm_actions must be a list of at most 2 typed actions. '
                                    'Recoverable: PM re-plans with a bounded action list.')
        return ['HOLD: invalid bounded action array']
    results=[]
    for action in actions:
        kind = action.get('kind') if isinstance(action, dict) else None
        if kind not in PM_ACTION_KINDS:
            detail = (f"BLOCKED (unsupported PM action): kind={kind!r} is not executable by this board "
                      f"(supported: {', '.join(sorted(PM_ACTION_KINDS))}). Recoverable: an authorized actor performs it "
                      "under existing scope, or CLI Dev adds a guarded executor capability.")
            record_pm_action_blocker(q, detail)
            results.append(detail); continue
        if not bool_setting('pm_bounded_actions', True):
            results.append('HOLD: bounded executor disabled'); continue
        key=canonical_key(action)
        scope=_pm_action_scope(action)
        resume_phase = None
        resolve_uncertain = False
        with DB_LOCK, con() as c:
            row=c.execute('SELECT * FROM pm_action_journal WHERE action_key=?',(key,)).fetchone()
            if row:
                _record_provenance(c, key, action, q)
            if scope:
                owner = c.execute("SELECT action_key,kind FROM pm_action_journal WHERE lease_scope=? "
                                  "AND status IN ('running','unconfirmed') AND action_key<>? LIMIT 1", (scope, key)).fetchone()
                if owner:
                    results.append(f"HOLD: {scope} mutation lease is held by unresolved {owner['kind']} action; read it back first")
                    continue
            if row and row['status'] == 'unconfirmed':
                # Resume only with a won atomic claim. Another connection/process may have claimed
                # the row between our read and this UPDATE; the loser must do no read/write.
                claimed = c.execute("UPDATE pm_action_journal SET status='running',updated_at=? WHERE action_key=? AND status='unconfirmed'",
                                    (now(), key)).rowcount
                if claimed != 1:
                    results.append('RECORDED: running · another request already claimed this resume'); continue
                if kind == 'refresh_reviews' and row['phase']:
                    resume_phase = row['phase']
                elif kind == 'refresh_reviews':
                    # The executor records a phase before its first mutation. No phase
                    # means only preflight reads ran, so retry the guarded preflight.
                    pass
                else:
                    resolve_uncertain = True
            elif row and row['status']!='held':
                results.append('RECORDED: '+row['status']+' · '+row['result']); continue
            else:
                if row:
                    c.execute("DELETE FROM pm_action_journal WHERE action_key=? AND status='held'",(key,))
                try:
                    # Claim by INSERT: a concurrent/duplicate request (any process) loses the claim.
                    c.execute('INSERT INTO pm_action_journal(action_key,status,result,kind,action_json,phase,pr_number,head,updated_at,lease_scope) '
                              'VALUES(?,?,?,?,?,?,?,?,?,?)',
                              (key,'running','Execution started; outcome unconfirmed',kind,json.dumps(action,sort_keys=True),'',
                               int(action.get('pr_number') or 0) or None,str(action.get('head') or ''),now(),scope))
                except sqlite3.IntegrityError:
                    results.append('RECORDED: running · concurrent request already claimed this action'); continue
                _record_provenance(c, key, action, q)
        if resume_phase:
            state, result = _resume_refresh(key, action, resume_phase)
        elif resolve_uncertain:
            state, result = _resolve_uncertain_action(key, action)
        else:
            try:
                result=_executor_for(key).execute(action)
                state='observed' if str(result).startswith('OBSERVED:') else 'completed'
            except Exception as e:
                # A rejected precondition is safe to reconsider on a new candidate/attempt.
                # Network errors can be uncertain; never replay blindly after restart.
                state='held' if isinstance(e, Hold) else 'unconfirmed'
                result=('HOLD: ' if state=='held' else 'UNCONFIRMED: ')+str(e)[:500]
            _finish_journal(key, kind, state, result)
        results.append(result)
        add_activity('EXECUTOR',result,'none',state,trigger_queue_id=q['id'])
    return results


def resume_interrupted_actions():
    """After restart: read back every uncertain mutation; refreshes also resume their journaled lifecycle phase."""
    with DB_LOCK, con() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM pm_action_journal WHERE status='unconfirmed'").fetchall()]
    out = []
    for r in rows:
        try:
            action = json.loads(r['action_json'])
        except (ValueError, TypeError):
            continue
        with DB_LOCK, con() as c:
            claimed = c.execute("UPDATE pm_action_journal SET status='running',updated_at=? WHERE action_key=? AND status='unconfirmed'",
                                (now(), r['action_key'])).rowcount
        if claimed:
            if r.get('kind') == 'refresh_reviews' and r.get('phase'):
                state, result = _resume_refresh(r['action_key'], action, r['phase'])
            elif r.get('kind') == 'refresh_reviews':
                try:
                    result = _executor_for(r['action_key']).execute(action)
                    state = 'observed' if str(result).startswith('OBSERVED:') else 'completed'
                except Exception as e:
                    state = 'held' if isinstance(e, Hold) else 'unconfirmed'
                    result = ('HOLD: ' if state == 'held' else 'UNCONFIRMED: ') + str(e)[:500]
                _finish_journal(r['action_key'], 'refresh_reviews', state, result)
            else:
                state, result = _resolve_uncertain_action(r['action_key'], action)
            add_activity('EXECUTOR', result, 'none', state)
            out.append((r['action_key'], state))
    return out


def poll_refreshed_reviews(request=None):
    """Review completion is observed separately from lifecycle execution, then routed to PM once.

    Only an exact-head Codex review counts as Code review observed; Security is never inferred.
    """
    request = request or _pm_request
    with DB_LOCK, con() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM pm_action_journal WHERE kind='refresh_reviews' AND status='completed' AND review_state='pending'").fetchall()]
    woke = []
    for r in rows:
        try:
            live_pr = request(['api', f"repos/relativityE/speaksharp/pulls/{int(r['pr_number'])}"])
            action = json.loads(r.get('action_json') or '{}')
            live_head = str((live_pr.get('head') or {}).get('sha') or '')
            live_base = str((live_pr.get('base') or {}).get('sha') or '')
            if (str(live_pr.get('state') or '').lower() != 'open' or live_head != r['head']
                    or live_base != str(action.get('base') or '')):
                detail = (f"Review candidate is stale: #{r['pr_number']} now state={live_pr.get('state')} "
                          f"head={live_head or 'unknown'} base={live_base or 'unknown'}; journaled candidate "
                          f"head={r['head']} base={action.get('base') or 'unknown'}")
                with DB_LOCK, con() as c:
                    changed = c.execute("UPDATE pm_action_journal SET review_state='stale_candidate',security_review_state='stale_candidate',"
                                        "pm_acceptance_state='stale_candidate',review_error=?,updated_at=? "
                                        "WHERE action_key=? AND review_state='pending'", (detail, now(), r['action_key'])).rowcount
                if changed:
                    aid = add_activity('SYSTEM', detail + '. No review is attributed to the changed candidate; PM must reconcile the new exact head.', 'pm', 'error')
                    enqueue(aid, 'pm', detail + '. Do not reuse old-head reviews.', source_actor='SYSTEM', auto_handoff=True,
                            delivery_key=f"review-stale:{r['pr_number']}:{r['head']}", kind='review_stale')
                continue
            reviews, read_error = bounded_github_list(request, f"repos/relativityE/speaksharp/pulls/{int(r['pr_number'])}/reviews")
            if read_error:
                raise RuntimeError(read_error)
        except Exception as exc:
            error = f'{type(exc).__name__}: {exc}'[:500]
            with DB_LOCK, con() as c:
                previous = c.execute('SELECT review_error FROM pm_action_journal WHERE action_key=?', (r['action_key'],)).fetchone()
                c.execute('UPDATE pm_action_journal SET review_error=?,updated_at=? WHERE action_key=?', (error, now(), r['action_key']))
            if not previous or previous['review_error'] != error:
                add_activity('SYSTEM', f"Review read for #{r['pr_number']} at {r['head']} is incomplete: {error}; no review status inferred.", 'pm', 'error')
            continue
        with DB_LOCK, con() as c:
            c.execute("UPDATE pm_action_journal SET review_error='',updated_at=? WHERE action_key=?", (now(), r['action_key']))
        hits = [x for x in (reviews or []) if x.get('commit_id') == r['head'] and 'codex' in str((x.get('user') or {}).get('login', '')).lower()]
        if not hits:
            continue
        ids = ','.join(str(x.get('id')) for x in hits)
        msg = (f"REVIEW COMPLETED (Code) for #{r['pr_number']} at exact head {r['head']}: Codex review id(s) {ids}. "
               "Security review status is NOT inferred from this. Read the findings, disposition each one, and return "
               "review_handoffs with an explicit task-specific instruction to the owning Dev. The handoff is complete only "
               "when the owner echoes its RECEIPT token.")
        with DB_LOCK, con() as c:
            changed = c.execute("UPDATE pm_action_journal SET review_state='code_review_observed',updated_at=? "
                                "WHERE action_key=? AND review_state='pending'", (now(), r['action_key'])).rowcount
            if not changed:
                continue
            aid = c.execute("INSERT INTO activity(actor,message,route,status,created_at) VALUES(?,?,?,?,?)",
                            ('SYSTEM', msg, 'pm', 'posted', now())).lastrowid
            qid = c.execute("INSERT INTO queue(activity_id,recipient,content,status,created_at,source_actor,handoff_depth,auto_handoff,attempts,kind) "
                            "VALUES(?,?,?,?,?,?,?,?,0,?)", (aid, 'pm', msg, 'queued', now(), 'SYSTEM', 0, 1, 'review_completed')).lastrowid
        woke.append(qid)
    return woke


def list_review_qualifications():
    """Expose separate exact-candidate Code, Security, and PM-acceptance states."""
    with DB_LOCK, con() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM pm_action_journal WHERE kind='refresh_reviews' "
            "AND status IN ('completed','observed','unconfirmed','held') ORDER BY updated_at DESC LIMIT 100").fetchall()]
    out = []
    for row in rows:
        try:
            action = json.loads(row.get('action_json') or '{}')
        except (ValueError, TypeError):
            action = {}
        out.append({'pr_number': row.get('pr_number'), 'head': row.get('head'), 'base': action.get('base'),
                    'code_state': row.get('review_state') or 'not_observed',
                    'security_state': row.get('security_review_state') or 'not_recorded',
                    'pm_acceptance_state': row.get('pm_acceptance_state') or 'not_recorded',
                    'error': row.get('review_error') or '', 'updated_at': row.get('updated_at')})
    return out


def recover_pm_outbox(comments):
    """Polling can confirm a timed-out POST without issuing another write."""
    instance=get_setting('board_instance_id')
    with DB_LOCK, con() as c:
        pending=c.execute("SELECT * FROM pm_outbox WHERE status IN ('publishing','unconfirmed')").fetchall()
        for row in pending:
            marker='rwt-board-pm:'+instance+':'+str(row['queue_id'])
            found=next((x for x in comments if marker in str(x.get('body') or '')),None)
            if not found or not found.get('id'):
                continue
            c.execute("UPDATE pm_outbox SET status='published',comment_id=? WHERE queue_id=?",(found['id'],row['queue_id']))
            c.execute("UPDATE queue SET status='responded',error=NULL WHERE id=? AND status='responded_unpublished'",(row['queue_id'],))
            c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('pm_outbox_status',?)",
                      (f"Recovered published #1258 comment {found['id']}; awaiting recipient ACK",))


def publish_pm_reply(q, message):
    if not bool_setting('pm_publish_control', True):
        set_setting('pm_outbox_status','PM reply publishing disabled; Dev not notified')
        return False
    if repo_slug(BASE_REPO)!='relativityE/speaksharp' or CONTROL_ISSUE!=1258:
        set_setting('pm_outbox_status','HOLD: PM outbox is scoped to SpeakSharp #1258')
        return False
    marker='rwt-board-pm:'+get_setting('board_instance_id')+':'+str(q['id'])
    body='<!-- '+marker+' -->\nCLI PM → APP DEV / BROWSER PM — automatic board response (delivery '+str(q['id'])+'). Coordination only; this is not new PO merge/deploy/Production authority.\n\n'+message
    with DB_LOCK, con() as c:
        row=c.execute('SELECT * FROM pm_outbox WHERE queue_id=?',(q['id'],)).fetchone()
        if row and row['status']=='published':
            set_setting('pm_outbox_status',f"Published #1258 comment {row['comment_id']}; awaiting recipient ACK")
            return True
    if row:
        # Recover a possibly completed POST by its unique marker, never by repeating it.
        comments, read_error, _staged_cursor = fetch_watch_comments('relativityE/speaksharp', CONTROL_ISSUE)
        comments = comments or []
        found=next((x for x in comments if marker in str(x.get('body') or '')),None)
        if read_error or not found:
            set_setting('pm_outbox_status','Unconfirmed PM post; inspect outbox before retry (no blind replay)')
            set_setting('pm_outbox_error', str(read_error or 'No matching publication marker in bounded comment window')[:500])
            return False
        obj=found
    else:
        with DB_LOCK, con() as c:
            c.execute('INSERT INTO pm_outbox VALUES(?,?,?,?)',(q['id'],'publishing',None,body))
        obj,err=gh_json(['api','-X','POST','repos/relativityE/speaksharp/issues/1258/comments','-f',f'body={body}'])
        if err or not isinstance(obj,dict) or not obj.get('id'):
            with DB_LOCK, con() as c:
                c.execute("UPDATE pm_outbox SET status='unconfirmed' WHERE queue_id=?",(q['id'],))
            set_setting('pm_outbox_status','PM post unconfirmed; no recipient ACK assumed')
            set_setting('pm_outbox_error', str(err or 'GitHub returned no comment ID')[:500])
            add_activity('SYSTEM','PM outbox post unconfirmed; inspect delivery before retry','none','error')
            return False
    with DB_LOCK, con() as c:
        c.execute("UPDATE pm_outbox SET status='published',comment_id=? WHERE queue_id=?",(obj['id'],q['id']))
    set_setting('pm_outbox_error','')
    set_setting('pm_outbox_status',f"Published #1258 comment {obj['id']}; awaiting recipient ACK")
    return True


def run_pm(q):
    global PM_CANCEL_GENERATION
    mode = pm_transport_mode()
    if mode == "manual":
        update_queue(q["id"], status="failed", error="PM transport not configured", finished_at=now())
        set_agent("pm", status="not_configured")
        add_activity("PM", "PM transport is not configured. Install/sign in to Codex CLI, or configure PM_COMMAND / legacy API fallback.", "none", "error")
        return

    a = get_agent("pm")
    sid = a.get("session_id")
    cancel_generation = PM_CANCEL_GENERATION
    update_queue(q["id"], status="delivering", started_at=now(), session_id=sid, attempts=(q.get("attempts") or 0) + 1)
    set_agent("pm", status="running")
    try:
        content = compose_for_pm(q)
        if mode == "codex":
            routed, sid = _run_pm_codex(content, sid)
        elif mode == "openai":
            routed, sid = _run_pm_openai(content, sid)
        elif mode == "command":
            routed, sid = _run_pm_command(content, sid)
        else:
            raise RuntimeError(f"Unsupported PM_MODE={mode}")
    except Exception as e:
        # The Codex PM is read-only; no host executor or outbox runs before this
        # point. Preserve this exact event and retry reasoning, never mutations.
        attempts = (q.get('attempts') or 0) + 1
        if (mode == 'codex' and isinstance(e, PMTransportTimeout)
                and cancel_generation == PM_CANCEL_GENERATION and attempts < 3):
            delay = 15 * attempts
            update_queue(q['id'], status='queued', error=str(e), started_at=None,
                         finished_at=None, session_id=None, available_after=time.time()+delay)
            set_agent('pm', status='idle', session_id=None)
            set_setting('pm_reconciliation_status', f'PM timeout: event #{q["id"]} retained; retry {attempts+1}/3 in {delay}s')
            add_activity('SYSTEM', f'PM timeout recovery: event #{q["id"]} retained, fresh read-only turn in {delay}s; no host action replay.', 'none', 'system')
            return
        update_queue(q["id"], status="failed", error=str(e), finished_at=now(), session_id=sid)
        status = "auth_required" if _is_codex_auth_error(str(e)) or "API key" in str(e) else "error"
        set_agent("pm", status=status, session_id=sid)
        add_activity("PM", f"Transport error: {e}", "none", "error")
        return

    if cancel_generation != PM_CANCEL_GENERATION:
        update_queue(q["id"], status="failed", error="PM turn cancelled by operator", finished_at=now(), session_id=sid)
        set_agent("pm", status="idle", session_id=sid)
        add_activity("SYSTEM", "Cancelled PM response was discarded; no automatic handoff occurred.", "none", "system")
        return

    updates = routed.get("board_updates")
    if (not isinstance(updates, dict) or not updates.get('work_items') or not updates.get('players')):
        detail = 'PM replied without task AND player reconciliation; no executable handoff'
        if routed.get('parse_error'):
            # c5 (F10): name the exact schema failure so the bounded recovery can correct it.
            detail = 'PM route failed the route schema (' + str(routed['parse_error'])[:600] + '); no executable handoff'
        set_setting('pm_reconciliation_status', detail)
        update_queue(q['id'], status='responded_unreconciled', error=detail, finished_at=now(), session_id=sid)
        set_agent('pm', status='idle', session_id=sid)
        add_activity('PM', routed.get('message', ''), 'none', 'unreconciled', trigger_queue_id=q['id'])
        # A missing board patch must not silently swallow a valid addressed reply.
        # Publish text only: do not execute actions or dispatch writers without reconciliation.
        if routed.get('message') and not routed.get('parse_error'):
            if not publish_pm_reply(q, routed['message']):
                update_queue(q['id'], status='responded_unpublished', error=get_setting('pm_outbox_error') or 'Publication unconfirmed')
        add_activity('SYSTEM', detail + '. Text reply publication attempted; no external action or writer dispatch replayed.', 'none', 'error')
        if not str(q.get('content') or '').startswith('RECONCILIATION RECOVERY:'):
            # A returned reply is not a completed checkpoint. One fresh recovery
            # turn prevents silent idle, while a second failure remains visible.
            with DB_LOCK, con() as c:
                uncertain = c.execute("SELECT 1 FROM pm_outbox WHERE queue_id=? AND status IN ('publishing','unconfirmed')", (q['id'],)).fetchone()
            if not uncertain:
                msg = ('RECONCILIATION RECOVERY: prior event #' + str(q['id']) +
                       ' returned no complete task/player checkpoint (' + detail + '). Read current GitHub facts and return both board_updates.work_items and board_updates.players. '
                       'Do not replay prior actions or publication. Original event:\n' + q['content'])
                aid = add_activity('SYSTEM', msg, 'pm', 'posted')
                enqueue(aid, 'pm', msg, source_actor='SYSTEM', parent_queue_id=q['id'], auto_handoff=True)
        return
    update_queue(q["id"], status="responded", finished_at=now(), session_id=sid)
    set_agent("pm", status="idle", session_id=sid)
    accepted = apply_board_updates(updates)
    if not accepted:
        set_setting('pm_reconciliation_status', 'Board patch rejected; inspect lease conflict')
        update_queue(q['id'], status='failed', error='Board patch rejected atomically; reconcile lease before retry', finished_at=now())
        aid = add_activity('PM', 'Board patch rejected atomically; reconcile the recorded lease conflict before dispatch.', 'none', 'error', trigger_queue_id=q['id'])
        return
    set_setting('pm_reconciliation_status', 'Task/player checkpoint applied at ' + now())
    results = execute_pm_actions(q, routed.get('pm_actions') or [])
    blocking = action_results_block(results)
    dependent_hold = bool(blocking) and routed.get('dev_depends_on_actions', True)
    if dependent_hold and routed['next'] == 'dev':
        add_activity('SYSTEM', 'Dependent Dev handoff held: required PM action did not complete — ' + blocking[0][:300],
                     'none', 'blocker', trigger_queue_id=q['id'])
    if results:
        routed['message'] += '\n\nBOUNDED EXECUTOR RESULTS:\n' + '\n'.join(results)
    assigned_dev_item = _actionable_cli_dev_assignment(updates)
    nxt = 'none' if (dependent_hold and routed['next'] == 'dev') else routed['next']
    # A board assignment is not execution. Never end a PM turn with active CLI-Dev work and no Dev
    # delivery merely because the model returned next=none (unless a prerequisite gate holds it).
    if assigned_dev_item and nxt == 'none' and not dependent_hold and bool_setting("auto_pm_to_dev", True):
        nxt = 'dev'
        routed["message"] = (routed["message"] + "\n\nEXECUTION HANDOFF: CLI Dev has active assigned work "
            + assigned_dev_item.get('item_key','') + ". Start it now and return an acknowledgment/evidence packet.")
        add_activity('SYSTEM', f"Corrected PM route none→dev for active CLI Dev assignment {assigned_dev_item.get('item_key')}", 'none', 'system')
    # c5 (F01): the turn's owed effects are persisted BEFORE any of them run, then applied by one
    # idempotent continuation. A crash at any phase resumes from this plan; nothing is decided twice.
    plan = {
        'message': routed['message'], 'next': nxt, 'route_next': routed['next'], 'publish': bool(routed.get('publish', True)),
        'results': results, 'blocking': blocking[:1], 'dependent_hold': bool(dependent_hold),
        'dispositions': routed.get('ask_dispositions') or [], 'review_handoffs': routed.get('review_handoffs') or [],
        'task_deliveries': routed.get('task_deliveries') or [],
        'dev_action_id': routed.get('dev_action_id'),
        'assigned_item': (assigned_dev_item or {}).get('item_key') or '', 'parse_error': routed.get('parse_error') or '',
        'session_id': sid,
    }
    _save_turn_plan(q['id'], plan, 'recording')
    continue_pm_turn(q['id'])


TURN_LOCK = threading.RLock()


def _save_turn_plan(qid, plan, phase):
    with DB_LOCK, con() as c:
        c.execute("INSERT OR REPLACE INTO pm_turn_effects(queue_id,plan_json,phase,updated_at) VALUES(?,?,?,?)",
                  (qid, json.dumps(plan, ensure_ascii=False), phase, now()))


def _load_turn_plan(qid):
    with DB_LOCK, con() as c:
        row = c.execute("SELECT plan_json,phase FROM pm_turn_effects WHERE queue_id=?", (qid,)).fetchone()
        q = c.execute("SELECT * FROM queue WHERE id=?", (qid,)).fetchone()
    if not row or not q:
        return None, None, None
    return json.loads(row['plan_json']), row['phase'], dict(q)


def continue_pm_turn(qid):
    """Apply one PM turn's owed effects, resuming at its persisted phase (c5 F01).

    recording → planned: record review handoffs (idempotent; a duplicate still 'recorded' is returned again);
    planned → published: publish once (an uncertain POST is recovered only by marker readback, never replayed);
    published → applied: ask dispositions, App Dev handoff delivery, then ONE Dev route arbitration whose
    deliveries carry unique keys. Every step is safe to repeat after a crash.
    """
    with TURN_LOCK:
        plan, phase, q = _load_turn_plan(qid)
        if not plan or phase == 'applied':
            return phase
        if phase == 'recording':
            dev_rows, blocks, index_map = record_review_handoffs(q, plan['review_handoffs'])
            plan['handoff_blocks'] = [hid for hid, _ in blocks]
            plan['handoff_dev'] = [[hid, key] for hid, key, _ in dev_rows]
            plan['handoff_index'] = {str(k): v for k, v in index_map.items()}
            if blocks:
                plan['message'] += '\n\n' + '\n\n'.join(text for _, text in blocks)
            plan['needs_publication'] = bool(plan['publish'] or plan['next'] != 'none' or plan['results'] or plan['assigned_item']
                                             or plan['dispositions'] or blocks or plan.get('task_deliveries'))
            _save_turn_plan(qid, plan, 'planned')
            phase = 'planned'
        if phase == 'planned':
            with DB_LOCK, con() as c:
                out = c.execute('SELECT status FROM pm_outbox WHERE queue_id=?', (qid,)).fetchone()
            if not plan['needs_publication']:
                with DB_LOCK, con() as c:
                    c.execute("INSERT OR IGNORE INTO pm_outbox VALUES(?,?,?,?)", (qid, 'local_only', None, plan['message']))
                set_setting('pm_outbox_status', 'Routine reconciliation kept on board; no GitHub post')
            elif not (out and out['status'] == 'published') and not publish_pm_reply(q, plan['message']):
                error = get_setting('pm_outbox_error') or get_setting('pm_outbox_status')
                update_queue(qid, status='responded_unpublished', error=error, finished_at=now())
                set_agent('pm', status='error', session_id=plan.get('session_id'))
                update_player_status('cli_pm', status='blocked', blocker=error, task='Publish PM reply to #1258', source='outbox')
                add_activity('SYSTEM', 'PM publication blocked: ' + error, 'none', 'error')
                return 'planned'  # owed effects wait for marker recovery; never a second POST
            _save_turn_plan(qid, plan, 'published')
            phase = 'published'
        if phase == 'published':
            _apply_turn_effects(q, plan)
            _save_turn_plan(qid, plan, 'applied')
            phase = 'applied'
        return phase


def _apply_turn_effects(q, plan):
    qid = q['id']
    with DB_LOCK, con() as c:
        out = c.execute('SELECT status,comment_id FROM pm_outbox WHERE queue_id=?', (qid,)).fetchone()
    published_ref = (f"comment {out['comment_id']}" if out and out['comment_id'] else f"board delivery {qid}")
    # Asks close and App Dev handoffs count as delivered only after the reply actually published.
    apply_ask_dispositions(q, plan['dispositions'], published_ref, {int(k): v for k, v in (plan.get('handoff_index') or {}).items()})
    with DB_LOCK, con() as c:
        if not plan.get('activity_id'):
            status = "needs_po" if plan['next'] == "po" else "responded"
            plan['activity_id'] = c.execute(
                "INSERT INTO activity(actor,message,route,status,created_at,trigger_queue_id) VALUES(?,?,?,?,?,?)",
                ('PM', plan['message'], plan['next'], status, now(), qid)).lastrowid
            c.execute("UPDATE pm_turn_effects SET plan_json=? WHERE queue_id=?", (json.dumps(plan, ensure_ascii=False), qid))
            if plan.get('parse_error'):
                c.execute("INSERT INTO activity(actor,message,route,status,created_at) VALUES(?,?,?,?,?)",
                          ('SYSTEM', f"PM routing JSON was invalid; failed safe to PO: {plan['parse_error']}", 'none', 'error', now()))
    arbitrate_dev_dispatch(q, plan)
    dispatch_readonly_task_deliveries(q, plan)
    plan['agent_handoff_results'] = dispatch_review_handoff_notifications(
        plan.get('handoff_blocks') or [], out['comment_id'] if out else None)
    _save_turn_plan(qid, plan, 'published')


def _set_dispatch_hold(key, reason, release, source_qid):
    with DB_LOCK, con() as c:
        c.execute("UPDATE work_items SET dispatch_hold=?,dispatch_hold_since=COALESCE(NULLIF(dispatch_hold_since,''),?),"
                  "dispatch_hold_release=?,dispatch_hold_source=? WHERE item_key=?",
                  (reason[:500], now(), release[:300], source_qid, key))


def _clear_dispatch_hold(key):
    with DB_LOCK, con() as c:
        c.execute("UPDATE work_items SET dispatch_hold='',dispatch_hold_since=NULL,dispatch_hold_release='',dispatch_hold_source=NULL "
                  "WHERE item_key=? AND dispatch_hold<>''", (key,))


def _delivery_identity_key(key, item, handoffs, content, explicit_action_id=None):
    """Stable task/action key across PM turns and restarts; a new authorized action gets a new ID/content."""
    if handoffs:
        identity = {'kind': 'review', 'task': key, 'handoffs': sorted(set(int(x) for x in handoffs))}
    elif explicit_action_id:
        identity = {'kind': 'write', 'task': key, 'action_id': str(explicit_action_id)}
    else:
        identity = {'kind': 'write', 'task': key, 'assignment_generation': item.get('assignment_generation'),
                    'branch': item.get('branch'), 'worktree': item.get('worktree'),
                    'next_action': item.get('next_action'), 'instruction': ' '.join(str(content).split())}
    digest = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return 'task-action:' + digest


def dispatch_readonly_task_deliveries(q, plan):
    """Deliver explicitly typed read-only task requests without granting or releasing a WRITE lease."""
    for request in plan.get('task_deliveries') or []:
        action_id = str(request.get('action_id') or '').strip()
        key = str(request.get('task_id') or '').strip()
        action = str(request.get('action') or '').strip()
        recipient = str(request.get('recipient') or '').strip()
        kind = f'readonly_{action}'
        if recipient != 'cli_dev' or action not in READ_ONLY_TASK_ACTIONS or not action_id:
            add_activity('SYSTEM', f'Rejected read-only task delivery: invalid recipient/action/action_id ({recipient!r}/{action!r})',
                         'none', 'error', trigger_queue_id=q.get('id'))
            continue
        item = _delivery_assignment(key, kind)
        if not item or not item.get('branch') or not item.get('worktree'):
            add_activity('SYSTEM', f'Rejected read-only {action} delivery {action_id}: task {key!r} is not owned by CLI Dev in waiting/review state with a bound branch and worktree.',
                         'none', 'error', trigger_queue_id=q.get('id'))
            continue
        if not bool_setting('auto_pm_to_dev', True) or not q.get('auto_handoff'):
            add_activity('SYSTEM', f'Read-only task delivery {action_id} held by the PM→Dev dispatch guard; no action was queued.',
                         'none', 'blocker', trigger_queue_id=q.get('id'))
            continue
        path = item['worktree']
        snapshot = validate_worktree(path)
        if (not snapshot.get('exists') or not snapshot.get('is_git') or snapshot.get('branch') != item['branch']
                or not snapshot.get('snapshot_stable', True)
                or snapshot.get('head') != request.get('target_head')
                or snapshot.get('tree') != request.get('target_tree')
                or _origin_repo_identity(snapshot.get('origin')) != 'relativitye/speaksharp'):
            add_activity('SYSTEM', f'Rejected read-only {action} delivery {action_id}: frozen checkout tuple failed ownership/target validation.',
                         'none', 'error', trigger_queue_id=q.get('id'))
            continue
        delivery_key = 'task-action:' + hashlib.sha256(action_id.encode()).hexdigest()
        with DB_LOCK, con() as c:
            prior = c.execute('SELECT * FROM queue WHERE task_action_id=?', (action_id,)).fetchone()
        if prior:
            if (prior['recipient'] != 'dev' or prior['work_item_key'] != key or prior['kind'] != kind
                    or prior['target_head'] != snapshot['head'] or prior['target_tree'] != snapshot['tree']
                    or prior['target_assignment_generation'] != item.get('assignment_generation')):
                add_activity('SYSTEM', f'Rejected reused read-only action ID {action_id}: its recipient, task, action, or tuple changed.',
                             'none', 'error', trigger_queue_id=q.get('id'))
                continue
            continue  # same durable action already exists; never mutate or relaunch it
        aid = plan.get('activity_id')
        instruction = (f'READ-ONLY {action.upper()} REQUEST {action_id}\n'
                       f'Recipient: CLI Dev. Task: {key}. State: {item.get("state")}.\n'
                       f'Frozen target: {item["branch"]} @ {path}, HEAD {snapshot["head"]}, tree {snapshot["tree"]}.\n'
                       f'Instruction: {request["instruction"].strip()}\n'
                       f'Report exactly two stages in your response: `TASK-RECEIPT {action_id}` when acknowledging this request, and '
                       f'`TASK-RESULT {action_id}` with the read-only checkpoint/result. Do not edit, run mutating commands, publish, '
                       'change task/player state, transfer or release a lease, or treat this request as permission to do so.')
        did = enqueue(aid, 'dev', instruction, source_actor='PM', parent_queue_id=q.get('id'),
                      handoff_depth=int(q.get('handoff_depth') or 0) + 1, auto_handoff=False,
                      work_item_key=key, kind=kind, delivery_key=delivery_key, task_action_id=action_id)
        row = next((r for r in list_queue(500) if r['id'] == did), None)
        if not row or row.get('target_head') != snapshot['head'] or row.get('target_tree') != snapshot['tree']:
            add_activity('SYSTEM', f'Read-only task delivery {action_id} failed frozen-tuple readback; no actor was invoked.',
                         'none', 'error', trigger_queue_id=q.get('id'))


def arbitrate_dev_dispatch(q, plan):
    """The ONE Dev route arbiter for a PM turn (c5 F02/F12).

    Every Dev directive of the turn — explicit review handoffs, next=dev, the active-assignment correction —
    is grouped by task and passes the same gates: dispatch automation (auto_pm_to_dev), the parent's
    continuation control (auto_handoff, handoff depth), the persisted prerequisite gate on the task, and
    the task tuple. A task gets at most ONE delivery per turn (unique key). A held directive is kept
    (handoffs 'held', task gate persisted) and released by a later PM turn that dispatches the task with
    its prerequisites satisfied; the anti-idle reconciler honors the same gate.
    """
    qid = q['id']
    directives = {}
    for hid, key in plan.get('handoff_dev') or []:
        directives.setdefault(key, {'handoffs': [], 'route': False})['handoffs'].append(hid)
    if plan['next'] == 'dev':
        key = plan.get('assigned_item') or (dev_assignment() or {}).get('item_key') or ''
        if key:
            directives.setdefault(key, {'handoffs': [], 'route': False})['route'] = True
        else:
            add_activity('SYSTEM', 'PM routed to Dev but no single active CLI Dev task is assigned; nothing dispatched. '
                         'PM must assign the task (board_updates) before a Dev route can execute.', 'none', 'error', trigger_queue_id=qid)
    if plan.get('dependent_hold'):
        # The actions this turn's Dev work depends on did not complete: hold every task it would have woken.
        held_key = plan.get('assigned_item') or (dev_assignment() or {}).get('item_key') or ''
        if held_key and (plan.get('route_next') == 'dev' or plan.get('assigned_item')):
            directives.setdefault(held_key, {'handoffs': [], 'route': False})
    depth = int(q.get('handoff_depth') or 0) + 1
    created = []
    for key, d in directives.items():
        with DB_LOCK, con() as c:
            item = c.execute("SELECT * FROM work_items WHERE item_key=?", (key,)).fetchone()
            carried = [r['id'] for r in c.execute("SELECT id FROM review_handoffs WHERE work_item_key=? AND owner='cli_dev' AND state='held'",
                                                  (key,)).fetchall()]
        item = dict(item) if item else {}
        handoffs = list(dict.fromkeys(d['handoffs'] + carried))
        reason = release = None
        if plan.get('dependent_hold'):
            reason = 'Prerequisite PM action did not complete: ' + (plan.get('blocking') or ['(unknown)'])[0][:300]
            release = 'a later PM turn that dispatches this task after its prerequisite actions complete'
            _set_dispatch_hold(key, reason, release, qid)
        elif item.get('dispatch_hold') and not (d['handoffs'] or (d['route'] and plan.get('route_next') == 'dev')):
            # Only an EXPLICIT Dev directive for this task (next=dev or a new review handoff) in a turn whose
            # prerequisites completed releases a persisted gate; the none→dev assignment correction does not.
            reason, release = item['dispatch_hold'], item.get('dispatch_hold_release') or 'an explicit PM Dev directive'
        elif not bool_setting('auto_pm_to_dev', True):
            reason, release = 'PM→Dev automatic dispatch is turned off', 'auto_pm_to_dev re-enabled and a PM dispatch'
        elif not q.get('auto_handoff'):
            reason, release = f'parent delivery #{qid} does not allow automatic continuation', 'a new PM/PO directive'
        elif depth > MAX_HANDOFF_DEPTH:
            reason, release = f'automatic handoff depth {depth} exceeds {MAX_HANDOFF_DEPTH}', 'a new PM/PO directive'
        if reason:
            with DB_LOCK, con() as c:
                for hid in handoffs:
                    c.execute("UPDATE review_handoffs SET state='held',hold_reason=? WHERE id=? AND state IN ('recorded','held')",
                              (reason[:300], hid))
            add_activity('SYSTEM', f"Dev dispatch for {key} held: {reason}. Release: {release}.", 'none', 'blocker', trigger_queue_id=qid)
            continue
        _clear_dispatch_hold(key)  # this turn re-planned the task with its prerequisites satisfied
        gate = resolve_dev_target({'work_item_key': key})
        if not gate.get('ok'):
            with DB_LOCK, con() as c:
                for hid in handoffs:
                    c.execute("UPDATE review_handoffs SET state='blocked',ack_ref=? WHERE id=? AND state IN ('recorded','held')",
                              ('preflight: ' + gate['error'][:300], hid))
            add_activity('SYSTEM', f"Dev dispatch blocked before enqueue: {gate['error']}", 'none', 'error', trigger_queue_id=qid)
            queue_preflight_recovery(qid, key, item.get('branch'), item.get('worktree'), gate['error'],
                                     invoked_route=('review handoff from delivery' if handoffs and not d['route'] else 'PM handoff from delivery'))
            continue
        with DB_LOCK, con() as c:
            texts = [_handoff_text(dict(h)) for h in c.execute(
                "SELECT * FROM review_handoffs WHERE id IN (%s) ORDER BY id" % ','.join('?' * len(handoffs)), handoffs).fetchall()] if handoffs else []
        content = '\n\n'.join(([plan['message']] if d['route'] else []) + texts)
        delivery_key = _delivery_identity_key(key, item, handoffs, content, plan.get('dev_action_id'))
        did = enqueue(plan.get('activity_id'), 'dev', content, source_actor='PM', parent_queue_id=qid, handoff_depth=depth,
                      auto_handoff=True, work_item_key=key, kind=('review_handoff' if handoffs else ''),
                      delivery_key=delivery_key)
        with DB_LOCK, con() as c:
            for hid in handoffs:
                c.execute("UPDATE review_handoffs SET state='delivered',delivered_at=?,delivery_queue_id=?,hold_reason='' "
                          "WHERE id=? AND state IN ('recorded','held')", (now(), did, hid))
        created.append(did)
        assigned = next((x for x in list_work_items() if x['item_key'] == key), None)
        if d['route'] and assigned and key == plan.get('assigned_item'):
            set_setting('last_executable_assignment', json.dumps([assigned.get(k) for k in ('item_key','branch','worktree','next_action')], sort_keys=True))
            set_setting('anti_idle_cli_dev_signature', f"{assigned.get('item_key')}|{assigned.get('updated_at')}")
    return created


def resume_owed_pm_turns():
    """Restart/crash/uncertain-publication gap: finish every PM turn whose owed effects were not applied.

    A turn whose publication is uncertain ('publishing'/'unconfirmed' outbox) waits for marker recovery
    (recover_pm_outbox); this sweep never repeats the POST. Returns the phases reached.
    """
    with DB_LOCK, con() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT t.queue_id, o.status AS outbox FROM pm_turn_effects t LEFT JOIN pm_outbox o ON o.queue_id=t.queue_id "
            "WHERE t.phase<>'applied' ORDER BY t.queue_id").fetchall()]
    out = {}
    for r in rows:
        if r['outbox'] in ('publishing', 'unconfirmed'):
            continue
        out[r['queue_id']] = continue_pm_turn(r['queue_id'])
    return out


def maybe_handoff(activity_id, actor, recipient, content, parent_q, work_item_key=None):
    if not parent_q.get("auto_handoff"):
        return None
    depth = int(parent_q.get("handoff_depth") or 0) + 1
    terminal_notice = depth > MAX_HANDOFF_DEPTH and actor.upper() == "DEV" and recipient == "pm"
    if depth > MAX_HANDOFF_DEPTH and not terminal_notice:
        add_activity(
            "SYSTEM",
            f"Automatic {actor}→{recipient.upper()} handoff stopped at depth {depth}; new writer dispatch is suspended. Dev results still reach PM.",
            "none",
            "error",
        )
        return None
    # A loop limit must stop new writer execution, not hide the worker's result.
    # A terminal notice wakes PM once but cannot spawn another automatic Dev turn.
    with DB_LOCK, con() as c:
        prior = c.execute("SELECT id FROM queue WHERE parent_queue_id=? AND recipient=? AND source_actor=? AND kind=''",
                          (parent_q["id"], recipient, actor.upper())).fetchone()
        if prior:
            return prior["id"]
        if terminal_notice:
            content = "Writer handoff limit reached. Reconcile this Dev result; automatic writer continuation is suspended.\n\n" + content
        return enqueue(
            activity_id,
            recipient,
            content,
            source_actor=actor.upper(),
            parent_queue_id=parent_q["id"],
            handoff_depth=depth,
            auto_handoff=not terminal_notice,
            fanout_group=parent_q.get("fanout_group"),
            work_item_key=(work_item_key or (dev_assignment() or {}).get("item_key", "")) if recipient == "dev" else "",
        )


def _blocked_before_invocation(q):
    return (bool(q) and q.get('recipient') == 'dev' and bool(q.get('work_item_key'))
            and str(q.get('status') or '').startswith('failed')
            and not q.get('started_at') and int(q.get('attempts') or 0) == 0)


def _preflight_recovery_content(parent_id, key, branch, worktree, error, *, invoked_route):
    return (
        f"CLI Dev {invoked_route} #{parent_id} for {key} was blocked before Dev invocation. "
        f"Expected branch/worktree: {branch or '(not recorded)'} / {worktree or '(not recorded)'}. "
        f"Exact preflight error: {error}. "
        "Inspect the persisted task/player lease. If the target worktree does not exist, "
        "assign a bounded bootstrap on a verified available checkout, then atomically transfer the same task lease "
        "to the tuple Dev actually creates. Do not retry this delivery or queue a second writer until the tuple is verified. "
        "Return the task-specific route, worker invocation result, and Dev ACK/checkpoint."
    )


def queue_preflight_recovery(parent_id, key, branch, worktree, error, *, invoked_route='delivery'):
    """Queue exactly one PM recovery for a pre-invocation Dev block. Atomic and idempotent.

    The recovery is a system repair, not a writer continuation: it is exempt from the
    handoff-depth cap and from a parent's auto_handoff=0. Loops are bounded instead by
    tuple: a second block on the SAME task tuple after a recovery was already issued is an
    explicit board blocker, not another PM wake.
    """
    with DB_LOCK, con() as c:
        prior = c.execute("SELECT id FROM queue WHERE parent_queue_id=? AND kind='preflight_recovery' LIMIT 1",
                          (parent_id,)).fetchone()
        if prior:
            c.execute("UPDATE queue SET preflight_recovery_due=0 WHERE id=?", (parent_id,))
            return prior['id']
        repeat = c.execute(
            "SELECT r.id AS rid, r.parent_queue_id AS pid FROM queue r WHERE r.kind='preflight_recovery' "
            "AND r.work_item_key=? AND r.target_branch=? AND r.target_worktree=? ORDER BY r.id LIMIT 1",
            (key, branch or '', worktree or ''),
        ).fetchone()
        if repeat:
            blocker = (f"Repeated pre-invocation block on unchanged tuple {branch or '?'} @ {worktree or '?'} "
                       f"(first recovery #{repeat['rid']} for delivery #{repeat['pid']}); PM must rebind a verified tuple")
            c.execute("UPDATE queue SET preflight_recovery_due=0 WHERE id=?", (parent_id,))
            c.execute("UPDATE work_items SET blocker=?, blocker_since=COALESCE(blocker_since,?), bootstrap_state='required', "
                      "bootstrap_verified_at=NULL,bootstrap_verified_head='',bootstrap_verified_tree='' WHERE item_key=?",
                      (blocker, now(), key))
            c.execute("UPDATE player_status SET status='blocked', blocker=?, source='preflight', updated_at=? WHERE player_id='cli_dev'",
                      (blocker, now()))
            c.execute("INSERT INTO activity(actor,message,route,status,created_at,trigger_queue_id) VALUES(?,?,?,?,?,?)",
                      ('SYSTEM', 'BOARD BLOCKER: ' + blocker, 'none', 'error', now(), parent_id))
            return None
        c.execute("UPDATE work_items SET bootstrap_state='required',bootstrap_verified_at=NULL,"
                  "bootstrap_verified_head='',bootstrap_verified_tree='' WHERE item_key=?", (key,))
        content = _preflight_recovery_content(parent_id, key, branch, worktree, error, invoked_route=invoked_route)
        aid = c.execute("INSERT INTO activity(actor,message,route,status,created_at,trigger_queue_id) VALUES(?,?,?,?,?,?)",
                        ('SYSTEM', content, 'pm', 'error', now(), parent_id)).lastrowid
        qid = c.execute(
            "INSERT INTO queue(activity_id,recipient,content,status,created_at,source_actor,parent_queue_id,handoff_depth,"
            "auto_handoff,attempts,kind,work_item_key,target_branch,target_worktree) VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?,?)",
            (aid, 'pm', content, 'queued', now(), 'SYSTEM', parent_id, 0, 1, 'preflight_recovery',
             key, branch or '', worktree or ''),
        ).lastrowid
        c.execute("UPDATE queue SET preflight_recovery_due=0 WHERE id=?", (parent_id,))
        return qid


def recover_failed_dev_preflight(queue_id, error):
    """Wake PM once when an assigned Dev task fails before the Claude worker starts.

    A missing or mismatched task worktree is a routing/preflight failure, not a Dev result.
    Never retry it as another writer turn: PM must repair the task tuple/bootstrap route first.
    """
    with DB_LOCK, con() as c:
        saved = c.execute("SELECT * FROM queue WHERE id=?", (queue_id,)).fetchone()
        q = dict(saved) if saved else None
    if not _blocked_before_invocation(q):
        return None
    return queue_preflight_recovery(q['id'], q['work_item_key'], q.get('target_branch'), q.get('target_worktree'),
                                    error or q.get('error') or 'unknown preflight error')


def sweep_preflight_recoveries():
    """Restart/crash gap: a failure persisted with recovery owed but no recovery row yet."""
    with DB_LOCK, con() as c:
        owed = [dict(r) for r in c.execute("SELECT id,error FROM queue WHERE preflight_recovery_due=1 ORDER BY id").fetchall()]
    return [recover_failed_dev_preflight(r['id'], r.get('error')) for r in owed]


def fail_delivery(recipient, q, e):
    """Persist the failure and the owed recovery in ONE write, then queue the recovery.

    If the process dies between the two steps, sweep_preflight_recoveries() finishes it.
    """
    owed = False
    if q:
        with DB_LOCK, con() as c:
            row = c.execute("SELECT * FROM queue WHERE id=?", (q["id"],)).fetchone()
            owed = recipient == 'dev' and _blocked_before_invocation(dict(row or {}, status='failed'))
            c.execute("UPDATE queue SET status='failed', error=?, finished_at=?, preflight_recovery_due=? WHERE id=?",
                      (str(e), now(), 1 if owed else 0, q["id"]))
        set_agent(recipient, status="error")
    add_activity("SYSTEM", f"{recipient.upper()} worker error: {e}", "none", "error")
    return recover_failed_dev_preflight(q['id'], str(e)) if owed else None


def worker(recipient):
    """One independent delivery worker per orchestrated agent.

    PM and Dev can therefore make progress concurrently instead of a long Dev
    turn blocking GitHub/PO work for PM (or vice versa). Each agent still runs
    only one turn at a time.
    """
    while not STOP.is_set():
        q = None
        try:
            q = next_queue(recipient)
            if not q:
                time.sleep(.35)
                continue
            agent = get_agent(recipient)
            if not agent or agent.get("paused"):
                release_uninvoked_claim(q)
                time.sleep(.35)
                continue
            if recipient == "dev":
                run_dev(q)
            elif recipient == "pm":
                run_pm(q)
            else:
                update_queue(q["id"], status="failed", error=f"unknown recipient {recipient}", finished_at=now())
        except Exception as e:
            if isinstance(e, UnsupportedRecipientTransport):
                block_delivery_for_transport(q, e)
            else:
                fail_delivery(recipient, q, e)
            time.sleep(.5)


def kill_agent(agent_id):
    global ACTIVE_DEV_PROC, ACTIVE_PM_PROC, PM_CANCEL_GENERATION, DEV_STOP_REQUESTED
    if agent_id == "dev":
        with PROC_LOCK:
            p = ACTIVE_DEV_PROC
            if p and p.poll() is None:
                DEV_STOP_REQUESTED = ACTIVE_DEV_QUEUE_ID
                p.terminate()
                try:
                    p.wait(timeout=3)
                except Exception:
                    p.kill()
                set_agent("dev", status="idle")
                return True
    if agent_id == "pm":
        PM_CANCEL_GENERATION += 1
        killed = False
        with PROC_LOCK:
            p = ACTIVE_PM_PROC
            if p and p.poll() is None:
                p.terminate()
                try:
                    p.wait(timeout=3)
                except Exception:
                    p.kill()
                killed = True
        a = get_agent("pm")
        if a and a.get("status") == "running":
            killed = True
        set_agent("pm", status="idle")
        return killed
    return False


def _worktree_dirty_snapshot(path):
    status = subprocess.run(["git", "-C", path, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
                            capture_output=True, timeout=5)
    if status.returncode:
        raise RuntimeError(status.stderr.decode(errors='replace')[:300] or 'git status failed')
    entries = [entry for entry in status.stdout.split(b'\0') if entry]
    dirty_paths = []
    idx = 0
    while idx < len(entries):
        entry = entries[idx]
        if len(entry) >= 4:
            dirty_paths.append(os.fsdecode(entry[3:]))
            if (b'R' in entry[:2] or b'C' in entry[:2]) and idx + 1 < len(entries):
                idx += 1
                dirty_paths.append(os.fsdecode(entries[idx]))
        idx += 1
    diff = subprocess.run(["git", "-C", path, "diff", "--binary", "HEAD"], capture_output=True, timeout=5)
    untracked = subprocess.run(["git", "-C", path, "ls-files", "--others", "--exclude-standard", "-z"],
                               capture_output=True, timeout=5)
    if diff.returncode or untracked.returncode:
        raise RuntimeError('could not fingerprint dirty checkout')
    fingerprint = hashlib.sha256(diff.stdout + b'\0UNTRACKED\0')
    for rel in untracked.stdout.split(b'\0'):
        if not rel:
            continue
        fingerprint.update(rel + b'\0')
        file_path = Path(path) / os.fsdecode(rel)
        if file_path.is_symlink():
            fingerprint.update(b'LINK\0' + os.fsencode(os.readlink(file_path)))
        elif file_path.is_file():
            fingerprint.update(str(file_path.stat().st_mode & 0o7777).encode() + b'\0')
            with file_path.open('rb') as source:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    fingerprint.update(chunk)
    return dirty_paths, fingerprint.hexdigest()


def validate_worktree(path):
    p = Path(path)
    out = {"path": path, "exists": p.exists(), "is_git": False}
    if not p.exists():
        return out
    try:
        git = subprocess.run(["git", "-C", path, "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=5)
        out["is_git"] = git.returncode == 0
        if out["is_git"]:
            out["root"] = git.stdout.strip()
            out["branch"] = subprocess.run(["git", "-C", path, "branch", "--show-current"], capture_output=True, text=True, timeout=5).stdout.strip() or "(detached)"
            out["head"] = subprocess.run(["git", "-C", path, "rev-parse", "HEAD"], capture_output=True, text=True, timeout=5).stdout.strip()
            out["tree"] = subprocess.run(["git", "-C", path, "rev-parse", "HEAD^{tree}"], capture_output=True, text=True, timeout=5).stdout.strip()
            common = subprocess.run(["git", "-C", path, "rev-parse", "--git-common-dir"], capture_output=True, text=True, timeout=5)
            out["repo_common_dir"] = str((Path(path) / common.stdout.strip()).resolve()) if common.returncode == 0 else ""
            remote = subprocess.run(["git", "-C", path, "remote", "get-url", "origin"], capture_output=True, text=True, timeout=5)
            out["origin"] = remote.stdout.strip() if remote.returncode == 0 else ""
            dirty_paths, dirty_fingerprint = _worktree_dirty_snapshot(path)
            out["dirty_paths"] = dirty_paths
            out["clean"] = not dirty_paths
            out["dirty_fingerprint"] = dirty_fingerprint
            head_after = subprocess.run(["git", "-C", path, "rev-parse", "HEAD"], capture_output=True, text=True, timeout=5)
            tree_after = subprocess.run(["git", "-C", path, "rev-parse", "HEAD^{tree}"], capture_output=True, text=True, timeout=5)
            branch_after = subprocess.run(["git", "-C", path, "branch", "--show-current"], capture_output=True, text=True, timeout=5)
            origin_after = subprocess.run(["git", "-C", path, "remote", "get-url", "origin"], capture_output=True, text=True, timeout=5)
            common_after = subprocess.run(["git", "-C", path, "rev-parse", "--git-common-dir"], capture_output=True, text=True, timeout=5)
            dirty_paths_after, fingerprint_after = _worktree_dirty_snapshot(path)
            out["snapshot_stable"] = (head_after.returncode == 0 and head_after.stdout.strip() == out["head"]
                                      and tree_after.returncode == 0 and tree_after.stdout.strip() == out["tree"]
                                      and branch_after.returncode == 0 and (branch_after.stdout.strip() or "(detached)") == out["branch"]
                                      and origin_after.returncode == 0 and origin_after.stdout.strip() == out["origin"]
                                      and common_after.returncode == 0
                                      and str((Path(path) / common_after.stdout.strip()).resolve()) == out["repo_common_dir"]
                                      and dirty_paths_after == dirty_paths and fingerprint_after == dirty_fingerprint)
    except Exception as e:
        out["error"] = str(e)
    out["node_modules"] = (p / "node_modules").exists()
    out["frontend_node_modules"] = (p / "frontend" / "node_modules").exists()
    out["env"] = (p / ".env").exists()
    return out


def _origin_repo_identity(origin):
    value = str(origin or '').strip().lower()
    value = re.sub(r'^git@github\.com:', '', value)
    value = re.sub(r'^https?://github\.com/', '', value)
    value = value.removesuffix('.git').strip('/')
    return value


def _git_common_dir(path):
    try:
        root = subprocess.run(['git', '-C', str(path), 'rev-parse', '--show-toplevel'],
                              capture_output=True, text=True, timeout=5)
        common = subprocess.run(['git', '-C', str(path), 'rev-parse', '--git-common-dir'],
                                capture_output=True, text=True, timeout=5)
        if root.returncode or common.returncode:
            return ''
        return str((Path(root.stdout.strip()) / common.stdout.strip()).resolve())
    except (OSError, subprocess.TimeoutExpired):
        return ''


def _iso_now_dt():
    return datetime.now(timezone.utc)


def _current_checks(checks):
    latest = {}
    for x in checks or []:
        # GraphQL rollup keeps separate check suites/events. Never deduplicate cancelled report
        # rows from distinct suites, which may still be required by protection.
        key = (x.get('name') or x.get('context'), x.get('workflowName'), (x.get('checkSuite') or {}).get('id') or x.get('detailsUrl') or x.get('targetUrl') or id(x))
        previous = latest.get(key)
        stamp = str(x.get('startedAt') or x.get('completedAt') or '')
        if previous is None or stamp > str(previous.get('startedAt') or previous.get('completedAt') or ''):
            latest[key] = x
    return list(latest.values())


def _pr_gate_summary(p):
    checks = _current_checks((p or {}).get('statusCheckRollup') or [])
    out = {'total': len(checks), 'green': 0, 'running': 0, 'failed': 0, 'other': 0,
           'history_note': 'Exact-head check rows; required-check authority remains GitHub branch protection'}
    for x in checks:
        status = str(x.get('status') or x.get('state') or '').upper()
        conclusion = str(x.get('conclusion') or x.get('state') or '').upper()
        if conclusion == 'SUCCESS': out['green'] += 1
        elif status in ('IN_PROGRESS','QUEUED','PENDING','WAITING','REQUESTED','EXPECTED'): out['running'] += 1
        elif conclusion in ('FAILURE','FAILED','TIMED_OUT','ACTION_REQUIRED','CANCELLED','ERROR'): out['failed'] += 1
        else: out['other'] += 1
    return out


def _release_blocker(pr, release_item):
    p = pr.get("current") if isinstance(pr, dict) else None
    owner = (release_item or {}).get("owner") or "unassigned"
    cause = (release_item or {}).get("blocker") or ""
    next_action = (release_item or {}).get("next_action") or ""
    key = "work-item:" + str((release_item or {}).get("item_key") or "none") + ":" + cause
    if pr.get("error"):
        return {"key":"github-unavailable", "text":"GitHub status unavailable", "owner":"cli_pm", "cause":pr["error"], "next_action":"Restore GitHub access and reconcile; cached activity is not current qualification", "po_required":False}
    if not p:
        return {"key":"no-current-pr","text":"No Current PR selected","owner":"cli_pm","cause":"Release control has no selected PR","next_action":"Select the active release PR.","po_required":False}
    if p.get("mergedAt") or str(p.get("state") or "").upper() == "MERGED":
        return {"key":f"merged:{p.get('number')}","text":"Merged — advance deployment/diagnostic","owner":"cli_pm","cause":"PR merge is complete; release train must immediately advance","next_action":"Advance the explicit queue; verify deployment and obtain required run authority before Production tests.","po_required":False}
    if p.get("isDraft"):
        return {"key":f"draft:{p.get('headRefOid')}","text":"Draft / repair candidate","owner":owner,"cause":"Current release PR is Draft","next_action":"Finish the exact repair packet; PM pins/marks Ready.","po_required":False}
    g = _pr_gate_summary(p)
    if g['running'] and g['failed']:
        return {'key':f"running-failed:{p.get('headRefOid')}", 'text':'CI running; failed/cancelled rows also present',
                'owner':'cli_pm','cause':f"{g['running']} running, {g['failed']} failed/cancelled check rows; GitHub protection is authoritative",
                'next_action':'Wait for active CI; inspect required checks before sequential recovery. Never overlap retries.', 'po_required':False}
    if g["failed"]:
        return {"key":f"failed:{p.get('headRefOid')}:{g['failed']}","text":"Failed checks need disposition","owner":"cli_pm","cause":f"{g['failed']} reported check row(s) failed/cancelled; required status must be verified","next_action":"Attribute failures; repair only genuine release defects, otherwise rerun/qualify the correct protected lane.","po_required":False}
    if g["running"]:
        return {"key":f"running:{p.get('headRefOid')}:{g['running']}","text":"External review / CI running","owner":"external","cause":f"{g['running']} exact-head check(s) are still pending/running","next_action":"CLI PM monitors; all other players consume independent READY RWT work.","po_required":False}
    if p.get("mergeStateStatus") == "CLEAN" and g["total"] and g["green"] == g["total"] and str(p.get("reviewDecision") or "").upper() not in ("CHANGES_REQUESTED", "REVIEW_REQUIRED"):
        return {"key":f"ready-merge:{p.get('headRefOid')}","text":"GitHub merge state CLEAN; guard required","owner":"cli_pm","cause":"Reported checks are green; named executor must verify review receipts and exact head/base authority","next_action":"Named executor checks exact-head/base authority and guarded merge; verify resulting release before any separately authorized run.","po_required":False}
    return {"key":key,"text":cause or "Release item in progress","owner":owner,"cause":cause or "Awaiting current release-item transition","next_action":next_action,"po_required":bool((release_item or {}).get("po_required"))}


def _update_blocker_clock(blocker):
    key = str((blocker or {}).get("key") or "")
    old = get_setting("release_blocker_key", "")
    if key != old:
        set_setting("release_blocker_key", key)
        set_setting("release_blocker_since", now())
    since = get_setting("release_blocker_since", now())
    blocker = dict(blocker or {})
    blocker["since"] = since
    blocker["age_seconds"] = age_seconds(since)
    return blocker


def dashboard_snapshot():
    pr = display_pr_snapshot()
    items = list_work_items()
    active_items = [x for x in items if str(x.get("state")) not in ("done", "closed", "merged") and not str(x.get("blocker") or "").startswith("Historical template")]
    current_number = (pr.get('current') or {}).get('number')
    release_item = next((x for x in active_items if x.get('pr_number') == current_number),
                        next((x for x in active_items if x.get('release_blocker')), active_items[0] if active_items else None))
    blocker = _update_blocker_clock(_release_blocker(pr, release_item))
    players = list_player_status()
    agents = list_agents()

    # CLI agents are live process state, not stale manual labels.
    for pid, aid in (("cli_pm","pm"),("cli_dev","dev")):
        base = players.setdefault(pid, {"player_id":pid})
        a = agents.get(aid) or {}
        ast = str(a.get("status") or "idle")
        board_status = str(base.get('status') or 'unknown')
        if ast == 'running':
            base['status'] = 'active'
        elif ast in ('auth_required', 'error'):
            base['status'] = 'blocked'
        elif board_status in ('blocked', 'action-needed', 'unknown') and str(base.get('blocker') or '').strip():
            # An idle process is not proof that its assigned work is unblocked.
            # Keep the persisted task blocker visible until a later board update
            # explicitly clears it or changes the actor's state.
            base['status'] = board_status
        elif board_status == 'unknown':
            base['status'] = 'unknown'
        else:
            base['status'] = 'available'
        base["agent_status"] = ast
        base["updated_at"] = a.get("updated_at") or base.get("updated_at")
        base["age_seconds"] = age_seconds(base.get("updated_at"))

    po_needed = next((x for x in active_items if x.get("po_required")), None)
    po = players.setdefault("po", {"player_id":"po"})
    if po_needed:
        po.update({"status":"action-needed","task":po_needed.get("title"),"work_item_key":po_needed.get("item_key"),"blocker":po_needed.get("blocker"),"holding":1})
    else:
        po.update({"status":"available","task":"No governed decision requested","work_item_key":"","blocker":"","holding":0})
    po["age_seconds"] = age_seconds(po.get("updated_at"))

    for pid in ("app_dev","browser_pm"):
        base = players.setdefault(pid, {"player_id":pid,"status":"unknown","task":"No status posted","work_item_key":"","blocker":"","holding":0,"updated_at":None})
        base['age_seconds'] = age_seconds(base.get('updated_at'))
        base['last_reported_status'] = base.get('status')
        if base.get('source') in ('board','startup') or base['age_seconds'] is None or base['age_seconds'] > EXTERNAL_STATUS_TTL:
            base['status'] = 'unknown'
            base['task'] = 'No fresh verified checkpoint'
            base['work_item_key'] = ''
            base['blocker'] = 'External activity unverified; read the latest #1258 checkpoint'

    # Attach the concrete owned work item so the UI can answer: working on what,
    # blocked why, and what happens next without exposing routing internals.
    by_key = {str(x.get("item_key") or ""): x for x in items}
    for pid in ("cli_dev", "app_dev"):
        player = players.get(pid) or {}
        owned = by_key.get(str(player.get("work_item_key") or ""))
        if owned and (owned.get('dispatch_hold') or str(owned.get('state') or '').lower() in ('blocked', 'held')):
            player['status'] = 'blocked'
            player['blocker'] = owned.get('dispatch_hold') or owned.get('blocker') or 'Assigned work item is blocked'
    for pid, base in players.items():
        wi = by_key.get(str(base.get("work_item_key") or ""))
        if wi:
            base["work_item"] = {
                "item_key": wi.get("item_key"),
                "title": wi.get("title"),
                "state": wi.get("state"),
                "blocker": wi.get("blocker"),
                "next_action": wi.get("next_action"),
                "branch": wi.get("branch"),
                "po_required": bool(wi.get("po_required")),
            }

    # Highlight under-utilization without calling external waits a human failure.
    ready = [x for x in active_items if str(x.get("state")) == "ready"]
    unowned_ready = [x for x in ready if str(x.get("owner") or "unassigned") in ("", "unassigned")]
    if unowned_ready:
        for pid in ("cli_dev","app_dev"):
            base = players.get(pid) or {}
            if base.get("status") == "available" and not base.get("holding"):
                base["opportunity"] = f"READY work exists: {unowned_ready[0].get('title')}"

    p = pr.get("current") or {}
    opened = p.get("createdAt")
    current_info = {
        "number": p.get("number"), "title": p.get("title"), "url": p.get("url"),
        "head": p.get("headRefOid"), "draft": p.get("isDraft"), "state": p.get("state"),
        "opened_at": opened, "open_age_seconds": age_seconds(opened),
        "checks": _pr_gate_summary(p), "statusCheckRollup": p.get("statusCheckRollup") or [], "reviewDecision": p.get("reviewDecision"), "mergeStateStatus":p.get("mergeStateStatus"),
    } if p else None

    try:
        watch_snapshot = json.loads(get_setting('github_watch_snapshot', '{}') or '{}')
    except (ValueError, TypeError):
        watch_snapshot = {}

    # Escalations are projections of unresolved rows, not sticky error strings.
    # A later receipt/disposition/result must clear the dashboard blocker.
    open_asks = list_asks('open')
    current_asks = [a for a in open_asks if a.get('state') == 'pending' and a.get('escalated')]
    ask_blocker = ''
    if current_asks:
        ask_blocker = (f"{len(current_asks)} ask(s) still undispositioned after one PM recovery: " +
                       ', '.join(f"#{a['id']} (source {a['source_comment_id']})" for a in current_asks))
    all_handoffs = list_review_handoffs()
    stale_receipts = [h for h in all_handoffs if h.get('state') in ('recorded','delivered','received','blocked')
                      and h.get('escalated')]
    stale_actions = [h for h in all_handoffs if h.get('state') == 'acknowledged' and h.get('action_escalated')]
    handoff_parts = []
    if stale_receipts:
        handoff_parts.append(f"{len(stale_receipts)} review handoff(s) without owner receipt after one PM recovery: " +
                             ', '.join(f"{h['token']} ({h['owner']}, {h['state']})" for h in stale_receipts))
    if stale_actions:
        handoff_parts.append(f"{len(stale_actions)} review handoff(s) received but without owner RESULT after one PM recovery: " +
                             ', '.join(f"{h['token']} ({h['owner']})" for h in stale_actions))
    handoff_blocker = '; '.join(handoff_parts)
    if get_setting('pm_ask_blocker', '') != ask_blocker:
        set_setting('pm_ask_blocker', ask_blocker)
    if get_setting('pm_handoff_blocker', '') != handoff_blocker:
        set_setting('pm_handoff_blocker', handoff_blocker)

    return {
        "version": BOARD_VERSION,
        "build": BOARD_BUILD,
        "goal": "RWT CLOSED",
        "observed_at": now(),
        "github_observed_at": pr.get('observed_at'),
        "github_error": pr.get("error"),
        "affected_reviews": watch_snapshot.get('affected_reviews') or {},
        "review_qualifications": list_review_qualifications(),
        "current": current_info,
        "blocker": blocker,
        "players": players,
        "priority_queue": active_items,
        "flow": items,
        "open_prs": priority_prs(pr.get("active") or [], pr.get("current"), 100),
        "reconciliation": get_setting("pm_reconciliation_status", "Awaiting first structured PM checkpoint"),
        "comms": {"poll":get_setting("github_watch_last_poll", ""),"wake":get_setting("github_watch_last_wake", ""),"error":get_setting("github_watch_last_error", ""),"outbox":get_setting("pm_outbox_status", "Awaiting PM reply")},
        "recent_completed": pr.get("recent_completed") or [],
        "asks": open_asks,
        "handoff_blocker": handoff_blocker,
        "ask_blocker": ask_blocker,
        "review_handoffs": [h for h in list_review_handoffs() if h['state'] != 'acknowledged'],
        "action_blockers": json.loads(get_setting("pm_action_blockers", "[]") or "[]"),
        "packet_verifications": list_packet_verifications(10),
        "share": handoff_location(current_number or CONTROL_ISSUE),
        "ready_unowned": unowned_ready,
    }


def transport_status():
    mode = pm_transport_mode()
    codex_binary = resolved_bin(CODEX_BIN)
    codex_ok = bool(codex_binary) and CODEX_AUTH_OK is True
    configured = (mode == "codex" and codex_ok) or (mode == "openai" and bool(OPENAI_API_KEY)) or (mode == "command" and bool(PM_COMMAND) and bool(resolved_bin(shlex.split(PM_COMMAND)[0])))
    if mode == "codex":
        pm_label = f"Codex CLI{(' · ' + CODEX_MODEL) if CODEX_MODEL else ' · CLI default model'}"
    elif mode == "openai":
        pm_label = "OpenAI API fallback"
    elif mode == "command":
        pm_label = "PM command adapter"
    else:
        pm_label = "not configured"
    actors = {}
    for actor_id in ('cli_dev', 'app_dev', 'browser_pm', 'cli_pm'):
        try:
            route = configured_actor_route(actor_id)
            actors[actor_id] = {'configured': True, 'transport': 'codex_app_server',
                                'session_id': route.session_id, 'remote': bool(route.remote_url),
                                'live_delivery_proven': False}
        except agent_transport.RouteError as exc:
            actors[actor_id] = {'configured': False, 'blocker': str(exc), 'live_delivery_proven': False}
    external_ready = all(actors[x]['configured'] for x in ('app_dev', 'browser_pm'))
    return {
        "pm_mode": mode,
        "pm_configured": configured,
        "pm_mutations_enabled": bool_setting("pm_bounded_actions", True),
        "pm_publish_control": bool_setting("pm_publish_control", True),
        "github_watch_last_poll": get_setting("github_watch_last_poll", ""),
        "github_watch_last_wake": get_setting("github_watch_last_wake", ""),
        "github_watch_error": get_setting("github_watch_last_error", ""),
        "github_request_budget": github_request_budget_state(),
        "pm_outbox_status": get_setting("pm_outbox_status", "Awaiting PM reply"),
        "pm_outbox_error": get_setting("pm_outbox_error", ""),
        "pm_pending_packet": get_setting("pm_pending_packet", ""),
        "pm_reconciliation": get_setting("pm_reconciliation_status", "Awaiting first structured PM checkpoint"),
        "pm_model": CODEX_MODEL if mode == "codex" and CODEX_MODEL else ("CLI default" if mode == "codex" else None),
        "pm_label": pm_label,
        "pm_auth_ok": CODEX_AUTH_OK if mode == "codex" else None,
        "pm_auth_detail": CODEX_AUTH_DETAIL if mode == "codex" else None,
        "claude_model": CLAUDE_MODEL or "CLI default",
        "dev_configured": actors['cli_dev']['configured'],
        "claude_worker_configured": bool(resolved_bin(CLAUDE_BIN)),
        "claude_subscription_mode": True,
        "claude_permission_mode": PERMISSION_MODE,
        "agent_routes": actors,
        "external_notification_configured": external_ready,
        "external_notification_status": ("Configured Codex app-server routes; live actor receipt/action still unproven"
                                         if external_ready else "BLOCKED: configure per-actor Codex session UUIDs and remote WSS/token where sessions are on another host; GitHub publication is not delivery"),
        "max_handoff_depth": MAX_HANDOFF_DEPTH,
    }



# c5 (F15): the control API is for this board's own page and explicitly configured local adapters.
# A per-launch token (or RWT_CONTROL_TOKEN for a non-browser adapter) authorizes every mutation.
CONTROL_TOKEN = os.environ.get("RWT_CONTROL_TOKEN", "").strip() or secrets.token_urlsafe(32)
if not re.fullmatch(r"[A-Za-z0-9_-]{24,128}", CONTROL_TOKEN):
    raise SystemExit("RWT_CONTROL_TOKEN must be 24-128 URL-safe characters")
CONTROL_TOKEN_HEADER = "X-RWT-Control-Token"
TOKEN_PLACEHOLDER = b"__RWT_CONTROL_TOKEN__"


class H(BaseHTTPRequestHandler):
    def _loopback_origins(self):
        port = self.server.server_address[1]
        return {f"127.0.0.1:{port}", f"localhost:{port}"}

    def control_refusal(self, mutating):
        """Return (code, error) when a request may not reach the control API, else None.

        Host is checked on every request, so a DNS-rebound name cannot read the page or its token.
        A mutation must also be same-origin JSON carrying the control token.
        """
        hosts = self._loopback_origins()
        if str(self.headers.get("Host") or "").lower() not in hosts:
            return 403, "request Host is not this loopback board"
        if not mutating:
            return None
        origin = self.headers.get("Origin")
        if origin is not None and origin.lower() not in {"http://" + h for h in hosts}:
            return 403, "cross-origin control request refused"
        if str(self.headers.get("Sec-Fetch-Site") or "").lower() == "cross-site":
            return 403, "cross-site control request refused"
        if str(self.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
            return 415, "control requests must be application/json"
        if not hmac.compare_digest(str(self.headers.get(CONTROL_TOKEN_HEADER) or ""), CONTROL_TOKEN):
            return 403, "missing or invalid control token"
        return None

    def sendj(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(n) if n else b"{}"

    def do_GET(self):
        refused = self.control_refusal(mutating=False)
        if refused:
            return self.sendj(refused[0], {"error": refused[1]})
        u = urlparse(self.path)
        if u.path == "/":
            data = (STATIC / "index.html").read_bytes().replace(TOKEN_PLACEHOLDER, CONTROL_TOKEN.encode())
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        if u.path == "/api/live":
            return self.sendj(200, {
                "agents": list_agents(),
                "activity": list_activity(),
                "deliveries": list_queue(),
                "transport": transport_status(),
                "packet_verifications": list_packet_verifications(10),
                "automation": automation_settings(),
            })
        if u.path == "/api/dashboard":
            return self.sendj(200, dashboard_snapshot())
        if u.path == "/api/pr-state":
            snap = display_pr_snapshot()
            a = get_agent("dev") or {}
            wt = validate_worktree(a.get("cwd") or "") if a.get("cwd") else None
            return self.sendj(200, {"pr": snap, "worktree": wt})
        if u.path == "/api/state":
            # Backward-compatible aggregate endpoint. UI uses split live/PR polling in v4.5.2.
            snap = display_pr_snapshot()
            a = get_agent("dev") or {}
            wt = validate_worktree(a.get("cwd") or "") if a.get("cwd") else None
            return self.sendj(200, {
                "pr": snap,
                "agents": list_agents(),
                "activity": list_activity(),
                "deliveries": list_queue(),
                "worktree": wt,
                "transport": transport_status(),
                "automation": automation_settings(),
            })
        if u.path == "/api/automation":
            return self.sendj(200, automation_settings())
        if u.path == "/api/handoff-location":
            qs = parse_qs(u.query)
            try:
                return self.sendj(200, handoff_location(qs.get("pr", [""])[0] or None))
            except ValueError as e:
                return self.sendj(400, {"error": str(e)})
        if u.path == "/api/handoff-verify":
            qs = parse_qs(u.query)
            try:
                return self.sendj(200, verify_remote_packet(qs.get("pr", [""])[0] or None, qs.get("path", [""])[0], qs.get("ref", [""])[0]))
            except GithubReadError as e:
                return self.sendj(503, {'ok': False, 'category': e.kind, 'error': str(e)[:500]})
            except ValueError as e:
                return self.sendj(400, {"error": str(e)})
        if u.path == "/api/validate-worktree":
            qs = parse_qs(u.query)
            return self.sendj(200, validate_worktree(qs.get("path", [""])[0]))
        return self.sendj(404, {"error": "not found"})

    def do_POST(self):
        if urlparse(self.path).path == '/api/agent-task':
            if str(self.headers.get('Content-Type') or '').split(';')[0].strip().lower() != 'application/json':
                return self.sendj(415, {'error': 'task callbacks require application/json'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if size < 1 or size > 8192:
                    return self.sendj(413, {'error': 'task callback body must be 1..8192 bytes'})
                payload = json.loads(self.rfile.read(size))
            except Exception:
                return self.sendj(400, {'error': 'invalid task callback JSON'})
            auth = str(self.headers.get('Authorization') or '')
            if not auth.startswith('Bearer '):
                return self.sendj(403, {'error': 'task callback bearer token required'})
            code, response = record_agent_task_callback(payload, auth[7:])
            return self.sendj(code, response)
        refused = self.control_refusal(mutating=True)
        if refused:
            return self.sendj(refused[0], {"error": refused[1]})
        try:
            b = json.loads(self.body())
        except Exception:
            return self.sendj(400, {"error": "invalid json"})

        if self.path == "/api/send":
            actor = str(b.get("actor", "PO")).upper()
            route = str(b.get("route", "none")).lower()
            msg = str(b.get("message", "")).strip()
            if actor not in ("PO", "PM"):
                return self.sendj(400, {"error": "actor must be PO or PM"})
            if route not in ("pm", "dev", "both", "none"):
                return self.sendj(400, {"error": "invalid route"})
            if not msg and not b.get("files"):
                return self.sendj(400, {"error": "message or file required"})
            try:
                files = save_files(b.get("files") or [], b.get("handoff_pr"), b.get("handoff_topic", "attachments"))
            except Exception as e:
                return self.sendj(400, {"error": str(e)})

            aid = add_activity(actor, msg or "(attachment)", route, "posted")
            for name, path, size in files:
                add_attachment(aid, name, path, size)

            if route == "none":
                github_message = compose_user_message(msg or "(attachment)", files)
                if files:
                    share = handoff_location(b.get("handoff_pr"))
                    github_message += ("\n\nThese paths are on the board host, not downloadable GitHub attachments. CLI PM/Dev can read them there; "
                                       f"external reviewers need an explicitly published copy at {share['tree_url'] or share['remote_path']} (push pin + readback).")
                ok, err = post_control_issue_comment(github_message)
                if not ok:
                    add_activity("SYSTEM", f"GitHub-only post failed: {err}", "none", "error")
                    return self.sendj(502, {"error": err or "GitHub post failed"})
                add_activity("SYSTEM", f"Posted PO message to RWT control issue #{CONTROL_ISSUE}", "none", "responded")

            recipients = []
            dev_task_key = ''
            if route in ("pm", "both"):
                recipients.append("pm")
            if route in ("dev", "both"):
                active_dev_task = dev_assignment()
                wt = resolve_dev_target({'work_item_key': active_dev_task['item_key']}) if active_dev_task else {
                    'ok': False, 'error': 'No single active CLI Dev WRITE task is bound; PM must assign and reconcile a task first'}
                if not wt.get('ok'):
                    add_activity('SYSTEM', f"Dev dispatch blocked: {wt['error']}", 'none', 'error')
                    return self.sendj(409, {'error': wt['error'], 'worktree': wt})
                dev_task_key = active_dev_task['item_key']
                recipients.append('dev')
            ts = transport_status()
            if 'pm' in recipients and not ts['pm_configured']:
                return self.sendj(409, {'error': 'PM transport is not ready: ' + str(ts.get('pm_auth_detail') or ts['pm_label'])})
            if 'dev' in recipients and not ts['dev_configured']:
                return self.sendj(409, {'error': 'Claude CLI not found; configure/sign in before Dev dispatch'})

            fanout = uuid.uuid4().hex if len(recipients) > 1 else None
            delivery_ids = []
            for recipient in recipients:
                content = compose_user_message(msg, files)
                delivery_ids.append(enqueue(
                    aid, recipient, content, source_actor=actor, handoff_depth=0,
                    auto_handoff=True, fanout_group=fanout,
                    work_item_key=dev_task_key if recipient == 'dev' else '',
                ))
            return self.sendj(202, {"activity_id": aid, "delivery_ids": delivery_ids,
                                    "handoff_manifest": str(files[-1][1]) if files else None})

        if self.path == "/api/set-current-pr":
            if 'pr' not in b:
                return self.sendj(400, {'error': 'pr required; use an explicit empty value to clear selection'})
            selected = str(b.get("pr", "")).strip()
            if selected and not re.fullmatch(r'[1-9][0-9]{0,8}', selected):
                return self.sendj(400, {'error': 'pr must be a positive pull request number or an explicit empty value'})
            set_setting("current_pr", selected)
            set_setting("current_pr_explicit", '1')
            set_setting("github_watch_pr", "")
            set_setting("github_watch_snapshot", "")
            snap = pr_snapshot()
            return self.sendj(200, {'ok': True, 'current': snap.get('current'),
                                    'note': 'Release display selection never retargets the Dev worktree'})

        if self.path == "/api/automation":
            return self.sendj(200, set_automation_settings(b))

        if self.path == "/api/work-item":
            key = str(b.get("item_key", "")).strip()
            if not key:
                return self.sendj(400, {"error": "item_key required"})
            if not apply_board_updates({'work_items':[b]}):
                return self.sendj(409, {'error':'Work-item update rejected; see activity conflict record'})
            return self.sendj(200, {"ok": True, "dashboard": dashboard_snapshot()})

        if self.path == "/api/player-status":
            pid = str(b.get("player_id", "")).strip()
            if pid not in ("po","cli_pm","cli_dev","app_dev","browser_pm"):
                return self.sendj(400, {"error": "invalid player_id"})
            if not apply_board_updates({'players':[b]}):
                return self.sendj(409, {'error':'Player update rejected; task ownership mismatch'})
            return self.sendj(200, {"ok": True, "dashboard": dashboard_snapshot()})

        if self.path == "/api/pause":
            who = str(b.get("agent", "dev")).lower()
            if who not in ("dev", "pm"):
                return self.sendj(400, {"error": "agent must be dev or pm"})
            set_agent(who, paused=1 if b.get("paused", True) else 0)
            return self.sendj(200, {"ok": True})

        if self.path == "/api/kill":
            who = str(b.get("agent", "dev")).lower()
            return self.sendj(200, {"killed": kill_agent(who)})

        if self.path == "/api/reset-dev":
            kill_agent("dev")
            set_agent("dev", session_id=None, status="idle")
            return self.sendj(200, {"ok": True})

        if self.path == "/api/reset-pm":
            kill_agent("pm")
            set_agent("pm", session_id=None, status="idle")
            if pm_transport_mode() == "codex":
                refresh_codex_auth()
            return self.sendj(200, {"ok": True})

        if self.path == "/api/retry-delivery":
            qid = int(b.get("id", 0))
            with DB_LOCK, con() as c:
                row = c.execute("SELECT * FROM queue WHERE id=?", (qid,)).fetchone()
                if not row:
                    return self.sendj(404, {"error": "delivery not found"})
                if row["status"] not in ("failed", "failed_uncertain"):
                    return self.sendj(409, {"error": "only failed deliveries can be retried"})
                recovery = c.execute("SELECT id FROM queue WHERE parent_queue_id=? AND kind='preflight_recovery' LIMIT 1",
                                     (qid,)).fetchone()
                # One guarded statement: a recovery created concurrently also blocks the requeue.
                cur = c.execute(
                    "UPDATE queue SET status='queued', error=NULL, started_at=NULL, finished_at=NULL WHERE id=? "
                    "AND status IN ('failed','failed_uncertain') "
                    "AND NOT EXISTS(SELECT 1 FROM queue r WHERE r.parent_queue_id=queue.id AND r.kind='preflight_recovery') "
                    "AND NOT (recipient='dev' AND work_item_key<>'' AND started_at IS NULL AND attempts=0) "
                    "AND NOT (recipient='dev' AND (launch_attempted_at IS NOT NULL OR attempts>0))",
                    (qid,),
                )
            if cur.rowcount != 1 and row["recipient"] == 'dev' and (row["launch_attempted_at"] or int(row["attempts"] or 0) > 0):
                # c5 (F12): an invoked Dev turn may have written. Its uncertainty is reconciled by PM readback
                # and a NEW authorized continuation, never by the generic retry button.
                with DB_LOCK, con() as c:
                    rec = c.execute("SELECT id FROM queue WHERE delivery_key=?", (f'invocation-recovery:{qid}',)).fetchone()
                return self.sendj(409, {"error": "This Dev delivery was invoked; its writes are uncertain. Retry is disabled — "
                                                 "PM reconciles by readback and issues a new authorized continuation.",
                                        "recovery_queue_id": rec['id'] if rec else None})
            if cur.rowcount != 1:
                # Retrying would re-dispatch Dev into the same unverified tuple and bypass PM recovery.
                return self.sendj(409, {"error": "Dev delivery was blocked before invocation; PM recovery owns the repair. "
                                                 "Dev retry is disabled — PM must rebind a verified tuple and issue a new task handoff.",
                                        "recovery_queue_id": recovery['id'] if recovery else None})
            return self.sendj(200, {"ok": True})

        return self.sendj(404, {"error": "not found"})

    def log_message(self, *args):
        pass


def main():
    # Lock the state directory before any startup migration can reclassify another
    # process's running journal row. Binding also happens before any worker starts.
    global STATE_LOCK_FD, REPOSITORY_LOCK_FD
    # Repository lock spans distinct app folders/ports; state lock prevents a second
    # owner from reclassifying claims in this exact SQLite directory.
    REPOSITORY_LOCK_FD = acquire_repository_lock()
    try:
        STATE_LOCK_FD = acquire_state_dir_lock()
    except Exception:
        release_state_dir_lock(REPOSITORY_LOCK_FD)
        REPOSITORY_LOCK_FD = None
        raise
    try:
        srv = ThreadingHTTPServer((HOST, PORT), H)
    except Exception:
        release_state_dir_lock(STATE_LOCK_FD)
        STATE_LOCK_FD = None
        release_state_dir_lock(REPOSITORY_LOCK_FD)
        REPOSITORY_LOCK_FD = None
        raise
    init_db()
    recover_interrupted_state_after_lock()
    sweep_preflight_recoveries()
    sweep_invocation_recoveries()
    sweep_agent_delivery_stalls()
    reset_ephemeral_control_state_on_start()
    force_github_reconcile_on_start()
    mode = pm_transport_mode()
    if mode == "codex":
        refresh_codex_auth()
    set_agent("pm", provider=mode, cwd=BASE_REPO if mode == "codex" else "")
    threading.Thread(target=worker, args=("pm",), daemon=True).start()
    threading.Thread(target=worker, args=("dev",), daemon=True).start()
    threading.Thread(target=github_watcher, daemon=True).start()
    threading.Thread(target=anti_idle_reconciler, daemon=True).start()
    print(f"RWT Board v{BOARD_VERSION} ({BOARD_BUILD}): http://{HOST}:{PORT}/")
    print("Canonical origin is 127.0.0.1. Do not use localhost.")
    if mode == "codex":
        print(f"PM transport: Codex CLI ({CODEX_AUTH_DETAIL}; model={CODEX_MODEL or 'CLI default'})")
    elif mode == "openai":
        print("PM transport: legacy OpenAI API fallback")
    else:
        print(f"PM transport: {mode}")
    print(f"Dev transport: Claude CLI ({CLAUDE_MODEL or 'CLI default model'}; permission={PERMISSION_MODE}); API-key overrides are stripped from child env")
    if mode == "manual":
        print("PM transport is not configured. Install/sign in to Codex CLI, or configure PM_COMMAND / legacy API fallback.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        STOP.set()
        kill_agent("dev")
        kill_agent("pm")
        srv.server_close()
        release_state_dir_lock(STATE_LOCK_FD)
        STATE_LOCK_FD = None
        release_state_dir_lock(REPOSITORY_LOCK_FD)
        REPOSITORY_LOCK_FD = None


if __name__ == "__main__":
    main()
