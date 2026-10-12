"""Resume only already registered idle Dev workers; never creates a recipient/thread.

Both the old listener AND its app-server must be absent. An uncertain action,
permission block or unknown process identity is a stop, not a retry instruction.
"""
import os
import subprocess
import sys
from pathlib import Path
import actor_channels


def alive(pid):
    if not isinstance(pid, int) or pid <= 1:
        return True  # Unknown process identity is never proof of absence.
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def restart_reason(worker, unresolved, route, is_alive=alive):
    if worker['actor'] not in ('cli_dev', 'app_dev'):
        return 'PM roles use the sole board executor; no automatic second PM writer'
    if route.get('provider') != 'local_inbox' or route.get('session_id') != worker['session']:
        return 'Pairing differs from the registered worker'
    if not worker.get('thread_id'):
        return 'No verified saved thread to resume'
    if unresolved:
        return 'Unresolved action; no sent task may be replayed'
    if worker.get('status') not in ('listening', 'board_unavailable', 'stopped'):
        return 'Worker is blocked or working; explicit reconciliation required'
    if is_alive(worker.get('pid')) or is_alive(worker.get('runtime_pid')):
        return 'Existing worker or app-server still alive/unverified'
    if not Path(worker.get('cwd') or '').is_dir():
        return 'Registered checkout unavailable'
    return ''


def resume_registered(app, port, codex, *, spawn=subprocess.Popen, is_alive=alive):
    """Caller owns the board singleton. Listener lock is the final duplicate-worker guard."""
    results = []
    routes = actor_channels.read_config()['routes']
    with actor_channels.db() as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='workers'").fetchone():
            return []
        workers = [dict(r) for r in db.execute('SELECT * FROM workers')]
        unresolved = {w['actor']: db.execute("SELECT count(*) FROM worker_actions WHERE actor=? AND session=? AND state<>'completed'",
                                            (w['actor'], w['session'])).fetchone()[0] for w in workers}
    for w in workers:
        reason = restart_reason(w, unresolved[w['actor']], routes.get(w['actor'], {}), is_alive)
        if reason:
            continue
        # A private append-only log is operational output, not a callback/receipt.
        log_path = actor_channels.ROOT / ('worker-' + w['actor'] + '.log')
        fd = os.open(log_path, os.O_CREAT | os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW, 0o600)
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'ab') as log:
            child = spawn([sys.executable, str(Path(app) / 'orch-worker.py'), '--actor', w['actor'],
                           '--cwd', w['cwd'], '--codex', codex, '--port', str(port),
                           '--state-dir', str(actor_channels.ROOT)], stdout=log, stderr=log, start_new_session=True)
        # Avoid another launch before registration. New process does its own thread verification.
        with actor_channels.db() as db:
            db.execute("UPDATE workers SET pid=?,status='resuming' WHERE actor=? AND session=? AND pid=?",
                       (child.pid, w['actor'], w['session'], w['pid']))
        results.append({'actor': w['actor'], 'pid': child.pid, 'thread': w['thread_id'], 'state': 'resuming'})
    return results
