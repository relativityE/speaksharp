"""Private persistent recipient pairing and a durable local background-task inbox.

An inbox read is neither a receipt nor proof that a runtime woke. The recipient must
acknowledge the existing board action through its authenticated task callback.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import tempfile
import threading
import time
from contextlib import contextmanager
import agent_transport

ROOT = Path(__file__).resolve().parent / '.agent-work'
LOCK = threading.RLock()
ACTORS = ('cli_dev', 'app_dev', 'browser_pm', 'cli_pm')


def read_config():
    path = ROOT / 'agent-routes.json'
    if not path.exists():
        return {'version': 1, 'routes': {}}
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise agent_transport.RouteError('agent-routes.json must be a private regular file (chmod 600)')
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise agent_transport.RouteError('persisted recipient pairing is unreadable') from exc
    if not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('routes'), dict):
        raise agent_transport.RouteError('persisted recipient pairing must be a version 1 routes object')
    return value


def route_env():
    if os.environ.get('RWT_AGENT_ROUTES_JSON'):
        return os.environ
    env = dict(os.environ)
    config = read_config()
    if config['routes']:
        env['RWT_AGENT_ROUTES_JSON'] = json.dumps(config)
    return env


def pair(actor_id, provider, session_id):
    if actor_id not in ACTORS:
        raise agent_transport.RouteError('unknown actor')
    if os.environ.get('RWT_AGENT_ROUTES_JSON'):
        raise agent_transport.RouteError('environment routes are active; remove that override before changing persisted pairing')
    entry = {'provider': provider, 'session_id': session_id}
    agent_transport.configured_route(actor_id, {'RWT_AGENT_ROUTES_JSON': json.dumps({'version': 1, 'routes': {actor_id: entry}})})
    with LOCK:
        config = read_config()
        for other, paired in config['routes'].items():
            if other != actor_id and paired.get('session_id') == session_id:
                raise agent_transport.RouteError('this session is already paired to another actor')
        old = config['routes'].get(actor_id)
        if old and old.get('provider') == provider and old.get('session_id') == session_id:
            return {'actor_id': actor_id, 'provider': provider, 'session_id': session_id, 'changed': False}
        if pending(actor_id):
            raise agent_transport.RouteError('recipient has pending inbox actions; settle them before changing pairing')
        entry['inbox_token'] = secrets.token_urlsafe(32)
        config['routes'][actor_id] = entry
        ROOT.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix='.routes-', dir=ROOT)
        try:
            with os.fdopen(fd, 'w') as out:
                json.dump(config, out)
                out.flush()
                os.fsync(out.fileno())
            os.replace(name, ROOT / 'agent-routes.json')
        finally:
            if os.path.exists(name):
                os.unlink(name)
    return {'actor_id': actor_id, 'provider': provider, 'session_id': session_id, 'changed': True}


@contextmanager
def db():
    ROOT.mkdir(parents=True, exist_ok=True)
    path = ROOT / 'actor-inbox.db'
    # Create privately before SQLite opens it, including first use after an upgrade.
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    os.close(fd)
    os.chmod(path, 0o600)
    c = sqlite3.connect(path, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute('CREATE TABLE IF NOT EXISTS messages(action_id TEXT PRIMARY KEY, actor TEXT NOT NULL, session TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, created REAL NOT NULL)')
    c.execute('CREATE TABLE IF NOT EXISTS listeners(actor TEXT PRIMARY KEY, session TEXT NOT NULL, seen REAL NOT NULL)')
    if 'state' not in {r[1] for r in c.execute('PRAGMA table_info(listeners)')}:
        c.execute("ALTER TABLE listeners ADD COLUMN state TEXT NOT NULL DEFAULT 'listening'")
    try:
        with c:
            yield c
    finally:
        c.close()


def pending(actor):
    with LOCK, db() as c:
        return c.execute("SELECT count(*) FROM messages WHERE actor=? AND state IN ('pending','presented')", (actor,)).fetchone()[0]


def remember_callback(route, message):
    """Private callback copy for a recipient-invoked helper; never creates inbox wake/receipt."""
    if not message.startswith('RWT-BOARD TASK '):
        raise agent_transport.QueueRejected('callback copy requires a task identity')
    action = message.split('\n', 1)[0][len('RWT-BOARD TASK '):]
    digest = hashlib.sha256(message.encode()).hexdigest()
    with LOCK, db() as c:
        old = c.execute('SELECT * FROM messages WHERE action_id=?', (action,)).fetchone()
        if old and (old['digest'] != digest or old['actor'] != route.actor_id or old['session'] != route.session_id):
            raise agent_transport.QueueRejected('conflicting immutable callback action')
        c.execute('INSERT OR IGNORE INTO messages VALUES(?,?,?,?,?,?,?)',
                  (action, route.actor_id, route.session_id, message, digest, 'callback_only', time.time()))


def enqueue(route, message):
    if route.provider != 'local_inbox':
        raise agent_transport.QueueRejected('inbox requires an explicit local_inbox route')
    current = agent_transport.configured_route(route.actor_id, route_env())
    if current != route:
        raise agent_transport.QueueRejected('paired recipient changed before inbox delivery')
    if not message.startswith('RWT-BOARD TASK '):
        raise agent_transport.QueueRejected('inbox message must carry a board action identity')
    action = message.split('\n', 1)[0][len('RWT-BOARD TASK '):]
    digest = hashlib.sha256(message.encode()).hexdigest()
    try:
        with LOCK, db() as c:
            old = c.execute('SELECT * FROM messages WHERE action_id=?', (action,)).fetchone()
            if old and (old['digest'] != digest or old['actor'] != route.actor_id or old['session'] != route.session_id):
                raise agent_transport.QueueRejected('conflicting immutable inbox action')
            c.execute('INSERT OR IGNORE INTO messages VALUES(?,?,?,?,?,?,?)', (action, route.actor_id, route.session_id, message, digest, 'pending', time.time()))
    except sqlite3.Error as exc:
        raise agent_transport.QueueUncertain('inbox commit outcome uncertain; reconcile action before retry') from exc
    return {'transport': 'local_inbox', 'accepted': True, 'session_id': route.session_id, 'detail': 'inbox:' + action}


def inbox(actor, session, token, worker=False):
    entry = read_config()['routes'].get(actor, {})
    if (entry.get('provider') != 'local_inbox' or entry.get('session_id') != session
            or not token or not hmac.compare_digest(str(entry.get('inbox_token', '')), token)):
        raise agent_transport.RouteError('invalid inbox actor/session authentication')
    with LOCK, db() as c:
        import worker_runtime
        registered = worker_runtime.status(actor, session)
        if worker and not registered:
            raise agent_transport.RouteError('worker has not registered its actual thread')
        if registered and not worker:
            raise agent_transport.RouteError('persistent worker owns this inbox; do not start a second listener')
        c.execute('INSERT OR REPLACE INTO listeners(actor,session,seen,state) VALUES(?,?,?,?)', (actor, session, time.time(), 'listening'))
        rows = c.execute("SELECT action_id,body FROM messages WHERE actor=? AND session=? AND state IN ('pending','presented') ORDER BY created LIMIT ?", (actor, session, 1 if worker else 20)).fetchall() if worker else c.execute("SELECT action_id,body FROM messages WHERE actor=? AND session=? AND state='pending' ORDER BY created LIMIT 20", (actor, session)).fetchall()
    return [dict(row) for row in rows]


def received(action_id):
    with LOCK, db() as c:
        c.execute("UPDATE messages SET state='received' WHERE action_id=?", (action_id,))


def presented(action_id, actor, session):
    """One presentation only; outstanding receipt remains pending in the host ledger."""
    with LOCK, db() as c:
        return c.execute("UPDATE messages SET state='presented' WHERE action_id=? AND actor=? AND session=? AND state='pending'",
                         (action_id, actor, session)).rowcount == 1


def listener_status(actor, session):
    with LOCK, db() as c:
        row = c.execute('SELECT seen,state FROM listeners WHERE actor=? AND session=?', (actor, session)).fetchone()
    return {'listener_recent': bool(row and row['state'] == 'listening' and time.time() - row['seen'] < 30),
            'listener_state': row['state'] if row else 'not_observed', 'listener_last_seen': row['seen'] if row else None}


def set_listener_state(actor, session, token, state):
    if state not in ('waiting_for_rearm', 'stopped'):
        raise agent_transport.RouteError('invalid listener state')
    entry = read_config()['routes'].get(actor, {})
    if (entry.get('provider') != 'local_inbox' or entry.get('session_id') != session
            or not token or not hmac.compare_digest(str(entry.get('inbox_token', '')), token)):
        raise agent_transport.RouteError('invalid inbox actor/session authentication')
    with LOCK, db() as c:
        c.execute('INSERT OR REPLACE INTO listeners(actor,session,seen,state) VALUES(?,?,?,?)', (actor, session, time.time(), state))
