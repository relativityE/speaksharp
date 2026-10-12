"""Real WebSocket frames on an isolated existing-server loopback socket; no live wake claim."""
import base64
import hashlib
import json
from pathlib import Path
import socket
import struct
import tempfile
import threading
import unittest
from unittest.mock import patch
import agent_transport as transport
SESSION = '11111111-1111-4111-8111-111111111111'

class FakeServer:
    def __init__(self, path, state='idle', loaded=True, lose_reply=False, reject=False):
        self.path, self.state, self.loaded = path, state, loaded
        self.lose_reply, self.reject = lose_reply, reject
        self.methods, self.params, self.errors = [], [], []
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.socket.bind(('127.0.0.1', 0)); self.socket.listen(1); self.socket.settimeout(3)
        self.endpoint = 'ws://127.0.0.1:' + str(self.socket.getsockname()[1])
        self.thread = threading.Thread(target=self.run, daemon=True); self.thread.start()
    @staticmethod
    def read(conn, n):
        data = b''
        while len(data) < n:
            chunk = conn.recv(n - len(data))
            if not chunk: raise EOFError()
            data += chunk
        return data
    def run(self):
        try:
            with self.socket.accept()[0] as conn:
                conn.settimeout(3); header = b''
                while not header.endswith(b'\r\n\r\n'): header += self.read(conn, 1)
                key = next(l.split(':', 1)[1].strip() for l in header.decode().split('\r\n') if l.startswith('Sec-WebSocket-Key:'))
                accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
                conn.sendall(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n').encode())
                while True:
                    a, b = self.read(conn, 2); size = b & 127
                    if size == 126: size = struct.unpack('!H', self.read(conn, 2))[0]
                    elif size == 127: size = struct.unpack('!Q', self.read(conn, 8))[0]
                    if not b & 128: raise AssertionError('client frame unmasked')
                    mask = self.read(conn, 4); data = self.read(conn, size)
                    request = json.loads(bytes(c ^ mask[i % 4] for i, c in enumerate(data)))
                    method, params = request['method'], request.get('params', {})
                    self.methods.append(method); self.params.append(params)
                    if method == 'initialized': continue
                    if method == 'initialize': result = {}
                    elif method == 'thread/loaded/list': result = {'data': [SESSION] if self.loaded else []}
                    elif method == 'thread/read': result = {'thread': {'id': SESSION, 'status': {'type': self.state}, 'turns': [{'id': 'existing-turn', 'status': 'inProgress'}] if self.state == 'active' else []}}
                    elif method == 'turn/start': result = {'turn': {'id': 'new-turn', 'status': 'inProgress'}}
                    elif method == 'turn/steer': result = {'turnId': 'existing-turn'}
                    else: raise AssertionError('unexpected ' + method)
                    if method.startswith('turn/') and self.lose_reply: return
                    response = {'id': request['id'], 'result': result}
                    if method.startswith('turn/') and self.reject: response = {'id': request['id'], 'error': {'code': -32600, 'message': 'secret prompt content'}}
                    payload = json.dumps(response).encode()
                    prefix = bytes([129, len(payload)]) if len(payload) < 126 else bytes([129, 126]) + struct.pack('!H', len(payload))
                    conn.sendall(prefix + payload)
        except EOFError: pass
        except Exception as exc: self.errors.append(exc)
        finally: self.socket.close()
    def finish(self):
        self.thread.join(4)
        if self.thread.is_alive(): raise AssertionError('server still running')
        if self.errors: raise self.errors[0]

class CodexTransportTests(unittest.TestCase):
    def send(self, **options):
        with tempfile.TemporaryDirectory() as root:
            server = FakeServer(str(Path(root) / 'codex.sock'), **options)
            route = transport.CodexRoute('cli_dev', SESSION, server.endpoint)
            try:
                with patch.object(transport.subprocess, 'run', side_effect=AssertionError('must not launch writer')):
                    result = transport.queue_message('codex', route, 'read task', timeout=2)
                return result, server
            finally: server.finish()
    def test_idle_existing_thread_starts_turn_without_resume_or_process(self):
        result, s = self.send()
        self.assertTrue(result['accepted']); self.assertEqual(result['session_id'], SESSION)
        self.assertEqual(s.methods, ['initialize', 'initialized', 'thread/loaded/list', 'thread/read', 'turn/start'])
        self.assertEqual(s.params[-1], {'threadId': SESSION, 'input': [{'type': 'text', 'text': 'read task'}]})
    def test_active_thread_uses_exact_turn_steer(self):
        result, s = self.send(state='active')
        self.assertEqual(result['turn_id'], 'existing-turn'); self.assertNotIn('turn/start', s.methods)
        self.assertEqual(s.params[-1]['expectedTurnId'], 'existing-turn')
    def test_unloaded_thread_never_resumed_as_second_writer(self):
        with self.assertRaisesRegex(transport.QueueRejected, 'not loaded'): self.send(loaded=False)
    def test_lost_mutation_reply_is_uncertain_without_retry(self):
        with self.assertRaises(transport.QueueUncertain): self.send(lose_reply=True)
    def test_explicit_rejection_sanitizes_remote_text(self):
        with self.assertRaisesRegex(transport.QueueRejected, 'code -32600') as caught: self.send(reject=True)
        self.assertNotIn('secret', str(caught.exception))
    def test_missing_socket_does_not_start_server(self):
        with self.assertRaises(transport.QueueRejected): transport.queue_message('codex', transport.CodexRoute('cli_dev', SESSION, 'unix:///not/an/orch/socket'), 'task')
    def test_route_validation(self):
        def env(entry, extra=None): return {'RWT_AGENT_ROUTES_JSON': json.dumps({'version': 1, 'routes': {'cli_dev': entry}}), **(extra or {})}
        entry = {'provider': 'codex_app_server', 'session_id': SESSION}
        with self.assertRaises(transport.RouteError): transport.configured_route('cli_dev', env({**entry, 'session_id': 'latest'}))
        with self.assertRaises(transport.RouteError): transport.configured_route('cli_dev', env({**entry, 'remote_url': 'ws://remote.example:4500'}))
        self.assertEqual(transport.configured_route('cli_dev', env({**entry, 'remote_url': 'ws://127.0.0.1:4500'})).session_id, SESSION)
        remote = {**entry, 'remote_url': 'wss://remote.example/ws', 'auth_token_env': 'RWT_TOKEN'}
        with self.assertRaises(transport.RouteError): transport.configured_route('cli_dev', env(remote))
        self.assertEqual(transport.configured_route('cli_dev', env(remote, {'RWT_TOKEN': 'secret'})).session_id, SESSION)
    def test_remote_callback_has_no_local_helper(self):
        message = transport.task_message(action_id='a1', actor_id='cli_dev', task_id='t1', instruction='review', target_head='a'*40, target_tree='', session_id=SESSION, callback_url='https://board.example/api/agent-task', callback_token='token')
        self.assertNotIn('Local recipient callback command', message); self.assertIn('stage=receipt', message)

if __name__ == '__main__': unittest.main()
