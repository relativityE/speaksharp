import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import actor_channels
import agent_transport

spec = importlib.util.spec_from_file_location('orch_callback', Path(__file__).with_name('orch-callback.py'))
callback = importlib.util.module_from_spec(spec)
spec.loader.exec_module(callback)


class CallbackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = actor_channels.ROOT
        actor_channels.ROOT = Path(self.tmp.name)
        actor_channels.pair('app_dev', 'local_inbox', '11111111-2222-4333-8444-555555555555')
        self.body = agent_transport.task_message(action_id='probe:123', actor_id='app_dev',
            task_id='probe', instruction='test', target_head='abc', target_tree='',
            callback_url='http://127.0.0.1:4317/api/agent-task', callback_token='private-test-token', session_id='11111111-2222-4333-8444-555555555555')
        self.store(self.body)

    def store(self, body):
        with actor_channels.db() as c:
            c.execute('INSERT OR REPLACE INTO messages VALUES(?,?,?,?,?,?,?)',
                ('probe:123', 'app_dev', '11111111-2222-4333-8444-555555555555', body, 'digest', 'pending', 0))

    def tearDown(self):
        actor_channels.ROOT = self.old
        self.tmp.cleanup()

    def test_exact_identity_payload_and_private_header(self):
        for stage in ('receipt', 'result'):
            req = callback.request_for('app_dev', '11111111-2222-4333-8444-555555555555', 'probe:123', stage, 'Observed wake')
            self.assertEqual(json.loads(req.data), dict(actor_id='app_dev', session_id='11111111-2222-4333-8444-555555555555', action_id='probe:123', stage=stage, evidence='Observed wake'))
            self.assertEqual(req.get_header('Authorization'), 'Bearer private-test-token')
            self.assertNotIn(b'private-test-token', req.data)

    def test_wrong_session_or_action_refused(self):
        for session, action in [('old-session', 'probe:123'), ('11111111-2222-4333-8444-555555555555', 'missing')]:
            with self.assertRaises(ValueError):
                callback.request_for('app_dev', session, action, 'receipt', 'Observed wake')

    def test_remote_or_wrong_endpoint_refused(self):
        for url in ['https://external.example/api/agent-task', 'http://127.0.0.1:4317/api/other', 'http://user@127.0.0.1:4317/api/agent-task']:
            self.store(self.body.replace('http://127.0.0.1:4317/api/agent-task', url))
            with self.assertRaises(ValueError):
                callback.request_for('app_dev', '11111111-2222-4333-8444-555555555555', 'probe:123', 'receipt', 'Observed wake')

    def test_empty_evidence_refused(self):
        with self.assertRaises(ValueError):
            callback.request_for('app_dev', '11111111-2222-4333-8444-555555555555', 'probe:123', 'receipt', ' ')
