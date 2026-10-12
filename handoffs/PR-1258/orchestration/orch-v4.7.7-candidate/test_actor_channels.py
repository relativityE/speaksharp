"""Isolated transport acceptance tests. These do not claim live Dev wake proof."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import actor_channels as channels
import agent_transport as transport
import codex_sessions
import server

SESSION = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'


class ActorChannelTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.old_db, self.old_root = server.DB, channels.ROOT
        self.env = patch.dict(os.environ, {'RWT_AGENT_ROUTES_JSON': ''})
        self.env.start()
        server.DB = self.root / 'state.db'
        server.init_db()

    def tearDown(self):
        server.DB, channels.ROOT = self.old_db, self.old_root
        self.env.stop()
        self.tmp.cleanup()

    def pair(self, actor='app_dev', provider='local_inbox', session=SESSION):
        return server.pair_actor_route({'actor_id': actor, 'provider': provider, 'session_id': session})

    def token(self, actor='app_dev'):
        return channels.read_config()['routes'][actor]['inbox_token']

    def callback(self, probe, stage, evidence):
        payload = {k: probe[k] for k in ('action_id', 'actor_id', 'session_id')}
        token = server._notification_callback_token(**payload)
        return server.record_agent_task_callback({**payload, 'stage': stage, 'evidence': evidence}, token)

    def test_pairing_survives_restart_and_is_private_without_env(self):
        self.pair()
        self.assertEqual((self.root / 'agent-routes.json').stat().st_mode & 0o777, 0o600)
        before = self.token()
        server.init_db()
        self.assertEqual(server.configured_actor_route('app_dev').provider, 'local_inbox')
        self.assertEqual(self.token(), before)
        self.assertFalse(self.pair()['changed'])

    def test_environment_route_precedence_cannot_be_silently_overwritten(self):
        with patch.dict(os.environ, {'RWT_AGENT_ROUTES_JSON': json.dumps({'version': 1, 'routes': {'cli_dev': {'provider': 'codex_app_server', 'session_id': OTHER}}})}):
            with self.assertRaisesRegex(transport.RouteError, 'environment routes'):
                self.pair()
            self.assertEqual(server.configured_actor_route('cli_dev').session_id, OTHER)

    def test_no_route_is_guessed(self):
        with self.assertRaises(transport.RouteError):
            server.configured_actor_route('cli_dev')
        with self.assertRaises(transport.RouteError):
            self.pair(session='latest')
        self.assertFalse((self.root / 'agent-routes.json').exists())

    def test_local_codex_endpoints_keep_local_callback_without_public_url(self):
        with patch.dict(os.environ, {'RWT_AGENT_CALLBACK_URL': ''}), patch.object(server, 'AGENT_CALLBACK_URL', ''):
            for endpoint in ('', 'unix:///tmp/existing-codex.sock', 'ws://127.0.0.1:4500'):
                self.assertEqual(server._task_callback_url(endpoint), f'http://127.0.0.1:{server.PORT}/api/agent-task')
            with self.assertRaises(transport.RouteError):
                server._task_callback_url('wss://remote.example/ws')

    def test_one_session_cannot_pair_two_actors(self):
        self.pair()
        with self.assertRaisesRegex(transport.RouteError, 'another actor'):
            self.pair('cli_dev', 'codex_app_server')

    def test_public_config_and_symlink_are_rejected(self):
        self.pair()
        path = self.root / 'agent-routes.json'
        path.chmod(0o644)
        with self.assertRaisesRegex(transport.RouteError, 'private regular'):
            channels.read_config()
        path.chmod(0o600)
        target = self.root / 'real-routes.json'
        path.rename(target)
        path.symlink_to(target)
        with self.assertRaises(transport.RouteError):
            channels.read_config()

    def test_unpaired_environment_inbox_is_not_reported_configured(self):
        raw = json.dumps({'version': 1, 'routes': {'app_dev': {'provider': 'local_inbox', 'session_id': SESSION}}})
        with patch.dict(os.environ, {'RWT_AGENT_ROUTES_JSON': raw}):
            self.assertFalse(server.transport_status()['agent_routes']['app_dev']['configured'])

    def test_probe_round_trip_restart_wrong_identity_and_duplicate(self):
        self.pair()
        with patch.object(transport.subprocess, 'run', side_effect=AssertionError('inbox must not launch Codex')):
            probe = server.probe_actor_route('app_dev')
        self.assertEqual(probe['status'], 'awaiting_receipt')
        server.init_db()
        messages = server.actor_inbox('app_dev', SESSION, self.token())
        self.assertEqual([m['action_id'] for m in messages], [probe['action_id']])
        self.assertIn('Paired session: ' + SESSION, messages[0]['body'])
        with self.assertRaises(transport.RouteError):
            server.actor_inbox('app_dev', OTHER, self.token())
        with self.assertRaises(transport.RouteError):
            server.actor_inbox('app_dev', SESSION, 'wrong')
        wrong = {'action_id': probe['action_id'], 'actor_id': 'cli_dev', 'session_id': SESSION, 'stage': 'receipt', 'evidence': 'seen'}
        self.assertEqual(server.record_agent_task_callback(wrong, server._notification_callback_token(probe['action_id'], 'app_dev', SESSION))[0], 403)
        self.assertEqual(self.callback(probe, 'result', 'wake=automatic')[0], 409)
        self.assertEqual(self.callback(probe, 'receipt', 'seen')[0], 200)
        self.assertTrue(self.callback(probe, 'receipt', 'seen')[1]['duplicate'])
        self.assertEqual(self.callback(probe, 'receipt', 'different')[0], 409)
        self.assertEqual(server.actor_inbox('app_dev', SESSION, self.token()), [])
        self.assertEqual(self.callback(probe, 'result', 'wake=automatic; isolated test listener')[0], 200)
        self.assertTrue(self.callback(probe, 'result', 'wake=automatic; isolated test listener')[1]['duplicate'])
        route = server.transport_status()['agent_routes']['app_dev']
        self.assertTrue(route['live_delivery_proven'])  # Only this isolated fixture DB; not a real Dev.
        self.assertEqual(server.list_player_status()['app_dev']['source'], 'authenticated_actor_callback')
        self.assertTrue(server.list_player_status()['app_dev']['checkpoint_at'])
        self.assertTrue(any(q['delivery_key'] == 'task-result:' + probe['action_id'] for q in server.list_queue()))

    def test_pairing_and_inbox_reads_never_claim_wake_proof(self):
        self.pair()
        probe = server.probe_actor_route('app_dev')
        server.actor_inbox('app_dev', SESSION, self.token())
        route = server.transport_status()['agent_routes']['app_dev']
        self.assertTrue(route['listener_recent'])
        self.assertFalse(route['live_delivery_proven'])

    def test_result_always_queues_pm_even_when_github_watch_is_disabled(self):
        self.pair()
        probe = server.probe_actor_route('app_dev')
        server.set_setting('auto_pm_github_control', '0')
        server.set_agent('pm', paused=1)
        self.assertEqual(self.callback(probe, 'receipt', 'seen')[0], 200)
        self.assertEqual(self.callback(probe, 'result', 'wake=automatic; review ready')[0], 200)
        server.init_db()
        self.assertEqual(self.callback(probe, 'result', 'wake=automatic; review ready')[0], 200)
        rows = [q for q in server.list_queue() if q['delivery_key'] == 'task-result:' + probe['action_id']]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['status'], 'queued')
        self.assertEqual(server.get_agent('pm')['paused'], 1)

    def test_result_and_pm_wake_roll_back_together_if_enqueue_fails(self):
        self.pair()
        probe = server.probe_actor_route('app_dev')
        self.assertEqual(self.callback(probe, 'receipt', 'seen')[0], 200)
        with patch.object(server, '_persist_actor_result_wake', side_effect=RuntimeError('simulated storage failure')):
            with self.assertRaises(RuntimeError):
                self.callback(probe, 'result', 'review ready')
        with server.con() as c:
            row = c.execute('SELECT status FROM agent_notifications WHERE action_id=?', (probe['action_id'],)).fetchone()
        self.assertEqual(row['status'], 'received')
        self.assertEqual(self.callback(probe, 'result', 'review ready')[0], 200)
        self.assertEqual(len([q for q in server.list_queue() if q['delivery_key'] == 'task-result:' + probe['action_id']]), 1)

    def test_rearm_without_receipt_does_not_repeat_probe_or_hide_new_work(self):
        self.pair()
        probe = server.probe_actor_route('app_dev')
        first = server.actor_inbox('app_dev', SESSION, self.token())
        self.assertEqual([m['action_id'] for m in first], [probe['action_id']])
        server.init_db()
        self.assertEqual(server.actor_inbox('app_dev', SESSION, self.token()), [])
        self.assertEqual(channels.pending('app_dev'), 1)
        route = server.transport_status()['agent_routes']['app_dev']
        self.assertFalse(route['live_delivery_proven'])
        self.assertEqual(route['last_delivery']['status'], 'awaiting_receipt')
        # No receipt is synthesized by presentation. The same callback settles it later.
        self.assertEqual(self.callback(probe, 'result', 'wake=automatic')[0], 409)
        self.assertEqual(self.callback(probe, 'receipt', 'actor acknowledges original action')[0], 200)
        self.assertEqual(channels.pending('app_dev'), 0)
        self.callback(probe, 'receipt', 'manual pickup')
        self.callback(probe, 'result', 'wake=manual; PO relayed it')
        self.assertFalse(server.transport_status()['agent_routes']['app_dev']['live_delivery_proven'])

    def test_real_review_handoff_uses_inbox_and_returns_result_to_pm_once(self):
        self.pair()
        _, _, index = server.record_review_handoffs({}, [{'pr_number': 1576, 'head': 'a' * 40,
            'reviewed_ref': 'fixture-review', 'disposition': 'fix_now', 'owner': 'app_dev',
            'instruction': 'Fix only the accepted ordering defect'}])
        hid = index[0]
        result = server.dispatch_review_handoff_notifications([hid])[0]
        self.assertEqual(result['status'], 'awaiting_receipt')
        messages = server.actor_inbox('app_dev', SESSION, self.token())
        self.assertEqual(len(messages), 1)
        self.assertIn('a' * 40, messages[0]['body'])
        identity = {'action_id': messages[0]['action_id'], 'actor_id': 'app_dev', 'session_id': SESSION}
        self.assertEqual(self.callback(identity, 'receipt', 'exact candidate picked up')[0], 200)
        self.assertEqual(server.list_review_handoffs()[0]['state'], 'acknowledged')
        self.assertEqual(self.callback(identity, 'result', 'fix published for source review')[0], 200)
        self.assertEqual(server.list_review_handoffs()[0]['state'], 'result_returned')
        server.dispatch_review_handoff_notifications([hid])
        self.assertEqual(server.actor_inbox('app_dev', SESSION, self.token()), [])
        self.assertEqual(channels.pending('app_dev'), 0)
        self.assertFalse(server.transport_status()['agent_routes']['app_dev']['live_delivery_proven'])

    def test_fifteen_minute_board_fallback_is_durable_once_and_never_replays(self):
        self.pair('cli_dev', 'codex_app_server')
        with patch.object(transport, 'queue_message', side_effect=transport.QueueRejected('route unavailable')) as send:
            probe = server.probe_actor_route('cli_dev')
            with server.con() as c:
                created = c.execute('SELECT created_at FROM agent_notifications WHERE action_id=?', (probe['action_id'],)).fetchone()[0]
            at = server.datetime.fromisoformat(created).timestamp()
            server.sweep_agent_delivery_stalls(at=at + 899)
            self.assertFalse(any(q['delivery_key'].startswith('notification-board-fallback:') for q in server.list_queue()))
            server.sweep_agent_delivery_stalls(at=at + 901)
            server.init_db()
            server.sweep_agent_delivery_stalls(at=at + 1801)
            self.assertEqual(send.call_count, 1)
        reminders = [q for q in server.list_queue() if q['delivery_key'] == 'notification-board-fallback:' + probe['action_id']]
        self.assertEqual(len(reminders), 1)
        self.assertIn('CLI DEV — ACTION REQUIRED', reminders[0]['content'])
        self.assertIn(probe['action_id'], reminders[0]['content'])
        self.assertIn('issue #1258', reminders[0]['content'])

    def test_received_notification_has_no_fallback(self):
        self.pair()
        probe = server.probe_actor_route('app_dev')
        self.callback(probe, 'receipt', 'seen')
        server.sweep_agent_delivery_stalls(at=time.time() + 1800)
        self.assertFalse(any(q['delivery_key'].startswith('notification-board-fallback:') for q in server.list_queue()))

    def test_listener_exit_stale_and_rearm_health_are_explicit(self):
        self.pair()
        server.actor_inbox('app_dev', SESSION, self.token())
        self.assertTrue(channels.listener_status('app_dev', SESSION)['listener_recent'])
        with self.assertRaises(transport.RouteError):
            channels.set_listener_state('app_dev', OTHER, self.token(), 'waiting_for_rearm')
        channels.set_listener_state('app_dev', SESSION, self.token(), 'waiting_for_rearm')
        health = channels.listener_status('app_dev', SESSION)
        self.assertFalse(health['listener_recent'])
        self.assertEqual(health['listener_state'], 'waiting_for_rearm')
        server.sweep_agent_delivery_stalls(at=health['listener_last_seen'] + 61)
        server.sweep_agent_delivery_stalls(at=health['listener_last_seen'] + 121)
        self.assertEqual(len([q for q in server.list_queue() if q['delivery_key'].startswith('listener-rearm:')]), 1)
        server.actor_inbox('app_dev', SESSION, self.token())
        self.assertTrue(channels.listener_status('app_dev', SESSION)['listener_recent'])

    def test_outstanding_probe_cannot_be_duplicated_or_redirected(self):
        self.pair()
        server.probe_actor_route('app_dev')
        with self.assertRaisesRegex(transport.RouteError, 'outstanding'):
            server.probe_actor_route('app_dev')
        with self.assertRaisesRegex(transport.RouteError, 'frozen route'):
            self.pair(session=OTHER)

    def test_immutable_inbox_action_conflict_and_repeated_enqueue(self):
        self.pair()
        route = server.configured_actor_route('app_dev')
        first = channels.enqueue(route, 'RWT-BOARD TASK test-action\nimmutable')
        self.assertEqual(channels.enqueue(route, 'RWT-BOARD TASK test-action\nimmutable'), first)
        with self.assertRaises(transport.QueueRejected):
            channels.enqueue(route, 'RWT-BOARD TASK test-action\nchanged')
        self.assertEqual(channels.pending('app_dev'), 1)

    def test_restart_dispatch_uncertainty_never_resends_and_late_receipt_recovers(self):
        self.pair('cli_dev', 'codex_app_server')
        with patch.object(transport, 'queue_message', side_effect=transport.QueueUncertain('timeout')) as queue:
            probe = server.probe_actor_route('cli_dev')
            server.init_db()
            server.sweep_agent_delivery_stalls()
            self.assertEqual(queue.call_count, 1)
        self.assertEqual(probe['status'], 'transport_uncertain')
        self.assertEqual(self.callback(probe, 'receipt', 'exact late receipt')[0], 200)
        self.assertEqual(self.callback(probe, 'result', 'wake=automatic; late delivery')[0], 200)

    def test_warning_and_single_pm_escalation_do_not_redeliver(self):
        self.pair()
        probe = server.probe_actor_route('app_dev')
        with server.con() as c:
            stamp = c.execute('SELECT accepted_at FROM agent_notifications WHERE action_id=?', (probe['action_id'],)).fetchone()[0]
        at = server.datetime.fromisoformat(stamp).timestamp()
        server.sweep_agent_delivery_stalls(at=at + 61)
        server.sweep_agent_delivery_stalls(at=at + 301)
        server.sweep_agent_delivery_stalls(at=at + 601)
        key = 'notification-receipt-recovery:' + probe['action_id']
        self.assertEqual(len([q for q in server.list_queue() if q['delivery_key'] == key]), 1)
        self.assertEqual(channels.pending('app_dev'), 1)
        self.assertEqual(self.callback(probe, 'receipt', 'late pickup')[0], 200)

    def test_real_loopback_background_listener_exits_with_exact_prompt(self):
        self.pair()
        http = ThreadingHTTPServer(('127.0.0.1', 0), server.H)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        listener = subprocess.Popen([sys.executable, str(Path(server.__file__).parent / 'watch-orch-inbox.py'), '--actor', 'app_dev', '--port', str(http.server_port), '--state-dir', str(self.root)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            # Queue before its first read; the helper must wake from local HTTP only.
            probe = server.probe_actor_route('app_dev')
            out, err = listener.communicate(timeout=7)
            self.assertEqual(listener.returncode, 0, err)
            self.assertIn(probe['action_id'], out)
            self.assertIn('stage=receipt', out)
            self.assertEqual(channels.listener_status('app_dev', SESSION)['listener_state'], 'waiting_for_rearm')
            self.assertFalse(server.transport_status()['agent_routes']['app_dev']['live_delivery_proven'])
            # Control mutations remain protected even though inbox GET uses its own token.
            req = urllib.request.Request(f'http://127.0.0.1:{http.server_port}/api/agent-pair', data=b'{}', headers={'Content-Type': 'application/json'})
            with self.assertRaises(urllib.error.HTTPError) as exc:
                urllib.request.urlopen(req)
            self.assertEqual(exc.exception.code, 403)
        finally:
            if listener.poll() is None:
                listener.kill()
                listener.communicate()
            http.shutdown()
            http.server_close()
            thread.join(timeout=2)

    def test_read_only_session_inventory_uses_no_turn_or_resume(self):
        tool = self.root / 'fake-codex'
        log = self.root / 'requests.jsonl'
        tool.write_text('#!/usr/bin/env python3\nimport sys,json\n'
            'for line in sys.stdin:\n'
            ' q=json.loads(line)\n'
            f' with open({str(log)!r},"a") as f: f.write(line)\n'
            ' if q["method"]=="initialized": continue\n'
            f' result={{"data":[{{"id":{SESSION!r},"name":"verified-dev","cwd":"/repo"}}],"nextCursor":None}} if q["method"]=="thread/list" else {{}}\n'
            ' print(json.dumps({"id":q["id"],"result":result}),flush=True)\n')
        tool.chmod(0o700)
        result = codex_sessions.list_sessions(str(tool))
        self.assertEqual(result['sessions'][0]['id'], SESSION)
        self.assertEqual([json.loads(line)['method'] for line in log.read_text().splitlines()], ['initialize', 'initialized', 'thread/list'])

    def test_session_inventory_timeout_is_bounded(self):
        tool = self.root / 'slow-codex'
        tool.write_text('#!/usr/bin/env python3\nimport time\ntime.sleep(30)\n')
        tool.chmod(0o700)
        before = time.monotonic()
        with self.assertRaisesRegex(transport.RouteError, 'timed out'):
            codex_sessions.list_sessions(str(tool), timeout=0.05)
        self.assertLess(time.monotonic() - before, 2)


if __name__ == '__main__':
    unittest.main()
