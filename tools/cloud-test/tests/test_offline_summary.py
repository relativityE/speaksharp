"""The public offline summary is exact and fails closed (Sam RETURN 1793373703): names, statuses and counts only."""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import summarize_offline_checks as s

MANIFEST_IDS = json.loads(Path(s.MANIFEST).read_text())["ids"]
REQUIRED = {suite: sorted(i.split("::", 1)[1] for i in MANIFEST_IDS if i.startswith(suite + "::")) for suite in s.SUITES}
CLEAN = {suite: "....\n----------------------------------------------------------------------\nRan %d tests in 120.4s\n\nOK\n" % len(REQUIRED[suite])
         for suite in s.SUITES}
UNITTEST_CLEAN = CLEAN["package-unit-tests"]


def results(suite, outcome="success"):
    """Structured records exactly as run_offline_checks.py's RecordingResult writes them: every manifest id once, one terminal outcome each."""
    tests = [{"id": i, "starts": 1, "stops": 1, "outcomes": [outcome], "subtests": []} for i in REQUIRED[suite]]
    return {"schema": "speaksharp.cloud-test.suite-results.v1", "tests": tests, "fixtures": [],
            "callbackCounts": {"ran": len(tests), "failures": 0, "errors": 0, "skipped": 0, "expected failures": 0, "unexpected successes": 0}}


def identity():
    return {"fileSet": {"status": "COMPLETE", "codes": [], "files": [["config/test-config.v1.json", "a" * 64], ["scripts/pipeline.py", "b" * 64]],
                        "missing": [], "symlinks": 0, "unexpected": {}, "scanErrors": 0},
            "pins": {"code": "c" * 64, "packet": "d" * 64},
            "externalInputs": [{"name": "cloud-test-yml", "source": "env", "path": ".github/workflows/cloud-test.yml", "sha256": "e" * 64, "state": "BOUND"},
                               {"name": "chrome", "source": "env", "path": "outside-repo", "sha256": "f" * 64, "state": "BOUND"},
                               {"name": "test-repo", "source": "default", "path": None, "sha256": None, "state": "DECLARED"}],
            "environment": {"python": "3.12.11", "implementation": "CPython", "system": "Linux", "machine": "x86_64", "pyyaml": "6.0.2",
                            "node": "22.11.0", "pdfjs": "5.4.296"},
            "git": {"headTree": "1" * 40, "packageClean": True}}


def report():
    """A complete, clean result: every check passes, both suites report a clean count with a record for every manifest id, the identity is complete
    and the proof is the one the workflow supplied (CT_PROOF_FILE)."""
    checks = [dict({"id": i, "passed": True}, **({"stdout": "", "stderr": CLEAN[i], "results": results(i)} if i in s.SUITES else {}))
              for i in sorted(s.CHECKS)]
    return {"proofSource": "ct-proof-file", "passed": True, "checks": checks, "identity": identity()}


def by_id(doc, check_id):
    return next(c for c in doc["checks"] if c["id"] == check_id)


