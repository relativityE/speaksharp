#!/usr/bin/env python3
"""Persistent recipient worker: run in its own Terminal, not inside another agent.

Pair a NEW local-inbox UUID once, after settling the old recipient's work.
This worker owns a separate Codex thread; it does not impersonate the old chat.
"""
import argparse
import fcntl
import json
import os
import queue
import sys
import threading
from pathlib import Path
import time
import urllib.parse
import urllib.error
import urllib.request
import uuid
import actor_channels as channels
from agent_transport import QueueRejected, QueueUncertain, RouteError
from worker_runtime import Ledger, StdioClient, initialize


def opener():
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *unused):
            return None
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def board_read(http, port, actor, entry):
    query = urllib.parse.urlencode({'actor': actor, 'session': entry['session_id'], 'worker': '1'})
    req = urllib.request.Request(f'http://127.0.0.1:{port}/api/agent-inbox?{query}',
                                 headers={'Authorization': 'Bearer ' + entry['inbox_token']})
    try:
        with http.open(req, timeout=10) as response:
            value = json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code in (400, 401, 403) or 300 <= exc.code < 400:
            raise RouteError('worker inbox authentication/route rejected') from exc
        raise
    if not isinstance(value.get('messages'), list):
        raise RouteError('invalid worker inbox response')
    return value


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--actor', required=True, choices=channels.ACTORS)
    p.add_argument('--cwd', type=Path)
    p.add_argument('--new-identity', action='store_true', help='print a new Orch pairing UUID; does not start or pair')
    p.add_argument('--codex', default='codex')
    p.add_argument('--port', type=int, default=4317)
    p.add_argument('--state-dir', type=Path, default=channels.ROOT)
    p.add_argument('--approval-console', action='store_true', help='show scoped command/file approval requests in this Terminal; never auto-approve')
    p.add_argument('--turn-timeout', type=int, default=1800)
    args = p.parse_args()
    if args.new_identity:
        print(str(uuid.uuid4()))
        return
    channels.ROOT = args.state_dir
    if not args.cwd or not args.cwd.is_dir() or not 30 <= args.turn_timeout <= 7200:
        p.error('--cwd must exist; turn timeout must be 30..7200 seconds')
    entry = channels.read_config()['routes'].get(args.actor, {})
    if entry.get('provider') != 'local_inbox' or not entry.get('inbox_token'):
        p.error('pair the new worker identity as Local inbox in Orch first')
    fd = os.open(channels.ROOT / ('.inbox-listener-' + args.actor + '.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    os.fchmod(fd, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        p.error('another listener/worker owns this actor; stop it at a safe boundary first')
    ledger = Ledger(args.actor, entry['session_id'], args.cwd.resolve())
    def approval(event):
        if not sys.stdin.isatty():
            return 'cancel'
        params = event.get('params', {})
        print('Runtime approval requested: ' + event['method'], flush=True)
        preview = {k: params[k] for k in ('threadId', 'turnId', 'command', 'cwd', 'grantRoot', 'reason', 'networkApprovalContext') if k in params}
        print(json.dumps(preview, ensure_ascii=True), flush=True)
        print('Type accept to approve this exact request, or decline/cancel (60 second limit): ', flush=True)
        replies = queue.Queue()
        def read_decision():
            try:
                replies.put(input().strip())
            except (EOFError, OSError):
                replies.put('cancel')
        threading.Thread(target=read_decision, daemon=True).start()
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            ledger.heartbeat('awaiting_approval', 'Exact runtime request awaiting operator in worker Terminal')
            try:
                decision = replies.get(timeout=5)
                return decision if decision in ('accept', 'decline', 'cancel') else 'cancel'
            except queue.Empty:
                pass
        return 'cancel'
    http = opener()
    client = None
    try:
        client = StdioClient(args.codex, ledger.cwd, approval if args.approval_console else None)
        thread = initialize(client, ledger)
        print(f"Registered {args.actor}: Orch {ledger.session}; Codex thread {ledger.thread_id}", flush=True)
        first = board_read(http, args.port, args.actor, entry)
        ledger.settle(first.get('settled_actions', []))
        # Never replay a crash-interrupted send, even if the resumed thread is idle.
        if ledger.unresolved():
            ledger.heartbeat('blocked_transport', 'Unresolved prior action: inspect worker ledger and authenticated callbacks; no replay')
            print('BLOCKED: unresolved prior action; no turn was replayed', flush=True)
            return
        if thread.get('status', {}).get('type') == 'active':
            ledger.heartbeat('blocked_transport', 'Resumed thread is active; inspect its actual turn before dispatch')
            return
        while True:
            if channels.read_config()['routes'].get(args.actor) != entry:
                raise RouteError('pairing changed; stale worker stopped')
            ledger.heartbeat()
            if client.proc.poll() is not None and not ledger.unresolved():
                # Idle process death is safe to resume; no action is resubmitted.
                client.close()
                client = StdioClient(args.codex, ledger.cwd, approval if args.approval_console else None)
                thread = initialize(client, ledger)
                if thread.get('status', {}).get('type') != 'idle':
                    raise RouteError('resumed worker is not idle; reconciliation required')
            try:
                inbox = board_read(http, args.port, args.actor, entry)
                ledger.settle(inbox.get('settled_actions', []))
                messages = inbox['messages']
                if ledger.unresolved():
                    ledger.heartbeat('waiting_for_result', 'Unresolved action blocks new turns; recipient callback or PM reconciliation required')
            except OSError:
                ledger.heartbeat('board_unavailable', 'Board unavailable; durable actions retained')
                time.sleep(5)
                continue
            for message in messages:
                action, body = message.get('action_id'), message.get('body')
                if not isinstance(action, str) or not isinstance(body, str) or not body.startswith('RWT-BOARD TASK ' + action + '\n'):
                    raise RouteError('invalid immutable worker task')
                if ledger.unresolved():
                    continue
                live = client.rpc('thread/read', {'threadId': ledger.thread_id, 'includeTurns': False}).get('thread', {})
                if live.get('id') != ledger.thread_id or live.get('status', {}).get('type') != 'idle':
                    ledger.heartbeat('blocked_transport', 'Owned thread is not verified idle; no turn submitted')
                    return
                if not ledger.claim(action):
                    continue
                turn_id = ''
                try:
                    client.approval_turn = ''
                    result = client.rpc('turn/start', {'threadId': ledger.thread_id,
                        'input': [{'type': 'text', 'text': body + '\nYou are the registered recipient worker. Invoke the authenticated receipt yourself, then perform only this bounded task and return its authenticated result. PM performs no branch or merge operations; Dev performs only explicitly authorized operations. No other chat owns this worker thread.'}]})
                    turn_id = result.get('turn', {}).get('id', '')
                    if not turn_id:
                        raise QueueUncertain('turn/start omitted turn identity')
                    client.approval_turn = turn_id
                    ledger.state(action, 'sent', turn_id)
                    deadline = time.monotonic() + args.turn_timeout
                    while time.monotonic() < deadline:
                        ledger.heartbeat('working')
                        event = client.event(5)
                        params = event.get('params', {})
                        if event.get('method') == 'turn/completed' and params.get('threadId') == ledger.thread_id and params.get('turn', {}).get('id') == turn_id:
                            terminal = params['turn'].get('status')
                            ledger.state(action, 'callback_missing' if terminal == 'completed' else terminal if terminal in ('failed', 'interrupted') else 'uncertain', turn_id,
                                         error='Turn ended; waiting for authenticated task receipt/result' if terminal == 'completed' else 'Turn ended without qualified task result')
                            print(f'{action}: turn {terminal}; authenticated receipt/result still required', flush=True)
                            break
                    else:
                        client.rpc('turn/interrupt', {'threadId': ledger.thread_id, 'turnId': turn_id}, timeout=10)
                        raise QueueUncertain('Turn deadline; interrupt requested, result not confirmed')
                except PermissionError:
                    ledger.state(action, 'blocked_approval', turn_id, 'Normal runtime approval required; permission settings unchanged')
                    ledger.heartbeat('blocked_transport', 'Recipient approval blocked; inspect exact action')
                    return
                except QueueRejected:
                    ledger.state(action, 'failed', turn_id, 'App-server explicitly rejected request; PM disposition required')
                    ledger.heartbeat('blocked_transport', 'App-server rejected action; no automatic retry')
                    return
                except (OSError, QueueUncertain):
                    ledger.state(action, 'uncertain', turn_id, 'Delivery outcome uncertain; no automatic retry')
                    ledger.heartbeat('blocked_transport', 'Uncertain action requires reconciliation before further work')
                    return
            time.sleep(2)
    except KeyboardInterrupt:
        ledger.heartbeat('stopped', 'Operator stopped owned worker; inspect any sent turn before restart')
    except (OSError, RouteError, QueueRejected, QueueUncertain):
        if ledger.thread_id:
            ledger.heartbeat('blocked_transport', 'Worker initialization/transport failed; no replacement thread or retry')
        raise SystemExit('Worker blocked; inspect registration/action status. No callback or permission change was fabricated.')
    finally:
        if client:
            try:
                client.close()
            except (OSError, TimeoutError, QueueUncertain):
                if ledger.thread_id:
                    ledger.heartbeat('blocked_transport', 'Owned process-group cleanup unverified; no replacement permitted')
                print('Owned app-server cleanup UNVERIFIED; do not start replacement until inspected', flush=True)
        os.close(fd)


if __name__ == '__main__':
    main()
