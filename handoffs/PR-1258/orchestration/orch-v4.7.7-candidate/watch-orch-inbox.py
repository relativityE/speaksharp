#!/usr/bin/env python3
"""Run as a background task INSIDE the paired App Dev session; rearm after pickup.

Exits with a task prompt so the runtime's background-task completion wakes that
existing session. Never starts another writer or acknowledges on the actor's behalf.
"""
import argparse
import fcntl
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
import actor_channels


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--actor', required=True, choices=actor_channels.ACTORS)
    p.add_argument('--port', type=int, default=4317)
    p.add_argument('--state-dir', type=Path, default=actor_channels.ROOT)
    args = p.parse_args()
    actor_channels.ROOT = args.state_dir
    config = actor_channels.read_config()['routes'].get(args.actor, {})
    if config.get('provider') != 'local_inbox' or not config.get('inbox_token'):
        p.error('pair this actor with local_inbox in Orch Advanced first')
    lock_path = actor_channels.ROOT / ('.inbox-listener-' + args.actor + '.lock')
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    os.fchmod(fd, 0o600)
    listener_lock = os.fdopen(fd, 'r+')
    try:
        fcntl.flock(listener_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        p.error('this actor already has an Orch inbox listener; keep one background task')
    qs = urllib.parse.urlencode({'actor': args.actor, 'session': config['session_id']})
    req = urllib.request.Request(f'http://127.0.0.1:{args.port}/api/agent-inbox?{qs}', headers={'Authorization': 'Bearer ' + config['inbox_token']})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *unused):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    failures = 0
    while True:
        try:
            with opener.open(req, timeout=10) as response:
                result = json.load(response)
            if not isinstance(result, dict) or not isinstance(result.get('messages'), list):
                raise SystemExit('Orch inbox response is invalid; no tasks marked acknowledged')
            messages = result['messages']
            if any(not isinstance(m, dict) or not isinstance(m.get('body'), str) for m in messages):
                raise SystemExit('Orch task response is invalid; repair the listener before rearming')
            failures = 0
            if messages:
                state = urllib.request.Request(f'http://127.0.0.1:{args.port}/api/agent-listener',
                    data=json.dumps({'actor_id': args.actor, 'session_id': config['session_id'], 'state': 'waiting_for_rearm'}).encode(),
                    headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config['inbox_token']})
                try:
                    with opener.open(state, timeout=10):
                        pass
                except (OSError, ValueError):
                    pass  # Missing heartbeat still exposes a dead listener after its TTL.
                for message in messages:
                    print(message['body'], flush=True)
                return
        except urllib.error.HTTPError as exc:
            if exc.code in (400, 401, 403) or 300 <= exc.code < 400:
                raise SystemExit('Orch pairing rejected; repair the route before restarting this listener')
            failures += 1
        except (OSError, ValueError):
            failures += 1  # Board restart: no GitHub calls, no new writer.
        if failures == 1 or (failures and failures % 12 == 0):
            print('Orch inbox temporarily unavailable; retrying without acknowledging tasks', file=sys.stderr, flush=True)
        time.sleep(5)


if __name__ == '__main__':
    main()
