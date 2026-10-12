"""Isolated worker/event sequence tests, never installed-host wake evidence."""
import json
import os
from pathlib import Path
import tempfile
import signal
import queue
import subprocess
import sys
import threading
import time
from http.server import ThreadingHTTPServer
import unittest
from unittest.mock import patch
import actor_channels as channels
import agent_transport
import server
from worker_runtime import Ledger, StdioClient, initialize, status

SESSION = '11111111-1111-4111-8111-111111111111'


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.previous = server.DB, channels.ROOT
        self.env = patch.dict(os.environ, {'RWT_AGENT_ROUTES_JSON': ''})
        self.env.start()
        server.DB = self.root / 'state.db'
        server.init_db()
        server.pair_actor_route({'actor_id': 'cli_dev', 'provider': 'local_inbox', 'session_id': SESSION})
        self.token = channels.read_config()['routes']['cli_dev']['inbox_token']
        self.worker = Ledger('cli_dev', SESSION, self.root)
        self.worker.register({'id': 'thr_actual_provider_identity', 'status': {'type': 'idle'}})

    def tearDown(self):
        server.DB, channels.ROOT = self.previous
        self.env.stop()
        self.tmp.cleanup()

    def callback(self, probe, stage):
        payload = {k: probe[k] for k in ('action_id', 'actor_id', 'session_id')}
        return server.record_agent_task_callback({**payload, 'stage': stage, 'evidence': 'isolated recipient fixture'},
            server._notification_callback_token(**payload))

    def test_separate_thread_identity_persisted_and_resumed_not_guessed(self):
        next_worker = Ledger('cli_dev', SESSION, self.root)
        self.assertEqual(next_worker.thread_id, 'thr_actual_provider_identity')
        self.assertNotEqual(next_worker.thread_id, next_worker.session)
        self.assertEqual(next_worker.worker_id, self.worker.worker_id)
        self.assertNotEqual(next_worker.generation, self.worker.generation)

    def test_wrong_resume_thread_rejected(self):
        with self.assertRaises(agent_transport.RouteError):
            self.worker.register({'id': 'other-thread'})

    def test_changed_session_or_checkout_cannot_adopt_worker(self):
        with self.assertRaises(agent_transport.RouteError):
            Ledger('cli_dev', '22222222-2222-4222-8222-222222222222', self.root)
        with self.assertRaises(agent_transport.RouteError):
            Ledger('cli_dev', SESSION, self.root / 'other')

    def test_unregistered_or_legacy_listener_cannot_consume_worker(self):
        with self.assertRaises(agent_transport.RouteError):
            server.actor_inbox('cli_dev', SESSION, self.token)
        with self.assertRaises(agent_transport.RouteError):
            server.actor_inbox('cli_dev', SESSION, 'invalid', worker=True)

    def test_worker_replay_after_read_does_not_create_receipt(self):
        probe = server.probe_actor_route('cli_dev')
        for _ in range(2):
            messages = server.actor_inbox('cli_dev', SESSION, self.token, worker=True)
            self.assertEqual(messages[0]['action_id'], probe['action_id'])
        self.assertFalse(server.transport_status()['agent_routes']['cli_dev']['live_delivery_proven'])
        self.assertEqual(server.worker_settled_actions('cli_dev', SESSION), [])

    def test_claim_is_atomic_and_duplicate_never_starts_another_turn(self):
        self.assertTrue(self.worker.claim('action-1'))
        self.assertFalse(self.worker.claim('action-1'))
        self.worker.state('action-1', 'completed')
        self.assertFalse(self.worker.claim('action-1'))
        self.assertTrue(self.worker.claim('action-2'))

    def test_crash_after_claim_blocks_restart_without_replay(self):
        self.worker.claim('action-1')
        restarted = Ledger('cli_dev', SESSION, self.root)
        restarted.register({'id': self.worker.thread_id})
        self.assertEqual(restarted.unresolved()[0]['state'], 'sending')
        self.assertFalse(restarted.claim('action-1'))
        self.assertFalse(restarted.claim('action-2'))

    def test_lost_send_response_and_timeout_stay_uncertain(self):
        self.worker.claim('action-1')
        self.worker.state('action-1', 'uncertain', error='response lost')
        self.assertFalse(self.worker.claim('action-2'))
        self.assertEqual(status('cli_dev', SESSION)['actions'][0]['state'], 'uncertain')

    def test_stale_generation_cannot_claim_or_change_action(self):
        self.worker.claim('action-1')
        replacement = Ledger('cli_dev', SESSION, self.root)
        replacement.register({'id': self.worker.thread_id})
        for operation in (lambda: self.worker.claim('action-2'), lambda: self.worker.state('action-1', 'completed'), lambda: self.worker.heartbeat()):
            with self.assertRaises(agent_transport.RouteError):
                operation()

    def test_terminal_turn_without_callback_blocks_later_tasks(self):
        self.worker.claim('action-1')
        self.worker.state('action-1', 'callback_missing', 'turn_actual')
        self.assertFalse(self.worker.claim('action-2'))
        self.assertEqual(self.worker.unresolved()[0]['turn_id'], 'turn_actual')

    def test_receipt_alone_does_not_settle_result_or_start_later_turn(self):
        probe = server.probe_actor_route('cli_dev')
        self.worker.claim(probe['action_id'])
        self.worker.state(probe['action_id'], 'sent', 'turn_actual')
        self.assertEqual(self.callback(probe, 'receipt')[0], 200)
        self.worker.settle(server.worker_settled_actions('cli_dev', SESSION))
        self.assertTrue(self.worker.unresolved())
        self.assertFalse(self.worker.claim('action-2'))
        self.assertEqual(self.callback(probe, 'result')[0], 200)
        self.worker.settle(server.worker_settled_actions('cli_dev', SESSION))
        self.assertFalse(self.worker.unresolved())
        self.assertTrue(self.worker.claim('action-2'))

    def test_approval_block_and_interruption_require_disposition(self):
        for state in ('blocked_approval', 'failed', 'interrupted'):
            self.worker.claim(state)
            self.worker.state(state, state)
            self.assertFalse(self.worker.claim('next-' + state))
            self.worker.settle([state])  # Fixture for an authenticated host terminal result.

    def test_worker_status_is_not_wake_proof(self):
        value = server.transport_status()['agent_routes']['cli_dev']
        self.assertTrue(value['worker']['recent'])
        self.assertFalse(value['live_delivery_proven'])

    def test_missing_routes_preserved_and_pairing_recovers_original_event(self):
        server.persist_event_notifications('PM DECISION — retain seven logs without recipient keywords', 'a' * 40)
        server.persist_event_notifications('PM DECISION — retain seven logs without recipient keywords', 'a' * 40)
        with server.con() as c:
            rows = [dict(r) for r in c.execute("SELECT * FROM agent_notifications WHERE task_id='event-observation'")]
        self.assertEqual(len(rows), 4)
        self.assertEqual({r['actor_id'] for r in rows}, set(channels.ACTORS))
        app = next(r for r in rows if r['actor_id'] == 'app_dev')
        self.assertEqual(app['status'], 'blocked_transport')
        server.pair_actor_route({'actor_id': 'app_dev', 'provider': 'local_inbox', 'session_id': '22222222-2222-4222-8222-222222222222'})
        server.dispatch_event_notifications()
        with server.con() as c:
            updated = dict(c.execute('SELECT * FROM agent_notifications WHERE action_id=?', (app['action_id'],)).fetchone())
        self.assertEqual(updated['status'], 'awaiting_receipt')
        self.assertEqual(updated['action_id'], app['action_id'])

    def test_uncertain_event_send_never_retried(self):
        with patch.object(agent_transport, 'queue_message', side_effect=agent_transport.QueueUncertain('lost')) as send:
            server.persist_event_notifications('CI finished', 'a' * 40)
            server.dispatch_event_notifications()
            self.assertEqual(send.call_count, 1)

    def test_event_only_notice_has_no_action_authority(self):
        server.persist_event_notifications('Code review started', 'a' * 40)
        message = server.actor_inbox('cli_dev', SESSION, self.token, worker=True)[0]['body']
        self.assertIn('EVENT OBSERVATION ONLY', message)
        self.assertIn('No repository, branch, PR lifecycle', message)

    def test_second_edited_summary_same_head_is_a_new_event_not_lost(self):
        server.persist_event_notifications('Security summary changed', 'a' * 40, event_key='summary-edit-1')
        server.persist_event_notifications('Security summary changed', 'a' * 40, event_key='summary-edit-2')
        server.persist_event_notifications('Security summary changed', 'a' * 40, event_key='summary-edit-2')
        with server.con() as c:
            self.assertEqual(c.execute("SELECT count(*) FROM agent_notifications WHERE task_id='event-observation'").fetchone()[0], 8)

    def test_ci_running_retry_attempt_review_and_merge_transitions(self):
        old = {'pr': 1586, 'state': 'OPEN', 'draft': True, 'head': 'a' * 40, 'runs': {}}
        new = dict(old, draft=False, check_fingerprint='review-start', runs={'1': {'id': 1, 'attempt': 2, 'status': 'in_progress', 'headSha': 'a' * 40}})
        events = server.github_watch_events(old, new, {'pm_github_ci': True, 'pm_github_review': True})
        self.assertTrue(any('CI progress' in e and 'attempt 2' in e for e in events))
        self.assertTrue(any('Code/Security check state' in e for e in events))
        self.assertTrue(any('Ready/Draft' in e for e in events))
        merged = dict(new, state='MERGED')
        self.assertTrue(any('MERGED' in e for e in server.github_watch_events(new, merged, {})))

    def test_waiting_pr_running_checks_are_not_silently_skipped(self):
        old = {'affected_reviews': {'1587': {'head': 'a' * 40, 'check_fingerprint': 'old', 'state': 'OPEN'}}}
        new = {'affected_reviews': {'1587': {'head': 'a' * 40, 'check_fingerprint': 'new', 'checks': [{'status': 'IN_PROGRESS'}], 'state': 'OPEN'}}}
        self.assertTrue(any('CI/check evidence changed' in e for e in server.github_watch_events(old, new, {'pm_github_ci': True})))

    def test_real_stdio_protocol_start_resume_and_notification_retention(self):
        binary = self.root / 'fake-codex'
        binary.write_text('''#!/usr/bin/env python3
import json,sys
for line in sys.stdin:
 m=json.loads(line)
 if 'id' not in m: continue
 method=m['method']
 if method=='initialize': result={}
 elif method in ('thread/start','thread/resume'): result={'thread':{'id':m['params'].get('threadId','thr_actual_provider_identity'),'status':{'type':'idle'}}}
 elif method=='turn/start':
  print(json.dumps({'method':'turn/completed','params':{'threadId':m['params']['threadId'],'turn':{'id':'turn_1','status':'completed'}}}),flush=True)
  result={'turn':{'id':'turn_1'}}
 else: result={}
 print(json.dumps({'id':m['id'],'result':result}),flush=True)
''')
        binary.chmod(0o700)
        for _ in range(2):
            client = StdioClient(str(binary), self.root)
            try:
                initialize(client, self.worker)
                answer = client.rpc('turn/start', {'threadId': self.worker.thread_id})
                self.assertEqual(answer['turn']['id'], 'turn_1')
                self.assertEqual(client.event()['method'], 'turn/completed')
            finally:
                client.close()

    def test_command_approval_requires_explicit_operator_and_matching_thread(self):
        client = object.__new__(StdioClient)
        client.events, client.saved = queue.Queue(), []
        client.approval_thread = 'thread-owned'
        client.approval_turn = 'turn-owned'
        sent = []
        client.send = sent.append
        request = {'id': 99, 'method': 'item/commandExecution/requestApproval', 'params': {'threadId': 'thread-owned', 'turnId': 'turn-owned'}}
        client.approval_handler = None
        client.events.put(request)
        with self.assertRaises(PermissionError): client.event()
        self.assertIn('error', sent[-1])
        client.approval_handler = lambda event: 'accept'
        client.events.put(request)
        self.assertEqual(client.event(), {})
        self.assertEqual(sent[-1], {'id': 99, 'result': {'decision': 'accept'}})
        client.events.put({**request, 'params': {'threadId': 'foreign'}})
        with self.assertRaises(PermissionError): client.event()
        self.assertIn('error', sent[-1])

    def test_denied_approval_is_not_replaced_by_accept(self):
        client = object.__new__(StdioClient)
        client.events, client.saved = queue.Queue(), []
        client.approval_thread = 'thread-owned'
        client.approval_turn = 'turn-owned'
        sent = []
        client.send = sent.append
        client.approval_handler = lambda event: 'decline'
        client.events.put({'id': 99, 'method': 'item/fileChange/requestApproval', 'params': {'threadId': 'thread-owned', 'turnId': 'turn-owned'}})
        with self.assertRaises(PermissionError): client.event()
        self.assertEqual(sent, [{'id': 99, 'result': {'decision': 'decline'}}])

    def test_worker_process_idle_delivery_receipt_result_restart_and_no_replay(self):
        # Actual HTTP board + worker subprocess + simulated app-server recipient.
        # This exercises adapters, not a real Codex/model wake on the user's Mac.
        http = ThreadingHTTPServer(('127.0.0.1', 0), server.H)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        old_port = server.PORT
        server.PORT = http.server_address[1]
        binary = self.root / 'recipient-codex'
        log = self.root / 'protocol.jsonl'
        binary.write_text('''#!/usr/bin/env python3
import json,re,sys,urllib.request
for line in sys.stdin:
 m=json.loads(line)
 if 'id' not in m: continue
 method=m['method']
 with open('protocol.jsonl','a') as out: out.write(json.dumps({'method':method})+'\\n')
 if method=='initialize': result={}
 elif method in ('thread/start','thread/resume','thread/read'): result={'thread':{'id':m['params'].get('threadId','thr_actual_provider_identity'),'status':{'type':'idle'}}}
 elif method=='turn/start':
  body=m['params']['input'][0]['text']
  action=body.split('\\n',1)[0][len('RWT-BOARD TASK '):]
  actor=re.search(r'^Actor: (.+)$',body,re.M)[1]
  session=re.search(r'^Paired session: (.+)$',body,re.M)[1]
  url=re.search(r'^Callback URL: (.+)$',body,re.M)[1]
  token=re.search(r'^Send the token as Authorization: Bearer (\\S+)\\.$',body,re.M)[1]
  print(json.dumps({'id':m['id'],'result':{'turn':{'id':'turn_'+action}}}),flush=True)
  for stage in ('receipt','result'):
   req=urllib.request.Request(url,data=json.dumps({'actor_id':actor,'session_id':session,'action_id':action,'stage':stage,'evidence':'isolated simulated recipient'}).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+token})
   with urllib.request.urlopen(req,timeout=5) as response: json.load(response)
  print(json.dumps({'method':'turn/completed','params':{'threadId':m['params']['threadId'],'turn':{'id':'turn_'+action,'status':'completed'}}}),flush=True)
  continue
 else: result={}
 print(json.dumps({'id':m['id'],'result':result}),flush=True)
''')
        binary.chmod(0o700)
        worker = None
        def start():
            return subprocess.Popen([sys.executable, str(Path(__file__).with_name('orch-worker.py')), '--actor', 'cli_dev',
                '--cwd', str(self.root), '--state-dir', str(channels.ROOT), '--port', str(server.PORT), '--codex', str(binary)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        def wait_for(predicate):
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                if predicate(): return
                time.sleep(.05)
            self.fail('isolated worker sequence timed out')
        def settled(action):
            with channels.db() as c:
                row = c.execute('SELECT state FROM worker_actions WHERE action_id=?', (action,)).fetchone()
            return bool(row and row['state'] == 'completed')
        try:
            worker = start()
            wait_for(lambda: (status('cli_dev', SESSION) or {}).get('pid') == worker.pid)
            probe = server.probe_actor_route('cli_dev')
            wait_for(lambda: settled(probe['action_id']))
            self.assertIn(probe['action_id'], server.worker_settled_actions('cli_dev', SESSION))
            self.assertEqual(len([q for q in server.list_queue() if q.get('delivery_key') == 'task-result:' + probe['action_id']]), 1)
            worker.send_signal(signal.SIGINT)
            worker.wait(timeout=6)
            worker = start()
            wait_for(lambda: (status('cli_dev', SESSION) or {}).get('pid') == worker.pid)
            second = server.probe_actor_route('cli_dev')
            wait_for(lambda: settled(second['action_id']))
            methods = [json.loads(line)['method'] for line in log.read_text().splitlines()]
            self.assertEqual(methods.count('turn/start'), 2)
            self.assertEqual(methods.count('thread/start'), 0)  # existing verified registration from fixture
            self.assertEqual(methods.count('thread/resume'), 2)
        finally:
            if worker and worker.poll() is None:
                worker.send_signal(signal.SIGINT)
                worker.wait(timeout=6)
            server.PORT = old_port
            http.shutdown()
            http.server_close()
            thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
