"""a reserved run that is CANCELLED or TIMED OUT leaves no settle input, so its reservation stays open, and the failure-only
unexecuted rules refused it (unexecuted-run-not-failed / unexecuted-job-live), blocking every later dispatch. It now settles conservatively as
`terminated-capped`: every product counter at the held allocation (unknown usage charged in full, never inferred zero) plus the live job's
measured runner minutes, and the record retires the `cancelled` (or `incomplete`) attempt with that reason.

Fixtures: R10 run 42406851270's REAL GitHub run/jobs JSON and its own workflow at its head, with only the conclusions changed to the cancelled /
timed-out shapes under test (stated per test); the journal is the reserve that run really appended."""
import copy
import os
import unittest

from _fixtures import ROOT  # noqa: F401  (puts scripts/ on sys.path when this file runs alone, as full-evidence does)
import publish_latest_record as P
import unexecuted_attempt_evidence as U
from test_rejected_before_any_step import RESERVE, HEAD, RUN_ID, chain, load, workflow

HELD = {k: RESERVE["allocation"][k] for k in ("requests", "identityReads", "starts", "takes", "coachingRequests")}


def shaped(run_conclusion="cancelled", live_conclusion="cancelled", **job_conclusions):
    run, jobs = load("run-42406851270.json"), load("jobs-42406851270.json")
    run["conclusion"] = run_conclusion
    for j in jobs["jobs"]:
        if j["name"].startswith(U.LIVE_JOB_PREFIX):
            j["conclusion"] = live_conclusion
        for prefix, conclusion in job_conclusions.items():
            if j["name"].startswith(prefix):
                j["conclusion"] = conclusion
    return run, jobs


def build(run, jobs, events=None):
    return U.build_evidence(run, jobs, chain(events), workflow())


class TerminatedCapped(unittest.TestCase):
    def test_a_cancelled_run_settles_at_its_reserved_caps_never_zero(self):
        doc = build(*shaped("cancelled", "cancelled"))
        self.assertEqual((doc["accounting"], doc["failedStep"], doc["dispositionRef"]), ("terminated-capped", None, None))
        usage = {k: doc["usage"][k] for k in HELD}
        self.assertEqual(usage, HELD)
        self.assertGreaterEqual(doc["usage"]["runnerMinutes"], 1)
        digest, checked, _at = U.check_evidence(doc)
        self.assertEqual(checked, doc["usage"])

    def test_a_job_timeout_inside_a_failed_run_and_a_timed_out_run_are_both_terminated(self):
        for run_c, live_c in (("failure", "cancelled"), ("timed_out", "timed_out"), ("cancelled", "failure")):
            with self.subTest(run=run_c, live=live_c):
                doc = build(*shaped(run_c, live_c))
                self.assertEqual(doc["accounting"], "terminated-capped")
                self.assertEqual({k: doc["usage"][k] for k in HELD}, HELD)

    def test_the_real_failed_pre_run_attempt_is_unchanged(self):
        doc = build(load("run-42406851270.json"), load("jobs-42406851270.json"))
        self.assertEqual(doc["accounting"], "none")

    def test_refusals(self):
        cases = [
            (shaped("cancelled", "cancelled", **{"Reserve the run": "failure"}), None, "unexecuted-job-reserve"),
            (shaped("cancelled", "cancelled", **{"Record the attempt": "cancelled"}), None, "unexecuted-job-record"),
            (shaped("cancelled", "in_progress"), None, "unexecuted-job-live"),
        ]
        for (run, jobs), events, code in cases:
            with self.subTest(code), self.assertRaises(U.Refused) as e:
                build(run, jobs, events)
            self.assertEqual(str(e.exception), code)
        run, jobs = shaped("cancelled", "cancelled")
        run["status"] = "in_progress"
        with self.assertRaises(U.Refused):
            build(run, jobs)
        settled = dict(RESERVE, type="settle")
        with self.assertRaises(U.Refused):                 # something already settled it: nothing is open to settle again
            build(*shaped("cancelled", "cancelled"), events=[dict(RESERVE), settled])

    def test_a_tampered_terminated_document_refuses(self):
        good = build(*shaped("cancelled", "cancelled"))
        for edit in (lambda d: d.update(accounting="none"), lambda d: d.update(accounting="capped"),
                     lambda d: d["usage"].update(starts=0), lambda d: d.update(failedStep="Stage runner (run), bounded to the selected cases' live minutes"),
                     lambda d: d.update(dispositionRef="slack:1793965143.063589")):
            doc = copy.deepcopy(good)
            edit(doc)
            with self.assertRaises(U.Refused):
                U.check_evidence(doc)


