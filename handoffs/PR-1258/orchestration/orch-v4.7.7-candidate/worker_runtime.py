"""Recipient-owned persistent Codex worker. Never manufactures board callbacks.

The action ledger is deliberately separate from receipt/result. A potentially
sent turn is never sent again, including after a process or board restart.
"""
import json
import os
import queue
import subprocess
import threading
import time
import uuid
import actor_channels as channels
from agent_transport import RouteError, QueueRejected, QueueUncertain


class Ledger:
    def __init__(self, actor, session, cwd):
        self.actor, self.session, self.cwd = actor, session, str(cwd)
        with channels.db() as c:
            c.execute('CREATE TABLE IF NOT EXISTS workers(actor TEXT PRIMARY KEY, session TEXT NOT NULL, worker_id TEXT NOT NULL, thread_id TEXT NOT NULL, cwd TEXT NOT NULL, generation TEXT NOT NULL, pid INTEGER NOT NULL, seen REAL NOT NULL, status TEXT NOT NULL, error TEXT NOT NULL)')
            columns = {r[1] for r in c.execute('PRAGMA table_info(workers)')}
            for name, definition in (('runtime_session_id', 'TEXT'), ('runtime_pid', 'INTEGER'), ('provider', "TEXT NOT NULL DEFAULT 'codex_app_server'"), ('connection', "TEXT NOT NULL DEFAULT 'owned_stdio'")):
                if name not in columns:
                    c.execute('ALTER TABLE workers ADD COLUMN ' + name + ' ' + definition)
            c.execute('CREATE TABLE IF NOT EXISTS worker_actions(action_id TEXT PRIMARY KEY, actor TEXT NOT NULL, session TEXT NOT NULL, thread_id TEXT NOT NULL, generation TEXT NOT NULL, state TEXT NOT NULL, turn_id TEXT NOT NULL, error TEXT NOT NULL, updated REAL NOT NULL)')
        row = self.registration()
        if row and (row['session'] != session or row['cwd'] != self.cwd):
            raise RouteError('registered worker identity/cwd differs; reconcile old worker before replacement')
        self.worker_id = row['worker_id'] if row else str(uuid.uuid4())
        self.thread_id = row['thread_id'] if row else ''
        self.generation = str(uuid.uuid4())

    def registration(self):
        with channels.db() as c:
            row = c.execute('SELECT * FROM workers WHERE actor=?', (self.actor,)).fetchone()
        return dict(row) if row else None

    def register(self, thread, runtime_pid=None):
        thread_id = thread.get('id')
        if not isinstance(thread_id, str) or not thread_id or len(thread_id) > 200:
            raise RouteError('app-server returned no verified thread identity')
        if self.thread_id and thread_id != self.thread_id:
            raise RouteError('resume returned a different thread; no replacement allowed')
        self.thread_id = thread_id
        with channels.db() as c:
            c.execute('INSERT OR REPLACE INTO workers(actor,session,worker_id,thread_id,cwd,generation,pid,seen,status,error,runtime_session_id,runtime_pid,provider,connection) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                      (self.actor, self.session, self.worker_id, thread_id, self.cwd,
                       self.generation, os.getpid(), time.time(), 'listening', '',
                       thread.get('sessionId') if isinstance(thread.get('sessionId'), str) else None,
                       runtime_pid, 'codex_app_server', 'owned_stdio'))

    def heartbeat(self, status='listening', error=''):
        with channels.db() as c:
            changed = c.execute('UPDATE workers SET seen=?,status=?,error=? WHERE actor=? AND session=? AND generation=?',
                                (time.time(), status, error, self.actor, self.session, self.generation)).rowcount
        if not changed:
            raise RouteError('worker registration superseded; stop stale relay')

    def claim(self, action):
        """Commit the uncertainty boundary BEFORE turn/start; uniqueness prevents replay."""
        with channels.db() as c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT generation FROM workers WHERE actor=? AND session=?', (self.actor, self.session)).fetchone()
            if not row or row['generation'] != self.generation:
                raise RouteError('stale worker cannot claim')
            unresolved = c.execute("SELECT 1 FROM worker_actions WHERE actor=? AND state IN ('sending','sent','uncertain','blocked_approval','callback_missing','failed','interrupted')", (self.actor,)).fetchone()
            if unresolved:
                return False
            return c.execute('INSERT OR IGNORE INTO worker_actions VALUES(?,?,?,?,?,?,?,?,?)',
                             (action, self.actor, self.session, self.thread_id, self.generation,
                              'sending', '', '', time.time())).rowcount == 1

    def state(self, action, state, turn_id='', error=''):
        if state not in ('sent', 'completed', 'failed', 'interrupted', 'uncertain', 'blocked_approval', 'callback_missing'):
            raise ValueError('invalid worker state')
        with channels.db() as c:
            changed = c.execute('UPDATE worker_actions SET state=?,turn_id=CASE WHEN ?<>\'\' THEN ? ELSE turn_id END,error=?,updated=? WHERE action_id=? AND actor=? AND session=? AND generation=? AND EXISTS (SELECT 1 FROM workers WHERE actor=worker_actions.actor AND generation=worker_actions.generation)',
                                (state, turn_id, turn_id, error, time.time(), action, self.actor, self.session, self.generation)).rowcount
        if not changed:
            raise RouteError('stale worker cannot update action')

    def unresolved(self):
        with channels.db() as c:
            return [dict(r) for r in c.execute("SELECT action_id,state,turn_id,error FROM worker_actions WHERE actor=? AND session=? AND state IN ('sending','sent','uncertain','blocked_approval','callback_missing','failed','interrupted') ORDER BY updated", (self.actor, self.session))]

    def settle(self, actions):
        with channels.db() as c:
            current = c.execute('SELECT generation FROM workers WHERE actor=? AND session=?', (self.actor, self.session)).fetchone()
            if not current or current['generation'] != self.generation:
                raise RouteError('stale worker cannot reconcile action')
            for action in actions:
                c.execute("UPDATE worker_actions SET state='completed',error='',updated=? WHERE action_id=? AND actor=? AND session=? AND thread_id=?",
                          (time.time(), action, self.actor, self.session, self.thread_id))


