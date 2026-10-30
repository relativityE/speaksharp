"""The public offline summary is exact and fails closed (Sam RETURN 1793373703): names, statuses and counts only."""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import summarize_offline_checks as s

UNITTEST_OK = "....\n----------------------------------------------------------------------\nRan 433 tests in 70.1s\n\nOK (skipped=5)\n"
UNITTEST_CLEAN = "....\n----------------------------------------------------------------------\nRan 580 tests in 120.4s\n\nOK\n"


def report(history="none"):
    """A complete result. Reduced: the package suite reports skips (as today). Required: both suites report a clean run."""
    reduced = history == "none"
    output = {"package-unit-tests": UNITTEST_OK} if reduced else {i: UNITTEST_CLEAN for i in s.SUITES}
    checks = [dict({"id": i, "passed": True}, **({"stdout": "", "stderr": output[i]} if i in output else {}))
              for i in sorted(s.CURRENT_SOURCE)]
    checks += [{"id": i, "passed": None, "applicable": False} if reduced else {"id": i, "passed": True} for i in sorted(s.HISTORY_BOUND)]
    return {"historyMode": history, "passed": True, "checks": checks}


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

    def test_a_complete_reduced_result_passes_with_explicit_scope(self):
        out = s.summarize(report(), "none")
        self.assertTrue(out["resultValid"] and out["overallPassed"])
        self.assertEqual((out["passed"], out["failed"], out["notApplicable"]), (6, 0, 5))
        self.assertTrue(out["reducedScope"])
        self.assertIs(out["liveExecutionAuthorized"], False)
        self.assertEqual(set(out["steps"].values()), {"NOT APPLICABLE"})
        self.assertEqual(by_id(out, "package-unit-tests")["tests"], {"ran": 433, "failures": 0, "errors": 0, "skipped": 5})

    def test_a_complete_required_result_passes_with_nothing_not_applicable(self):
        out = s.summarize(report("required"), "required")
        self.assertTrue(out["overallPassed"])
        self.assertEqual(out["notApplicable"], 0)
        self.assertEqual(set(out["steps"].values()), {"REQUIRED"})

    def test_an_applicable_failure_fails_and_names_only_the_failing_tests(self):
        doc = report()
        unit = by_id(doc, "package-unit-tests")
        unit.update(passed=False, stderr="ERROR: test_a (m.C.test_a)\nTraceback (most recent call last):\n  SECRET-LIKE DETAIL\n"
                                          "Ran 3 tests in 1s\n\nFAILED (failures=1, errors=1, skipped=1)\nFAIL: test_b (m.C.test_b)\n")
        doc["passed"] = False
        out = s.summarize(doc, "none")
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
        row = by_id(s.summarize(doc, "none"), "package-unit-tests")
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
            return by_id(s.summarize(doc, "none"), "package-unit-tests")["failureTypes"]["test_x (m.C.test_x)"]
        # A multi-line message whose later lines are captured output: only the class is read.
        self.assertEqual(types("AssertionError: 5 != 0 : STOP: credential-like variables are present", "STOP: PRIVATE",
                               "SECRET-LIKE"), "AssertionError")
        self.assertEqual(types("subprocess.CalledProcessError: Command returned 3"), "subprocess.CalledProcessError")
        for leaked in ("STOP: credential-like variables are present", "Hello: there", "secret", "PRIVATE-WORD",
                       "pkg.mod.CustomFailure", "PrivateNoteError: x", "SecretTokenException"):
            self.assertEqual(types(leaked), "OTHER", leaked)
        # A message that imitates a further traceback frame cannot smuggle an invented class name out.
        self.assertEqual(types("AssertionError: note", '  File "fake.py", line 1, in x', "CustomerNameError: spoofed"), "OTHER")

    def assertRefused(self, doc, error, history="none"):
        out = s.summarize(doc, history)
        self.assertEqual(out.get("error"), error)
        self.assertFalse(out["resultValid"])
        self.assertFalse(out["overallPassed"])

    def test_the_reviewed_counterexample_is_refused(self):
        self.assertRefused({"historyMode": "none", "passed": True, "checks": [{"id": "package-unit-tests", "passed": True, "applicable": False}]},
                           "RESULT_CHECK_INVENTORY_MISMATCH")

    def test_missing_malformed_and_empty_results_are_refused(self):
        self.assertRefused(None, "RESULT_MISSING")
        for doc in ({}, [], {"checks": []}, {"checks": "x"}, {"checks": [{"passed": True}]}, {"checks": [{"id": 3}]}):
            self.assertRefused(doc, "RESULT_MALFORMED")

    def test_a_missing_check_is_refused(self):
        for check_id in sorted(s.CURRENT_SOURCE | s.HISTORY_BOUND):
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

    def test_a_current_source_check_can_never_be_not_applicable(self):
        for history in ("none", "required"):
            for check_id in sorted(s.CURRENT_SOURCE):
                doc = report(history)
                by_id(doc, check_id).update(passed=None, applicable=False)
                self.assertRefused(doc, "RESULT_ILLEGAL_APPLICABILITY", history)

    def test_history_checks_are_not_applicable_exactly_when_reduced(self):
        for check_id in sorted(s.HISTORY_BOUND):
            doc = report()
            by_id(doc, check_id).update(passed=True, applicable=True)
            self.assertRefused(doc, "RESULT_ILLEGAL_APPLICABILITY")
            doc = report("required")
            by_id(doc, check_id).update(passed=None, applicable=False)
            self.assertRefused(doc, "RESULT_ILLEGAL_APPLICABILITY", "required")

    def test_a_not_applicable_check_cannot_carry_a_pass(self):
        doc = report()
        by_id(doc, "offline-proof-index").update(passed=True)
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
        doc["historyMode"] = "required"
        self.assertRefused(doc, "RESULT_INCONSISTENT")

    def test_only_an_in_job_proof_may_make_the_proof_check_applicable_when_reduced(self):
        doc = report()
        by_id(doc, "offline-proof-index").update(passed=True, applicable=True)
        self.assertRefused(doc, "RESULT_ILLEGAL_APPLICABILITY")
        doc["proofSource"] = "in-job"
        out = s.summarize(doc, "none")
        self.assertTrue(out["resultValid"] and out["overallPassed"], out)
        self.assertEqual(out["notApplicable"], 4)
        doc = report()
        doc["proofSource"] = "in-job"  # an in-job proof must be judged, never left N/A
        self.assertRefused(doc, "RESULT_ILLEGAL_APPLICABILITY")
        doc = report()
        doc["proofSource"] = "somewhere-else"
        self.assertRefused(doc, "RESULT_MALFORMED")

    def test_an_unknown_mode_is_refused(self):
        self.assertRefused(report(), "HISTORY_MODE_INVALID", "skip")


