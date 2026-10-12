"""Regression replay for the installed frozen-route re-pairing failure."""
import json
import os
import tempfile
import unittest
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
import actor_channels
import agent_transport
import route_recovery
import server

OLD = '01a0f83f-a51b-76e3-ae4f-e45aec3c6980'
NEW = '8f936233-7e87-4ffe-b78b-852df532ec64'
EVIDENCE = 'https://github.com/relativityE/speaksharp/issues/1258#issuecomment-6113695724'


class RouteRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.previous = server.DB, actor_channels.ROOT
        server.DB = Path(self.tmp.name) / 'state.db'
        self.env = patch.dict(os.environ, {'RWT_AGENT_ROUTES_JSON': ''})
        self.env.start()
        server.init_db()
        server.pair_actor_route({'actor_id': 'cli_dev', 'provider': 'codex_app_server', 'session_id': OLD})
        with server.con() as c:
            c.execute("INSERT INTO queue(id,activity_id,recipient,content,created_at,status,attempts,target_actor_id,target_transport,target_session_id,task_action_id) VALUES(880,0,'dev','obsolete #1560',?,'queued',0,'cli_dev','codex_app_server',?,'task-old')", (server.now(), OLD))
            for i in range(7):
                c.execute("INSERT INTO agent_notifications(notification_key,handoff_id,actor_id,task_id,action_id,target_transport,target_session_id,head,instruction,status,attempts,error,created_at,updated_at) VALUES(?,0,'cli_dev',?,?,'codex_app_server',?,'','observation','blocked_transport',1,?,?,?)", ('n'+str(i), 'wake-probe' if i < 2 else 'event-observation', 'old-'+str(i), OLD, 'Existing Codex route unavailable: invalid Codex frame length', server.now(), server.now()))
        self.base = {'actor_id': 'cli_dev', 'session_id': OLD}

    def tearDown(self):
        server.DB, actor_channels.ROOT = self.previous
        self.env.stop()
        self.tmp.cleanup()

    def call(self, body):
        with server.DB_LOCK, server.con() as c:
            c.execute('BEGIN IMMEDIATE')
            return route_recovery.reconcile(c, actor_channels.read_config()['routes'], {**self.base, **body})

    def plan(self):
        p = self.call({'mode': 'preview'})
        return {'mode': 'retire', 'snapshot_sha256': p['snapshot_sha256'], 'retire_queue_ids': [880],
            'retire_notification_ids': ['old-'+str(i) for i in range(7)],
            'checkpoint': 'CLI Dev clean checkout, source writer frozen, no validation or listener running.', 'evidence': EVIDENCE}

    def test_real_sequence_retirement_preserves_history_then_normal_pairing(self):
        with self.assertRaisesRegex(agent_transport.RouteError, 'frozen route'):
            server.pair_actor_route({'actor_id': 'cli_dev', 'provider': 'local_inbox', 'session_id': NEW})
        result = self.call(self.plan())
        self.assertEqual(result['retired_queue_ids'], [880])
        self.assertEqual(len(result['retired_notifications']), 7)
        self.assertFalse(result['delivery_proven'])
        with server.con() as c:
            self.assertEqual(c.execute("SELECT count(*) FROM agent_notifications WHERE status='cancelled' AND receipt_at IS NULL AND result_at IS NULL AND error LIKE '%invalid Codex frame length%' ").fetchone()[0], 7)
            audit = json.loads(c.execute('SELECT evidence_json FROM route_retirements').fetchone()[0])
            self.assertEqual(audit['before']['queue'][0]['status'], 'queued')
        self.assertTrue(server.pair_actor_route({'actor_id': 'cli_dev', 'provider': 'local_inbox', 'session_id': NEW})['changed'])

    def test_preview_does_not_mutate_or_expose_tokens(self):
        p = self.call({'mode': 'preview'})
        self.assertFalse(p['changed'])
        self.assertNotIn('inbox_token', json.dumps(p))
        with server.con() as c:
            self.assertEqual(c.execute("SELECT status FROM queue WHERE id=880").fetchone()[0], 'queued')

    def test_state_change_between_preview_and_apply_is_rejected_atomically(self):
        plan = self.plan()
        with server.con() as c:
            c.execute("UPDATE agent_notifications SET error='different failure' WHERE action_id='old-6'")
        with self.assertRaisesRegex(agent_transport.RouteError, 'changed since preview'):
            self.call(plan)
        with server.con() as c:
            self.assertEqual(c.execute("SELECT status FROM queue WHERE id=880").fetchone()[0], 'queued')

    def test_started_queue_cannot_be_retired(self):
        with server.con() as c:
            c.execute('UPDATE queue SET attempts=1 WHERE id=880')
        with self.assertRaisesRegex(agent_transport.RouteError, 'may have started'):
            self.call(self.plan())

    def test_accepted_notice_blocks_every_retirement(self):
        with server.con() as c:
            c.execute("UPDATE agent_notifications SET accepted_at=? WHERE action_id='old-6'", (server.now(),))
        with self.assertRaisesRegex(agent_transport.RouteError, 'accepted delivery'):
            self.call(self.plan())
        with server.con() as c:
            self.assertEqual(c.execute("SELECT status FROM queue WHERE id=880").fetchone()[0], 'queued')

    def test_mixed_route_cannot_be_retired(self):
        with server.con() as c:
            c.execute("UPDATE agent_notifications SET target_session_id=? WHERE action_id='old-6'", (NEW,))
        with self.assertRaisesRegex(agent_transport.RouteError, 'different route'):
            self.plan()

    def test_explicit_queue_id_required(self):
        p = self.plan(); p['retire_queue_ids'] = []
        with self.assertRaisesRegex(agent_transport.RouteError, 'explicit obsolete queue IDs'):
            self.call(p)

    def test_checkpoint_and_evidence_required(self):
        for key in ('checkpoint', 'evidence'):
            p = self.plan(); p[key] = ''
            with self.assertRaisesRegex(agent_transport.RouteError, 'checkpoint and source evidence'):
                self.call(p)

    def test_new_or_unlisted_notification_cannot_be_retired(self):
        p = self.plan(); p['retire_notification_ids'] = p['retire_notification_ids'][:-1]
        with self.assertRaisesRegex(agent_transport.RouteError, 'explicit notification IDs'):
            self.call(p)

    def test_retired_notice_cannot_later_claim_receipt(self):
        self.call(self.plan())
        payload = {'actor_id': 'cli_dev', 'session_id': OLD, 'action_id': 'old-0', 'stage': 'receipt', 'evidence': 'late callback'}
        token = server._notification_callback_token('old-0', 'cli_dev', OLD)
        self.assertEqual(server.record_agent_task_callback(payload, token)[0], 409)

    def test_second_retirement_is_noop_and_creates_no_duplicate_audit(self):
        self.call(self.plan())
        p = self.plan(); p['retire_queue_ids'] = []; p['retire_notification_ids'] = []
        self.assertFalse(self.call(p)['changed'])
        with server.con() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM route_retirements').fetchone()[0], 1)

    def test_other_actor_or_wrong_route_refused(self):
        for payload in ({'actor_id': 'app_dev'}, {'session_id': NEW}):
            with self.assertRaises(agent_transport.RouteError):
                self.call({'mode': 'preview', **payload})

    def test_cli_actual_http_retirement_and_control_auth_guard(self):
        http = ThreadingHTTPServer(('127.0.0.1', 0), server.H)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        try:
            port = http.server_address[1]
            request = urllib.request.Request(f'http://127.0.0.1:{port}/api/agent-route-retire',
                data=b'{}', headers={'Content-Type': 'application/json'}, method='POST')
            with self.assertRaises(urllib.error.HTTPError) as exc:
                urllib.request.urlopen(request)
            self.assertEqual(exc.exception.code, 403)
            run = subprocess.run([sys.executable, str(server.APP / 'orch-reconcile-route.py'),
                '--session', OLD, '--port', str(port), '--apply', '--retire-queue', '880',
                '--checkpoint', 'CLI Dev writer frozen; checkout clean; no validation or listener running.',
                '--evidence', EVIDENCE, '--pair-worker', NEW,
                *sum((['--retire-notification', 'old-'+str(i)] for i in range(7)), [])], text=True, capture_output=True, timeout=15)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertIn('"delivery_proven": false', run.stdout)
            self.assertNotIn(server.CONTROL_TOKEN, run.stdout)
            self.assertIn('Pairing saved:', run.stdout)
            self.assertEqual(actor_channels.read_config()['routes']['cli_dev']['session_id'], NEW)
            with server.con() as c:
                self.assertEqual(c.execute("SELECT status FROM queue WHERE id=880").fetchone()[0], 'cancelled')
        finally:
            http.shutdown()
            http.server_close()
            thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
