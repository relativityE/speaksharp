"""Actual offline-check entry point retains failed work without inventing proof. Every check is a current-run check; the proof is the one the workflow
supplies through CT_PROOF_FILE (its freshness is the workflow boundary's) and a retained proof file is never substituted."""
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
        self.proof = self.root / "supplied-proof.json"

    def invoke(self, failure=False, write_failure=False, history="", proof=None, catalog=(True, "fixture catalog")):
        """proof: a document (dict) or raw text supplied as CT_PROOF_FILE, or None for no supplied proof."""
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
                mock.patch.dict(runner.os.environ, {"CT_HISTORY": history, "CT_PROOF_FILE": str(self.proof) if proof is not None else ""}), \
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
        self.assertEqual(report["proofSource"], "ct-proof-file")
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
            self.assertEqual("PROOF_NOT_SUPPLIED" in out["deliveryRefusals"], proof is None)

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


PROBE = '''import unittest
class Plain(unittest.TestCase):
    def test_pass(self): pass
    def test_subtests(self):
        for i in range(3):
            with self.subTest(i=i):
                self.assertNotEqual(i, 1)
    def test_skipped_subtest(self):
        with self.subTest(k="x"):
            self.skipTest("probe skip")
    @unittest.expectedFailure
    def test_expected(self): self.fail("expected")
class Fixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls): raise RuntimeError("class setup")
    def test_never_run(self): pass
class Teardown(unittest.TestCase):
    def tearDown(self): raise RuntimeError("teardown")
    def test_fails_then_teardown_errors(self): self.fail("first")
'''


class StructuredSuiteResults(unittest.TestCase):
    """The suite child (Sam 1793406369 point 3): unittest's own output and exit code, plus one structured record per test id from the callbacks."""

    def run_child(self, source):
        d = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, d, True)
        Path(d, "test_probe.py").write_text(source)
        results = Path(d, "results.json")
        child = subprocess.run([sys.executable, "-I", runner.__file__, "--suite-child", d, "--results", str(results)], capture_output=True, text=True)
        plain = subprocess.run([sys.executable, "-I", "-m", "unittest", "discover", "-s", d, "-p", "test_*.py"], capture_output=True, text=True)
        return child, plain, json.loads(results.read_text()) if results.exists() else None

    def test_the_child_prints_unittests_own_result_and_exit_code(self):
        child, plain, _ = self.run_child(PROBE)
        self.assertEqual(child.returncode, plain.returncode)
        self.assertEqual(summarizer._suite({"stderr": child.stderr}), summarizer._suite({"stderr": plain.stderr}))
        self.assertTrue(summarizer._suite({"stderr": child.stderr}))
        child, plain, _ = self.run_child("import unittest\n")
        self.assertEqual((child.returncode, plain.returncode), (5, 5), "NO TESTS RAN keeps its exit code")

    def test_records_come_from_callbacks_and_fixtures_credit_nothing(self):
        child, _, res = self.run_child(PROBE)
        tests = {t["id"]: t for t in res["tests"]}
        self.assertEqual(sorted(tests), ["test_probe.Plain.test_expected", "test_probe.Plain.test_pass", "test_probe.Plain.test_skipped_subtest",
                                         "test_probe.Plain.test_subtests", "test_probe.Teardown.test_fails_then_teardown_errors"],
                         "the class whose setup failed contributes no method")
        self.assertEqual(tests["test_probe.Teardown.test_fails_then_teardown_errors"]["outcomes"], ["failure", "error"])
        self.assertEqual(tests["test_probe.Plain.test_pass"]["outcomes"], ["success"])
        self.assertEqual((tests["test_probe.Plain.test_subtests"]["outcomes"], sorted(tests["test_probe.Plain.test_subtests"]["subtests"])),
                         ([], ["failure", "success", "success"]), "a failed subtest leaves no parent success")
        self.assertEqual(tests["test_probe.Plain.test_skipped_subtest"]["subtests"], ["skipped"])
        self.assertEqual(tests["test_probe.Plain.test_expected"]["outcomes"], ["expectedFailure"])
        self.assertTrue(all(t["starts"] == t["stops"] == 1 for t in tests.values()))
        self.assertEqual(res["fixtures"], [{"description": "setUpClass (test_probe.Fixture)", "outcome": "error"}])
        printed = summarizer._suite({"stderr": child.stderr})
        self.assertEqual({k: res["callbackCounts"][k] for k in printed}, printed, "callback counts equal the printed count line")

    def test_the_summary_aggregates_the_real_records(self):
        child, _, res = self.run_child(PROBE)
        rows, codes = summarizer._suite_records({"id": "package-unit-tests", "stderr": child.stderr, "results": res})
        self.assertEqual({i: r["outcome"] for i, r in rows.items()},
                         {"test_probe.Plain.test_expected": "expectedFailure", "test_probe.Plain.test_pass": "success",
                          "test_probe.Plain.test_skipped_subtest": "skipped", "test_probe.Plain.test_subtests": "failure",
                          "test_probe.Teardown.test_fails_then_teardown_errors": "error"})
        self.assertEqual(codes, ["FIXTURE_EVENTS:package-unit-tests"])