def real_unittest(source):
    """The real stderr of `python -m unittest` over one temporary module, so the gate is judged against unittest's own output."""
    import subprocess
    import tempfile
    d = tempfile.mkdtemp()
    Path(d, "test_probe.py").write_text(source)
    return subprocess.run([sys.executable, "-I", "-m", "unittest", "discover", "-s", d, "-p", "test_probe.py"], capture_output=True, text=True).stderr


class Delivery(unittest.TestCase):
    """PO 2026-10-30 via Sam 1793398305: the delivery is the GitHub workflow passing with NO skips. Required mode refuses any skip,
    error, failure, N/A or missing/unparseable/empty suite count; reduced mode stays truthful but is never delivery."""

    def required(self, suite="package-unit-tests", output=UNITTEST_CLEAN, passed=True):
        doc = report("required")
        by_id(doc, suite).update(stderr=output, passed=passed)
        doc["passed"] = all(c["passed"] for c in doc["checks"])
        return s.summarize(doc, "required")

    def assertNotDelivered(self, out, refusal):
        self.assertTrue(out["resultValid"], out)
        self.assertFalse(out["delivered"])
        self.assertFalse(out["overallPassed"])
        self.assertIn(refusal, out["deliveryRefusals"])

    def test_a_clean_required_run_is_the_delivery(self):
        out = self.required()
        self.assertEqual((out["delivered"], out["deliveryRefusals"], out["overallPassed"]), (True, [], True))

    def test_reduced_scope_keeps_its_verdict_but_is_never_delivery(self):
        out = s.summarize(report(), "none")
        self.assertTrue(out["overallPassed"])
        self.assertEqual((out["delivered"], out["deliveryRefusals"]), (False, ["REDUCED_SCOPE"]))
        doc = report()
        doc["proofSource"] = "in-job"
        by_id(doc, "offline-proof-index").update(passed=True, applicable=True)
        self.assertFalse(s.summarize(doc, "none")["delivered"])

    def test_a_reduced_scope_result_cannot_be_presented_as_required(self):
        # Its N/A history checks are illegal in required mode; a relabelled mode with otherwise legal checks is inconsistent.
        relabelled = report("required")
        relabelled["historyMode"] = "none"
        for doc, error in ((report(), "RESULT_ILLEGAL_APPLICABILITY"), (relabelled, "RESULT_INCONSISTENT")):
            out = s.summarize(doc, "required")
            self.assertEqual(out.get("error"), error)
            self.assertFalse(out["delivered"] or out["overallPassed"])

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

    def test_an_empty_suite_is_refused(self):
        self.assertNotDelivered(self.required(output="Ran 0 tests in 0.000s\n\nOK\n"), "COUNTS_EMPTY:package-unit-tests")
        # A real run with nothing to run prints "NO TESTS RAN": no parseable count, so it is refused too.
        output = real_unittest("import unittest\n")
        self.assertNotDelivered(self.required(output=output), "COUNTS_MISSING:package-unit-tests")

    def test_a_failed_check_is_named_in_the_refusals(self):
        doc = report("required")
        by_id(doc, "harness-verified")["passed"] = False
        doc["passed"] = False
        self.assertNotDelivered(s.summarize(doc, "required"), "FAILED:harness-verified")


if __name__ == "__main__":
    unittest.main()
