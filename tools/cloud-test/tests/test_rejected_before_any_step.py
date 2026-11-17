"""R10 run 42406851270 (PO: a run rejected before it ran anything must never block the next one). Its live job was rejected by the credential
environment's protection rules and completed `failure` with NO steps. Two barriers made that block the next dispatch (a pre-run failure, no claimed reason, no extra fetch):
  1. unexecuted_attempt_evidence required at least one live step and a failed one, so the next record-begin refused (unexecuted-failed-step);
  2. the one-off grant tolerated zero-usage setup-failure settles only when pinned at the journal ROOT, and this grant is pinned at a later
     head (e7450f70) already carrying earlier runs' usage, so it refused (one-off-grant-checkpoint).
Real GitHub run/jobs JSON and the run's own workflow at its head are the fixtures; the journal is a real state ref on a temporary bare repo."""
import copy
import hashlib
import json
import os
import tempfile
import unittest
from unittest import mock

from _fixtures import ROOT
import accounting_rollup as R
import init_run_inputs as I
import unexecuted_attempt_evidence as U
from test_accounting_rollup import Journal, scope

FX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "unexecuted")
RUN_ID, HEAD = "42406851270", "22918b4467934cb4dd66a279e2bb8cfba17f70ae"
# the reserve this run appended (cloud-test-state, journal head 58eca9ab), exactly as GitHub's journal-reserve job wrote it
RESERVE = {"type": "reserve", "campaignId": "R10-3b040043-smoke15", "runId": RUN_ID, "attempt": 1,
           "allocation": {"requests": 3382, "identityReads": 32, "starts": 16, "takes": 16, "coachingRequests": 20, "runnerMinutes": 60},
           "provenance": "request-sha256:a194217fd1975b52abe9151b9ddbcf8ef33a88e44d6bf1792f05228e316e6f2e", "atUtc": "2026-11-07T19:34:32Z"}
