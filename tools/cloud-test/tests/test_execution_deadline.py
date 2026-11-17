""", design (a): one execution deadline per run. init computes it once (init time + live minutes - the
stage exit reserve, never past the occurrence end); the plan (BP_T1), guard policy, admission and producer scope all bind that value; the
window check immediately before the run step refuses a deadline later than the step's kill. Missing or malformed input refuses.
Real workflow timing is run 42386714252 (Actions job steps): occurrence 15:30:36Z-16:50:36Z, init 15:37:42Z, run step 15:39:02Z, 40 live minutes.
It is a runtime safety bound, not a calendar window: the occurrence is unchanged and nothing is extended."""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from _fixtures import ROOT, J, reconciliation, wjson
from _common import sha256_file
import init_run_inputs as I


def at(v):
    return datetime.strptime(v, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


OCCURRENCE = {"startUtc": "2026-11-07T15:30:36Z", "endUtc": "2026-11-07T16:50:36Z"}
INIT, RUN_STEP, LIVE = at("2026-11-07T15:37:42Z"), at("2026-11-07T15:39:02Z"), 40
KILL = RUN_STEP + timedelta(minutes=LIVE)


def request(window=OCCURRENCE):
    return {"window": dict(window)}


def refused(case, code, fn, *args):
    with case.assertRaises(I.Refused) as e:
        fn(*args)
    case.assertEqual(str(e.exception), code)


class RealWorkflowTiming(unittest.TestCase):
    def test_the_one_deadline_precedes_the_run_step_kill_with_the_exit_reserve(self):
        d = I.execution_deadline(request(), INIT, LIVE)
        self.assertEqual(d, "2026-11-07T16:16:42Z")
        self.assertLessEqual(at(d), KILL - timedelta(seconds=I.RUN_STAGE_EXIT_RESERVE_SECONDS))
        self.assertLess(at(d), at(OCCURRENCE["endUtc"]))
        # The gap this closes: the previous plan deadline was the occurrence end, 31.5 minutes after the step kill.
        self.assertEqual(at(OCCURRENCE["endUtc"]) - KILL, timedelta(minutes=31, seconds=34))

    def test_the_window_check_immediately_before_the_run_step_admits_it_and_refuses_the_occurrence_end(self):
        d = I.execution_deadline(request(), INIT, LIVE)
        I.check_execution_deadline(request(), RUN_STEP, LIVE, d)
        refused(self, "execution-deadline-after-step-kill", I.check_execution_deadline, request(), RUN_STEP, LIVE, OCCURRENCE["endUtc"])

    def test_bounded_by_the_occurrence_end_and_never_open_after_it(self):
        end = at(OCCURRENCE["endUtc"])
        self.assertEqual(I.execution_deadline(request(), end - timedelta(minutes=20), LIVE), OCCURRENCE["endUtc"])
        refused(self, "execution-deadline-not-open", I.execution_deadline, request(), end, LIVE)
        refused(self, "execution-deadline-not-open", I.execution_deadline, request(), at(OCCURRENCE["startUtc"]) - timedelta(seconds=1), LIVE)
        refused(self, "live-minutes", I.execution_deadline, request(), INIT, 0)

    def test_the_window_check_fails_closed(self):
        d = I.execution_deadline(request(), INIT, LIVE)
        for bad in (None, "", "soon", "2026-11-07T16:16:42.000Z", "2026-11-07 16:16:42Z"):
            refused(self, "execution-deadline-missing", I.check_execution_deadline, request(), RUN_STEP, LIVE, bad)
        refused(self, "execution-deadline-outside-occurrence", I.check_execution_deadline, request(), RUN_STEP, LIVE, OCCURRENCE["startUtc"])
        refused(self, "execution-deadline-outside-occurrence", I.check_execution_deadline, request(), RUN_STEP, LIVE, "2026-11-07T16:50:37Z")
        refused(self, "execution-deadline-passed", I.check_execution_deadline, request(), at(d), LIVE, d)
        refused(self, "live-minutes", I.check_execution_deadline, request(), RUN_STEP, 0, d)


class PlanEnvironment(unittest.TestCase):
    """The REAL run_env.py: BP_T1 is exactly the supplied execution deadline; absent, malformed or outside the occurrence refuses."""

    def run_env(self, deadline_args):
        req = J("config", "runs", "R7-full-coverage-proposal.json")
        req["approvedLimits"] = {"cumulativeCeilingRequests": 10535, "identityCap": 126, "startsCap": 85, "takesCap": 55,
                                 "runCapRequests": 4310, "startPressCaps": copy.deepcopy(req["proposedLimits"]["startPressCaps"]),
                                 "approvalRef": "o", "approvedBy": "o"}
        req["window"] = {"startUtc": "2026-10-29T02:00:00Z", "endUtc": "2026-10-29T07:30:00Z", "approvalRef": "o"}
        req["selectionApprovalRef"] = "o"
        req["release"]["backend"]["verifiedAtUtc"] = "2026-10-29T00:00:00Z"
        with tempfile.TemporaryDirectory() as d:
            d = os.path.realpath(d)
            p, rc, o = os.path.join(d, "r.json"), os.path.join(d, "reconciliation.json"), os.path.join(d, "env.txt")
            wjson(p, req)
            wjson(rc, reconciliation())
            r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "run_env.py"), "--request", p, "--request-sha256", sha256_file(p),
                                "--reconciliation", rc, *deadline_args, "--out", o], capture_output=True, text=True)
            return r, (dict(l.split("=", 1) for l in open(o).read().splitlines()) if os.path.exists(o) else {})

    def test_bp_t1_is_the_execution_deadline(self):
        r, env = self.run_env(["--execution-deadline", "2026-10-29T03:09:00Z"])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual((env["BP_T0"], env["BP_T1"]), ("2026-10-29T02:00:00Z", "2026-10-29T03:09:00Z"))

    def test_missing_malformed_or_outside_refuses(self):
        r, env = self.run_env([])
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(env, {})
        for bad in ("", "soon", "2026-10-29T03:09:00.000Z", "2026-10-29T02:00:00Z", "2026-10-29T07:30:01Z"):
            r, env = self.run_env(["--execution-deadline", bad])
            self.assertNotEqual(r.returncode, 0, bad)
            self.assertIn("execution deadline is missing, malformed or outside the occurrence", r.stderr)
            self.assertEqual(env, {})


class Wiring(unittest.TestCase):
    def test_execute_run_refuses_plan_construction_without_the_deadline(self):
        text = open(os.path.join(ROOT, "scripts", "execute_run.sh"), encoding="utf-8").read()
        self.assertIn('[ -n "${CT_EXECUTION_DEADLINE:-}" ] || blocked "CT_EXECUTION_DEADLINE (the run\'s one execution deadline) is required"', text)
        self.assertIn('--execution-deadline "$CT_EXECUTION_DEADLINE"', text)
        self.assertNotIn("run-step-deadline", text)

    def test_init_publishes_the_deadline_as_a_step_output_and_the_scope_carries_it(self):
        text = open(os.path.join(ROOT, "scripts", "init_run_inputs.py"), encoding="utf-8").read()
        self.assertIn('f.write("execution_deadline=%s\\n" % p["executionDeadline"])', text)
        self.assertIn('"deadlineAt": deadline,', text)
        self.assertNotIn('"deadlineAt": w["endUtc"]', text)


if __name__ == "__main__":
    unittest.main()
