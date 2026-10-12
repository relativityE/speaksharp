"""PM cleanup regressions: real inherited pipes, operator stop, and retry receipts."""
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from unittest.mock import patch, Mock

import server
from test_comms import CommsTests


class PMCleanupTests(CommsTests):
    def test_old_publication_never_hides_failed_or_queued_retry(self):
        q = self.q()
        with server.con() as c:
            c.execute('INSERT INTO pm_outbox VALUES(?,?,?,?)', (q['id'], 'published', 123, 'prior reply'))
        for status in ('failed', 'queued', 'delivering', 'responded'):
            with self.subTest(status=status):
                server.update_queue(q['id'], status=status)
                row = next(r for r in server.list_queue() if r['id'] == q['id'])
                self.assertEqual(row['github_comment_id'], 123)
                self.assertEqual(row['delivery_label'], 'PUBLISHED — recipient action unverified' if status == 'responded' else status)

    def test_stop_during_transport_error_stays_idle_and_preserves_reset(self):
        q = self.q()
        server.PM_MODE = 'codex'
        generation = server.PM_CANCEL_GENERATION
        def stopped(*args):
            server.PM_CANCEL_GENERATION += 1
            server.set_agent('pm', session_id=None, status='idle')
            raise RuntimeError('process exited on SIGTERM')
        try:
            server.set_agent('pm', session_id='old-session')
            with patch.object(server, '_run_pm_codex', side_effect=stopped):
                server.run_pm(q)
            row = next(r for r in server.list_queue() if r['id'] == q['id'])
            self.assertEqual(row['status'], 'failed')
            self.assertEqual(row['error'], 'PM turn cancelled by operator')
            self.assertEqual(server.get_agent('pm')['status'], 'idle')
            self.assertIsNone(server.get_agent('pm')['session_id'])
        finally:
            server.PM_CANCEL_GENERATION = generation

    def test_output_drain_is_bounded_even_for_escaped_child(self):
        proc = Mock()
        proc.communicate.side_effect = subprocess.TimeoutExpired('fixture', 3)
        self.assertEqual(server._drain_pm_output(proc), ('', ''))
        proc.communicate.assert_called_once_with(timeout=3)
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            stream.close.assert_called_once()

    def launch_fixture(self):
        script = Path(self.tmp.name) / 'pm_fixture.py'
        script.write_text('import subprocess,sys,time\n'
                          'sys.stdin.read()\n'
                          'subprocess.Popen([sys.executable,"-c","import time; time.sleep(10)"])\n'
                          'print("ready",flush=True)\n'
                          'time.sleep(10)\n')
        return [sys.executable, str(script)]

    def test_real_codex_timeout_kills_children_holding_output_pipes(self):
        command = self.launch_fixture()
        started = time.monotonic()
        with patch.object(server, 'PM_ROUTE_SCHEMA', Path(__file__).parent / 'pm-route.schema.json'), \
             patch.object(server, 'APP', Path(self.tmp.name)), \
             patch.object(server, 'BASE_REPO', self.tmp.name), \
             patch.object(server, 'CODEX_AUTH_OK', True), \
             patch.object(server, 'PM_TIMEOUT', .5), \
             patch.object(server, '_codex_command', return_value=command):
            with self.assertRaises(server.PMTransportTimeout):
                server._run_pm_codex('fixture', None)
        self.assertLess(time.monotonic() - started, 4)
        self.assertIsNone(server.ACTIVE_PM_PROC)

    def test_real_operator_stop_kills_group_and_unblocks_worker(self):
        command = self.launch_fixture()
        proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, start_new_session=True)
        proc.stdin.close()
        proc.stdin = None
        self.assertEqual(proc.stdout.readline().strip(), 'ready')
        server.ACTIVE_PM_PROC = proc
        generation = server.PM_CANCEL_GENERATION
        started = time.monotonic()
        try:
            self.assertTrue(server.kill_agent('pm'))
            proc.communicate(timeout=2)
            self.assertLess(time.monotonic() - started, 4)
        finally:
            server.ACTIVE_PM_PROC = None
            server.PM_CANCEL_GENERATION = generation
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
