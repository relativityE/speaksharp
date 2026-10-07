#!/usr/bin/env python3
import base64
import io
import zipfile
import json
import re
import hashlib
from guarded_pm import Executor, Hold
import os
import shlex
import shutil
import sqlite3
import subprocess
import pty
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

APP = Path(__file__).resolve().parent
DB = APP / ".agent-work" / "state.db"
UPLOADS = APP / "uploads"
HANDOFFS = APP / "handoffs"
STATIC = APP / "static"
HOST = "127.0.0.1"
PORT = int(os.environ.get("RWT_PORT", "4317"))
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
# Legacy optional fallback only. Auto mode never prefers API billing when local Codex is available.
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
OPENAI_TIMEOUT = int(os.environ.get("OPENAI_TIMEOUT_SECONDS", str(PM_TIMEOUT)))
MAX_UPLOAD = 10 * 1024 * 1024
MAX_HANDOFF_DEPTH = int(os.environ.get("MAX_HANDOFF_DEPTH", "12"))
GITHUB_WATCH_INTERVAL = max(5, int(os.environ.get("GITHUB_WATCH_INTERVAL_SECONDS", "20")))
CONTROL_ISSUE = int(os.environ.get("RWT_CONTROL_ISSUE", "1258"))
WATCH_ISSUES = os.environ.get('RWT_WATCH_ISSUES', '1304')
BOARD_VERSION = "4.6.16"
BOARD_BUILD = "deadlock.5"
GH_BACKOFF_UNTIL = 0.0
PR_DISPLAY_CACHE = {}
PR_DISPLAY_LOCK = threading.RLock()

class PMTransportTimeout(RuntimeError):
    """Read-only PM reasoning expired before host actions or publication."""

EXTERNAL_STATUS_TTL = 1800
RELEASE_ORDER = (1555, 1558, 1554, 1559)