class Summary(unittest.TestCase):
    def test_importing_the_summarizer_leaves_sockets_untouched(self):
        code = ("import socket, sys; before = (socket.socket.connect, socket.create_connection, socket.getaddrinfo); "
                "sys.path.insert(0, %r); import summarize_offline_checks; "
                "print((socket.socket.connect, socket.create_connection, socket.getaddrinfo) == before)") % str(Path(s.__file__).parent)
        import subprocess
        r = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True)
        self.assertEqual(r.stdout.strip(), "True", r.stderr)

    def test_a_complete_result_passes_with_every_check_current(self):
        out = s.summarize(report())
        self.assertTrue(out["resultValid"] and out["overallPassed"] and out["delivered"])
        self.assertEqual((out["passed"], out["failed"]), (8, 0))
        self.assertIs(out["liveExecutionAuthorized"], False)
        self.assertEqual(by_id(out, "package-unit-tests")["tests"], {"ran": len(REQUIRED["package-unit-tests"]), "failures": 0, "errors": 0, "skipped": 0})

    def test_an_applicable_failure_fails_and_names_only_the_failing_tests(self):
        doc = report()
        unit = by_id(doc, "package-unit-tests")
        unit.update(passed=False, stderr="ERROR: test_a (m.C.test_a)\nTraceback (most recent call last):\n  SECRET-LIKE DETAIL\n"
                                          "FAIL: test_b (m.C.test_b)\nRan 3 tests in 1s\n\nFAILED (failures=1, errors=1, skipped=1)\n")
        doc["passed"] = False
        out = s.summarize(doc)
        self.assertTrue(out["resultValid"])
        self.assertFalse(out["overallPassed"])
        row = by_id(out, "package-unit-tests")
        self.assertEqual(row["failingTests"], ["test_a (m.C.test_a)", "test_b (m.C.test_b)"])
        self.assertEqual(row["tests"], {"ran": 3, "failures": 1, "errors": 1, "skipped": 1})
        self.assertNotIn("SECRET-LIKE", json.dumps(out))
        self.assertNotIn("Traceback", json.dumps(out))

    def test_failure_types_are_class_names_only_including_class_fixtures(self):
        doc = report()
        unit = by_id(doc, "package-unit-tests")
        sep, dash = "=" * 70, "-" * 70
        unit.update(passed=False, stderr="\n".join([
            sep, "ERROR: setUpClass (test_full_plan.FullPlanProof)", dash, "Traceback (most recent call last):",
            '  File "x.py", line 1, in setUpClass', "AssertionError: [b'SECRET-LIKE STDERR']", "",
            sep, "FAIL: test_b (m.C.test_b)", dash, "Traceback (most recent call last):", "  File \"y.py\", line 2",
            "subprocess.CalledProcessError: Command '['node', 'PRIVATE-PATH']' returned 3", "",
            sep, "ERROR: test_c (m.C.test_c)", dash, "something unexpected without a type", "",
            dash, "Ran 9 tests in 1s", "", "FAILED (failures=1, errors=2)"]))
        doc["passed"] = False
        row = by_id(s.summarize(doc), "package-unit-tests")
        self.assertEqual(row["failingTests"], ["setUpClass (test_full_plan.FullPlanProof)", "test_b (m.C.test_b)", "test_c (m.C.test_c)"])
        self.assertEqual(row["failureTypes"], {"setUpClass (test_full_plan.FullPlanProof)": "AssertionError",
                                               "test_b (m.C.test_b)": "subprocess.CalledProcessError",
                                               "test_c (m.C.test_c)": "OTHER"})
        text = json.dumps(row)
        for leaked in ("SECRET-LIKE", "PRIVATE-PATH", "returned 3", "unexpected"):
            self.assertNotIn(leaked, text)

    def test_only_an_exception_class_shape_is_ever_published(self):
        sep, dash = "=" * 70, "-" * 70
        def types(*body):
            doc = report()
            by_id(doc, "package-unit-tests").update(passed=False, stderr="\n".join(
                [sep, "FAIL: test_x (m.C.test_x)", dash, "Traceback (most recent call last):", '  File "t.py", line 9, in test_x',
                 "    self.assertEqual(r.returncode, 0, r.stdout)", *body, "", dash, "Ran 1 test in 1s", "", "FAILED (failures=1)"]))
            doc["passed"] = False
            return by_id(s.summarize(doc), "package-unit-tests")["failureTypes"]["test_x (m.C.test_x)"]
        # A multi-line message whose later lines are captured output: only the class is read.
        self.assertEqual(types("AssertionError: 5 != 0 : STOP: credential-like variables are present", "STOP: PRIVATE",
                               "SECRET-LIKE"), "AssertionError")
        self.assertEqual(types("subprocess.CalledProcessError: Command returned 3"), "subprocess.CalledProcessError")
        for leaked in ("STOP: credential-like variables are present", "Hello: there", "secret", "PRIVATE-WORD",
                       "pkg.mod.CustomFailure", "PrivateNoteError: x", "SecretTokenException"):
            self.assertEqual(types(leaked), "OTHER", leaked)
        # A message that imitates a further traceback frame cannot smuggle an invented class name out.
        self.assertEqual(types("AssertionError: note", '  File "fake.py", line 1, in x', "CustomerNameError: spoofed"), "OTHER")

    def assertRefused(self, doc, error):
        out = s.summarize(doc)
        self.assertEqual(out.get("error"), error)
        self.assertFalse(out["resultValid"])
        self.assertFalse(out["overallPassed"])

    def test_the_reviewed_counterexample_is_refused(self):
        self.assertRefused({"proofSource": "ct-proof-file", "passed": True, "checks": [{"id": "package-unit-tests", "passed": True, "applicable": False}]},
                           "RESULT_CHECK_INVENTORY_MISMATCH")

    def test_missing_malformed_and_empty_results_are_refused(self):
        self.assertRefused(None, "RESULT_MISSING")
        for doc in ({}, [], {"checks": []}, {"checks": "x"}, {"checks": [{"passed": True}]}, {"checks": [{"id": 3}]}):
            self.assertRefused(doc, "RESULT_MALFORMED")

    def test_a_missing_check_is_refused(self):
        for check_id in sorted(s.CHECKS):
            doc = report()
            doc["checks"] = [c for c in doc["checks"] if c["id"] != check_id]
            self.assertRefused(doc, "RESULT_CHECK_INVENTORY_MISMATCH")

    def test_an_extra_check_is_refused(self):
        doc = report()
        doc["checks"].append({"id": "unreviewed-check", "passed": True})
        self.assertRefused(doc, "RESULT_CHECK_INVENTORY_MISMATCH")

    def test_a_duplicate_check_is_refused(self):
        doc = report()
        doc["checks"].append(copy.deepcopy(by_id(doc, "harness-verified")))
        self.assertRefused(doc, "RESULT_DUPLICATE_CHECK")

    def test_no_check_can_ever_be_not_applicable(self):
        for check_id in sorted(s.CHECKS):
            doc = report()
            by_id(doc, check_id).update(passed=None, applicable=False)
            self.assertRefused(doc, "RESULT_ILLEGAL_APPLICABILITY")

    def test_a_not_applicable_check_cannot_carry_a_pass(self):
        doc = report()
        by_id(doc, "offline-proof-index").update(passed=True, applicable=False)
        self.assertRefused(doc, "RESULT_ILLEGAL_APPLICABILITY")

    def test_a_non_boolean_outcome_is_refused(self):
        doc = report()
        by_id(doc, "harness-verified")["passed"] = "yes"
        self.assertRefused(doc, "RESULT_ILLEGAL_APPLICABILITY")

    def test_an_overall_flag_or_mode_that_contradicts_the_checks_is_refused(self):
        doc = report()
        doc["passed"] = False
        self.assertRefused(doc, "RESULT_INCONSISTENT")
        doc = report()
        by_id(doc, "harness-verified")["passed"] = False
        self.assertRefused(doc, "RESULT_INCONSISTENT")
        doc = report()
        doc["proofSource"] = "somewhere-else"
        self.assertRefused(doc, "RESULT_MALFORMED")


