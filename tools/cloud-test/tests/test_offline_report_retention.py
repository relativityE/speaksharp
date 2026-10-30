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
import summarize_offline_checks as summarizer


def full_proof(manifest, **row_overrides):
    """A proof row per expected correction, every test and control passing."""
    rows = [dict({"id": i, "result": "PASS", "tests": [{"title": i, "result": "PASS"}], "mutationControls": [{"control": "M-" + i, "caught": True}]},
                 **row_overrides.get(i, {})) for i in runner.PROOF_CORRECTIONS]
    return {"result": "PASS", "corrections": rows, "codeManifestSha256": manifest}


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

    def invoke(self, failure=False, write_failure=False, history="required", proof_file=None):
        count = 0

        def child(cmd, **_kwargs):
            nonlocal count
            count += 1
            return subprocess.CompletedProcess(cmd, 7 if failure and count == 1 else 0,
                                               "retained stdout %s" % count,
                                               "retained stderr %s" % count)

        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(runner, "ROOT", str(self.root)), \
                mock.patch.dict(runner.os.environ, {"CT_HISTORY": history, "CT_PROOF_FILE": proof_file or ""}), \
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
        (self.root / "config" / "proofs" / "offline-proof-aaaaaaaa.json").write_text("not json")
        (self.root / "config" / "test-config.v1.json").write_text("[]")
        code, _, _ = self.invoke()
        self.assertNotEqual(code, 0)
        report = json.loads(self.out.read_text())
        self.assertFalse(report["passed"])
        by_id = {c["id"]: c for c in report["checks"]}
        self.assertFalse(by_id["config-matches-workflow"]["passed"])
        self.assertFalse(by_id["offline-proof-index"]["passed"])
        self.assertEqual(by_id["harness-verified"]["returncode"], 0)

    def test_report_write_failure_is_nonzero_and_prints_no_child_diagnostics(self):
        code, stdout, stderr = self.invoke(write_failure=True)
        self.assertNotEqual(code, 0)
        self.assertFalse(self.out.exists())
        self.assertIn("OFFLINE_CHECKS_REPORT_WRITE_FAILED: OSError", stderr)
        self.assertNotIn("fixture report write denied", stderr)
        for text in (stdout, stderr):
            self.assertNotIn("retained stdout", text)
            self.assertNotIn("retained stderr", text)
            self.assertNotIn("{", text)
        self.assertIn("PASS package-unit-tests", stdout)

    def test_the_log_carries_names_and_statuses_only(self):
        code, stdout, stderr = self.invoke(failure=True)
        self.assertNotEqual(code, 0)
        self.assertIn("FAIL package-unit-tests", stdout.splitlines())
        for text in (stdout, stderr):
            self.assertNotIn("retained", text)
            self.assertNotIn("FileNotFoundError", text)
        report = json.loads(self.out.read_text())
        self.assertEqual(report["checks"][0]["stdout"], "retained stdout 1")

    def test_valid_proof_can_pass_and_does_not_erase_nonzero_child(self):
        (self.root / "config" / "proofs" / "offline-proof-aaaaaaaa.json").write_text(json.dumps(full_proof("a" * 64)))
        code, _, _ = self.invoke()
        self.assertEqual(code, 0)
        self.assertTrue(json.loads(self.out.read_text())["passed"])
        code, _, _ = self.invoke(failure=True)
        self.assertNotEqual(code, 0)
        self.assertFalse(json.loads(self.out.read_text())["passed"])

    def test_previous_historical_proof_cannot_substitute_for_selected_proof(self):
        (self.root / "config" / "proofs" / "offline-proof-7dae348f.json").write_text(json.dumps(full_proof("a" * 64)))
        code, _, _ = self.invoke()
        self.assertNotEqual(code, 0)
        report = json.loads(self.out.read_text())
        selected = next(c for c in report["checks"] if c["id"] == "offline-proof-index")
        self.assertFalse(selected["passed"])
        self.assertIn("offline-proof-aaaaaaaa.json", selected["detail"])

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
        self.assertEqual(len([c for c in report["checks"] if "returncode" in c]), 5)

    def test_no_history_still_fails_on_any_applicable_failure(self):
        code, _, _ = self.invoke(failure=True, history="none")
        self.assertNotEqual(code, 0)
        self.assertFalse(json.loads(self.out.read_text())["passed"])

    def test_unknown_history_mode_is_refused_before_any_check(self):
        code, _, stderr = self.invoke(history="skip")
        self.assertEqual(code, 2)
        self.assertFalse(self.out.exists())
        self.assertIn("OFFLINE_CHECKS_REFUSED", stderr)

    def test_the_public_summary_accepts_exactly_the_reports_this_runner_writes(self):
        self.assertEqual(set(runner.HISTORY_BOUND), set(summarizer.HISTORY_BOUND))
        for history, overall in (("none", True), ("required", False)):  # required: no proof file in this fixture root
            self.invoke(history=history)
            out = summarizer.summarize(json.loads(self.out.read_text()), history)
            self.assertNotIn("error", out, history)
            self.assertTrue(out["resultValid"], history)
            self.assertIs(out["overallPassed"], overall, history)

    def proof_check(self):
        self.invoke()
        return next(c for c in json.loads(self.out.read_text())["checks"] if c["id"] == "offline-proof-index")

    def write_proof(self, name, doc):
        (self.root / "config" / "proofs" / name).write_text(json.dumps(doc))

    def test_the_proof_is_selected_by_the_pinned_manifest_and_must_bind_it_exactly(self):
        self.write_proof("offline-proof-aaaaaaaa.json", full_proof("a" * 64))
        self.assertTrue(self.proof_check()["passed"])
        # Same 8-hex prefix, different full manifest: never accepted.
        self.write_proof("offline-proof-aaaaaaaa.json", full_proof("a" * 63 + "b"))
        check = self.proof_check()
        self.assertFalse(check["passed"])
        self.assertIn("DIFFERS", check["detail"])

    def test_a_passing_proof_for_another_harness_is_never_substituted(self):
        self.write_proof("offline-proof-582e5e30.json", full_proof("582e5e30" + "0" * 56))
        check = self.proof_check()
        self.assertFalse(check["passed"])
        self.assertIn("offline-proof-aaaaaaaa.json", check["detail"])

    def test_every_expected_correction_exactly_once_or_the_proof_fails(self):
        ids = list(runner.PROOF_CORRECTIONS)
        cases = {
            "missing one": lambda d: d["corrections"].pop(),
            "duplicate id": lambda d: d["corrections"].append(dict(d["corrections"][0])),
            "unknown id": lambda d: d["corrections"].append({"id": "invented", "result": "PASS", "tests": [{"result": "PASS"}], "mutationControls": []}),
            "anonymous row": lambda d: d["corrections"].__setitem__(0, {"result": "PASS"}),
            "the reviewed one-row counterexample": lambda d: d.__setitem__("corrections", [{"result": "PASS"}]),
            "empty": lambda d: d.__setitem__("corrections", []),
            "not a list": lambda d: d.__setitem__("corrections", {"diagnostic-codes": "PASS"}),
            "a failing row": lambda d: d["corrections"][1].__setitem__("result", "FAIL"),
            "a row with no tests": lambda d: d["corrections"][2].__setitem__("tests", []),
            "a failing test": lambda d: d["corrections"][3]["tests"].append({"result": "FAIL"}),
            "an uncaught mutation": lambda d: d["corrections"][4]["mutationControls"].append({"caught": False}),
            "result FAIL": lambda d: d.__setitem__("result", "FAIL"),
        }
        for label, mutate in cases.items():
            doc = full_proof("a" * 64)
            mutate(doc)
            self.write_proof("offline-proof-aaaaaaaa.json", doc)
            self.assertFalse(self.proof_check()["passed"], label)
        self.assertEqual(len(ids), 9)

    def test_a_malformed_pin_fails_before_any_path_is_built(self):
        (self.root / "config" / "test-config.v1.json").write_text(json.dumps({"workflowVersion": "test", "harness": {"expectedCodeManifestSha256": "../escape"}}))
        check = self.proof_check()
        self.assertFalse(check["passed"])
        self.assertIn("not a sha256", check["detail"])

    def test_the_expected_corrections_equal_the_generators_list(self):
        import ast
        tree = ast.parse((Path(runner.__file__).parent / "offline_proof.py").read_text())
        corr = next(n.value for n in tree.body if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", None) == "CORR")
        self.assertEqual(tuple(ast.literal_eval(e.elts[0]) for e in corr.elts), runner.PROOF_CORRECTIONS)

    def test_an_in_job_proof_makes_the_proof_check_applicable_without_history(self):
        good = self.root / "in-job-proof.json"
        good.write_text(json.dumps(full_proof("a" * 64)))
        self.invoke(history="none", proof_file=str(good))
        report = json.loads(self.out.read_text())
        self.assertEqual(report["proofSource"], "in-job")
        proof = next(c for c in report["checks"] if c["id"] == "offline-proof-index")
        self.assertIs(proof["passed"], True)
        self.assertNotIn("offline-proof-index", report["notApplicable"])
        self.assertEqual(len(report["notApplicable"]), 4)
        out = summarizer.summarize(report, "none")
        self.assertNotIn("error", out)
        self.assertIs(out["overallPassed"], True)

    def test_an_in_job_proof_is_held_to_the_same_strict_rules(self):
        bad = self.root / "in-job-proof.json"
        doc = full_proof("a" * 64)
        doc["corrections"].pop()
        bad.write_text(json.dumps(doc))
        self.invoke(history="none", proof_file=str(bad))
        report = json.loads(self.out.read_text())
        proof = next(c for c in report["checks"] if c["id"] == "offline-proof-index")
        self.assertIs(proof["passed"], False)
        self.assertIn("correction ids differ", proof["detail"])
        self.assertIs(report["passed"], False)
