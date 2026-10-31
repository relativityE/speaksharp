"""Actual offline-check entry point retains failed work without inventing proof. Every check is a current-run check; the proof must be generated
in this job (CT_PROOF_FILE) and a retained proof file is never substituted."""
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


JOB = {"GITHUB_SHA": "f" * 40, "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "control-plane"}


def full_proof(manifest, bound=True, **row_overrides):
    """A proof row per expected correction, every test and control passing, stamped with this fixture job's identity (as the generator does)."""
    rows = [dict({"id": i, "result": "PASS", "tests": [{"title": i, "result": "PASS"}], "mutationControls": [{"control": "M-" + i, "caught": True}]},
                 **row_overrides.get(i, {})) for i in runner.PROOF_CORRECTIONS]
    doc = {"result": "PASS", "corrections": rows, "codeManifestSha256": manifest}
    if bound:
        doc["generatedIn"] = {"sha": "f" * 40, "runId": "123", "runAttempt": "1", "job": "control-plane", "codeManifestSha256": manifest}
    return doc


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
        self.proof = self.root / "in-job-proof.json"

    def invoke(self, failure=False, write_failure=False, history="", proof=None, catalog=(True, "fixture catalog"), job=JOB):
        """proof: a document (dict) or raw text written as this job's proof, or None for no in-job proof."""
        count = 0

        def child(cmd, **_kwargs):
            nonlocal count
            count += 1
            return subprocess.CompletedProcess(cmd, 7 if failure and count == 1 else 0,
                                               "retained stdout %s" % count,
                                               "retained stderr %s" % count)

        if proof is not None:
            self.proof.write_text(proof if isinstance(proof, str) else json.dumps(proof))
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(runner, "ROOT", str(self.root)), \
                mock.patch.dict(runner.os.environ, dict({k: "" for k in JOB}, CT_HISTORY=history, CT_PROOF_FILE=str(self.proof) if proof is not None else "", **job)), \
                mock.patch.object(sys, "argv", ["run_offline_checks.py", "--out", str(self.out)]), \
                mock.patch.object(runner.subprocess, "run", side_effect=child), \
                mock.patch.object(runner, "catalog_matches_harness", return_value=catalog), \
                mock.patch.object(runner, "catalog_history_additive", return_value=(True, "fixture catalog history")), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            with contextlib.ExitStack() as stack:
                if write_failure:
                    stack.enter_context(mock.patch.object(runner, "dump", side_effect=OSError("fixture report write denied")))
                try:
                    result = runner.main()
                except SystemExit as error:
                    result = error.code
        return result, stdout.getvalue(), stderr.getvalue()

    def by_id(self):
        return {c["id"]: c for c in json.loads(self.out.read_text())["checks"]}

    def test_the_inventory_is_exactly_the_summarizers(self):
        self.assertEqual(set(runner.CHECKS), set(summarizer.CHECKS))
        self.invoke(proof=full_proof("a" * 64))
        self.assertEqual([c["id"] for c in json.loads(self.out.read_text())["checks"]], list(runner.CHECKS))

    def test_missing_proof_writes_non_success_and_retains_prior_child_results(self):
        code, _, _ = self.invoke(failure=True)
        self.assertNotEqual(code, 0)
        report = json.loads(self.out.read_text())
        self.assertFalse(report["passed"])
        self.assertIsNone(report["proofSource"])
        first = report["checks"][0]
        self.assertFalse(first["passed"])
        self.assertEqual(first["returncode"], 7)
        self.assertEqual(first["stdout"], "retained stdout 1")
        self.assertEqual(first["stderr"], "retained stderr 1")
        proof = self.by_id()["offline-proof-index"]
        self.assertFalse(proof["passed"])
        self.assertIn("CT_PROOF_FILE", proof["detail"])
        self.assertEqual(len([c for c in report["checks"] if "returncode" in c]), 4)

    def test_no_check_is_ever_not_applicable(self):
        self.invoke(proof=full_proof("a" * 64))
        report = json.loads(self.out.read_text())
        self.assertNotIn("notApplicable", report)
        self.assertTrue(all(isinstance(c["passed"], bool) and c.get("applicable", True) for c in report["checks"]))

    def test_the_retired_history_mode_is_refused_before_any_check(self):
        for history in ("none", "required", "skip"):
            code, _, stderr = self.invoke(history=history, proof=full_proof("a" * 64))
            self.assertEqual(code, 2, history)
            self.assertFalse(self.out.exists(), history)
            self.assertIn("OFFLINE_CHECKS_REFUSED", stderr, history)

    def test_malformed_proof_and_config_are_explicit_failures_in_written_report(self):
        (self.root / "config" / "test-config.v1.json").write_text("[]")
        code, _, _ = self.invoke(proof="not json")
        self.assertNotEqual(code, 0)
        report = json.loads(self.out.read_text())
        self.assertFalse(report["passed"])
        by_id = self.by_id()
        self.assertFalse(by_id["config-matches-workflow"]["passed"])
        self.assertFalse(by_id["offline-proof-index"]["passed"])
        self.assertEqual(by_id["harness-verified"]["returncode"], 0)

    def test_a_catalog_that_differs_from_the_harness_contract_fails(self):
        code, _, _ = self.invoke(proof=full_proof("a" * 64), catalog=(False, "the tracked catalog differs"))
        self.assertNotEqual(code, 0)
        self.assertFalse(self.by_id()["assertion-catalog-matches-harness"]["passed"])

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
            self.assertNotIn("CT_PROOF_FILE", text)
        report = json.loads(self.out.read_text())
        self.assertEqual(report["checks"][0]["stdout"], "retained stdout 1")

    def test_valid_proof_can_pass_and_does_not_erase_nonzero_child(self):
        code, _, _ = self.invoke(proof=full_proof("a" * 64))
        self.assertEqual(code, 0)
        report = json.loads(self.out.read_text())
        self.assertTrue(report["passed"])
        self.assertEqual(report["proofSource"], "in-job")
        code, _, _ = self.invoke(failure=True, proof=full_proof("a" * 64))
        self.assertNotEqual(code, 0)
        self.assertFalse(json.loads(self.out.read_text())["passed"])

    def test_a_retained_proof_file_is_never_substituted_for_an_in_job_proof(self):
        for name in ("offline-proof-aaaaaaaa.json", "offline-proof-7dae348f.json"):
            (self.root / "config" / "proofs" / name).write_text(json.dumps(full_proof("a" * 64)))
        code, _, _ = self.invoke()
        self.assertNotEqual(code, 0)
        self.assertFalse(self.by_id()["offline-proof-index"]["passed"])

    def test_the_public_summary_accepts_exactly_the_reports_this_runner_writes(self):
        for proof in (full_proof("a" * 64), None):
            self.invoke(proof=proof)
            out = summarizer.summarize(json.loads(self.out.read_text()))
            self.assertNotIn("error", out, proof is not None)
            self.assertTrue(out["resultValid"], proof is not None)
            # The stubbed children print no unittest counts, so the delivery is refused either way, and without a proof also for its source.
            self.assertFalse(out["delivered"])
            self.assertIn("COUNTS_MISSING:package-unit-tests", out["deliveryRefusals"])
            self.assertEqual("PROOF_NOT_FROM_THIS_JOB" in out["deliveryRefusals"], proof is None)

    def proof_check(self, doc):
        self.invoke(proof=doc)
        return self.by_id()["offline-proof-index"]

    def test_the_proof_must_bind_the_pinned_manifest_exactly(self):
        self.assertTrue(self.proof_check(full_proof("a" * 64))["passed"])
        # Same 8-hex prefix, different full manifest: never accepted.
        check = self.proof_check(full_proof("a" * 63 + "b"))
        self.assertFalse(check["passed"])
        self.assertIn("DIFFERS", check["detail"])

    def test_a_passing_proof_for_another_harness_is_never_accepted(self):
        check = self.proof_check(full_proof("582e5e30" + "0" * 56))
        self.assertFalse(check["passed"])
        self.assertIn("DIFFERS", check["detail"])

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
            self.assertFalse(self.proof_check(doc)["passed"], label)
        self.assertEqual(len(ids), 9)

    def test_a_malformed_pin_fails_before_any_path_is_built(self):
        (self.root / "config" / "test-config.v1.json").write_text(json.dumps({"workflowVersion": "test", "harness": {"expectedCodeManifestSha256": "../escape"}}))
        check = self.proof_check(full_proof("a" * 64))
        self.assertFalse(check["passed"])
        self.assertIn("not a sha256", check["detail"])

    def test_the_expected_corrections_equal_the_generators_list(self):
        import ast
        tree = ast.parse((Path(runner.__file__).parent / "offline_proof.py").read_text())
        corr = next(n.value for n in tree.body if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", None) == "CORR")
        self.assertEqual(tuple(ast.literal_eval(e.elts[0]) for e in corr.elts), runner.PROOF_CORRECTIONS)

    def test_an_in_job_proof_is_held_to_the_strict_rules(self):
        doc = full_proof("a" * 64)
        doc["corrections"].pop()
        check = self.proof_check(doc)
        self.assertIs(check["passed"], False)
        self.assertIn("correction ids differ", check["detail"])
        self.assertIs(json.loads(self.out.read_text())["passed"], False)

    def test_a_proof_not_bound_to_this_job_is_never_in_job(self):
        # Generator-to-consumer binding (Sam 1793405092): a valid proof without this job's stamp, from another run or attempt, or read outside a
        # GitHub job is refused, and the report never labels it in-job.
        other = full_proof("a" * 64); other["generatedIn"]["runId"] = "999"
        retry = full_proof("a" * 64); retry["generatedIn"]["runAttempt"] = "2"
        wrong = full_proof("a" * 64); wrong["generatedIn"]["codeManifestSha256"] = "b" * 64
        for label, doc, job in (("unstamped", full_proof("a" * 64, bound=False), JOB), ("another run", other, JOB), ("another attempt", retry, JOB),
                                ("another harness", wrong, JOB), ("outside a job", full_proof("a" * 64), {})):
            code, _, _ = self.invoke(proof=doc, job=job)
            self.assertNotEqual(code, 0, label)
            report = json.loads(self.out.read_text())
            self.assertFalse(self.by_id()["offline-proof-index"]["passed"], label)
            self.assertIsNone(report["proofSource"], label)

    def test_the_real_catalog_history_check_reads_no_campaign_index(self):
        # Not mocked. Even with an index file present it is never opened: the current check passes no index to the verifier.
        import builtins
        real_open = builtins.open
        opened = []
        def spy(path, *a, **k):
            opened.append(str(path))
            return real_open(path, *a, **k)
        with mock.patch.object(builtins, "open", side_effect=spy):
            passed, detail = runner.catalog_history_additive()
        self.assertTrue(passed, detail)
        self.assertFalse([p for p in opened if p.endswith("index.json") or "/receipts/" in p], opened)

    def test_the_real_catalog_check_matches_the_tracked_catalog(self):
        # Not mocked: the tracked catalog equals the one derived from the vendored harness contract alone.
        passed, detail = runner.catalog_matches_harness()
        self.assertTrue(passed, detail)
        self.assertIn("204 assertions", detail)


if __name__ == "__main__":
    unittest.main()