def status(actor, session):
    with channels.db() as c:
        if not c.execute("SELECT 1 FROM sqlite_master WHERE name='workers'").fetchone():
            return None
        row = c.execute('SELECT * FROM workers WHERE actor=? AND session=?', (actor, session)).fetchone()
        if not row:
            return None
        value = dict(row)
        value['recent'] = time.time() - value['seen'] < 30 and value['status'] not in ('stopped', 'blocked_transport')
        value['actions'] = [dict(r) for r in c.execute('SELECT action_id,state,turn_id,error FROM worker_actions WHERE actor=? AND session=? ORDER BY updated DESC LIMIT 10', (actor, session))]
        return value


class StdioClient:
    """Own one app-server process and one stream; retain notifications during RPCs."""
    def __init__(self, binary, cwd, approval_handler=None):
        self.approval_handler = approval_handler
        self.approval_thread = ''
        self.approval_turn = ''
        env = dict(os.environ)
        env.pop('OPENAI_API_KEY', None)
        env.pop('CODEX_API_KEY', None)
        self.proc = subprocess.Popen([binary, 'app-server'], cwd=cwd,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, start_new_session=True, env=env)
        self.events, self.saved, self.counter = queue.Queue(), [], 0
        def read():
            try:
                for line in self.proc.stdout:
                    self.events.put(json.loads(line))
            except (ValueError, OSError):
                pass
            finally:
                self.events.put(None)
        threading.Thread(target=read, daemon=True).start()

    def send(self, message):
        self.proc.stdin.write(json.dumps(message) + '\n')
        self.proc.stdin.flush()

    def event(self, timeout=1):
        if self.saved:
            return self.saved.pop(0)
        try:
            event = self.events.get(timeout=timeout)
        except queue.Empty:
            return {}
        if event is None:
            raise QueueUncertain('owned app-server disconnected')
        if 'method' in event and 'id' in event:
            params = event.get('params', {})
            if (self.approval_handler and self.approval_turn and params.get('threadId') == self.approval_thread
                    and params.get('turnId') == self.approval_turn
                    and event['method'] in ('item/commandExecution/requestApproval', 'item/fileChange/requestApproval')):
                decision = self.approval_handler(event)
                if decision not in ('accept', 'decline', 'cancel'):
                    raise PermissionError('invalid approval decision')
                self.send({'id': event['id'], 'result': {'decision': decision}})
                if decision != 'accept':
                    raise PermissionError('operator declined runtime approval')
                return {}
            # No permission bypass or silent approval for unsupported prompts.
            self.send({'id': event['id'], 'error': {'code': -32000, 'message': 'Orch worker requires normal runtime approval; no automatic approval'}})
            raise PermissionError('worker command needs approval in the owning runtime')
        return event

    def rpc(self, method, params, timeout=30):
        self.counter += 1
        request_id = self.counter
        self.send({'id': request_id, 'method': method, 'params': params})
        deadline = time.monotonic() + timeout
        deferred = []
        try:
            while time.monotonic() < deadline:
                event = self.event(min(1, max(.01, deadline - time.monotonic())))
                if event.get('id') == request_id:
                    if 'error' in event:
                        raise QueueRejected('app-server rejected ' + method)
                    return event.get('result', {})
                if event:
                    deferred.append(event)
            raise QueueUncertain('app-server response deadline: ' + method)
        finally:
            self.saved = deferred + self.saved

    def close(self):
        import signal
        if self.proc.poll() is None:
            os.killpg(self.proc.pid, signal.SIGTERM)
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.proc.pid, signal.SIGKILL)
                self.proc.wait(timeout=5)
        # A reaped parent is not evidence that its descendants stopped. Inspect
        # the owned group even if the parent exited on SIGTERM or beforehand.
        try:
            os.killpg(self.proc.pid, 0)
        except ProcessLookupError:
            pass
        else:
            os.killpg(self.proc.pid, signal.SIGKILL)
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                try:
                    os.killpg(self.proc.pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(.05)
            else:
                raise QueueUncertain('owned app-server descendant cleanup unverified')
        self.proc.stdin.close()
        self.proc.stdout.close()


def initialize(client, ledger):
    client.rpc('initialize', {'clientInfo': {'name': 'orch_worker', 'title': 'Orch recipient worker', 'version': '4.7.6'}})
    client.send({'method': 'initialized', 'params': {}})
    method = 'thread/resume' if ledger.thread_id else 'thread/start'
    params = {'threadId': ledger.thread_id} if ledger.thread_id else {'cwd': ledger.cwd}
    result = client.rpc(method, params)
    ledger.register(result.get('thread', {}), client.proc.pid)
    client.approval_thread = ledger.thread_id
    return result.get('thread', {})