def during_cases(live_steps_cancel_at="Stage runner (run), bounded to the selected cases' live minutes"):
    """A cancellation DURING the cases: setup steps succeeded, the run stage started and was cancelled, later always steps ran."""
    run, jobs = shaped("cancelled", "cancelled")
    names = ["Set up job", "Generate the exact-head browser-bound proof and offline checks", "Prove the selected accounts' bounded first-use prerequisites",
             "Select the committed request and bind this run's inputs", "Stage runner (install-tools, plans, stimulus preflight, gates)",
             live_steps_cancel_at, "Collect, verify the binding, qualify every selected row, and project the closed record"]
    for j in jobs["jobs"]:
        if j["name"].startswith(U.LIVE_JOB_PREFIX):
            j["steps"] = [{"number": n, "name": name, "status": "completed",
                           "conclusion": "cancelled" if name == live_steps_cancel_at else "success"} for n, name in enumerate(names, 1)]
            j["started_at"], j["completed_at"] = "2026-11-07T19:34:40Z", "2026-11-07T20:30:10Z"
    return run, jobs


class TerminatedControls(unittest.TestCase):
    """a distinct conservative path, never a permissive one."""

    def refused(self, code, run, jobs, events=None):
        with self.assertRaises(U.Refused) as e:
            build(run, jobs, events)
        self.assertEqual(str(e.exception), code)

    def test_cancellation_during_cases_is_charged_the_full_held_allocation_with_measured_runner_minutes(self):
        doc = build(*during_cases())
        self.assertEqual(doc["accounting"], "terminated-capped")
        self.assertEqual({k: doc["usage"][k] for k in HELD}, HELD)           # a conservative charge, never the zero-usage path
        self.assertEqual(doc["usage"]["runnerMinutes"], 56)                   # ceil(55 m 30 s), from GitHub's job times
        zero = dict(copy.deepcopy(doc), accounting="none")
        with self.assertRaises(U.Refused):
            U.check_evidence(zero)

    def test_missing_steps_duplicate_live_job_active_step_or_active_run_refuse(self):
        run, jobs = during_cases()
        live = next(j for j in jobs["jobs"] if j["name"].startswith(U.LIVE_JOB_PREFIX))
        del live["steps"]
        self.refused("unexecuted-steps", run, jobs)
        run, jobs = during_cases()
        jobs["jobs"].append(copy.deepcopy(next(j for j in jobs["jobs"] if j["name"].startswith(U.LIVE_JOB_PREFIX))))
        with self.assertRaises(U.Refused):
            build(run, jobs)
        run, jobs = during_cases()
        next(j for j in jobs["jobs"] if j["name"].startswith(U.LIVE_JOB_PREFIX))["steps"][5]["status"] = "in_progress"
        self.refused("unexecuted-step-active", run, jobs)
        run, jobs = shaped("failure", "cancelled")
        run["status"] = "in_progress"                                         # a live-job conclusion alone never races an active run
        self.refused("unexecuted-run-not-completed", run, jobs)

    def test_stale_predecessor_or_replay_refuses(self):
        other = dict(RESERVE, runId="42499999999")
        self.refused("unexecuted-journal", *shaped("cancelled", "cancelled"), events=[dict(RESERVE), other])
        self.refused("unexecuted-journal", *shaped("cancelled", "cancelled"), events=[dict(RESERVE), dict(RESERVE, type="settle")])

    def test_runner_minutes_beyond_the_largest_enforced_job_bound_refuse(self):
        run, jobs = during_cases()
        next(j for j in jobs["jobs"] if j["name"].startswith(U.LIVE_JOB_PREFIX))["completed_at"] = "2026-11-08T01:15:00Z"   # 341 minutes
        self.refused("unexecuted-runner-minutes", run, jobs)


class Record(unittest.TestCase):
    def attempt(self, status):
        state = P.begin(P.parse_body(""), RUN_ID, 1, HEAD, "2026-11-07T19:34:10Z")
        return P.interrupt(state, RUN_ID, 1, status)

    def test_a_cancelled_attempt_retires_only_on_terminated_capped_evidence(self):
        doc = build(*shaped("cancelled", "cancelled"))
        state = self.attempt("cancelled")
        self.assertEqual(P.unexecuted_candidate(state, doc), RUN_ID)
        out = P.retire_unexecuted(state, doc, "a" * 64)
        self.assertIsNone(out["inProgress"])
        self.assertEqual(out["retiredAttempts"][-1]["retiredReason"], "reserved-terminated-capped")
        self.assertEqual(P.begin(out, "42500000002", 1, "b" * 40, "2026-11-08T02:00:00Z")["inProgress"]["runId"], "42500000002")
        failed = build(load("run-42406851270.json"), load("jobs-42406851270.json"))
        self.assertIsNone(P.unexecuted_candidate(state, failed))            # a cancelled attempt never retires as no-usage

    def test_an_incomplete_attempt_still_retires_on_either_evidence(self):
        state = self.attempt("incomplete")
        self.assertEqual(P.unexecuted_candidate(state, build(*shaped("failure", "cancelled"))), RUN_ID)
        self.assertEqual(P.unexecuted_candidate(state, build(load("run-42406851270.json"), load("jobs-42406851270.json"))), RUN_ID)


