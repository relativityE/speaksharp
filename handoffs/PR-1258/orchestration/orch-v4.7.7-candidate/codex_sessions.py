"""Read-only Codex app-server session inventory. Never resumes or starts a turn."""
import json
import os
import selectors
import subprocess
import time
import agent_transport


def list_sessions(binary, *, timeout=15):
    env = dict(os.environ)
    for key in ('OPENAI_API_KEY', 'OPENAI_ADMIN_KEY', 'CODEX_API_KEY'):
        env.pop(key, None)
    try:
        child = subprocess.Popen([binary, 'app-server', '--listen', 'stdio://'], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
    except OSError as exc:
        raise agent_transport.RouteError('read-only Codex session discovery could not start') from exc
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    buffer = bytearray()
    deadline = time.monotonic() + timeout
    request_id = 0

    def send(value):
        child.stdin.write(json.dumps(value).encode() + b'\n')
        child.stdin.flush()

    def rpc(method, params):
        nonlocal request_id
        request_id += 1
        send({'id': request_id, 'method': method, 'params': params})
        while True:
            while b'\n' in buffer:
                line, _, rest = buffer.partition(b'\n')
                buffer[:] = rest
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if isinstance(event, dict) and event.get('id') == request_id:
                    if 'error' in event:
                        raise agent_transport.RouteError('Codex rejected read-only session inventory')
                    return event.get('result', {})
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not selector.select(remaining):
                raise agent_transport.RouteError('read-only Codex session discovery timed out')
            chunk = os.read(child.stdout.fileno(), 65536)
            if not chunk:
                raise agent_transport.RouteError('Codex session inventory ended without a result')
            buffer.extend(chunk)
            if len(buffer) > 1024 * 1024:
                raise agent_transport.RouteError('Codex session inventory exceeded the response bound')

    try:
        rpc('initialize', {'clientInfo': {'name': 'orch-recipient-pairing', 'version': '4.7.6'}})
        send({'method': 'initialized', 'params': {}})
        cursor, sessions, seen = None, [], set()
        for _ in range(8):
            params = {'limit': 25, 'archived': False}
            if cursor:
                params['cursor'] = cursor
            page = rpc('thread/list', params)
            if not isinstance(page, dict) or not isinstance(page.get('data'), list):
                raise agent_transport.RouteError('invalid Codex session inventory response')
            for entry in page['data']:
                if isinstance(entry, dict):
                    sessions.append({k: entry.get(k) for k in ('id', 'name', 'cwd', 'status')})
            cursor = page.get('nextCursor')
            if not cursor:
                return {'sessions': sessions, 'complete': True}
            if cursor in seen:
                raise agent_transport.RouteError('Codex session inventory cursor repeated')
            seen.add(cursor)
        return {'sessions': sessions, 'complete': False}
    except agent_transport.RouteError:
        raise
    except (OSError, ValueError, TypeError) as exc:
        raise agent_transport.RouteError('read-only Codex session discovery failed') from exc
    finally:
        selector.close()
        for stream in (child.stdin, child.stdout):
            if stream:
                stream.close()
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=1)
