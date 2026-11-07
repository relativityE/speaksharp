"""R10 run 42406851270 (PO: a run rejected before it ran anything must never block the next one). Its live job was rejected by the credential
environment's protection rules and completed `failure` with NO steps. Two barriers made that block the next dispatch:
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


def build(run=None, jobs=None, annotations=False):
    return U.build_evidence(run or load("run-42406851270.json"), jobs or load("jobs-42406851270.json"), chain(), workflow(),
                            load("annotations-128506390478.json") if annotations is False else annotations)


class RejectedBeforeAnyStep(unittest.TestCase):
    def refused(self, code, fn, *a):
        with self.assertRaises(U.Refused) as e:
            fn(*a)
        self.assertEqual(str(e.exception), code)

    def live(self, jobs):
        return next(j for j in jobs["jobs"] if j["name"].startswith(U.LIVE_JOB_PREFIX))

    def test_the_real_rejected_run_is_not_executed_with_zero_product_usage(self):
        live = self.live(load("jobs-42406851270.json"))
        self.assertEqual((live["conclusion"], live["steps"], live["runner_id"], live["runner_name"]), ("failure", [], 0, ""))
        doc = build()
        digest, usage, at_utc = U.check_evidence(doc)
        self.assertEqual((doc["accounting"], doc["dispositionRef"], doc["failedStep"]), ("none", None, None))
        self.assertEqual(doc["rejection"]["environment"], "trusted-main-credentials")
        self.assertEqual((doc["rejection"]["headBranch"], doc["rejection"]["checkRunId"]), ("elon/r10-preflight-traffic-class", 128506390478))
        self.assertEqual(usage, dict(ZERO, runnerMinutes=1))
        self.assertEqual(at_utc, "2026-11-07T19:35:02Z")
        self.assertEqual(digest, hashlib.sha256(U.canon(doc)).hexdigest())
        self.assertEqual(U.rejected_check_run(load("jobs-42406851270.json")), 128506390478)

    def test_missing_or_non_list_steps_are_never_an_empty_list(self):
        for value in (None, False, 0, "", {}, "[]"):
            jobs = load("jobs-42406851270.json")
            self.live(jobs)["steps"] = value
            self.refused("unexecuted-steps", build, None, jobs)
            self.refused("unexecuted-steps", U.rejected_check_run, jobs)
        jobs = load("jobs-42406851270.json")
        del self.live(jobs)["steps"]
        self.refused("unexecuted-steps", build, None, jobs)

    def test_an_assigned_runner_or_another_check_run_refuses(self):
        for key, value in (("runner_id", 7), ("runner_name", "GitHub Actions 7"), ("runner_group_id", 2),
                           ("check_run_url", "https://api.github.com/repos/relativityE/speaksharp/check-runs/1"),
                           ("check_run_url", "https://api.github.com/repos/other/repo/check-runs/128506390478"), ("check_run_url", None)):
            with self.subTest(key=key, value=value):
                jobs = load("jobs-42406851270.json")
                self.live(jobs)[key] = value
                self.refused("unexecuted-rejection-job", build, None, jobs)
        jobs = load("jobs-42406851270.json")
        self.live(jobs)["runner_id"] = 7
        self.assertIsNone(U.rejected_check_run(jobs))           # record-begin fetches no annotations for an allocated runner

    def test_the_annotations_must_be_githubs_exact_rejection_of_this_branch_and_environment(self):
        real = load("annotations-128506390478.json")
        self.refused("unexecuted-annotations", build, None, None, None)
        cases = {"one missing": real[:1], "none": [], "other branch": [dict(real[0], message=real[0]["message"].replace("elon/", "main-"))] + real[1:],
                 "other environment": [dict(real[0], message=real[0]["message"].replace("trusted-main-credentials", "x"))] + real[1:],
                 "warning level": [dict(real[0], annotation_level="warning")] + real[1:],
                 "an unrelated failure": [dict(real[0], message="Process completed with exit code 1.")] + real[1:]}
        for name, annotations in cases.items():
            with self.subTest(name):
                with self.assertRaises(U.Refused) as e:
                    U.build_evidence(load("run-42406851270.json"), load("jobs-42406851270.json"), chain(), workflow(), annotations)
                self.assertIn(str(e.exception), ("unexecuted-rejection", "unexecuted-shape"))
        with self.assertRaises(U.Refused) as e:                  # the run's own workflow names the live environment
            U.build_evidence(load("run-42406851270.json"), load("jobs-42406851270.json"), chain(),
                             workflow().replace("environment: trusted-main-credentials", "environment: other-env"), real)
        self.assertEqual(str(e.exception), "unexecuted-rejection")
        with self.assertRaises(U.Refused) as e:
            U.build_evidence(dict(load("run-42406851270.json"), head_branch="main"), load("jobs-42406851270.json"), chain(), workflow(), real)
        self.assertEqual(str(e.exception), "unexecuted-rejection")

    def test_only_a_completed_failed_live_job_takes_this_path_and_no_step_is_synthesized(self):
        for conclusion in ("cancelled", "success", "timed_out"):
            jobs = load("jobs-42406851270.json")
            self.live(jobs)["conclusion"] = conclusion
            self.refused("unexecuted-job-live", build, None, jobs)
        jobs = load("jobs-42406851270.json")                     # a step that ran is the ordinary path: annotations are refused there
        self.live(jobs)["steps"] = [{"number": 1, "name": "Set up job", "status": "completed", "conclusion": "success"}]
        self.refused("unexecuted-annotations", build, None, jobs)
        doc = build()
        self.refused("unexecuted-rejection", U.check_evidence, dict(doc, failedStep="Set up job"))
        self.refused("unexecuted-shape", U.check_evidence, {k: v for k, v in doc.items() if k != "rejection"})
        self.refused("unexecuted-rejection", U.check_evidence, dict(doc, rejection=dict(doc["rejection"], checkRunId=1)))
        self.refused("unexecuted-accounting", U.check_evidence, dict(doc, accounting="preflight-bound"))
        self.refused("unexecuted-credential-steps", U.check_evidence, dict(doc, credentialSteps=[]))

    def test_documents_with_steps_are_unchanged(self):
        import test_unexecuted_attempt_evidence as T
        doc = T.build()
        self.assertNotIn("rejection", doc)
        self.assertEqual(hashlib.sha256(U.canon(doc)).hexdigest(), T.DIGEST)

    def test_the_record_retires_it_and_the_next_begin_opens(self):
        import publish_latest_record as P
        running = P.begin(P.parse_body(""), RUN_ID, 1, HEAD, "2026-11-07T19:34:10Z")
        incomplete = P.interrupt(running, RUN_ID, 1, "incomplete")
        doc = build()
        self.assertEqual(P.unexecuted_candidate(incomplete, doc), RUN_ID)
        retired = P.retire_unexecuted(incomplete, doc, hashlib.sha256(P.render(incomplete).encode()).hexdigest())
        self.assertIsNone(retired["inProgress"])
        self.assertEqual(P.begin(retired, "42499999999", 1, "3" * 40, "2026-11-07T21:00:00Z")["inProgress"]["status"], "running")

    def test_record_begin_fetches_the_rejection_annotations_with_no_credential(self):
        """The REAL record-begin snippet (this head's workflow), offline: the real rejected-check-run decides the fetch; a stub curl stands in
        for GitHub's public API and records its arguments; the collector invocation is recorded (its rules are exercised above)."""
        wf = open(os.path.join(ROOT, "..", "..", ".github", "workflows", "cloud-test-live.yml"), encoding="utf-8").read()
        start = wf.index("              annotation_args=()")
        end = wf.index('--out "$RUNNER_TEMP/unexecuted-evidence.json"', start) + len('--out "$RUNNER_TEMP/unexecuted-evidence.json"')
        snippet = "\n".join(line[14:] for line in wf[start:end].split("\n"))
        self.assertIn("curl --fail --silent --show-error --proto '=https'", snippet)
        self.assertNotIn("Authorization", snippet)
        self.assertNotIn("GH_TOKEN", snippet)
        with tempfile.TemporaryDirectory() as d:
            d = os.path.realpath(d)
            stub = os.path.join(d, "bin"); os.mkdir(stub)
            real_python = __import__("sys").executable
            with open(os.path.join(stub, "curl"), "w") as f:
                f.write('#!/bin/sh\nprintf "%%s\\n" "$@" > "%s/curl.args"\nenv > "%s/curl.env"\ncat "%s"\n'
                        % (d, d, os.path.join(FX, "annotations-128506390478.json")))
            with open(os.path.join(stub, "python3"), "w") as f:     # the real interpreter, except the journal-reading collect is recorded
                f.write('#!/bin/sh\nfor a in "$@"; do [ "$a" = collect ] && { printf "%%s\\n" "$@" > "%s/collect.args"; exit 0; }; done\n'
                        'exec "%s" "$@"\n' % (d, real_python))
            for n in ("curl", "python3"):
                os.chmod(os.path.join(stub, n), 0o755)
            import shutil
            shutil.copy(os.path.join(FX, "jobs-42406851270.json"), os.path.join(d, "unexecuted-jobs.json"))
            env = {"PATH": stub + ":/usr/bin:/bin", "RUNNER_TEMP": d, "GITHUB_REPOSITORY": "relativityE/speaksharp", "HOME": d}
            r = __import__("subprocess").run(["bash", "-c", "set -euo pipefail\n" + snippet], cwd=os.path.join(ROOT, "..", ".."),
                                             capture_output=True, text=True, env=env)
            self.assertEqual(r.returncode, 0, r.stderr)
            curl = open(os.path.join(d, "curl.args")).read().split("\n")
            self.assertIn("https://api.github.com/repos/relativityE/speaksharp/check-runs/128506390478/annotations", curl)
            self.assertFalse([a for a in curl if "uthorization" in a or "token" in a.lower()])
            self.assertNotIn("GH_TOKEN", open(os.path.join(d, "curl.env")).read())
            collect = open(os.path.join(d, "collect.args")).read().split("\n")
            self.assertEqual(collect[collect.index("--annotations") + 1], os.path.join(d, "unexecuted-annotations.json"))
            self.assertEqual(json.load(open(os.path.join(d, "unexecuted-annotations.json"))), load("annotations-128506390478.json"))
            # a job that ran steps: no fetch, no --annotations
            os.remove(os.path.join(d, "curl.args"))
            jobs = load("jobs-42406851270.json")
            self.live(jobs)["steps"] = [{"number": 1, "name": "Set up job", "status": "completed", "conclusion": "failure"}]
            json.dump(jobs, open(os.path.join(d, "unexecuted-jobs.json"), "w"))
            r = __import__("subprocess").run(["bash", "-c", "set -euo pipefail\n" + snippet], cwd=os.path.join(ROOT, "..", ".."),
                                             capture_output=True, text=True, env=env)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertFalse(os.path.exists(os.path.join(d, "curl.args")))
            self.assertNotIn("--annotations", open(os.path.join(d, "collect.args")).read())


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