if __name__ == "__main__":
    unittest.main()


class LiveStepBounds(unittest.TestCase):
    """setup/proof steps relied on the job timeout, so one stalled step could consume the usable window. Every live-job step
    now has its own bound (about 2-3x its measured duration on run 42423408284, floor 2 minutes; the run stage keeps its live-minutes bound).
    A step that exceeds its bound FAILS (not cancels) the job at that step, so the unexecuted-attempt evidence names it as the failed step:
    the precise receipt, classified by the existing failure rules."""

    def test_every_live_job_step_is_bounded(self):
        import yaml
        from _fixtures import REPO
        with open(os.path.join(REPO, ".github", "workflows", "cloud-test-live.yml"), encoding="utf-8") as f:
            steps = yaml.safe_load(f)["jobs"]["live"]["steps"]
        for s in steps:
            label = s.get("name") or s.get("uses")
            bound = s.get("timeout-minutes")
            self.assertIsNotNone(bound, label)
            if isinstance(bound, int):
                self.assertTrue(1 <= bound <= 12, label)
            else:
                self.assertEqual(bound, "${{ fromJSON(steps.init.outputs.live_minutes) }}", label)
        proof = next(s for s in steps if s.get("name") == "Generate the exact-head browser-bound proof and offline checks")
        self.assertEqual(proof["timeout-minutes"], 12)          # measured 317 s on run 42423408284


class ComposedRecovery(unittest.TestCase):
    """the composed paths, not the parts."""

    def test_begin_then_killed_final_publisher_then_terminal_recovery_then_next_begin(self):
        state = P.begin(P.parse_body(""), RUN_ID, 1, HEAD, "2026-11-07T19:34:10Z")      # record-begin published `running`
        self.assertEqual(state["inProgress"]["status"], "running")                     # record-complete was killed: nothing else changed it
        self.assertIsNone(P.unexecuted_candidate(state, build(load("run-42406851270.json"), load("jobs-42406851270.json"))))
        # an ACTIVE run is never read as stopped: its evidence cannot even be built
        run, jobs = shaped("failure", "cancelled", **{"Complete or interrupt": "cancelled"})
        active = copy.deepcopy(run)
        active["status"] = "in_progress"
        with self.assertRaises(U.Refused):
            build(active, jobs)
        doc = build(run, jobs)                                                          # terminal: run and every job completed
        self.assertEqual(doc["accounting"], "terminated-capped")
        self.assertEqual(P.unexecuted_candidate(state, doc), RUN_ID)
        out = P.retire_unexecuted(state, doc, "a" * 64)
        self.assertEqual(out["retiredAttempts"][-1]["retiredReason"], "reserved-terminated-capped")
        self.assertEqual(P.begin(out, "42500000003", 1, "c" * 40, "2026-11-08T02:00:00Z")["inProgress"]["status"], "running")

    def test_runner_minutes_at_and_beyond_the_held_allocation_through_settle_and_the_writer(self):
        import manual_reservation as M
        import state_ref_writer as W
        held_minutes = RESERVE["allocation"]["runnerMinutes"]                           # 60, the R10 reservation
        for end, minutes, settles in (("2026-11-07T20:34:40Z", 60, True), ("2026-11-07T20:45:10Z", 71, False)):
            run, jobs = during_cases()
            next(j for j in jobs["jobs"] if j["name"].startswith(U.LIVE_JOB_PREFIX))["completed_at"] = end
            doc = build(run, jobs)
            digest, usage, at = U.check_evidence(doc)
            self.assertEqual(usage["runnerMinutes"], minutes)
            if settles:
                event = M.settle(dict(RESERVE), usage, digest, at)
                W.validate_event(event)
                self.assertEqual(event["allocation"]["runnerMinutes"], held_minutes)
            else:
                # the measured overage is NOT clipped or absorbed: the settle refuses at the reservation boundary (an open policy decision)
                with self.assertRaises(M.Refused) as e:
                    M.settle(dict(RESERVE), usage, digest, at)
                self.assertEqual(str(e.exception), "manual-settle-exceeds-reservation")
                self.assertGreater(minutes, held_minutes)