def real_unittest(source):
    """The real stderr of `python -m unittest` over one temporary module, so the gate is judged against unittest's own output."""
    import subprocess
    import tempfile
    d = tempfile.mkdtemp()
    Path(d, "test_probe.py").write_text(source)
    return subprocess.run([sys.executable, "-I", "-m", "unittest", "discover", "-s", d, "-p", "test_probe.py"], capture_output=True, text=True).stderr


class Delivery(unittest.TestCase):
    """PO 2026-10-30 via Sam 1793398305: the delivery is the GitHub workflow passing with NO skips. Any skip, error, failure, N/A, missing,
    unparseable or empty suite count, or a proof the workflow did not supply, is refused."""

    def required(self, suite="package-unit-tests", output=UNITTEST_CLEAN, passed=True):
        doc = report()
        by_id(doc, suite).update(stderr=output, passed=passed)
        doc["passed"] = all(c["passed"] for c in doc["checks"])
        return s.summarize(doc)

    def assertNotDelivered(self, out, refusal):
        self.assertTrue(out["resultValid"], out)
        self.assertFalse(out["delivered"])
        self.assertFalse(out["overallPassed"])
        self.assertIn(refusal, out["deliveryRefusals"])

    def test_a_clean_run_is_the_delivery(self):
        out = self.required()
        self.assertEqual((out["delivered"], out["deliveryRefusals"], out["overallPassed"]), (True, [], True))

    def test_a_proof_the_workflow_did_not_supply_is_never_delivery(self):
        doc = report()
        doc["proofSource"] = None
        out = s.summarize(doc)
        self.assertTrue(out["resultValid"])
        self.assertEqual((out["delivered"], out["overallPassed"]), (False, False))
        self.assertIn("PROOF_NOT_SUPPLIED", out["deliveryRefusals"])

    def test_any_skip_is_refused_in_either_suite(self):
        for suite in s.SUITES:
            out = self.required(suite, "Ran 41 tests in 2.0s\n\nOK (skipped=1)\n")
            self.assertNotDelivered(out, "SKIPPED:" + suite)

    def test_a_real_class_level_skip_is_counted_and_refused(self):
        # setUpClass raising SkipTest runs none of the class's tests and unittest counts the whole class as ONE skip.
        output = real_unittest("import unittest\nclass Skipped(unittest.TestCase):\n    @classmethod\n    def setUpClass(cls):\n"
                               "        raise unittest.SkipTest('history')\n    def test_a(self): pass\n    def test_b(self): pass\n"
                               "class Runs(unittest.TestCase):\n    def test_c(self): pass\n")
        self.assertEqual(s._counts({"stderr": output})["skipped"], 1, output)
        self.assertNotDelivered(self.required(output=output), "SKIPPED:package-unit-tests")

    def test_errors_failures_and_unclean_outcomes_are_refused(self):
        cases = (("FAILED (errors=1)", "ERRORS"), ("FAILED (failures=2)", "FAILURES"),
                 ("OK (expected failures=1)", "EXPECTED_FAILURES"), ("FAILED (unexpected successes=1)", "UNEXPECTED_SUCCESSES"))
        for status, refusal in cases:
            out = self.required(output="Ran 9 tests in 1.0s\n\n%s\n" % status, passed=status.startswith("OK"))
            self.assertNotDelivered(out, refusal + ":package-unit-tests")

    def test_absent_or_unparseable_counts_are_refused(self):
        for output in ("", "Ran 9 tests in 1.0s\n", "Ran 9 tests in 1.0s\n\nOK (skipped=x)\n", "Ran 9 tests in 1.0s\n\nOK (skips=1)\n",
                       "Ran 9 tests in 1.0s\n\nOK (errors=1)\n", "Ran 9 tests\n\nOK\n", "OK\n", "Ran 9 tests in 1.0s\n\nPASSED\n"):
            self.assertNotDelivered(self.required(output=output), "COUNTS_MISSING:package-unit-tests")
        self.assertNotDelivered(self.required("report-builder-tests", ""), "COUNTS_MISSING:report-builder-tests")

    def test_an_ambiguous_or_contradicted_result_is_refused(self):
        # Sam 1793398852: a valid summary followed by a second (even truncated) summary or a contradictory status is not one
        # unambiguous result, and never yields delivery.
        clean = "Ran 9 tests in 1.0s\n\nOK\n"
        for output in (clean + "Ran 10 tests\n", clean + "FAILED (errors=1)\n", clean + "Ran 10 tests in 2.0s\n\nOK\n",
                       "Ran 10 tests\n" + clean, clean + "NO TESTS RAN\n", clean + "OK (skipped=1)\n", clean + "anything else\n"):
            self.assertNotDelivered(self.required(output=output), "COUNTS_MISSING:package-unit-tests")
        # The result may sit after stdout and test-time noise, but nothing may follow it.
        self.assertTrue(self.required(output="noise\nRan into nothing here\n" + clean)["deliveryRefusals"])
        self.assertEqual(self.required(output="warning: noise\n" + UNITTEST_CLEAN)["deliveryRefusals"], [])

    def test_an_empty_suite_is_refused(self):
        self.assertNotDelivered(self.required(output="Ran 0 tests in 0.000s\n\nOK\n"), "COUNTS_EMPTY:package-unit-tests")
        # A real run with nothing to run prints "NO TESTS RAN": no parseable count, so it is refused too.
        output = real_unittest("import unittest\n")
        self.assertNotDelivered(self.required(output=output), "COUNTS_MISSING:package-unit-tests")

    def test_a_failed_check_is_named_in_the_refusals(self):
        doc = report()
        by_id(doc, "harness-verified")["passed"] = False
        doc["passed"] = False
        self.assertNotDelivered(s.summarize(doc), "FAILED:harness-verified")


