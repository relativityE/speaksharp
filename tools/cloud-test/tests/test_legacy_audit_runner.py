"""The historical-audit runner never reports PASS without executing exactly its whole suite, cleanly, on the retained history (Sam 1793405092)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from _fixtures import ROOT
import run_legacy_audit as L


def suite(output, passed=True):
    return {"id": "legacy-audit-tests", "passed": passed, "stdout": "", "stderr": output}


class LegacyAuditJudgement(unittest.TestCase):
    def test_the_exact_clean_suite_is_the_only_pass(self):
        self.assertEqual(L.audit_suite_judgement(suite("Ran %d tests in 5.0s\n\nOK\n" % L.AUDIT_TESTS))[0], True)

    def test_short_skipped_empty_or_ambiguous_discovery_is_never_a_pass(self):
        for output in ("Ran %d tests in 5.0s\n\nOK\n" % (L.AUDIT_TESTS - 3), "Ran %d tests in 5.0s\n\nOK (skipped=1)\n" % L.AUDIT_TESTS,
                       "Ran 0 tests in 0.000s\n\nOK\n", "\nNO TESTS RAN\n", "", "Ran %d tests in 5.0s\n\nOK\nRan 1 test in 1.0s\n" % L.AUDIT_TESTS):
            self.assertFalse(L.audit_suite_judgement(suite(output))[0], output)

    def test_the_constant_equals_the_audit_test_methods_on_disk(self):
        import ast
        d = os.path.join(ROOT, "tests", "legacy_audit")
        n = sum(1 for f in os.listdir(d) if f.startswith("audit_") and f.endswith(".py")
                for x in ast.walk(ast.parse(open(os.path.join(d, f), encoding="utf-8").read()))
                if isinstance(x, ast.FunctionDef) and x.name.startswith("test_"))
        self.assertEqual(n, L.AUDIT_TESTS)

    def test_the_current_suite_never_collects_the_audit_suite(self):
        names = [f for f in os.listdir(os.path.join(ROOT, "tests", "legacy_audit"))]
        self.assertNotIn("__init__.py", names)
        self.assertFalse([f for f in names if f.startswith("test_")])

    def test_without_the_retained_history_nothing_is_executed_and_nothing_passes(self):
        out = os.path.join(tempfile.mkdtemp(), "audit.json")
        with mock.patch.object(L, "present", return_value=False), mock.patch.object(sys, "argv", ["run_legacy_audit.py", "--out", out]):
            self.assertEqual(L.main(), 3)
        doc = json.load(open(out))
        self.assertEqual((doc["executed"], doc["passed"], doc["currentExecutionCredit"], doc["provenance"]), (False, False, False, "historical"))
        self.assertTrue(all(c["passed"] is None for c in doc["checks"]))

    def test_missing_analyst_inputs_make_the_audit_incomplete_never_pass(self):
        out = os.path.join(tempfile.mkdtemp(), "audit.json")
        ok = subprocess.CompletedProcess([], 0, "", "Ran %d tests in 5.0s\n\nOK\n" % L.AUDIT_TESTS)
        with mock.patch.object(L, "present", return_value=True), mock.patch.object(L.subprocess, "run", return_value=ok), \
                mock.patch.object(L, "analyst_inputs_missing", return_value=["config/history/analysis/R5-vs-R4C.facts.json"]), \
                mock.patch.object(sys, "argv", ["run_legacy_audit.py", "--out", out]):
            self.assertEqual(L.main(), 3)
        doc = json.load(open(out))
        self.assertFalse(doc["passed"])
        self.assertTrue(doc["status"].startswith("INCOMPLETE"))


if __name__ == "__main__":
    unittest.main()