ZERO = {"requests": 0, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": 0}


def load(name):
    with open(os.path.join(FX, name), encoding="utf-8") as f:
        return json.load(f)


def workflow():
    with open(os.path.join(FX, "cloud-test-live.22918b44.yml"), encoding="utf-8") as f:
        return f.read()


def chain(events=None):
    return [("1" * 40, []), ("2" * 40, [dict(RESERVE)] if events is None else events)]


def build(run=None, jobs=None):
    return U.build_evidence(run or load("run-42406851270.json"), jobs or load("jobs-42406851270.json"), chain(), workflow())


class PreRunFailure(unittest.TestCase):
    """a pre-run failure is an explicitly empty step list plus the no-runner fields of exactly this run's own job; no
    rejection reason is claimed and nothing beyond GitHub's run and jobs JSON is fetched."""

    def refused(self, code, fn, *a):
        with self.assertRaises(U.Refused) as e:
            fn(*a)
        self.assertEqual(str(e.exception), code)

    def live(self, jobs):
        return next(j for j in jobs["jobs"] if j["name"].startswith(U.LIVE_JOB_PREFIX))

    def test_the_real_run_is_a_pre_run_failure_with_zero_product_usage(self):
        live = self.live(load("jobs-42406851270.json"))
        self.assertEqual((live["conclusion"], live["steps"], live["runner_id"], live["runner_name"], live["runner_group_id"]),
                         ("failure", [], 0, "", 0))
        doc = build()
        digest, usage, at_utc = U.check_evidence(doc)
        self.assertEqual((doc["accounting"], doc["dispositionRef"], doc["failedStep"]), ("none", None, None))
        self.assertNotIn("rejection", doc)
        self.assertEqual(usage, dict(ZERO, runnerMinutes=1))
        self.assertEqual(at_utc, "2026-11-07T19:35:02Z")
        self.assertEqual(digest, hashlib.sha256(U.canon(doc)).hexdigest())
        pre = next(j for j in doc["jobs"] if j["name"].startswith(U.LIVE_JOB_PREFIX))
        self.assertEqual((pre["jobId"], pre["runnerId"], pre["runnerName"], pre["runnerGroupId"], pre["checkRunUrl"]),
                         (128506390478, 0, "", 0, "https://api.github.com/repos/relativityE/speaksharp/check-runs/128506390478"))

    def test_missing_or_non_list_steps_are_never_an_empty_list(self):
        for value in (None, False, 0, "", {}, "[]"):
            with self.subTest(value=value):
                jobs = load("jobs-42406851270.json")
                self.live(jobs)["steps"] = value
                self.refused("unexecuted-steps", build, None, jobs)
        jobs = load("jobs-42406851270.json")
        del self.live(jobs)["steps"]
        self.refused("unexecuted-steps", build, None, jobs)

    def test_an_assigned_runner_another_job_or_missing_identity_stays_unknown(self):
        for key, value in (("runner_id", 7), ("runner_id", None), ("runner_name", "GitHub Actions 7"), ("runner_group_id", 2),
                           ("runner_group_id", None), ("check_run_url", "https://api.github.com/repos/relativityE/speaksharp/check-runs/1"),
                           ("check_run_url", "https://api.github.com/repos/other/repo/check-runs/128506390478"), ("check_run_url", None),
                           ("id", None), ("id", 0)):
            with self.subTest(key=key, value=value):
                jobs = load("jobs-42406851270.json")
                self.live(jobs)[key] = value
                self.refused("unexecuted-pre-run-job", build, None, jobs)
        for key in ("runner_id", "runner_name", "runner_group_id", "check_run_url"):
            with self.subTest(missing=key):
                jobs = load("jobs-42406851270.json")
                del self.live(jobs)[key]
                self.refused("unexecuted-pre-run-job", build, None, jobs)

    def test_only_a_completed_failed_live_job_takes_this_path_and_no_step_or_reason_is_synthesized(self):
        jobs = load("jobs-42406851270.json")
        self.live(jobs)["conclusion"] = "success"
        self.refused("unexecuted-job-live", build, None, jobs)
        for conclusion in ("cancelled", "timed_out"):                    # settled at the reserved caps, never as this zero-usage path
            jobs = load("jobs-42406851270.json")
            self.live(jobs)["conclusion"] = conclusion
            self.assertEqual(build(None, jobs)["accounting"], "terminated-capped")
        doc = build()
        self.refused("unexecuted-pre-run", U.check_evidence, dict(doc, failedStep="Set up job"))
        self.refused("unexecuted-shape", U.check_evidence, dict(doc, rejection={"reason": "environment"}))
        self.refused("unexecuted-accounting", U.check_evidence, dict(doc, accounting="preflight-bound"))
        self.refused("unexecuted-credential-steps", U.check_evidence, dict(doc, credentialSteps=[]))
        for value in ({}, "", None, False, 0, "[]", ()):                     # the validator itself re-checks the step list's TYPE
            with self.subTest(steps=value):
                tampered = copy.deepcopy(doc)
                next(j for j in tampered["jobs"] if j["name"].startswith(U.LIVE_JOB_PREFIX))["steps"] = value
                self.refused("unexecuted-steps", U.check_evidence, tampered)
        tampered = copy.deepcopy(doc)
        del next(j for j in tampered["jobs"] if j["name"].startswith(U.LIVE_JOB_PREFIX))["steps"]
        self.assertRaises(U.Refused, U.check_evidence, tampered)
        tampered = copy.deepcopy(doc)                                       # the no-runner fields are re-verified, not trusted
        next(j for j in tampered["jobs"] if j["name"].startswith(U.LIVE_JOB_PREFIX))["runnerId"] = 3
        self.refused("unexecuted-pre-run-job", U.check_evidence, tampered)

    def test_documents_with_steps_are_unchanged(self):
        import test_unexecuted_attempt_evidence as T
        doc = T.build()
        self.assertNotIn("jobId", next(j for j in doc["jobs"] if j["name"].startswith(U.LIVE_JOB_PREFIX)))
        self.assertEqual(hashlib.sha256(U.canon(doc)).hexdigest(), T.DIGEST)
        tampered = copy.deepcopy(doc)                                       # a document with steps may not carry the pre-run fields
        next(j for j in tampered["jobs"] if j["name"].startswith(U.LIVE_JOB_PREFIX)).update(jobId=1, runnerId=0, runnerName="", runnerGroupId=0,
                                                                                         checkRunUrl=U.CHECK_RUN_URL % 1)
        self.refused("unexecuted-pre-run-job", U.check_evidence, tampered)

    def test_the_record_retires_it_and_the_next_begin_opens(self):
        import publish_latest_record as P
        running = P.begin(P.parse_body(""), RUN_ID, 1, HEAD, "2026-11-07T19:34:10Z")
        incomplete = P.interrupt(running, RUN_ID, 1, "incomplete")
        doc = build()
        self.assertEqual(P.unexecuted_candidate(incomplete, doc), RUN_ID)
        retired = P.retire_unexecuted(incomplete, doc, hashlib.sha256(P.render(incomplete).encode()).hexdigest())
        self.assertIsNone(retired["inProgress"])
        self.assertEqual(P.begin(retired, "42499999999", 1, "3" * 40, "2026-11-07T21:00:00Z")["inProgress"]["status"], "running")

    def test_record_begin_fetches_nothing_beyond_the_run_and_jobs_json(self):
        wf = open(os.path.join(ROOT, "..", "..", ".github", "workflows", "cloud-test-live.yml"), encoding="utf-8").read()
        self.assertNotIn("curl ", wf)
        self.assertNotIn("annotations", wf)
        self.assertIn('unexecuted_attempt_evidence.py collect --run "$RUNNER_TEMP/unexecuted-run.json"', wf)


class GrantPinnedPastRoot(Journal):
    """The grant pinned at a later head admits a checkpoint past it only for zero-usage setup-failure pairs, recomputed from the rollup."""

    def setUp(self):
        super().setUp()
        self.append("reserve", "41000000001", dict(requests=500, identityReads=4, starts=2, takes=2, coachingRequests=1, runnerMinutes=30))
        self.append("settle", "41000000001", dict(requests=400, identityReads=4, starts=2, takes=1, coachingRequests=1, runnerMinutes=20),
                    provenance="request-sha256:" + "a" * 64)
        self.pinned = self.chain()[-1][0]                      # a later head that already carries an executed run's usage
        self.sc = scope()
        self.repo_dir = tempfile.mkdtemp(dir=self.d)
        os.makedirs(os.path.join(self.repo_dir, I.CONTINUITY_DIR))
        with open(os.path.join(self.repo_dir, I.CONTINUITY_DIR, I.CONTINUITY_BOOTSTRAP), "wb") as f:
            f.write(self.raw)
        patches = mock.patch.multiple(R, ACCEPTED_ROOT=self.root, ACCEPTED_BOOTSTRAP_SHA256=hashlib.sha256(self.raw).hexdigest())
        patches.start()
        self.addCleanup(patches.stop)

    def admits(self):
        ch = self.chain()
        cp = json.loads(R.checkpoint_bytes(R.receive(self.raw, self.sc, ch)))
        return I._setup_failures_since_pin(cp, {"preReserveStateHead": self.pinned}, ch, self.repo_dir, self.sc), cp, ch

    def rejected_run(self, run="42406851270", settle=None, provenance="evidence-sha256:" + "6" * 64):
        self.append("reserve", run, dict(requests=3382, identityReads=32, starts=16, takes=16, coachingRequests=20, runnerMinutes=60))
        if settle is not False:
            self.append("settle", run, dict(ZERO, runnerMinutes=1) if settle is None else settle, provenance=provenance)

    def test_a_zero_usage_reserve_settle_pair_past_the_pin_admits(self):
        self.rejected_run()
        ok, cp, _ = self.admits()
        self.assertTrue(ok)
        self.rejected_run("42406851271")                       # two such pairs are still not an executed attempt
        self.assertTrue(self.admits()[0])

    def test_the_pinned_head_itself_and_the_root_path_are_unchanged(self):
        self.assertFalse(self.admits()[0])                     # nothing past the pin: the ordinary equality check governs
        ch = self.chain()
        cp = json.loads(R.checkpoint_bytes(R.receive(self.raw, self.sc, ch)))
        self.assertFalse(I._setup_failures_since_pin(cp, {"preReserveStateHead": self.root}, ch, self.repo_dir, self.sc))

    def test_any_product_usage_an_open_reserve_or_a_release_refuses(self):
        for name, settle in (("identity read", dict(ZERO, identityReads=1, runnerMinutes=1)), ("start", dict(ZERO, starts=1, runnerMinutes=1)),
                             ("take", dict(ZERO, takes=1, runnerMinutes=1)), ("coaching", dict(ZERO, coachingRequests=1, runnerMinutes=1)),
                             ("requests over the preflight bound", dict(ZERO, requests=11, runnerMinutes=1))):
            with self.subTest(name):
                self.setUp()
                self.rejected_run(settle=settle)
                self.assertFalse(self.admits()[0])
        self.setUp()
        self.rejected_run(settle=False)                        # reserved, never settled: open
        self.assertFalse(self.admits()[0])
        self.setUp()
        self.rejected_run(provenance="request-sha256:" + "6" * 64)  # settled from its request/record (executed), not from evidence
        self.assertFalse(self.admits()[0])

    def test_a_checkpoint_that_is_not_the_recomputed_rollup_refuses(self):
        self.rejected_run()
        ok, cp, ch = self.admits()
        self.assertTrue(ok)
        for key in ("requests", "identityReads", "runnerMinutes"):
            bad = copy.deepcopy(cp)
            bad["period"][key] -= 1
            self.assertFalse(I._setup_failures_since_pin(bad, {"preReserveStateHead": self.pinned}, ch, self.repo_dir, self.sc), key)
        for over in ({"outstandingReservations": 1}, {"root": "f" * 40}, {"headSha": "f" * 40}, {"unknown": {"runnerMinutes": True}}):
            self.assertFalse(I._setup_failures_since_pin(dict(cp, **over), {"preReserveStateHead": self.pinned}, ch, self.repo_dir, self.sc), over)
        self.assertFalse(I._setup_failures_since_pin(cp, {"preReserveStateHead": "e" * 40}, ch, self.repo_dir, self.sc))   # pin not on chain


if __name__ == "__main__":
    unittest.main()