class Equivalence(unittest.TestCase):
    """The equivalence contract (Sam 1793406369, 1793406609, 1793406980; file set 1793407393; manifest 1793408198). MATCHED means equal observations of
    equal inputs only; each run keeps its own gate. The ten reviewed controls, plus the aggregation and inventory rules."""

    def summary(self, mutate=None):
        doc = report()
        if mutate:
            mutate(doc)
        doc["passed"] = all(c["passed"] for c in doc["checks"])
        return s.summarize(doc)

    def fail_test(self, doc, test_id, outcome="failure"):
        unit = by_id(doc, "package-unit-tests")
        next(t for t in unit["results"]["tests"] if t["id"] == test_id)["outcomes"] = [outcome]
        unit["results"]["callbackCounts"]["failures"] += 1
        unit.update(passed=False, stderr="Ran %d tests in 1.0s\n\nFAILED (failures=1)\n" % len(REQUIRED["package-unit-tests"]))

    def test_c1_the_same_inputs_give_the_same_digests(self):
        a, b = self.summary(), self.summary()
        self.assertEqual(a["equivalence"], b["equivalence"])
        self.assertEqual(s.compare(a, b)["state"], "MATCHED")
        self.assertEqual(a["equivalence"]["inventory"]["status"], "COMPLETE")
        self.assertEqual(len(a["equivalence"]["inventory"]["executed"]), len(MANIFEST_IDS))
        self.assertEqual(a["equivalence"]["inventory"]["manifestSha256"], __import__("hashlib").sha256(Path(s.MANIFEST).read_bytes()).hexdigest())

    def test_c2_one_changed_reviewed_byte_is_different_inputs_naming_the_path(self):
        b = self.summary(lambda d: d["identity"]["fileSet"]["files"][1].__setitem__(1, "9" * 64))
        cmp = s.compare(self.summary(), b)
        self.assertEqual((cmp["state"], cmp["differences"]["paths"]), ("DIFFERENT-INPUTS", ["scripts/pipeline.py"]))
        cmp = s.compare(self.summary(), self.summary(lambda d: d["identity"]["externalInputs"][0].__setitem__("sha256", "9" * 64)))
        self.assertEqual((cmp["state"], cmp["differences"]["inputs"]), ("DIFFERENT-INPUTS", ["cloud-test-yml"]))

    def test_c3_a_missing_or_unexpected_file_is_incomplete_and_never_delivery(self):
        for codes, extra in ((["MISSING"], {"missing": ["scripts/pipeline.py"]}), (["UNEXPECTED"], {"unexpected": {"source": 1}}),
                             (["SYMLINK"], {"symlinks": 1}), (["SCAN_ERROR"], {"scanErrors": 1})):
            b = self.summary(lambda d: d["identity"]["fileSet"].update(status="INCOMPLETE", codes=codes, **extra))
            self.assertIn("FILE_SET_INCOMPLETE", b["deliveryRefusals"])
            cmp = s.compare(self.summary(), b)
            self.assertEqual(cmp["state"], "INCOMPLETE")
            self.assertIn("FILE_SET_INCOMPLETE", cmp["codes"])
        # An unexpected file is published by category and count only, never by path.
        self.assertRefusedIdentity(lambda i: i["fileSet"].update(status="INCOMPLETE", codes=["UNEXPECTED"], unexpected={"/home/private/x.py": 1}))

    def test_c4_an_unrelated_repository_change_or_no_git_can_still_match(self):
        b = self.summary(lambda d: d["identity"].update(git={"headTree": None, "packageClean": None}))
        self.assertEqual(s.compare(self.summary(), b)["state"], "MATCHED")

    def test_c5_equal_counts_with_a_different_failing_test_is_different(self):
        first, second = REQUIRED["package-unit-tests"][:2]
        a, b = self.summary(lambda d: self.fail_test(d, first)), self.summary(lambda d: self.fail_test(d, second))
        self.assertEqual(by_id(a, "package-unit-tests")["tests"], by_id(b, "package-unit-tests")["tests"])
        cmp = s.compare(a, b)
        self.assertEqual(cmp["state"], "DIFFERENT")
        self.assertEqual(sorted(t[0] for t in cmp["differences"]["tests"]), sorted("package-unit-tests::" + i for i in (first, second)))

    def test_c6_a_failed_subtest_fails_its_parent_and_a_class_fixture_credits_nothing(self):
        def subtest(d):
            unit = by_id(d, "package-unit-tests")
            unit["results"]["tests"][0].update(outcomes=[], subtests=["success", "failure"])
            unit["results"]["callbackCounts"]["failures"] += 1
            unit.update(passed=False, stderr="Ran %d tests in 1.0s\n\nFAILED (failures=1)\n" % len(REQUIRED["package-unit-tests"]))
        out = self.summary(subtest)
        row = out["equivalence"]["inventory"]["executed"][[e[0] for e in out["equivalence"]["inventory"]["executed"]].index(
            "package-unit-tests::" + REQUIRED["package-unit-tests"][0])]
        self.assertEqual(row[1:], ["failure", {"failure": 1, "success": 1}, {}])
        self.assertEqual(out["equivalence"]["inventory"]["status"], "COMPLETE", "a subtest failure is a recorded outcome, not missing data")

        def fixture(d):
            unit = by_id(d, "package-unit-tests")
            klass = REQUIRED["package-unit-tests"][0].rsplit(".", 1)[0]
            unit["results"]["tests"] = [t for t in unit["results"]["tests"] if not t["id"].startswith(klass + ".")]
            unit["results"]["fixtures"] = [{"description": "setUpClass (%s)" % klass, "outcome": "error"}]
            n = len(unit["results"]["tests"])
            unit["results"]["callbackCounts"].update(ran=n, errors=1)
            unit.update(passed=False, stderr="Ran %d tests in 1.0s\n\nFAILED (errors=1)\n" % n)
        inv = self.summary(fixture)["equivalence"]["inventory"]
        self.assertEqual(inv["status"], "INCOMPLETE")
        self.assertTrue(any(c.startswith("MANIFEST_IDS_NOT_EXECUTED:package-unit-tests:") for c in inv["codes"]), inv["codes"])
        self.assertIn("FIXTURE_EVENTS:package-unit-tests", inv["codes"])

    def test_c7_a_duplicate_id_or_disagreeing_counts_is_incomplete(self):
        def duplicate(d):
            r = by_id(d, "package-unit-tests")["results"]
            r["tests"].append(copy.deepcopy(r["tests"][0]))
        def twice(d):
            by_id(d, "package-unit-tests")["results"]["tests"][0].update(starts=2, stops=2)
        def miscounted(d):
            by_id(d, "package-unit-tests")["results"]["callbackCounts"]["skipped"] = 1
        def no_terminal(d):
            by_id(d, "package-unit-tests")["results"]["tests"][0].update(outcomes=[], stops=0)
        def contradictory(d):
            by_id(d, "package-unit-tests")["results"]["tests"][0]["outcomes"] = ["success", "failure"]
        for mutate, code in ((duplicate, "DUPLICATE_ID"), (twice, "DUPLICATE_EXECUTION"), (miscounted, "COUNTS_DISAGREE"),
                             (no_terminal, "NO_TERMINAL_OUTCOME"), (contradictory, "CONTRADICTORY_OUTCOMES")):
            out = self.summary(mutate)
            self.assertIn(code + ":package-unit-tests", out["equivalence"]["inventory"]["codes"], code)
            self.assertIn("INVENTORY_INCOMPLETE", out["deliveryRefusals"], code)
            self.assertEqual(s.compare(self.summary(), out)["state"], "INCOMPLETE", code)
        for broken in (None, {}, {"tests": "x"}, {"tests": [], "fixtures": [], "callbackCounts": {"ran": True}}):
            out = self.summary(lambda d: by_id(d, "report-builder-tests").__setitem__("results", broken))
            self.assertIn("RESULTS_MALFORMED:report-builder-tests", out["equivalence"]["inventory"]["codes"])
            self.assertIn("INVENTORY_INCOMPLETE", out["deliveryRefusals"])
        out = self.summary(lambda d: by_id(d, "report-builder-tests")["results"]["tests"].append(
            {"id": "unittest.loader._FailedTest.test_probe", "starts": 1, "stops": 1, "outcomes": ["error"], "subtests": []}))
        self.assertIn("UNLISTED_IDS_EXECUTED:report-builder-tests:1", out["equivalence"]["inventory"]["codes"], "an import placeholder is never credited")

    def test_c8_identical_failures_match_and_both_runs_stay_undelivered(self):
        first = REQUIRED["package-unit-tests"][0]
        a, b = self.summary(lambda d: self.fail_test(d, first)), self.summary(lambda d: self.fail_test(d, first))
        cmp = s.compare(a, b)
        self.assertEqual((cmp["state"], cmp["delivered"]), ("MATCHED", [False, False]))

    def test_c9_a_tampered_digest_or_a_different_manifest_is_incomplete(self):
        for path in (("resultDigest",), ("inventory", "executedDigest"), ("identity", "inputsDigest"), ("identity", "fileSet", "digest")):
            b = self.summary()
            node = b["equivalence"]
            for k in path[:-1]:
                node = node[k]
            node[path[-1]] = "0" * 64
            self.assertEqual(s.compare(self.summary(), b)["state"], "INCOMPLETE", path)
        b = self.summary()
        b["equivalence"]["inventory"]["executed"][0][1] = "failure"
        self.assertEqual(s.compare(self.summary(), b)["state"], "INCOMPLETE", "an edited row without its digest")
        b = self.summary()
        b["equivalence"]["inventory"]["manifestSha256"] = "0" * 64
        self.assertEqual(s.compare(self.summary(), b)["codes"], ["MANIFEST_DIFFERS"])

    def test_c10_an_environment_difference_is_listed_and_an_unbound_input_is_unknown(self):
        b = self.summary(lambda d: d["identity"]["environment"].update(system="Darwin", machine="arm64"))
        cmp = s.compare(self.summary(), b)
        self.assertEqual((cmp["state"], cmp["environmentDifferences"]), ("MATCHED", ["machine", "system"]))
        b = self.summary(lambda d: d["identity"]["externalInputs"][0].update(source="default", path="tools/cloud-test/tests/fixtures/cloud-test.yml"))
        cmp = s.compare(self.summary(), b)
        self.assertEqual((cmp["state"], cmp["declaredInputDifferences"]), ("MATCHED", ["cloud-test-yml"]), "same bytes from another source")
        b = self.summary(lambda d: d["identity"]["externalInputs"][1].update(sha256=None, state="UNKNOWN"))
        self.assertEqual(s.compare(self.summary(), b)["state"], "UNKNOWN", "package-only identity never claims equal inputs")
        b = self.summary(lambda d: d["identity"].update(pins={"code": None, "packet": None}))
        self.assertEqual(s.compare(self.summary(), b)["codes"], ["PINS_UNVERIFIED"])

    def test_a_recorded_failure_never_hides_behind_zero_counters_and_a_printed_ok(self):
        # Sam 1793410315: the per-id record says failure; the callback counters say 0 and the printed line says OK.
        out = self.summary(lambda d: by_id(d, "package-unit-tests")["results"]["tests"][0].update(outcomes=["failure"]))
        self.assertIn("COUNTS_DISAGREE:package-unit-tests", out["equivalence"]["inventory"]["codes"])
        self.assertIn("UNSUCCESSFUL_OUTCOMES:package-unit-tests", out["deliveryRefusals"])
        self.assertFalse(out["delivered"])

    def test_a_failure_then_a_teardown_error_keeps_both_and_only_impossible_combinations_contradict(self):
        n = len(REQUIRED["package-unit-tests"])
        def teardown(d):
            unit = by_id(d, "package-unit-tests")
            unit["results"]["tests"][0]["outcomes"] = ["failure", "error"]
            unit["results"]["callbackCounts"].update(failures=1, errors=1)
            unit.update(passed=False, stderr="Ran %d tests in 1.0s\n\nFAILED (failures=1, errors=1)\n" % n)
        out = self.summary(teardown)
        inv = out["equivalence"]["inventory"]
        self.assertEqual((inv["status"], inv["codes"]), ("COMPLETE", []), "two unsuccessful callbacks are legitimate evidence (Sam 1793410430)")
        row = inv["executed"][[e[0] for e in inv["executed"]].index("package-unit-tests::" + REQUIRED["package-unit-tests"][0])]
        self.assertEqual(row[1:], ["error", {}, {"error": 1, "failure": 1}], "worst outcome first, and the failure is retained")
        self.assertIn("UNSUCCESSFUL_OUTCOMES:package-unit-tests", out["deliveryRefusals"])
        for impossible in (["success", "failure"], ["success", "success"], ["error", "success"]):
            out = self.summary(lambda d: by_id(d, "package-unit-tests")["results"]["tests"][0].update(outcomes=impossible))
            self.assertIn("CONTRADICTORY_OUTCOMES:package-unit-tests", out["equivalence"]["inventory"]["codes"], impossible)

    def test_bool_zero_or_negative_outcome_counts_make_a_summary_invalid(self):
        for j, value in ((2, True), (2, -1), (3, 0), (3, False)):
            b = self.summary()
            b["equivalence"]["inventory"]["executed"][0][j] = {"failure": value}
            self.assertEqual(s.compare(self.summary(), b)["codes"], ["b:SUMMARY_INVALID"], (j, value))
        # Sam 1793410731: every count a comparison reads, including the summary-row test counts.
        for key, value in (("ran", True), ("failures", -1), ("errors", False), ("skipped", "0"), ("ran", 1.0)):
            b = self.summary()
            by_id(b, "package-unit-tests")["tests"][key] = value
            self.assertEqual(s.compare(self.summary(), b)["codes"], ["b:SUMMARY_INVALID"], (key, value))
        b = self.summary()
        by_id(b, "package-unit-tests")["tests"]["extra"] = 0
        self.assertEqual(s.compare(self.summary(), b)["codes"], ["b:SUMMARY_INVALID"], "an unknown count key")
        for key, value in (("symlinks", True), ("scanErrors", -1)):
            b = self.summary()
            b["equivalence"]["identity"]["fileSet"][key] = value
            self.assertEqual(s.compare(self.summary(), b)["state"], "INCOMPLETE", (key, value))

    def test_every_unsuccessful_outcome_refuses_delivery_even_when_the_accounts_agree(self):
        n = len(REQUIRED["package-unit-tests"])
        for outcome, key, status in (("expectedFailure", "expected failures", "OK (expected failures=1)"), ("skipped", "skipped", "OK (skipped=1)"),
                                     ("unexpectedSuccess", "unexpected successes", "FAILED (unexpected successes=1)")):
            def mutate(d):
                unit = by_id(d, "package-unit-tests")
                unit["results"]["tests"][0]["outcomes"] = [outcome]
                unit["results"]["callbackCounts"][key] = 1
                unit.update(stderr="Ran %d tests in 1.0s\n\n%s\n" % (n, status), passed=status.startswith("OK"))
            out = self.summary(mutate)
            self.assertEqual(out["equivalence"]["inventory"]["status"], "COMPLETE", outcome)
            self.assertIn("UNSUCCESSFUL_OUTCOMES:package-unit-tests", out["deliveryRefusals"], outcome)
            self.assertFalse(out["delivered"], outcome)

    def test_a_valid_failure_map_under_a_success_aggregate_or_clean_counts_is_refused(self):
        # Sam 1793410909: a positive, well-formed failure map with both digests recomputed must not pass as a clean, delivered row.
        def forge(flip_aggregate):
            b = self.summary()
            eq = b["equivalence"]
            eq["inventory"]["executed"][0][3] = {"failure": 1}
            if flip_aggregate:
                eq["inventory"]["executed"][0][1] = "failure"
            eq["inventory"]["executedDigest"] = s.digest(eq["inventory"]["executed"])
            eq["resultDigest"] = s._result_digest(b["checks"], eq["inventory"], {"delivered": b["delivered"], "refusals": sorted(b["deliveryRefusals"]),
                                                                                 "proofSource": b["proofSource"]})
            return b
        self.assertTrue(self.summary()["delivered"])
        cmp = s.compare(self.summary(), forge(False))
        self.assertEqual(cmp["state"], "INCOMPLETE")
        self.assertIn("b:AGGREGATE_CONTRADICTED", cmp["codes"])
        cmp = s.compare(self.summary(), forge(True))
        self.assertEqual(cmp["state"], "INCOMPLETE")
        self.assertIn("b:ROW_COUNTS_CONTRADICTED", cmp["codes"])
        self.assertIn("b:DELIVERED_FLAG_CONTRADICTED", cmp["codes"])
        self.assertEqual(s.compare(self.summary(), self.summary())["state"], "MATCHED", "unforged summaries reconcile")

    def test_the_delivered_flag_is_recomputed_never_trusted(self):
        failing = self.summary(lambda d: self.fail_test(d, REQUIRED["package-unit-tests"][0]))
        flipped = copy.deepcopy(failing)
        flipped.update(delivered=True, overallPassed=True, deliveryRefusals=[])
        cmp = s.compare(self.summary(), flipped)
        self.assertEqual(cmp["state"], "INCOMPLETE")
        self.assertIn("b:RESULT_DIGEST_MISMATCH", cmp["codes"], "the verdict is inside the result digest")
        # Even with the digest recomputed over the flipped verdict, the flag contradicts the recomputed eligibility.
        eq = flipped["equivalence"]
        eq["resultDigest"] = s._result_digest(flipped["checks"], eq["inventory"], {"delivered": True, "refusals": [], "proofSource": flipped["proofSource"]})
        cmp = s.compare(self.summary(), flipped)
        self.assertEqual((cmp["state"], cmp["codes"]), ("INCOMPLETE", ["b:DELIVERED_FLAG_CONTRADICTED"]))
        clean = self.summary()
        clean.update(delivered=False)
        self.assertIn("b:DELIVERED_FLAG_CONTRADICTED", s.compare(self.summary(), clean)["codes"], "a clean run cannot be presented as undelivered")

    def test_aggregation_precedence_keeps_every_unsuccessful_state(self):
        order = ["success", "expectedFailure", "skipped", "unexpectedSuccess", "failure", "error"]
        self.assertEqual(list(s.OUTCOMES), order)
        for worst in order[1:]:
            out = self.summary(lambda d: by_id(d, "package-unit-tests")["results"]["tests"][0].update(outcomes=["success"], subtests=[worst]))
            self.assertEqual(out["equivalence"]["inventory"]["executed"][[e[0] for e in out["equivalence"]["inventory"]["executed"]].index(
                "package-unit-tests::" + REQUIRED["package-unit-tests"][0])][1], worst)

    def test_identity_fields_outside_the_allowlist_are_refused_not_published(self):
        for mutate in (lambda i: i["fileSet"]["files"].__setitem__(0, ["/abs/private/path", "a" * 64]),
                       lambda i: i["fileSet"]["files"].__setitem__(0, ["../escape", "a" * 64]),
                       lambda i: i["externalInputs"][0].update(path="/Users/someone/x.yml"),
                       lambda i: i["environment"].update(python="3.12 with a sentence"),
                       lambda i: i["pins"].update(code="not-a-hash"),
                       lambda i: i.pop("git")):
            self.assertRefusedIdentity(mutate)

    def assertRefusedIdentity(self, mutate):
        doc = report()
        mutate(doc["identity"])
        out = s.summarize(doc)
        self.assertIsNone(out["equivalence"]["identity"])
        self.assertIn("IDENTITY_MISSING", out["deliveryRefusals"])
        self.assertNotIn("/home/private", json.dumps(out))
        self.assertNotIn("/Users/someone", json.dumps(out))
        self.assertNotIn("/abs/private", json.dumps(out))


if __name__ == "__main__":
    unittest.main()
