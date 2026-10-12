"""Bounded JSON-RPC over the EXISTING Codex control socket/WebSocket.

No process launch, resume, fork, policy override, redirect, proxy or automatic retry.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import ssl
import struct
import time
from urllib.parse import urlparse


class RPCError(RuntimeError):
    pass


class Client:
    LIMIT = 8 * 1024 * 1024

    def __init__(self, endpoint='', *, token='', timeout=15, env=None):
        env = os.environ if env is None else env
        self.deadline = time.monotonic() + timeout
        self.sock = None
        self.buffer = bytearray()
        self.serial = 0
        self.mutation_sent = False
        parsed = urlparse(endpoint or 'unix://')
        try:
            if parsed.scheme == 'unix':
                if parsed.netloc or parsed.query or parsed.fragment or token:
                    raise RPCError('invalid local Codex control socket endpoint')
                root = Path(env.get('CODEX_HOME') or Path.home() / '.codex')
                path = parsed.path or str(root / 'app-server-control/app-server-control.sock')
                self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                self._timeout()
                self.sock.connect(path)
                host, target = 'localhost', '/'
            elif parsed.scheme in ('ws', 'wss'):
                if (not parsed.hostname or parsed.username or parsed.password or parsed.fragment
                        or parsed.query or '\r' in token or '\n' in token):
                    raise RPCError('invalid Codex WebSocket endpoint')
                if parsed.scheme == 'ws' and parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
                    raise RPCError('plain Codex WebSocket must be loopback')
                if parsed.scheme == 'wss' and not token:
                    raise RPCError('remote Codex WebSocket requires authentication')
                port = parsed.port or (443 if parsed.scheme == 'wss' else 80)
                self.sock = socket.create_connection((parsed.hostname, port), self._remaining())
                if parsed.scheme == 'wss':
                    self.sock = ssl.create_default_context().wrap_socket(self.sock, server_hostname=parsed.hostname)
                host, target = parsed.netloc, parsed.path or '/'
            else:
                raise RPCError('unsupported Codex control transport')
            key = base64.b64encode(os.urandom(16)).decode()
            headers = [f'GET {target} HTTP/1.1', f'Host: {host}', 'Upgrade: websocket',
                       'Connection: Upgrade', 'Sec-WebSocket-Version: 13', f'Sec-WebSocket-Key: {key}']
            if token:
                headers.append('Authorization: Bearer ' + token)
            self._timeout()
            self.sock.sendall(('\r\n'.join(headers) + '\r\n\r\n').encode())
            while b'\r\n\r\n' not in self.buffer:
                self._receive()
                if len(self.buffer) > 16384:
                    raise RPCError('Codex WebSocket upgrade exceeded bound')
            raw, _, rest = self.buffer.partition(b'\r\n\r\n')
            self.buffer[:] = rest
            lines = raw.decode('ascii').split('\r\n')
            values = {key.lower(): value for key, value in (line.split(':', 1) for line in lines[1:] if ':' in line)}
            accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            if (len(lines[0].split()) < 2 or lines[0].split()[1] != '101'
                    or values.get('sec-websocket-accept', '').strip() != accept
                    or values.get('upgrade', '').strip() != 'websocket'
                    or 'upgrade' not in values.get('connection', '').lower()):
                raise RPCError('Codex WebSocket upgrade refused')
        except Exception:
            self.close()
            raise

    def _remaining(self):
        value = self.deadline - time.monotonic()
        if value <= 0:
            raise TimeoutError('Codex control deadline expired')
        return value

    def _timeout(self):
        self.sock.settimeout(self._remaining())

    def _receive(self):
        self._timeout()
        chunk = self.sock.recv(65536)
        if not chunk:
            raise RPCError('Codex control connection closed')
        self.buffer.extend(chunk)
        if len(self.buffer) > self.LIMIT + 65536:
            raise RPCError('Codex control frame exceeded bound')

    def _read(self, size):
        while len(self.buffer) < size:
            self._receive()
        value = bytes(self.buffer[:size])
        del self.buffer[:size]
        return value

    def _send_frame(self, opcode, data):
        if len(data) > self.LIMIT:
            raise RPCError('Codex request exceeded bound')
        mask = os.urandom(4)
        length = len(data)
        prefix = bytes([0x80 | opcode, 0x80 | (length if length < 126 else 126 if length <= 65535 else 127)])
        if length >= 126:
            prefix += struct.pack('!H' if length <= 65535 else '!Q', length)
        self._timeout()
        self.sock.sendall(prefix + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def send(self, value):
        self._send_frame(1, json.dumps(value, separators=(',', ':')).encode())

    def _event(self):
        message = bytearray()
        started = False
        while True:
            a, b = self._read(2)
            opcode, final = a & 15, bool(a & 128)
            if a & 112 or b & 128:
                raise RPCError('invalid Codex WebSocket frame')
            size = b & 127
            if size == 126:
                size = struct.unpack('!H', self._read(2))[0]
            elif size == 127:
                size = struct.unpack('!Q', self._read(8))[0]
            if size > self.LIMIT or (opcode >= 8 and (not final or size > 125)):
                raise RPCError('invalid Codex frame length')
            data = self._read(size)
            if opcode == 8:
                raise RPCError('Codex control connection closed')
            if opcode == 9:
                self._send_frame(10, data)
                continue
            if opcode == 10:
                continue
            if (opcode == 1 and not started) or (opcode == 0 and started):
                started = True
                message.extend(data)
            else:
                raise RPCError('unexpected Codex WebSocket opcode')
            if len(message) > self.LIMIT:
                raise RPCError('Codex message exceeded bound')
            if final:
                value = json.loads(message.decode())
                if not isinstance(value, dict):
                    raise RPCError('invalid Codex JSON-RPC response')
                return value

    def rpc(self, method, params):
        self.serial += 1
        if method in ('turn/start', 'turn/steer'):
            # Any connection failure from this point is uncertain, including a partial send.
            self.mutation_sent = True
        self.send({'id': self.serial, 'method': method, 'params': params})
        while True:
            event = self._event()
            if event.get('id') == self.serial:
                if 'error' in event:
                    self.mutation_sent = False  # Definitive JSON-RPC rejection, not a lost reply.
                    # Do not expose remote error text (may contain message/token content).
                    raise RPCError('Codex rejected ' + method + ' (code ' + str(event['error'].get('code')) + ')')
                if not isinstance(event.get('result'), dict):
                    raise RPCError('Codex returned an invalid ' + method + ' response')
                return event['result']
            if 'id' in event and 'method' in event:
                # This client cannot approve tool/permission requests on another UI's behalf.
                self.send({'id': event['id'], 'error': {'code': -32601, 'message': 'Use the owning session UI for approvals'}})

    def close(self):
        if self.sock:
            self.sock.close()
            self.sock = None


def deliver(route, message, *, timeout=15, env=None):
    """Send one input to an already-loaded paired thread; never resume/create a writer."""
    env = os.environ if env is None else env
    client = None
    try:
        client = Client(route.remote_url, token=env.get(route.auth_token_env, '') if route.auth_token_env else '',
                        timeout=timeout, env=env)
        client.rpc('initialize', {'clientInfo': {'name': 'orch-actor-delivery', 'version': '4.7.6'}})
        client.send({'method': 'initialized', 'params': {}})
        cursor, seen, loaded = None, set(), False
        for _ in range(8):
            page = client.rpc('thread/loaded/list', {'cursor': cursor, 'limit': 100})
            if not isinstance(page.get('data'), list):
                raise RPCError('Codex loaded-thread inventory unavailable')
            if route.session_id in page['data']:
                loaded = True
                break
            cursor = page.get('nextCursor')
            if not cursor:
                break
            if cursor in seen:
                raise RPCError('Codex loaded-thread cursor repeated')
            seen.add(cursor)
        if not loaded:
            raise RPCError('Paired session is not loaded in the existing Codex server; no writer was started')
        thread = client.rpc('thread/read', {'threadId': route.session_id, 'includeTurns': True}).get('thread')
        if not isinstance(thread, dict) or thread.get('id') != route.session_id:
            raise RPCError('Codex thread readback does not match pairing')
        status = thread.get('status') or {}
        state = status.get('type') if isinstance(status, dict) else None
        params = {'threadId': route.session_id, 'input': [{'type': 'text', 'text': message}]}
        if state == 'idle':
            result = client.rpc('turn/start', params)
            turn = result.get('turn') or {}
            turn_id = turn.get('id')
            if not turn_id or turn.get('status') not in ('inProgress', 'completed'):
                raise RPCError('Codex did not confirm the requested turn')
        elif state == 'active':
            active = [t for t in thread.get('turns', []) if t.get('status') == 'inProgress']
            if len(active) != 1 or not active[0].get('id') or status.get('activeFlags'):
                raise RPCError('Active paired turn cannot be safely steered; wait for its owner')
            params['expectedTurnId'] = active[0]['id']
            result = client.rpc('turn/steer', params)
            turn_id = result.get('turnId')
            if turn_id != params['expectedTurnId']:
                raise RPCError('Codex steering response does not match the active turn')
        else:
            raise RPCError('Paired Codex session state is not deliverable')
        return {'transport': 'codex_app_server', 'accepted': True, 'session_id': route.session_id,
                'detail': 'Existing paired thread accepted input; recipient receipt pending', 'turn_id': turn_id}
    except Exception as exc:
        import agent_transport
        if client and client.mutation_sent:
            raise agent_transport.QueueUncertain('Codex input outcome is uncertain; reconcile the original action, do not resend') from exc
        detail = str(exc) if isinstance(exc, RPCError) else type(exc).__name__
        raise agent_transport.QueueRejected('Existing Codex route unavailable: ' + detail) from exc
    finally:
        if client:
            client.close()
