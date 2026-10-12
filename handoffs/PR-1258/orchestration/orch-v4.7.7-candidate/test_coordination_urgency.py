"""Regressions from the PO's real queue/wake/setup failures (no provider calls)."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
from unittest.mock import Mock, patch
import unittest
import server
import actor_channels
import coordination_health
import worker_supervisor
import package_integrity
import hashlib
from worker_runtime import Ledger
from test_comms import CommsTests


class CoordinationRecoveryTests(CommsTests):
    def test_error_queue_reports_exact_blocker_and_never_claims_it(self):
        q = self.q()
        server.set_agent('pm', status='error')
        row = next(r for r in server.list_queue() if r['id'] == q['id'])
        self.assertIn('state=error', row['dispatch_blocker'])
        self.assertIsNone(server.next_queue('pm'))
        self.assertEqual(server.get_agent('pm')['status'], 'error')

    def test_paused_and_delayed_queues_are_not_silent(self):
        q = self.q()
        server.set_agent('pm', status='idle', paused=1)
        self.assertIn('paused', server.queue_dispatch_blocker(q))
        server.set_agent('pm', paused=0)
        server.update_queue(q['id'], available_after=time.time() + 60)
        row = next(r for r in server.list_queue() if r['id'] == q['id'])
        self.assertIn('deferred', row['dispatch_blocker'])

    def test_cleanup_denial_survives_parent_exit_and_still_blocks_pm(self):
        proc = Mock(pid=64820)
        proc.poll.return_value = 0
        with patch.object(os, 'killpg', side_effect=PermissionError('denied')):
            with self.assertRaisesRegex(RuntimeError, 'cleanup permission denied'):
                server._terminate_pm_process(proc)
        self.assertEqual(json.loads(server.get_setting('pm_cleanup_unverified'))['pid'], 64820)
        server.set_agent('pm', status='idle')  # Old Resume UI must not bypass the durable hold.
        self.q()
        self.assertIsNone(server.next_queue('pm'))

    def test_cleanup_recovery_refuses_live_or_inaccessible_group(self):
        server.set_setting('pm_cleanup_unverified', json.dumps({'pid': 64820}))
        server.set_agent('pm', status='error')
        for side in (None, PermissionError('denied')):
            with patch.object(os, 'killpg', side_effect=side):
                with self.assertRaises(RuntimeError):
                    server.recover_pm_cleanup()
            self.assertTrue(server.get_setting('pm_cleanup_unverified'))
            self.assertEqual(server.get_agent('pm')['status'], 'error')

    def test_verified_cleanup_resumes_queued_work_without_replaying_failed_delivery(self):
        old = self.q()
        server.update_queue(old['id'], status='failed', error='cleanup denied')
        new = self.q()
        server.set_agent('pm', status='error')
        server.set_setting('pm_cleanup_unverified', json.dumps({'pid': 64820}))
        with patch.object(os, 'killpg', side_effect=ProcessLookupError):
            self.assertEqual(server.recover_pm_cleanup()['replayed_actions'], 0)
        self.assertEqual(server.next_queue('pm')['id'], new['id'])
        self.assertEqual(next(r for r in server.list_queue() if r['id'] == old['id'])['status'], 'failed')

    def test_no_generic_reset_without_cleanup_record(self):
        server.set_agent('pm', status='error')
        with self.assertRaisesRegex(RuntimeError, 'No recorded'):
            server.recover_pm_cleanup()

    def test_latest_page_priority_does_not_advance_backlog_cursor(self):
        key = 'github_comments:repo:1258'
        original = json.dumps({'next_page': 6, 'since': '2026-10-01T00:00:00Z'})
        server.set_setting(key, original)
        packet = {'id': 2433, 'body': 'App Dev COMPLETE PACKET', 'updated_at': '2026-10-11T23:09:50Z'}
        with patch.object(server, 'gh_json', side_effect=[({'comments': 2433}, None), ([], None), ([packet], None)]) as read:
            rows, error = server.fetch_latest_watch_comments('repo', 1258)
        self.assertIsNone(error)
        self.assertEqual(rows, [packet])
        self.assertIn('page=25', read.call_args_list[-1].args[0][-1])
        self.assertEqual(server.get_setting(key), original)
        self.assertEqual(read.call_count, 3)

    def test_recent_page_error_is_not_a_false_empty_queue(self):
        with patch.object(server, 'gh_json', side_effect=[({'comments': 2433}, None), (None, 'rate limited')]):
            rows, error = server.fetch_latest_watch_comments('repo', 1258)
        self.assertIsNone(rows)
        self.assertIn('rate limited', error)

    def test_ci_terminal_and_edited_review_queue_the_local_pm(self):
        prev = {'pr': 1591, 'head': 'same', 'check_fingerprint': 'running',
                'latest_control_comment_id': 20, 'control_updates': [{'id': 20, 'body': 'review pending', 'updated_at': 'old'}]}
        cur = dict(prev, check_fingerprint='complete', control_updates=[{'id': 20, 'body': 'review completed', 'updated_at': 'new'}])
        cfg = {'pm_github_ci': True, 'pm_github_review': True, 'pm_github_control': True}
        events = server.github_watch_events(prev, cur, cfg)
        self.assertTrue(any('check state changed' in e for e in events))
        self.assertTrue(any('review completed' in e for e in events))
        server.emit_github_event(events, cur, cfg)
        self.assertTrue(any(q['recipient'] == 'pm' and q['status'] == 'queued' for q in server.list_queue()))
        with server.con() as db:
            notices = [dict(r) for r in db.execute("SELECT * FROM agent_notifications WHERE task_id='event-observation'")]
        self.assertEqual({n['actor_id'] for n in notices}, set(actor_channels.ACTORS))
        self.assertTrue(all(not n['receipt_at'] and not n['result_at'] for n in notices))


class CoordinationHealthTests(unittest.TestCase):
    def valid(self):
        routes = {a: {'configured': True, 'transport': 'local_inbox', 'listener_recent': True, 'live_delivery_proven': True}
                  for a in coordination_health.ACTORS}
        return {'pm_configured': True, 'agent_routes': routes}, [{'agent_id': 'pm', 'status': 'idle'}], {
            k: True for k in ('pm_github_control', 'pm_github_review', 'pm_github_ci', 'pm_github_head', 'pm_github_deploy')}

    def test_pairing_without_current_listener_and_receipt_is_not_ready(self):
        t, a, cfg = self.valid()
        t['agent_routes']['cli_dev'].update(listener_recent=False, listener_state='waiting_for_rearm')
        h = coordination_health.summarize(t, a, cfg)
        self.assertFalse(h['core_ready'])
        self.assertIn('listener_waiting_for_rearm', [i['code'] for i in h['issues']])

    def test_browser_chat_support_is_separate_from_working_local_conduit(self):
        t, a, cfg = self.valid()
        t['agent_routes']['browser_pm'] = {'configured': False}
        h = coordination_health.summarize(t, a, cfg)
        self.assertTrue(h['core_ready'])
        self.assertFalse(h['all_routes_verified'])
        self.assertIn('does not wake', h['browser_pm_note'])

    def test_paused_pm_or_disabled_ci_never_claims_ready(self):
        t, a, cfg = self.valid()
        a[0]['paused'] = 1
        cfg['pm_github_ci'] = False
        h = coordination_health.summarize(t, a, cfg)
        self.assertFalse(h['core_ready'])
        self.assertEqual(h['owner'], 'cli_pm')

    def test_real_board_agent_mapping_is_supported(self):
        t, a, cfg = self.valid()
        self.assertEqual(coordination_health.summarize(t, {'pm': a[0]}, cfg), coordination_health.summarize(t, a, cfg))


class RegisteredWorkerTests(unittest.TestCase):
    def test_idle_registered_worker_requires_both_processes_absent(self):
        with tempfile.TemporaryDirectory() as cwd:
            w = {'actor': 'cli_dev', 'session': 'saved', 'thread_id': 'actual-thread', 'status': 'listening',
                 'pid': 42, 'runtime_pid': 43, 'cwd': cwd}
            route = {'provider': 'local_inbox', 'session_id': 'saved'}
            self.assertEqual(worker_supervisor.restart_reason(w, 0, route, lambda p: False), '')
            self.assertTrue(worker_supervisor.restart_reason(w, 1, route, lambda p: False))
            self.assertTrue(worker_supervisor.restart_reason(w, 0, route, lambda p: p == 43))
            for state in ('blocked_transport', 'awaiting_approval', 'working'):
                self.assertTrue(worker_supervisor.restart_reason(dict(w, status=state), 0, route, lambda p: False))

    def test_cannot_auto_create_a_second_pm_writer_or_replace_pairing(self):
        w = {'actor': 'cli_pm', 'session': 'saved'}
        self.assertIn('sole board executor', worker_supervisor.restart_reason(w, 0, {}))
        w['actor'] = 'cli_dev'
        self.assertIn('Pairing differs', worker_supervisor.restart_reason(w, 0, {'session_id': 'other'}))

    def test_setup_reuses_running_board_and_strips_api_key_overrides_from_login_check(self):
        path = Path(__file__).parent / 'orch-setup.py'
        spec = importlib.util.spec_from_file_location('orch_setup_test', path)
        setup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(setup)
        run = Mock(return_value=Mock(returncode=0))
        self.assertEqual(setup.prerequisites({'OPENAI_API_KEY': 'secret', 'CODEX_API_KEY': 'secret'}, lambda x: '/bin/' + x, run), [])
        self.assertTrue(all('OPENAI_API_KEY' not in c.kwargs['env'] and 'CODEX_API_KEY' not in c.kwargs['env'] for c in run.call_args_list))
        with patch.object(sys := __import__('sys'), 'argv', ['orch-setup.py', '--check']), \
             patch.object(setup, 'running_board', return_value={'transport': {'coordination': {'core_ready': False}}}), \
             patch.object(setup, 'prerequisites') as check, patch.object(setup.subprocess, 'call') as start:
            self.assertEqual(setup.main(), 0)
            check.assert_not_called()
            start.assert_not_called()


class AutomaticResumeTests(unittest.TestCase):
    setUp = CommsTests.setUp
    tearDown = CommsTests.tearDown

    def worker(self):
        root = actor_channels.ROOT.parent
        session = '11111111-1111-4111-8111-111111111111'
        server.pair_actor_route({'actor_id': 'cli_dev', 'provider': 'local_inbox', 'session_id': session})
        ledger = Ledger('cli_dev', session, root)
        ledger.register({'id': 'verified-existing-thread'}, runtime_pid=42)
        return ledger

    def test_resume_retains_identity_and_completed_ledger_then_does_not_spawn_twice(self):
        ledger = self.worker()
        ledger.claim('already-delivered')
        ledger.state('already-delivered', 'completed')
        spawn = Mock(return_value=Mock(pid=23456))
        results = worker_supervisor.resume_registered(Path(__file__).parent, 4317, '/fixture/codex', spawn=spawn, is_alive=lambda p: False)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['thread'], ledger.thread_id)
        command = spawn.call_args.args[0]
        self.assertNotIn('--new-identity', command)
        self.assertNotIn('--dangerously-bypass-approvals-and-sandbox', command)
        self.assertEqual(ledger.registration()['worker_id'], ledger.worker_id)
        self.assertEqual(ledger.registration()['status'], 'resuming')
        with actor_channels.db() as db:
            self.assertEqual(db.execute('SELECT state FROM worker_actions WHERE action_id=?', ('already-delivered',)).fetchone()[0], 'completed')
        self.assertEqual(worker_supervisor.resume_registered(Path(__file__).parent, 4317, '/fixture/codex', spawn=spawn, is_alive=lambda p: False), [])
        spawn.assert_called_once()
        self.assertFalse(server.transport_status()['agent_routes']['cli_dev']['live_delivery_proven'])

    def test_uncertain_send_and_live_runtime_prevent_automatic_restart(self):
        ledger = self.worker()
        spawn = Mock()
        self.assertEqual(worker_supervisor.resume_registered(Path(__file__).parent, 4317, '/fixture/codex', spawn=spawn, is_alive=lambda p: p == 42), [])
        ledger.claim('send-response-lost')
        ledger.state('send-response-lost', 'uncertain')
        self.assertEqual(worker_supervisor.resume_registered(Path(__file__).parent, 4317, '/fixture/codex', spawn=spawn, is_alive=lambda p: False), [])
        spawn.assert_not_called()


class PackageIntegrityTests(unittest.TestCase):
    def test_startup_checks_bytes_and_rejects_unlisted_code_or_redirected_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'launcher.py'
            source.write_text('print(1)\n')
            data = source.read_bytes()
            (root / 'PACKAGE-MANIFEST.json').write_text(json.dumps({'files': [{'path': source.name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]}))
            self.assertEqual(package_integrity.verify(root), [])
            source.write_text('print(2)\n')
            self.assertIn('mismatch', package_integrity.verify(root)[0])
            source.write_bytes(data)
            extra = root / 'unlisted.py'
            extra.write_text('print(3)\n')
            self.assertIn('unlisted executable', package_integrity.verify(root)[0])
            extra.unlink()
            source.unlink()
            source.symlink_to(root / 'PACKAGE-MANIFEST.json')
            self.assertIn('redirected', package_integrity.verify(root)[0])
