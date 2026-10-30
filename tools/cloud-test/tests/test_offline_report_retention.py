"""Actual offline-check entry point retains failed work without inventing proof."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import run_offline_checks as runner


class OfflineReportRetention(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "config" / "proofs").mkdir(parents=True)
        (self.root / "config" / "test-config.v1.json").write_text(json.dumps({
            "workflowVersion": "test", "harness": {"expectedCodeManifestSha256": "a" * 64}}))
        (self.root / "workflow.json").write_text('{"version":"test"}')
        self.out = self.root / "offline-checks.json"

    def invoke(self, failure=False, write_failure=False, history="required"):
        count = 0

        def child(cmd, **_kwargs):
            nonlocal count
            count += 1
            return subprocess.CompletedProcess(cmd, 7 if failure and count == 1 else 0,
                                               "retained stdout %s" % count,
                                               "retained stderr %s" % count)

        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(runner, "ROOT", str(self.root)), \
                mock.patch.dict(runner.os.environ, {"CT_HISTORY": history}), \
                mock.patch.object(sys, "argv", ["run_offline_checks.py", "--out", str(self.out)]), \
                mock.patch.object(runner.subprocess, "run", side_effect=child), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            with contextlib.ExitStack() as stack:
                if write_failure:
                    stack.enter_context(mock.patch.object(runner, "dump", side_effect=OSError("fixture report write denied")))
                try:
                    result = runner.main()
                except SystemExit as error:
                    result = error.code
        return result, stdout.getvalue(), stderr.getvalue()

    def test_missing_proof_writes_non_success_and_retains_prior_child_results(self):
        code, _, _ = self.invoke(failure=True)
        self.assertNotEqual(code, 0)
        report = json.loads(self.out.read_text())
        self.assertFalse(report["passed"])
        first = report["checks"][0]
        self.assertFalse(first["passed"])
        self.assertEqual(first["returncode"], 7)
        self.assertEqual(first["stdout"], "retained stdout 1")
        self.assertEqual(first["stderr"], "retained stderr 1")
        proof = next(c for c in report["checks"] if c["id"] == "offline-proof-index")
        self.assertFalse(proof["passed"])
        self.assertIn("FileNotFoundError", proof["detail"])
        self.assertEqual(len([c for c in report["checks"] if "returncode" in c]), 9)

    def test_malformed_proof_and_config_are_explicit_failures_in_written_report(self):
        (self.root / "config" / "proofs" / "offline-proof-582e5e30.json").write_text("not json")
        (self.root / "config" / "test-config.v1.json").write_text("[]")
        code, _, _ = self.invoke()
        self.assertNotEqual(code, 0)
        report = json.loads(self.out.read_text())
        self.assertFalse(report["passed"])
        by_id = {c["id"]: c for c in report["checks"]}
        self.assertFalse(by_id["config-matches-workflow"]["passed"])
        self.assertFalse(by_id["offline-proof-index"]["passed"])
        self.assertEqual(by_id["harness-verified"]["returncode"], 0)

    def test_report_write_failure_is_nonzero_and_emits_complete_fallback_diagnostics(self):
        code, stdout, stderr = self.invoke(write_failure=True)
        self.assertNotEqual(code, 0)
        self.assertFalse(self.out.exists())
        self.assertIn("OFFLINE_CHECKS_REPORT_WRITE_FAILED", stderr)
        self.assertIn("retained stdout 1", stdout)
        self.assertIn("retained stderr 9", stdout)
        self.assertIn('"passed": false', stdout)

    def test_valid_proof_can_pass_and_does_not_erase_nonzero_child(self):
        proof = {"result": "PASS", "corrections": [{"result": "PASS"}],
                 "codeManifestSha256": "a" * 64}
        (self.root / "config" / "proofs" / "offline-proof-582e5e30.json").write_text(json.dumps(proof))
        code, _, _ = self.invoke()
        self.assertEqual(code, 0)
        self.assertTrue(json.loads(self.out.read_text())["passed"])
        code, _, _ = self.invoke(failure=True)
        self.assertNotEqual(code, 0)
        self.assertFalse(json.loads(self.out.read_text())["passed"])

    def test_previous_historical_proof_cannot_substitute_for_selected_proof(self):
        proof = {"result": "PASS", "corrections": [{"result": "PASS"}],
                 "codeManifestSha256": "a" * 64}
        (self.root / "config" / "proofs" / "offline-proof-7dae348f.json").write_text(json.dumps(proof))
        code, _, _ = self.invoke()
        self.assertNotEqual(code, 0)
        report = json.loads(self.out.read_text())
        selected = next(c for c in report["checks"] if c["id"] == "offline-proof-index")
        self.assertFalse(selected["passed"])
        self.assertIn("offline-proof-582e5e30.json", selected["detail"])

    def test_no_history_marks_only_history_checks_not_applicable_and_never_passed(self):
        code, stdout, _ = self.invoke(history="none")
        self.assertEqual(code, 0)
        report = json.loads(self.out.read_text())
        self.assertTrue(report["passed"])
        self.assertEqual(report["historyMode"], "none")
        self.assertEqual(sorted(report["notApplicable"]), sorted(runner.HISTORY_BOUND))
        for check in report["checks"]:
            if check["id"] in runner.HISTORY_BOUND:
                self.assertIsNone(check["passed"])
                self.assertFalse(check["applicable"])
                self.assertIn("N/A  " + check["id"], stdout)
            else:
                self.assertIs(check["passed"], True)
        self.assertEqual(len([c for c in report["checks"] if "returncode" in c]), 6)

    def test_no_history_still_fails_on_any_applicable_failure(self):
        code, _, _ = self.invoke(failure=True, history="none")
        self.assertNotEqual(code, 0)
        self.assertFalse(json.loads(self.out.read_text())["passed"])

    def test_unknown_history_mode_is_refused_before_any_check(self):
        code, _, stderr = self.invoke(history="skip")
        self.assertEqual(code, 2)
        self.assertFalse(self.out.exists())
        self.assertIn("OFFLINE_CHECKS_REFUSED", stderr)