DB_LOCK = threading.RLock()
PROC_LOCK = threading.RLock()
ACTIVE_DEV_PROC = None
ACTIVE_PM_PROC = None
PM_CANCEL_GENERATION = 0
CODEX_AUTH_OK = None
CODEX_AUTH_DETAIL = "not checked"
STOP = threading.Event()


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
          source TEXT NOT NULL DEFAULT 'board', updated_at TEXT NOT NULL
        );
        """)
        c.executescript('''CREATE TABLE IF NOT EXISTS pm_outbox(queue_id INTEGER PRIMARY KEY,status TEXT NOT NULL,comment_id INTEGER,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS pm_action_journal(action_key TEXT PRIMARY KEY,status TEXT NOT NULL,result TEXT NOT NULL);''')
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
        _add_column(c, "queue", "event_key TEXT NOT NULL DEFAULT ''")
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS queue_event_key_unique ON queue(event_key) WHERE event_key<>''")

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

        # Safe restart semantics: queued work was never delivered, so preserve it.
        # A delivering turn is ambiguous: repeating it could duplicate a side effect.
        c.execute(
            "UPDATE queue SET status='failed_uncertain', "
            "error='Process restarted while delivery was in progress; explicit retry required', finished_at=? "
            "WHERE status IN ('running','delivering')",
            (now(),),
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
            handoff_depth=0, auto_handoff=True, fanout_group=None, work_item_key="", event_key=""):
    target = dev_assignment(work_item_key) if recipient == 'dev' else None
    with DB_LOCK, con() as c:
        if event_key:
            existing = c.execute("SELECT id FROM queue WHERE event_key=?", (event_key,)).fetchone()
            if existing:
                return int(existing['id'])
        cur = c.execute(
            "INSERT INTO queue(activity_id,recipient,content,status,created_at,source_actor,parent_queue_id,"
            "handoff_depth,auto_handoff,fanout_group,attempts,event_key) VALUES(?,?,?,?,?,?,?,?,?,?,0,?)",
            (
                aid, recipient, content, "queued", now(), source_actor, parent_queue_id,
                int(handoff_depth), 1 if auto_handoff else 0, fanout_group, event_key,
            ),
        )
        qid = cur.lastrowid
        if target:
            c.execute("UPDATE queue SET work_item_key=?,target_branch=?,target_worktree=? WHERE id=?",
                      (target['item_key'], target['branch'], target.get('worktree') or '', qid))
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
            "SELECT q.*,o.status AS _outbox_status,o.comment_id AS _outbox_comment_id, "
            "rc.id AS _recovery_id,rc.status AS _recovery_status FROM queue q "
            "LEFT JOIN pm_outbox o ON o.queue_id=q.id "
            "LEFT JOIN (SELECT parent_queue_id,MIN(id) AS id FROM queue "
            "WHERE recipient='pm' AND source_actor='SYSTEM' GROUP BY parent_queue_id) r ON r.parent_queue_id=q.id "
            "LEFT JOIN queue rc ON rc.id=r.id WHERE q.event_key<>'' OR q.id >= "
            "(SELECT COALESCE(MIN(id),0) FROM (SELECT id FROM queue ORDER BY id DESC LIMIT ?)) "
            "ORDER BY q.id DESC", (limit,)
        ).fetchall()]
    rows.reverse()
    for row in rows:
        row['age_seconds'] = age_seconds(row.get('finished_at') or row.get('started_at') or row.get('created_at'))
        row['historical'] = row['status'] in ('responded', 'failed', 'failed_uncertain')
        row['delivery_label'] = ('REPLY RETURNED — task completion unverified' if row['status'] == 'responded' else row['status'])
        if row.get('recipient') == 'dev' and row.get('work_item_key'):
            if row['status'] == 'queued':
                row['delivery_stage'] = 'ASSIGNED → QUEUED · Dev not invoked'
            elif row['status'] == 'delivering':
                row['delivery_stage'] = 'ASSIGNED → QUEUED → DEV INVOKED · awaiting result'
            elif row['status'] == 'responded':
                row['delivery_stage'] = 'DEV RESULT RETURNED · task-specific ACK/action unverified'
            elif row['status'].startswith('failed') and not row.get('started_at') and not int(row.get('attempts') or 0):
                row['delivery_stage'] = 'BLOCKED BEFORE DEV INVOCATION'
            elif row['status'].startswith('failed'):
                row['delivery_stage'] = 'DEV INVOCATION FAILED · inspect result/error'
            else:
                row['delivery_stage'] = str(row['status']).upper()
        else:
            row['delivery_stage'] = str(row['status']).upper()
        if row.get('_outbox_comment_id'):
            row['delivery_label'] = 'PUBLISHED — recipient action unverified'
            row['github_comment_id'] = row['_outbox_comment_id']
        elif row.get('_outbox_status') == 'local_only':
            row['delivery_label'] = 'RECONCILED LOCALLY — no GitHub post'
        if row.get('_recovery_id'):
            row['recovery_action'] = f"PM recovery queued #{row['_recovery_id']} ({row['_recovery_status']}); no Dev retry"
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

def update_work_item(item_key, **fields):
    allowed = {"priority","title","state","owner","branch","blocker","blocker_since","next_action","po_required","release_blocker","notes","pr_number","worktree"}
    clean = {k:v for k,v in fields.items() if k in allowed}
    if not clean:
        return None
    with DB_LOCK, con() as c:
        old = c.execute("SELECT * FROM work_items WHERE item_key=?", (item_key,)).fetchone()
        if not old:
            raise ValueError(f"unknown work item {item_key}")
        merged = dict(old)
        merged.update(clean)
        conflict = _dev_lease_conflict(c, item_key, merged.get("owner"), merged.get("branch"), merged.get("state"))
        if conflict:
            raise ValueError("WRITE lease conflict: " + conflict)
        if "blocker" in clean and "blocker_since" not in clean and old["blocker"] != str(clean["blocker"]):
            clean["blocker_since"] = now()
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
                allowed = {'priority','title','state','owner','branch','worktree','pr_number','blocker','blocker_since','next_action','po_required','release_blocker','notes'}
                clean = {k:v for k,v in item.items() if k in allowed and v is not None}
                old = c.execute('SELECT * FROM work_items WHERE item_key=?', (key,)).fetchone()
                if old is None:
                    c.execute("INSERT INTO work_items(item_key,priority,title,state,owner,updated_at) VALUES(?,?,?,?,?,?)",
                              (key, 99, key, 'waiting', 'unassigned', now()))
                if 'blocker' in clean and 'blocker_since' not in clean:
                    clean['blocker_since'] = now()
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
                merged = dict(old or {})
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
                    clean['updated_at'] = dt.astimezone(timezone.utc).isoformat()
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
    if get_setting('dev_assignment_reconciled', '0') != '1':
        return {'ok': False, 'error': 'CLI Dev assignment needs a fresh PM checkpoint after startup'}
    item = dev_assignment(q.get('work_item_key') or '')
    if not item or not item.get('branch'):
        return {'ok': False, 'error': 'CLI Dev needs one active task with an explicit branch/worktree; ask PM to assign it'}
    if q.get('target_branch') and q['target_branch'] != item['branch']:
        return {'ok': False, 'error': 'Delivery branch changed after enqueue; request a new task handoff'}
    if q.get('target_worktree') and q['target_worktree'] != item.get('worktree'):
        return {'ok': False, 'error': 'Delivery worktree changed after enqueue; request a new task handoff'}
    path = item.get('worktree')
    if not path:
        path = find_branch_worktree(item['branch']) or get_agent('dev').get('cwd')
    if not path:
        return {'ok': False, 'error': 'Assigned task has no local worktree; PM must supply its worktree path'}
    v = validate_worktree(path)
    if not v.get('exists'):
        return {'ok': False, 'error': f"Assigned task worktree is missing: expected branch '{item['branch']}' at '{path}'; bootstrap must finish before Dev dispatch", 'validation': v}
    if not v.get('is_git'):
        return {'ok': False, 'error': f"Assigned task path is not a Git worktree: expected branch '{item['branch']}' at '{path}'", 'validation': v}
    if v.get('branch') != item['branch']:
        return {'ok': False, 'error': f"Assigned worktree branch mismatch: expected '{item['branch']}' at '{path}', found '{v.get('branch')}' at HEAD {v.get('head')}", 'validation': v}
    if q.get('target_head') and v.get('head') != q['target_head']:
        return {'ok': False, 'error': 'Worktree head changed after dispatch; explicit new handoff required'}
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
    """Return the highest-priority queued delivery for one agent (or globally).

    PO instructions start first, followed by handoffs and machine events. One
    priority step ages every 60 seconds, so an older event eventually passes
    newer traffic while FIFO is preserved for equal effective priority.
    """
    where = "q.status='queued' AND a.paused=0 AND q.available_after<=?"
    args = [time.time()]
    if recipient:
        where += " AND q.recipient=?"
        args.append(recipient)
    with DB_LOCK, con() as c:
        rows = c.execute(
            "SELECT q.* FROM queue q JOIN agents a ON a.agent_id=q.recipient "
            f"WHERE {where} ORDER BY q.id",
            args,
        ).fetchall()
    if not rows:
        return None
    base_priority = {"PO": 0, "PM": 1, "DEV": 1, "GITHUB": 3}
    def rank(row):
        age = age_seconds(row['created_at']) or 0
        effective = max(0, base_priority.get(row['source_actor'], 2) - age // 60)
        return (effective, row['id'])
    return dict(min(rows, key=rank))


def update_queue(qid, **fields):
    ks = list(fields)
    vals = [fields[k] for k in ks] + [qid]
    with DB_LOCK, con() as c:
        c.execute("UPDATE queue SET " + ",".join(f"{k}=?" for k in ks) + " WHERE id=?", vals)


def gh_json(args):
    global GH_BACKOFF_UNTIL
    if time.time() < GH_BACKOFF_UNTIL:
        return None, 'GitHub rate-limit backoff until ' + datetime.fromtimestamp(GH_BACKOFF_UNTIL, timezone.utc).isoformat()
    try:
        p = subprocess.run(["gh"] + args, capture_output=True, text=True, timeout=20)
        if p.returncode != 0:
            error = p.stderr.strip() or p.stdout.strip()
            if re.search(r'rate limit|secondary rate|abuse detection|HTTP 429', error, re.I):
                # Read rate resources once, then stop all board GH requests during cooldown.
                # Never replay the failed operation: it may have been a write.
                GH_BACKOFF_UNTIL = time.time() + 900
                try:
                    rate = subprocess.run(['gh', 'api', 'rate_limit'], capture_output=True, text=True, timeout=10)
                    resources = json.loads(rate.stdout).get('resources', {}) if rate.returncode == 0 else {}
                    resets = [float(x['reset']) + 5 for x in resources.values() if x.get('remaining') == 0 and x.get('reset')]
                    if resets:
                        GH_BACKOFF_UNTIL = max(time.time() + 60, max(resets))
                except Exception:
                    pass
            return None, error
        return json.loads(p.stdout or "null"), None
    except Exception as e:
        return None, str(e)


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
    chosen = next((by_number[int(n)] for n in order if int(n) in by_number), None)
    if chosen:
        set_setting('current_pr', chosen['number'])
    return chosen


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
    current = _auto_select_current_pr(prs)
    current_num = str(current['number']) if current else get_setting("current_pr", "").strip()
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
                set_setting("current_pr", "")
        except Exception:
            set_setting("current_pr", "")
    if current is None:
        current = _auto_select_current_pr(prs)
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
    """Stage an incremental cursor. It is committed only after durable event enqueue."""
    key = f'github_comments:{repo}:{issue}'
    try:
        state = json.loads(get_setting(key, '{}'))
    except (ValueError, TypeError):
        state = {}
    url = f'repos/{repo}/issues/{issue}/comments?per_page=100'
    if state.get('since'):
        url += '&since=' + quote(state['since'], safe='')
    pages, err = gh_json(['api', '--paginate', '--slurp', url])
    if err:
        return None, err, None
    fresh = [x for page in (pages or []) for x in (page if isinstance(page, list) else [page]) if isinstance(x, dict) and x.get('id')]
    merged = {int(x['id']): x for x in state.get('comments', [])}
    merged.update({int(x['id']): x for x in fresh})
    rows = sorted(merged.values(), key=lambda x: int(x['id']))
    dates = [x.get('updated_at') or x.get('created_at') for x in fresh]
    dates = [x for x in dates if x]
    since = state.get('since')
    if dates:
        try:
            # Overlap handles tied timestamps; IDs deduplicate the repeat rows.
            candidate = (datetime.fromisoformat(max(dates).replace('Z', '+00:00')) - timedelta(seconds=1)).isoformat()
            since = max(since or '', candidate)
        except ValueError:
            pass  # Unknown timestamp: retain the old cursor, never skip unread rows.
    return rows, None, (key, {'since': since, 'comments': rows[-200:]})


def commit_watch_comment_cursors(snapshot):
    for key, state in snapshot.get('_pending_comment_cursors', []):
        set_setting(key, json.dumps(state, ensure_ascii=False))



def _terminal(value):
    return str(value or '').upper() in ('COMPLETED','SUCCESS','FAILURE','FAILED','CANCELLED','SKIPPED','NEUTRAL','TIMED_OUT','ACTION_REQUIRED','STALE')

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
        'control_updates': [{'id':int(r['id']), 'body':str(r.get('body') or '')[:12000], 'url':r.get('html_url')} for r in incoming_comments if r.get('id')],
        'runs': {}, 'deploy': [],
        '_pending_comment_cursors': pending_cursors,
    }
    if not current:
        return base, control_err
    pr, err = gh_json(['pr','view',current,'--repo',repo,'--json','number,title,headRefName,headRefOid,isDraft,state,reviewDecision,updatedAt,url,statusCheckRollup'])
    if pr is None:
        # Do not lose #1258 monitoring merely because the selected PR is stale/closed/unreadable.
        return base, err or control_err or 'PR lookup failed'
    reviews, review_err = gh_json(['api','--paginate','--slurp',f'repos/{repo}/pulls/{current}/reviews?per_page=100'])
    comments, comment_err = gh_json(['api','--paginate','--slurp',f'repos/{repo}/pulls/{current}/comments?per_page=100'])
    requested, request_err = gh_json(['api',f'repos/{repo}/pulls/{current}/requested_reviewers'])
    if review_err or comment_err or request_err:
        return None, 'Review signal read failed: ' + '; '.join(x for x in (review_err,comment_err,request_err) if x)
    def flatten(pages):
        return [item for page in (pages or []) for item in (page if isinstance(page,list) else [page]) if isinstance(item,dict)]
    reviews = flatten(reviews)
    comments = flatten(comments)
    requested = requested if isinstance(requested,dict) else {}
    review_requests = sorted(
        ['user:'+str(x.get('login')) for x in (requested.get('users') or []) if x.get('login')]
        + ['team:'+str(x.get('slug')) for x in (requested.get('teams') or []) if x.get('slug')]
    )
    runs, _ = gh_json(['run','list','--repo',repo,'--branch',pr.get('headRefName',''),'--limit','30','--json','databaseId,workflowName,status,conclusion,headSha,updatedAt,event'])
    runs = [r for r in (runs if isinstance(runs,list) else []) if r.get('headSha') == pr.get('headRefOid')]
    latest_runs={}
    for r in runs:
        name=str(r.get('databaseId') or r.get('workflowName') or 'workflow')
        if name not in latest_runs:
            latest_runs[name]={'id':r.get('databaseId'),'name':r.get('workflowName'),'status':r.get('status'),'conclusion':r.get('conclusion'),'updatedAt':r.get('updatedAt')}
    deploy=[]
    for x in pr.get('statusCheckRollup') or []:
        name=(x.get('name') or x.get('context') or x.get('workflowName') or '').strip()
        if any(k in name.lower() for k in ('vercel','deploy','deployment')):
            deploy.append({'name':name,'status':x.get('status') or x.get('state'),'conclusion':x.get('conclusion')})
    base.update({
        'pr':pr.get('number'),'title':pr.get('title'),'head':pr.get('headRefOid'),'draft':pr.get('isDraft'),
        'reviewDecision':pr.get('reviewDecision'),
        'latest_review_id':max([int(r.get('id') or 0) for r in reviews] or [0]),
        'latest_review_comment_id':max([int(r.get('id') or 0) for r in comments] or [0]),
        'review_requests':review_requests,
        'latest_reviews':[{'id':int(r.get('id') or 0),'state':r.get('state'),'login':(r.get('user') or {}).get('login'),
                           'body':str(r.get('body') or '')[:1600],'url':r.get('html_url'),'submitted_at':r.get('submitted_at')}
                          for r in reviews if r.get('id')],
        'latest_review_comments':[{'id':int(r.get('id') or 0),'login':(r.get('user') or {}).get('login'),
                                   'path':r.get('path'),'body':str(r.get('body') or '')[:1600],
                                   'url':r.get('html_url'),'created_at':r.get('created_at')}
                                  for r in comments if r.get('id')],
        'runs':latest_runs,'deploy':sorted(deploy,key=lambda x:x['name']),
    })
    return base, err or control_err

def github_watch_events(prev, cur, cfg):
    if not prev or not cur:
        return []
    if prev.get('pr') != cur.get('pr') and prev.get('pr') is not None and cur.get('pr') is not None:
        return []
    events=[]
    if cfg.get('pm_github_head') and prev.get('head') != cur.get('head'):
        events.append(f"PR head changed: {(prev.get('head') or '')[:9]} → {(cur.get('head') or '')[:9]}")
    if cfg.get('pm_github_review'):
        old_review_id=int(prev.get('latest_review_id') or 0)
        new_reviews=[r for r in cur.get('latest_reviews',[]) if int(r.get('id') or 0)>old_review_id]
        if new_reviews:
            for review in new_reviews:
                events.append(f"PR review #{review.get('id')} by @{review.get('login') or 'unknown'}: {review.get('state') or 'submitted'}; {review.get('url') or 'no URL'}\n{review.get('body') or '(no review summary)'}")
        elif cur.get('latest_review_id',0) > old_review_id:
            events.append('A new pull-request review completed')
        old_comment_id=int(prev.get('latest_review_comment_id') or 0)
        new_comments=[r for r in cur.get('latest_review_comments',[]) if int(r.get('id') or 0)>old_comment_id]
        if new_comments:
            for comment in new_comments:
                events.append(f"Inline review comment #{comment.get('id')} by @{comment.get('login') or 'unknown'} on {comment.get('path') or '(path unknown)'}: {comment.get('url') or 'no URL'}\n{comment.get('body') or '(empty comment)'}")
        elif cur.get('latest_review_comment_id',0) > old_comment_id:
            events.append('A new inline review finding/comment appeared')
        if prev.get('reviewDecision') != cur.get('reviewDecision'):
            events.append(f"Review decision changed: {prev.get('reviewDecision')} → {cur.get('reviewDecision')}")
        old_requests=set(prev.get('review_requests') or [])
        new_requests=set(cur.get('review_requests') or [])
        for reviewer in sorted(new_requests-old_requests):
            events.append(f"Review requested from {reviewer}")
        for reviewer in sorted(old_requests-new_requests):
            events.append(f"Review request withdrawn for {reviewer}")
    if cfg.get('pm_github_control', True) and cur.get('latest_control_comment_id',0) > prev.get('latest_control_comment_id',0):
        updates = [c for c in cur.get('control_updates', []) if c['id'] > prev.get('latest_control_comment_id', 0)]
        if not updates:
            updates = [cur.get('latest_control_comment') or {}]
        for cc in updates:
            events.append(f"RWT control issue #{CONTROL_ISSUE} comment {cc.get('id')}: {cc.get('url') or ''}\n{cc.get('body') or 'new comment'}")
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
    """Keep each watcher request as its own durable delivery; dedupe poll retries."""
    key = hashlib.sha256((recipient + "\0" + msg).encode("utf-8")).hexdigest()
    return enqueue(aid, recipient, msg, source_actor='GITHUB', handoff_depth=0,
                   auto_handoff=True, event_key=key)


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
        for event in events:
            event_msg = f"GitHub state transition for {scope}:\n- {event}\nInspect this exact request and record its specific disposition. Do not mark it complete from a generic acknowledgment."
            qids.append(_coalesced_github_enqueue(aid,'pm',event_msg))
    if cfg.get('dev_github'):
        for event in events:
            event_msg = f"GitHub state transition for {scope}:\n- {event}\nInspect this exact request and return a task-specific checkpoint."
            qids.append(_coalesced_github_enqueue(aid,'dev',event_msg))
    return qids

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
    while not STOP.is_set():
        try:
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
                # Commit cursors and snapshot together only after enqueue above succeeds.
                with DB_LOCK, con() as c:
                    for key, state in snap.get('_pending_comment_cursors', []):
                        c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (key, json.dumps(state, ensure_ascii=False)))
                    saved_snapshot = {k: v for k, v in snap.items() if k != '_pending_comment_cursors'}
                    c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('github_watch_snapshot',?)", (json.dumps(saved_snapshot, sort_keys=True),))
            if not err:
                pending_pin_watchdog()
            STOP.wait(cfg.get('watch_interval_seconds',GITHUB_WATCH_INTERVAL))
        except Exception as e:
            add_activity('SYSTEM', f'GitHub watcher error: {type(e).__name__}: {e}', 'none', 'error')
            STOP.wait(GITHUB_WATCH_INTERVAL)

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
        manifest = {"pr_or_task": int(match.group(1)), "topic": topic, "created_at": datetime.now(timezone.utc).isoformat(), "files": []}
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
        "- CLI PM (you): READ-ONLY observer/reconciler in this bundled Codex transport. Do not call GitHub mutation tools in your read-only Codex process. Return typed pm_actions for the separate bounded executor when existing scope authorizes them: mark_ready, refresh_reviews, open_draft_pr, rerun_failed_jobs or dispatch_full_ci. It rechecks source packet/head/base/concurrency and qualifier. No merge/deploy/Production action is exposed. Actionable reconciled messages are published to #1258 so App Dev can read them; routine status remains on the board. Never tell PO to relay messages.\n"
        "- CLI Dev: engineering worker. One branch/task WRITE lease at a time. If its owned release task is externally blocked, it may claim the highest-priority independent READY RWT task unless another Dev owns it; current release repair preempts lower-priority work.\n"
        "- Browser PM: PM/research worker. May own any non-conflicting PM task, audit GitHub, preflight upcoming gates, prepare acceptance/merge packets, and detect stalls. Never duplicate a CLI PM mutation lease.\n"
        "- App Dev: engineering worker. May claim any independent READY RWT task in an isolated worktree. It is read-only on branches leased to CLI Dev. No push/merge without the appropriate PM/PO authority.\n"
        "QUEUE RULE: one writer per branch/task and one PM mutator per GitHub mutation. The board mechanically rejects conflicting active Dev WRITE leases by owner or branch. Otherwise both PMs and both Devs may work in parallel on independent READY RWT items. P0 release-path work preempts only the actor needed to service it. The board owns waiting and work stealing.\n"
        "DELIVERY PRIORITY: PO > PM/Dev handoff > other > coalesced GitHub watcher events.\n\n"
        f"MESSAGE:\n{q['content']}\n\n"
        "Return the next PM disposition. Route to dev for executable work owned by CLI Dev; do not block it from independent READY queue work merely because the current PR is externally waiting. "
        "Route to po only for a genuinely uncovered governed decision. Otherwise route to none. "
        "When an existing PO delegation covers merge/deploy/one authorized Production diagnostic, advance without stopping at PO."
    )


def compose_for_dev(q):
    return (
        "CLI DEV CONTRACT:\n"
        "- You hold a WRITE lease only for the branch/task named by the incoming directive. One branch has one writer at a time.\n"
        "- If your owned release task is externally blocked, you may claim the highest-priority independent READY RWT item unless App Dev already owns it. Use an isolated worktree and checkpoint cleanly.\n"
        "- P0/P1 release work on your owned branch preempts your lower-priority task; it does not stop other actors from advancing independent work.\n"
        "- NEVER PUSH unless the incoming directive contains explicit exact push authority/pin for the exact commit/head being pushed. Local-only authorized evidence runs do not need a PM pin when no push is involved.\n"
        "- Never mix bytes from separate queue items or edit a branch leased to App Dev.\n"
        "- Return exact head/tree, tests/gates, clean-tree proof, blockers, and the next required PM action.\n\n"
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
    cmd = [CLAUDE_BIN, "-p", content, "--output-format", "json", "--permission-mode", PERMISSION_MODE]
    if CLAUDE_MODEL:
        cmd += ["--model", CLAUDE_MODEL]
    cmd += ["--resume", sid] if existing else ["--session-id", sid]
    return cmd


def _run_claude_once(content, cwd, sid, existing):
    global ACTIVE_DEV_PROC
    cmd = _claude_command(content, sid, existing)
    with PROC_LOCK:
        ACTIVE_DEV_PROC = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=subscription_env("claude"))
    out, err = ACTIVE_DEV_PROC.communicate()
    rc = ACTIVE_DEV_PROC.returncode
    with PROC_LOCK:
        ACTIVE_DEV_PROC = None
    result, ret_sid, parse_err = parse_claude(out)
    return rc, result, ret_sid or sid, parse_err, err.strip()




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
        msg = str(obj.get("message", "")).strip()
        nxt = str(obj.get("next", "")).strip().lower()
        if nxt not in ("dev", "po", "none"):
            raise ValueError("next must be dev, po, or none")
        if not msg:
            raise ValueError("message is empty")
        if 'publish' in obj and not isinstance(obj['publish'], bool):
            raise ValueError('publish must be boolean')
        return {"message": msg, "next": nxt, "publish": obj.get('publish', True), "board_updates": obj.get("board_updates"), "pm_actions": obj.get("pm_actions") or [], "parse_error": None}
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
    raw = json.dumps({"message": obj.get("message", ""), "next": obj.get("next", "po"), "publish": obj.get('publish', True), "board_updates": obj.get("board_updates"), "pm_actions": obj.get("pm_actions") or []})
    sid = obj.get("session_id") or session_id or str(uuid.uuid4())
    return parse_pm_route(raw), sid


def run_dev(q):
    if not q.get('work_item_key'):
        raise RuntimeError('Unbound historical delivery: request a new task handoff')
    a = get_agent("dev")
    target = resolve_dev_target(q)
    if not target.get('ok'):
        raise RuntimeError(target['error'])
    cwd = target['path']
    if not resolved_bin(CLAUDE_BIN):
        raise RuntimeError(f"Claude CLI not found: {CLAUDE_BIN}")
    if cwd != a.get('cwd'):
        set_agent('dev', cwd=cwd, session_id=None, status='idle')
        a = get_agent('dev')
    update_queue(q['id'], work_item_key=target['item_key'], target_branch=target['validation']['branch'],
                 target_worktree=cwd, target_head=target['validation']['head'])

    existing = a.get("session_id")
    sid = existing or str(uuid.uuid4())
    update_queue(q["id"], status="delivering", started_at=now(), session_id=sid, attempts=(q.get("attempts") or 0) + 1)
    set_agent("dev", status="running", session_id=sid)

    dev_content = compose_for_dev(q)
    rc, result, sid, parse_err, stderr = _run_claude_once(dev_content, cwd, sid, bool(existing))
    # Claude Code may emit non-fatal warnings to stderr (for example MCP OAuth
    # migration warnings) while still exiting 0 and returning a valid JSON
    # response on stdout. stderr is diagnostic output, not an exit status.
    error = claude_transport_error(rc, parse_err, stderr)

    if error and existing and _is_stale_model_error(error):
        add_activity("SYSTEM", f"Stale Claude session; retrying once with {CLAUDE_MODEL or 'the Claude CLI default model'}.", "none", "system")
        set_agent("dev", session_id=None, status="running")
        sid = str(uuid.uuid4())
        update_queue(q["id"], session_id=sid)
        rc, result, sid, parse_err, stderr = _run_claude_once(dev_content, cwd, sid, False)
        error = claude_transport_error(rc, parse_err, stderr)

    if error:
        update_queue(q["id"], status="failed", error=error, finished_at=now(), session_id=sid)
        if _is_auth_error(error):
            set_agent("dev", status="auth_required", session_id=None)
            add_activity("Dev", 'Authentication expired — re-authenticate Claude CLI, then use New Dev session and retry.', "none", "error")
        else:
            set_agent("dev", status="error", session_id=sid)
            add_activity("Dev", f"Transport error: {error}", "none", "error")
        recover_failed_dev_delivery(q['id'], error)
        return

    update_queue(q["id"], status="responded", finished_at=now(), session_id=sid)
    set_agent("dev", status="idle", session_id=sid)
    aid = add_activity("Dev", result, "pm" if q.get("auto_handoff") else "none", "responded", trigger_queue_id=q["id"])
    if bool_setting("auto_dev_to_pm", True):
        maybe_handoff(aid, "Dev", "pm", result, q)


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
            if get_setting('last_executable_assignment', '') == signature or _has_pending_delivery('dev', item['item_key']):
                return None
            if not resolve_dev_target({'work_item_key': item['item_key']}).get('ok'):
                return None
            return item
    return None

def _has_pending_delivery(recipient, work_item_key=None):
    with DB_LOCK, con() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT id,status,work_item_key,source_actor FROM queue "
            "WHERE recipient=? AND status IN ('queued','delivering')",
            (recipient,),
        ).fetchall()]
    if work_item_key is None:
        return bool(rows)
    items = {x['item_key']: x for x in list_work_items()}
    owner = {'dev': 'cli_dev', 'pm': 'cli_pm'}.get(recipient, recipient)
    for row in rows:
        if row['status'] == 'delivering' or row.get('work_item_key') == work_item_key:
            return True
        other = items.get(row.get('work_item_key'))
        if other and other.get('owner') == owner and str(other.get('state') or '').lower() in WRITE_STATES:
            return True
        # An unrelated queued event or a held task does not suppress this task's wake.
    return False

def _wake_cli_dev_for_item(item, reason='PM board assignment'):
    """Create one executable Dev delivery for an active persisted CLI-Dev lease."""
    if not item or _has_pending_delivery('dev', item.get('item_key')):
        return None
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
            players = list_player_status()
            p = players.get('cli_dev') or {}
            key = str(p.get('work_item_key') or '')
            items = {x['item_key']: x for x in list_work_items()}
            item = items.get(key) if key else None
            if item and item.get('owner') == 'cli_dev' and str(item.get('state') or '').lower() in WRITE_STATES:
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
                        and not _has_pending_delivery('dev', item['item_key']) and signature != last):
                    _wake_cli_dev_for_item(item, 'Anti-idle repair: CLI Dev has active assigned work but no executable delivery')
            STOP.wait(2.0)
        except Exception as e:
            add_activity('SYSTEM', f'Anti-idle reconciler error: {type(e).__name__}: {e}', 'none', 'error')
            STOP.wait(5.0)

def _pm_request(args):
    obj, err = gh_json(args)
    if err:
        raise (RuntimeError if '-X' in args and args[args.index('-X')+1]=='POST' or 'graphql' in args and any('mutation(' in x for x in args) else Hold)('GitHub operation failed: ' + err[:300])
    return obj


def _pm_qualify(pr_number, head):
    # Existing gh session only; token is kept in child environment, never output/logged.
    p = subprocess.run(['gh', 'auth', 'token'], capture_output=True, text=True, timeout=20)
    if p.returncode or not p.stdout.strip():
        raise Hold('Existing GitHub login cannot supply qualification access')
    env = os.environ.copy()
    env.update(GITHUB_TOKEN=p.stdout.strip(), GITHUB_REPOSITORY='relativityE/speaksharp',
               PR_NUMBER=str(pr_number), EXPECTED_HEAD_SHA=head, GITHUB_EVENT_NAME='workflow_dispatch')
    env.pop('REVIEW_QUALIFICATION_FILE', None)
    check = subprocess.run(['node', 'scripts/collect-review-qualification.mjs'], cwd=BASE_REPO,
                           env=env, capture_output=True, text=True, timeout=90)
    if check.returncode or 'REVIEW-QUALIFIED:' not in check.stdout:
        raise Hold('Exact-head repo qualifier did not pass; no recovery started')


def execute_pm_actions(q, actions):
    if not isinstance(actions, list) or len(actions)>2:
        return ['BLOCKED_ACTIONS: malformed or over-limit typed action list; PM must return at most two supported actions with complete exact-head scope']
    results=[]
    for action in actions:
        if not isinstance(action, dict):
            results.append('BLOCKED_ACTION: action is not an object; PM must provide a supported typed action or an explicit disposition')
            continue
        kind=action.get('kind')
        supported={'mark_ready','refresh_reviews','open_draft_pr','rerun_failed_jobs','dispatch_full_ci'}
        if kind not in supported:
            label=str(kind)[:80] if kind is not None else '<missing kind>'
            result=f"BLOCKED_ACTION: unsupported actionable operation '{label}'; PM must map it to a supported typed action or provide a named manual disposition"
            results.append(result)
            add_activity('EXECUTOR',result,'none','blocked',trigger_queue_id=q['id'])
            continue
        if not bool_setting('pm_bounded_actions', True):
            result=f'HOLD_ACTION: {kind} was not executed because the bounded executor is disabled'
            results.append(result); add_activity('EXECUTOR',result,'none','held',trigger_queue_id=q['id']); continue
        key=hashlib.sha256(json.dumps(action,sort_keys=True).encode()).hexdigest()
        with DB_LOCK, con() as c:
            row=c.execute('SELECT * FROM pm_action_journal WHERE action_key=?',(key,)).fetchone()
            if row and row['status']!='held':
                results.append('RECORDED: '+row['status']+' · '+row['result']); continue
            if row:
                c.execute('DELETE FROM pm_action_journal WHERE action_key=?',(key,))
            c.execute('INSERT INTO pm_action_journal VALUES(?,?,?)',(key,'running','Execution started; outcome unconfirmed'))
        try:
            result=Executor(_pm_request,_pm_qualify).execute(action)
            state='completed'
        except Exception as e:
            # A rejected precondition is safe to reconsider on a new candidate/attempt.
            # Network errors can be uncertain; never replay blindly after restart.
            state='held' if isinstance(e, Hold) else 'unconfirmed'
            result=('HOLD: ' if state=='held' else 'UNCONFIRMED: ')+str(e)[:500]
        with DB_LOCK, con() as c:
            c.execute('UPDATE pm_action_journal SET status=?,result=? WHERE action_key=?',(state,result,key))
        results.append(result)
        add_activity('EXECUTOR',result,'none',state,trigger_queue_id=q['id'])
    return results


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
        pages,err=gh_json(['api','--paginate','--slurp','repos/relativityE/speaksharp/issues/1258/comments?per_page=100'])
        comments=[x for page in (pages or []) for x in (page if isinstance(page,list) else [page])]
        found=next((x for x in comments if marker in str(x.get('body') or '')),None)
        if err or not found:
            set_setting('pm_outbox_status','Unconfirmed PM post; inspect outbox before retry (no blind replay)')
            set_setting('pm_outbox_error', str(err or 'No matching publication marker yet')[:500])
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
                       ' returned no complete task/player checkpoint. Read current GitHub facts and return both board_updates.work_items and board_updates.players. '
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
    if any(x.startswith(('HOLD:', 'UNCONFIRMED:', 'RECORDED: running', 'RECORDED: unconfirmed')) for x in results):
        routed['next'] = 'none'
    if results:
        routed['message'] += '\n\nBOUNDED EXECUTOR RESULTS:\n' + '\n'.join(results)
    assigned_dev_item = _actionable_cli_dev_assignment(updates)
    needs_publication = routed.get('publish', True) or routed['next'] != 'none' or bool(results) or bool(assigned_dev_item)
    if not needs_publication:
        with DB_LOCK, con() as c:
            c.execute("INSERT OR REPLACE INTO pm_outbox VALUES(?,?,?,?)", (q['id'], 'local_only', None, routed['message']))
        set_setting('pm_outbox_status', 'Routine reconciliation kept on board; no GitHub post')
    elif not publish_pm_reply(q, routed['message']):
        error = get_setting('pm_outbox_error') or get_setting('pm_outbox_status')
        update_queue(q['id'], status='responded_unpublished', error=error, finished_at=now())
        set_agent('pm', status='error', session_id=sid)
        update_player_status('cli_pm', status='blocked', blocker=error, task='Publish PM reply to #1258', source='outbox')
        add_activity('SYSTEM', 'PM publication blocked: ' + error, 'none', 'error')
        return
    nxt = routed["next"]
    # A board assignment is not execution. Never end a PM turn with active CLI-Dev work
    # and no Dev delivery merely because the model returned next=none.
    if assigned_dev_item and nxt == 'none' and bool_setting("auto_pm_to_dev", True):
        nxt = 'dev'
        routed["message"] = (routed["message"] + "\n\nEXECUTION HANDOFF: CLI Dev has active assigned work "
            + assigned_dev_item.get('item_key','') + ". Start it now and return an acknowledgment/evidence packet.")
        add_activity('SYSTEM', f"Corrected PM route none→dev for active CLI Dev assignment {assigned_dev_item.get('item_key')}", 'none', 'system')
    status = "needs_po" if nxt == "po" else "responded"
    aid = add_activity("PM", routed["message"], nxt, status, trigger_queue_id=q["id"])
    if routed.get("parse_error"):
        add_activity("SYSTEM", f"PM routing JSON was invalid; failed safe to PO: {routed['parse_error']}", "none", "error")
    if nxt == "dev" and bool_setting("auto_pm_to_dev", True):
        delivery_id = maybe_handoff(aid, "PM", "dev", routed["message"], q,
                                    work_item_key=(assigned_dev_item or {}).get("item_key"))
        if assigned_dev_item and delivery_id:
            set_setting('last_executable_assignment', json.dumps([assigned_dev_item.get(k) for k in ('item_key','branch','worktree','next_action')], sort_keys=True))
            set_setting('anti_idle_cli_dev_signature', f"{assigned_dev_item.get('item_key')}|{assigned_dev_item.get('updated_at')}")


def maybe_handoff(activity_id, actor, recipient, content, parent_q, work_item_key=None):
    if not parent_q.get("auto_handoff"):
        return None
    depth = int(parent_q.get("handoff_depth") or 0) + 1
    terminal_notice = depth > MAX_HANDOFF_DEPTH and actor.upper() in ("DEV", "SYSTEM") and recipient == "pm"
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
        prior = c.execute("SELECT id FROM queue WHERE parent_queue_id=? AND recipient=? AND source_actor=?",
                          (parent_q["id"], recipient, actor.upper())).fetchone()
        if prior:
            return prior["id"]
        if terminal_notice:
            content = ("Automatic handoff depth limit reached. Reconcile this delivery and record its disposition; "
                       "no further writer turn will be started automatically.\n\n" + content)
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


def recover_failed_dev_delivery(queue_id, error):
    """Wake PM once for a failed assigned Dev delivery, without retrying the writer.

    Before-invocation failures need a corrected task route. After-invocation failures
    may have partial side effects, so PM must inspect them before issuing new work.
    """
    with DB_LOCK, con() as c:
        saved = c.execute("SELECT * FROM queue WHERE id=?", (queue_id,)).fetchone()
        q = dict(saved) if saved else None
    if (not q or q.get('recipient') != 'dev' or not q.get('work_item_key')
            or not str(q.get('status') or '').startswith('failed')):
        return None
    invoked = bool(q.get('started_at'))
    if invoked:
        content = (
            f"CLI Dev delivery #{q['id']} for {q['work_item_key']} failed after Dev invocation started "
            f"(attempts={q.get('attempts') or 0}; session={q.get('session_id') or '(unknown)'}). "
            f"Exact failure: {error}. Inspect the worktree for partial effects and record a specific disposition "
            "before issuing another writer turn. Do not automatically replay or create a second writer."
        )
    else:
        content = (
            f"CLI Dev delivery #{q['id']} for {q['work_item_key']} was blocked before Dev invocation. "
            f"Expected branch/worktree: {q.get('target_branch') or '(not recorded)'} / "
            f"{q.get('target_worktree') or '(not recorded)'}. Exact preflight error: {error}. "
            "Inspect this failed delivery and the persisted task/player lease. If the target worktree does not exist, "
            "assign a bounded bootstrap on a verified available checkout, then atomically transfer the same task lease "
            "to the tuple Dev actually creates. Do not retry this delivery or queue a second writer until the tuple is verified. "
            "Return the task-specific route, worker invocation result, and Dev ACK/checkpoint."
        )
    aid = add_activity('SYSTEM', content, 'pm', 'error', trigger_queue_id=q['id'])
    return maybe_handoff(aid, 'SYSTEM', 'pm', content, q)


def recover_failed_dev_preflight(queue_id, error):
    """Backward-compatible name for the pre-invocation recovery path."""
    return recover_failed_dev_delivery(queue_id, error)


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
                time.sleep(.35)
                continue
            if recipient == "dev":
                run_dev(q)
            elif recipient == "pm":
                run_pm(q)
            else:
                update_queue(q["id"], status="failed", error=f"unknown recipient {recipient}", finished_at=now())
        except Exception as e:
            if q:
                update_queue(q["id"], status="failed", error=str(e), finished_at=now())
                set_agent(recipient, status="error")
            add_activity("SYSTEM", f"{recipient.upper()} worker error: {e}", "none", "error")
            if recipient == 'dev' and q:
                recover_failed_dev_delivery(q['id'], str(e))
            time.sleep(.5)


def kill_agent(agent_id):
    global ACTIVE_DEV_PROC, ACTIVE_PM_PROC, PM_CANCEL_GENERATION
    if agent_id == "dev":
        with PROC_LOCK:
            p = ACTIVE_DEV_PROC
            if p and p.poll() is None:
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
            out["clean"] = subprocess.run(["git", "-C", path, "status", "--porcelain"], capture_output=True, text=True, timeout=5).stdout.strip() == ""
    except Exception as e:
        out["error"] = str(e)
    out["node_modules"] = (p / "node_modules").exists()
    out["frontend_node_modules"] = (p / "frontend" / "node_modules").exists()
    out["env"] = (p / ".env").exists()
    return out


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
        base["status"] = "active" if ast == "running" else ("blocked" if ast in ("auth_required","error") else "available")
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

    return {
        "version": BOARD_VERSION,
        "build": BOARD_BUILD,
        "goal": "RWT CLOSED",
        "observed_at": now(),
        "github_observed_at": pr.get('observed_at'),
        "github_error": pr.get("error"),
        "current": current_info,
        "blocker": blocker,
        "players": players,
        "priority_queue": active_items,
        "flow": items,
        "open_prs": priority_prs(pr.get("active") or [], pr.get("current"), 100),
        "reconciliation": get_setting("pm_reconciliation_status", "Awaiting first structured PM checkpoint"),
        "comms": {"poll":get_setting("github_watch_last_poll", ""),"wake":get_setting("github_watch_last_wake", ""),"error":get_setting("github_watch_last_error", ""),"outbox":get_setting("pm_outbox_status", "Awaiting PM reply")},
        "recent_completed": pr.get("recent_completed") or [],
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
    return {
        "pm_mode": mode,
        "pm_configured": configured,
        "pm_mutations_enabled": bool_setting("pm_bounded_actions", True),
        "pm_publish_control": bool_setting("pm_publish_control", True),
        "github_watch_last_poll": get_setting("github_watch_last_poll", ""),
        "github_watch_last_wake": get_setting("github_watch_last_wake", ""),
        "github_watch_error": get_setting("github_watch_last_error", ""),
        "pm_outbox_status": get_setting("pm_outbox_status", "Awaiting PM reply"),
        "pm_outbox_error": get_setting("pm_outbox_error", ""),
        "pm_pending_packet": get_setting("pm_pending_packet", ""),
        "pm_reconciliation": get_setting("pm_reconciliation_status", "Awaiting first structured PM checkpoint"),
        "pm_model": CODEX_MODEL if mode == "codex" and CODEX_MODEL else ("CLI default" if mode == "codex" else None),
        "pm_label": pm_label,
        "pm_auth_ok": CODEX_AUTH_OK if mode == "codex" else None,
        "pm_auth_detail": CODEX_AUTH_DETAIL if mode == "codex" else None,
        "claude_model": CLAUDE_MODEL or "CLI default",
        "dev_configured": bool(resolved_bin(CLAUDE_BIN)),
        "claude_subscription_mode": True,
        "claude_permission_mode": PERMISSION_MODE,
        "max_handoff_depth": MAX_HANDOFF_DEPTH,
    }



class H(BaseHTTPRequestHandler):
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
        u = urlparse(self.path)
        if u.path == "/":
            data = (STATIC / "index.html").read_bytes()
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
        if u.path == "/api/validate-worktree":
            qs = parse_qs(u.query)
            return self.sendj(200, validate_worktree(qs.get("path", [""])[0]))
        return self.sendj(404, {"error": "not found"})

    def do_POST(self):
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
                    github_message += "\n\nThese paths are on the board host, not downloadable GitHub attachments. CLI PM/Dev can read them there; external reviewers need an explicitly published copy."
                ok, err = post_control_issue_comment(github_message)
                if not ok:
                    add_activity("SYSTEM", f"GitHub-only post failed: {err}", "none", "error")
                    return self.sendj(502, {"error": err or "GitHub post failed"})
                add_activity("SYSTEM", f"Posted PO message to RWT control issue #{CONTROL_ISSUE}", "none", "responded")

            recipients = []
            if route in ("pm", "both"):
                recipients.append("pm")
            if route in ("dev", "both"):
                wt = resolve_dev_target({})
                if not wt.get('ok'):
                    add_activity('SYSTEM', f"Dev dispatch blocked: {wt['error']}", 'none', 'error')
                    return self.sendj(409, {'error': wt['error'], 'worktree': wt})
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
                ))
            return self.sendj(202, {"activity_id": aid, "delivery_ids": delivery_ids,
                                    "handoff_manifest": str(files[-1][1]) if files else None})

        if self.path == "/api/set-current-pr":
            if 'pr' not in b:
                return self.sendj(400, {'error': 'pr required; use an explicit empty value to clear selection'})
            set_setting("current_pr", str(b.get("pr", "")).strip())
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
                row = dict(row)
                if row["status"] not in ("failed", "failed_uncertain"):
                    return self.sendj(409, {"error": "only failed deliveries can be retried"})
                if row.get('recipient') == 'dev' and row.get('work_item_key'):
                    if row.get('started_at'):
                        return self.sendj(409, {"error": "Dev invocation already started; inspect possible partial effects and issue a new task handoff after PM disposition"})
                    recovery = c.execute(
                        "SELECT id FROM queue WHERE parent_queue_id=? AND recipient='pm' AND source_actor='SYSTEM' ORDER BY id LIMIT 1",
                        (qid,),
                    ).fetchone()
                    if recovery:
                        return self.sendj(409, {"error": f"PM disposition is queued in recovery #{recovery['id']}; retry this failed delivery only through a new verified task handoff"})
            if row.get('recipient') == 'dev' and row.get('work_item_key'):
                target = resolve_dev_target(row)
                if not target.get('ok'):
                    return self.sendj(409, {"error": "Dev retry is blocked until the assigned task tuple is valid: " + target['error']})
            with DB_LOCK, con() as c:
                cur = c.execute("UPDATE queue SET status='queued', error=NULL, started_at=NULL, finished_at=NULL WHERE id=? AND status IN ('failed','failed_uncertain')", (qid,))
                if cur.rowcount != 1:
                    return self.sendj(409, {"error": "delivery changed during retry validation; reconcile its current state"})
            return self.sendj(200, {"ok": True})

        return self.sendj(404, {"error": "not found"})

    def log_message(self, *args):
        pass


def main():
    # Bind before waking workers: a second launch on the same port cannot execute actions.
    srv = ThreadingHTTPServer((HOST, PORT), H)
    init_db()
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


if __name__ == "__main__":
    main()
