import unittest
from pathlib import Path
from unittest.mock import Mock,patch
import subprocess
import server
import test_regressions as reg

class TransportPermissionsTests(unittest.TestCase):
    setUp=reg.RegressionTests.setUp
    tearDown=reg.RegressionTests.tearDown

    def test_launch_permission_names_operation_and_no_process(self):
        with patch.object(server,'CODEX_AUTH_OK',True), patch.object(server,'_codex_command',return_value=['/fixture/codex']), patch.object(server.subprocess,'Popen',side_effect=PermissionError(1,'Operation not permitted')):
            with self.assertRaisesRegex(RuntimeError,'launch permission denied.*no PM process started'):
                server._run_pm_codex('read-only',None)

    def test_denied_group_cleanup_does_not_mask_original_timeout_or_retry(self):
        proc=Mock(pid=123);proc.communicate.side_effect=[subprocess.TimeoutExpired('codex',180),('','')];proc.poll.return_value=0
        with patch.object(server,'CODEX_AUTH_OK',True), patch.object(server,'_codex_command',return_value=['/fixture/codex']), patch.object(server.subprocess,'Popen',return_value=proc), patch.object(server.os,'killpg',side_effect=PermissionError(1,'Operation not permitted')):
            with self.assertRaisesRegex(RuntimeError,'timed out.*process-group cleanup permission denied.*automatic retry stopped'):
                server._run_pm_codex('read-only',None)

    def test_denied_group_stop_targets_only_owned_parent(self):
        proc=Mock(pid=123);proc.poll.return_value=None
        with patch.object(server.os,'killpg',side_effect=PermissionError(1,'Operation not permitted')):
            with self.assertRaisesRegex(RuntimeError,'descendant cleanup unverified'):
                server._terminate_pm_process(proc,force=True)
        proc.kill.assert_called_once()
        proc.terminate.assert_not_called()