class FileSetIdentity(unittest.TestCase):
    """The reviewed file set (Sam 1793407393): explicit paths, harness through its manifest, excluded trees pruned before descent, symlinks never
    followed, unexpected files counted by category only."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for rel in ("scripts/a.py", "config/c.json", "harness/bundle/x.cjs", "config/history/receipts/R5/private.json", "runner/node_modules/pkg/i.js"):
            (self.root / rel).parent.mkdir(parents=True, exist_ok=True)
            (self.root / rel).write_text(rel)
        (self.root / "harness" / "PACKET-MANIFEST.sha256").write_text("%s  bundle/x.cjs\n" % ("0" * 64))
        (self.root / "runner" / "node_modules" / ".bin").mkdir()
        (self.root / "runner" / "node_modules" / ".bin" / "tool").symlink_to(self.root / "runner" / "node_modules" / "pkg" / "i.js")
        spec = json.loads((Path(runner.__file__).parents[1] / "config" / "equivalence-file-set.v1.json").read_text())
        spec["paths"] = ["config/c.json", "config/equivalence-file-set.v1.json", "scripts/a.py"]
        (self.root / "config" / "equivalence-file-set.v1.json").write_text(json.dumps(spec))

    def identity(self):
        with mock.patch.object(runner, "ROOT", str(self.root)):
            return runner.file_set_identity()

    def test_a_clean_tree_is_complete_and_excluded_trees_are_never_entered(self):
        walked = []
        real_walk = runner.os.walk
        def spy(top, **kwargs):
            for dirpath, dirnames, filenames in real_walk(top, **kwargs):
                walked.append(dirpath)
                yield dirpath, dirnames, filenames
        with mock.patch.object(runner.os, "walk", side_effect=spy):
            fs = self.identity()
        self.assertEqual((fs["status"], fs["codes"]), ("COMPLETE", []))
        self.assertEqual([p for p, _ in fs["files"]], ["config/c.json", "config/equivalence-file-set.v1.json", "scripts/a.py"])
        self.assertFalse([w for w in walked if "node_modules" in w or "receipts" in w], "pruned before descent: the .bin link is never seen")

    def test_missing_unexpected_and_linked_files_are_incomplete_and_publish_no_private_path(self):
        (self.root / "scripts" / "a.py").unlink()
        (self.root / "scripts" / "unlisted.py").write_text("x")
        (self.root / "harness" / "bundle" / "extra.cjs").write_text("x")
        (self.root / "config" / "linked.json").symlink_to(self.root / "config" / "c.json")
        fs = self.identity()
        self.assertEqual((fs["status"], fs["codes"]), ("INCOMPLETE", ["MISSING", "SYMLINK", "UNEXPECTED"]))
        self.assertEqual((fs["missing"], fs["symlinks"], fs["unexpected"]), (["scripts/a.py"], 1, {"source": 2}))
        self.assertNotIn(str(self.root), json.dumps(fs))
        self.assertNotIn("unlisted", json.dumps(fs))

    def test_a_linked_directory_component_of_a_listed_path_is_never_followed(self):
        real = self.root / "elsewhere"
        real.mkdir()
        (real / "a.py").write_text("scripts/a.py")
        (self.root / "scripts" / "a.py").unlink()
        (self.root / "scripts").rmdir()
        (self.root / "scripts").symlink_to(real)
        fs = self.identity()
        self.assertIn("SYMLINK", fs["codes"])
        self.assertNotIn("scripts/a.py", [p for p, _ in fs["files"]])

    def test_a_linked_named_harness_file_or_manifest_is_incomplete_even_with_matching_bytes(self):
        # Sam 1793410354: a link to identical bytes must never stand in for an included file; both manifests are preflighted before any read.
        twin = self.root / "elsewhere"
        twin.mkdir()
        for rel in ("harness/bundle/x.cjs", "config/equivalence-file-set.v1.json", "harness/PACKET-MANIFEST.sha256"):
            target = self.root / rel
            original = target.read_bytes()
            (twin / target.name).write_bytes(original)
            target.unlink()
            target.symlink_to(twin / target.name)
            fs = self.identity()
            self.assertEqual(fs["status"], "INCOMPLETE", rel)
            self.assertIn("SYMLINK", fs["codes"], rel)
            target.unlink()
            target.write_bytes(original)
            (twin / target.name).unlink()
        twin.rmdir()
        self.assertEqual(self.identity()["status"], "COMPLETE", "restored regular files: each negative was the link alone")

    def test_a_scan_error_is_incomplete_and_names_no_path(self):
        real_walk = runner.os.walk
        def failing(top, **kwargs):
            kwargs["onerror"](PermissionError(13, "denied", str(self.root / "scripts" / "private-subtree")))
            yield from real_walk(top, **kwargs)
        with mock.patch.object(runner.os, "walk", side_effect=failing):
            fs = self.identity()
        self.assertEqual((fs["status"], fs["codes"], fs["scanErrors"]), ("INCOMPLETE", ["SCAN_ERROR"], 1))
        self.assertNotIn("private-subtree", json.dumps(fs))

    def test_external_inputs_publish_repository_paths_only(self):
        outside = tempfile.NamedTemporaryFile(delete=False)
        outside.write(b"x")
        outside.close()
        self.addCleanup(Path(outside.name).unlink)
        with mock.patch.dict(runner.os.environ, {"CT_TEST_REPO": str(self.root), "CLOUD_TEST_YML": outside.name}):
            got = runner.external_input("cloud-test-yml", "CLOUD_TEST_YML", None)
            self.assertEqual((got["source"], got["path"], got["state"]), ("env", "outside-repo", "BOUND"))
            got = runner.external_input("lock", None, str(self.root / "nope.yaml"))
            self.assertEqual((got["path"], got["sha256"], got["state"]), ("nope.yaml", None, "UNKNOWN"))
        self.assertEqual(runner.external_input("chrome", "CT_CHROME_UNSET_PROBE", None)["state"], "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
