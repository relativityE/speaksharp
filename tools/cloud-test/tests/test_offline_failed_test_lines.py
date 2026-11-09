"""A failed package suite names each failing test by its code identifier in the public job log (live run 42536487067 printed only
"FAIL package-unit-tests"): driven through the real suite child on a synthetic suite; never a traceback, message, subtest parameter or path."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

from _fixtures import ROOT

sys.path.insert(0, os.path.join(ROOT, "scripts"))
import run_offline_checks as C  # noqa: E402

SUITE = '''import unittest


class Sample(unittest.TestCase):
    def test_passes(self):
        self.assertTrue(True)

    def test_fails_with_a_secret_message(self):
        self.assertEqual("token=abc /opt/ci-work/private", "x")

    def test_errors(self):
        raise RuntimeError("password=hunter2")

    def test_subtest_fails(self):
        for value in ("ok", "secret-param"):
            with self.subTest(value=value):
                self.assertEqual(value, "ok")


class BrokenFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raise RuntimeError("fixture secret")

    def test_never_runs(self):
        pass
'''


class FailedTestLines(unittest.TestCase):
    def run_child(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "test_sample.py"), "w", encoding="utf-8") as f:
                f.write(SUITE)
            results = os.path.join(d, "results.json")
            r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "run_offline_checks.py"), "--suite-child", d, "--results", results],
                               capture_output=True, text=True, cwd=d)
            with open(results, encoding="utf-8") as f:
                return r, json.load(f)

    def test_each_failed_test_is_named_by_identifier_and_category_only(self):
        r, results = self.run_child()
        self.assertEqual(r.returncode, 1)
        lines = C.failed_test_lines({"id": "package-unit-tests", "passed": False, "results": results})
        self.assertEqual(sorted(lines), sorted([
            "FAILED-TEST package-unit-tests test_sample.Sample.test_fails_with_a_secret_message [failure]",
            "FAILED-TEST package-unit-tests test_sample.Sample.test_errors [error]",
            "FAILED-TEST package-unit-tests test_sample.Sample.test_subtest_fails [failure]",
            "FAILED-TEST package-unit-tests test_sample.BrokenFixture [fixture-error]"]))
        text = "\n".join(lines)
        for leak in ("token=abc", "/opt/ci-work", "hunter2", "secret-param", "fixture secret", "Traceback"):
            self.assertNotIn(leak, text)

    def test_unavailable_or_malformed_records_are_reported_without_echo(self):
        self.assertEqual(C.failed_test_lines({"id": "package-unit-tests", "passed": False, "results": None}),
                         ["FAILED-TEST package-unit-tests results unavailable"])
        forged = {"tests": [{"id": "x; rm -rf /opt/ci-work", "outcomes": ["failure"], "subtests": []}], "fixtures": [{"description": "token=abc", "outcome": "error"}]}
        self.assertEqual(C.failed_test_lines({"id": "package-unit-tests", "passed": False, "results": forged}),
                         ["FAILED-TEST package-unit-tests 2 failed test(s) with an unprintable identifier"])
        self.assertEqual(C.failed_test_lines({"id": "package-unit-tests", "passed": True, "results": {"tests": [], "fixtures": []}}), [])

    def test_main_prints_the_lines_for_a_failed_suite_check(self):
        with open(os.path.join(ROOT, "scripts", "run_offline_checks.py"), encoding="utf-8") as f:
            src = f.read()
        self.assertIn('if c["passed"] is not True and c["id"] in SUITE_DIRS:', src)
        self.assertIn("for line in failed_test_lines(c):", src)


if __name__ == "__main__":
    unittest.main()
