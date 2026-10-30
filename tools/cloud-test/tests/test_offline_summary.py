"""The public offline summary is exact and fails closed (Sam RETURN 1793373703): names, statuses and counts only."""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import summarize_offline_checks as s

UNITTEST_OK = "....\n----------------------------------------------------------------------\nRan 433 tests in 70.1s\n\nOK (skipped=5)\n"


def report(history="none"):
    reduced = history == "none"
    checks = [dict({"id": i, "passed": True}, **({"stdout": "", "stderr": UNITTEST_OK} if i == "package-unit-tests" else {}))
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
                                               "test_c (m.C.test_c)": "UNPARSED"})
        text = json.dumps(row)
        for leaked in ("SECRET-LIKE", "PRIVATE-PATH", "returned 3", "unexpected"):
            self.assertNotIn(leaked, text)

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

    def test_an_unknown_mode_is_refused(self):
        self.assertRefused(report(), "HISTORY_MODE_INVALID", "skip")


if __name__ == "__main__":
    unittest.main()
