"""Consultant P1-2: the workflow log names why each selected case ended, from closed values only. A FAIL, a NOT RUN and a setup stop each
print their closed reason on one line; free text, paths, tokens and unlisted ids never reach the log."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

from _fixtures import ROOT
import init_run_inputs as I

SECRET = "eyJhbGciOiJIUzI1NiJ9.c2VjcmV0.c2ln"


def timings(cases, outcome="results", stopped=None):
    rows = [{"caseId": c, "result": "NOT SELECTED", "evidence": "not-in-selection"} for c in I.ALL_AHT]
    for c, row in cases.items():
        rows[I.ALL_AHT.index(c)] = dict(row, caseId=c)
    return {"schema": "speaksharp-case-timings-v2", "contentSafe": True, "outcome": outcome, "selectedCases": list(cases), "cases": rows,
            "stoppedAtStage": stopped, "stages": [], "timings": {}, "binding": {}, "runStarted": True, "traceScope": ""}


class CaseLogLines(unittest.TestCase):
    def test_fail_not_run_and_setup_stop_each_print_their_closed_reason(self):
        fail = {"result": "FAIL", "evidence": "bound-case-receipt", "diagnostic": {
            "stopCode": "step-error", "exitCode": 1, "firstNonPassingAssertion": {"id": "AHT-01.saved-session", "result": "FAIL"},
            "driverInterruption": {"stage": "signin-navigate", "stopReason": "guard-refused-navigation:upstream-error"},
            "guard": {"upstreamMode": "env-proxy", "proxyConfigured": False, "upstreamReasons": {"proxy-not-configured": 1}}}}
        lines = I.case_log_lines(timings({"AHT-01": fail, "AHT-02": {"result": "NOT RUN", "evidence": "run-stage-never-started"}}))
        self.assertEqual(lines[0], "RUN outcome=results stoppedAtStage=none")
        self.assertEqual(lines[1], "CASE AHT-01 FAIL codes=stop-step-error,stage-signin-navigate,guard-refused-upstream-error,"
                                   "upstream-proxy-not-configured,egress-proxy-absent first=AHT-01.saved-session evidence=bound-case-receipt")
        self.assertEqual(lines[2], "CASE AHT-02 NOT RUN codes=none first=none evidence=run-stage-never-started")
        self.assertEqual(len(lines), 3, "NOT SELECTED cases are not printed")
        setup = I.case_log_lines(timings({"AHT-01": {"result": "UNKNOWN", "evidence": "started-without-case-results"}},
                                         outcome="started-without-results", stopped="run"))
        self.assertEqual(setup, ["RUN outcome=started-without-results stoppedAtStage=run",
                                 "CASE AHT-01 UNKNOWN codes=none first=none evidence=started-without-case-results"])

    def test_free_text_paths_and_tokens_never_reach_the_log(self):
        hostile = {"result": "FAIL " + SECRET, "evidence": "/home/runner/secret " + SECRET, "diagnostic": {
            "stopCode": SECRET, "firstNonPassingAssertion": {"id": "has space " + SECRET},
            "driverInterruption": {"stage": SECRET, "stopReason": "guard-refused-navigation:" + SECRET}, "guard": {"upstreamReasons": {SECRET: 1}}}}
        lines = I.case_log_lines(timings({"AHT-01": hostile}, outcome=SECRET, stopped=SECRET))
        text = "\n".join(lines)
        self.assertNotIn(SECRET, text)
        self.assertNotIn("/home", text)
        self.assertEqual(lines, ["RUN outcome=other stoppedAtStage=other",
                                 "CASE AHT-01 other codes=none first=none evidence=none"])

    def test_the_cli_prints_the_lines_and_refuses_a_non_timings_document(self):
        with tempfile.TemporaryDirectory() as d:
            good, bad = os.path.join(d, "t.json"), os.path.join(d, "b.json")
            with open(good, "w", encoding="utf-8") as f:
                json.dump(timings({"AHT-01": {"result": "PASS", "evidence": "bound-case-receipt"}}), f)
            with open(bad, "w", encoding="utf-8") as f:
                json.dump({"schema": "other"}, f)
            script = os.path.join(ROOT, "scripts", "init_run_inputs.py")
            r = subprocess.run([sys.executable, "-I", script, "case-log", "--case-timings", good], capture_output=True, text=True)
            self.assertEqual((r.returncode, r.stdout.splitlines()),
                             (0, ["RUN outcome=results stoppedAtStage=none", "CASE AHT-01 PASS codes=none first=none evidence=bound-case-receipt"]))
            r = subprocess.run([sys.executable, "-I", script, "case-log", "--case-timings", bad], capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("case-log-input", r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
