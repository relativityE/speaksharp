"""Evidence that the reserved attempt of run 41960376782 did not execute (unexecuted_attempt_evidence.py). Real data: GitHub's run and jobs JSON for
that run (trimmed to the fields used, tests/fixtures/unexecuted), the workflow AT its head, and the journal's real shas and reserve event. Every
negative control changes one fact and must refuse with its own code; the evidence document is deterministic and tamper-evident."""
import copy
import hashlib
import json
import os
import subprocess
import sys
import unittest

from _fixtures import ROOT
import unexecuted_attempt_evidence as U

FX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "unexecuted")
RUN_ID = "41960376782"
HEAD = "8f9f9451bb6bf37ba2bca524acd92d933e2b826c"
ROOT_SHA = "92d6ebf902351750c368d7d513116c6b1f19f80c"
LIVE = "Selected live journeys (existing stage runner; preinstalled browser)"
DIGEST = "81a1dcb7f10903d73f5b812eb20d5f2ff610c08904b1774ea8223389125d078c"
# The known facts of run 41960376782 (no longer a pin in the module, Sam 1793881491.714239): the journal head and reserve event as appended, the
# step it failed at, and the credential-bearing steps of its workflow at its head.
PIN = {"attempt": 1, "headSha": HEAD, "failedStep": "Generate the exact-head browser-bound proof and offline checks",
       "journalHeadSha": "0909b53ff6dc767105633ddc14db520c762dff64",
       "reserved": {"type": "reserve", "campaignId": "R10-3b040043-smoke15", "runId": RUN_ID, "attempt": 1,
                    "allocation": {"requests": 2032, "identityReads": 32, "starts": 16, "takes": 16, "coachingRequests": 20, "runnerMinutes": 40},
                    "provenance": "request-sha256:c7e6698a9c9aeb09504a83bff2078a1d41478943067f1084f39a901cdd2cc4ee", "atUtc": "2026-11-05T03:15:17Z"},
       "credentialSteps": [[LIVE, "Prove the selected accounts' bounded first-use prerequisites"],
                           [LIVE, "Select the committed request and bind this run's inputs"],
                           [LIVE, "Stage runner (install-tools, plans, stimulus preflight, gates)"],
                           [LIVE, "Stage runner (run), bounded to the selected cases' live minutes"]]}


def load(name):
    with open(os.path.join(FX, name), encoding="utf-8") as f:
        return json.load(f)


def chain(head=None, events=None):
    """The validated chain's shape: [(sha, events-so-far, ...)], genesis then the reserve."""
    return [(ROOT_SHA, []), (head or PIN["journalHeadSha"], [dict(PIN["reserved"])] if events is None else events)]


def workflow():
    with open(os.path.join(FX, "cloud-test-live.8f9f9451.yml"), encoding="utf-8") as f:
        return f.read()


def build(run=None, jobs=None, ch=None, wf=None):
    return U.build_evidence(run or load("run-41960376782.json"), jobs or load("jobs-41960376782.json"), ch or chain(), wf or workflow())


class Evidence(unittest.TestCase):
    def test_the_pending_probe_is_keyed_on_the_journal_not_the_record(self):
        # Sam 1793881260.206739 / 1793881491.714239: the run whose reserve is the journal's open last event is pending, whatever the record says
        self.assertEqual(U.pending_run(chain()), RUN_ID)
        self.assertEqual(U.pending_run(chain(head="e" * 40, events=[dict(PIN["reserved"]), {"type": "settle", "runId": RUN_ID},
                                                                    dict(PIN["reserved"], runId="41999999998")])), "41999999998")
        settle = {"type": "settle", "runId": RUN_ID}
        for other in (chain(events=[dict(PIN["reserved"]), settle]), [(ROOT_SHA, [])], chain(events=[]),
                      chain(events=[dict(PIN["reserved"]), {"type": "release", "runId": RUN_ID}])):
            self.assertIsNone(U.pending_run(other))
        with self.assertRaises(U.Refused):
            U.pending_run([])

    def refused(self, code, fn, *a):
        with self.assertRaises(U.Refused) as e:
            fn(*a)
        self.assertEqual(str(e.exception), code)

    def jobs(self):
        return load("jobs-41960376782.json")

    def live(self, jobs):
        return next(j for j in jobs["jobs"] if j["name"] == LIVE)

    def step(self, jobs, name):
        return next(s for s in self.live(jobs)["steps"] if s["name"] == name)

    def test_the_real_run_proves_zero_product_usage_and_six_measured_runner_minutes(self):
        doc = build()
        digest, usage, at_utc = U.check_evidence(doc)
        # the live job ran 03:15:25Z to 03:21:20Z = 355 s -> 6 minutes; the other jobs are listed, outside the campaign allocation
        self.assertEqual(usage, {"requests": 0, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": 0, "runnerMinutes": 6})
        self.assertEqual(at_utc, "2026-11-05T03:21:44Z")       # the latest job completion, a fixed fact (not the run's 03:21:45Z updated_at)
        self.assertEqual(doc["failedStep"], "Generate the exact-head browser-bound proof and offline checks")
        self.assertEqual(len(doc["jobs"]), 6)
        self.assertEqual(digest, DIGEST, "the document is deterministic: no collection time, a fixed ordering")

    def test_the_document_is_deterministic_and_every_field_is_bound_by_the_digest(self):
        a, b = build(), build()
        self.assertEqual(U.canon(a), U.canon(b))
        base = U.check_evidence(a)[0]
        doc = copy.deepcopy(a)
        doc["run"]["updatedAt"] = "2026-11-05T03:14:00Z"                    # before the run started
        with self.assertRaises(U.Refused):
            U.check_evidence(doc)
        doc = copy.deepcopy(a)
        doc["journal"]["headSha"] = "1" * 40                               # any head is valid shape, but it is a different document: the
        self.assertNotEqual(U.check_evidence(doc)[0], base)                # settle refuses at any other actual head (test_manual_reservation)
        # a harmless-looking reorder of jobs changes the digest, and the document is still valid: the digest binds the exact bytes
        doc = copy.deepcopy(a)
        doc["jobs"].reverse()
        self.assertNotEqual(U.check_evidence(doc)[0], base)

    def test_the_pinned_credential_steps_are_exactly_what_the_workflow_at_that_head_derives(self):
        path = os.path.join(FX, "cloud-test-live.8f9f9451.yml")
        with open(path, "rb") as f:
            data = f.read()
        self.assertEqual(hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest(), "288c4e3ca63de95bbc7d5e55d3f46d81f229ceb1",
                         "the fixture is the workflow blob at 8f9f9451")
        derived = sorted([list(p) for p in set(U.credential_steps(data.decode("utf-8")))])
        self.assertEqual(derived, sorted(PIN["credentialSteps"]))
        self.assertEqual(len(derived), 4)

    def test_the_credential_step_derivation_refuses_what_it_cannot_match(self):
        self.refused("unexecuted-workflow", U.credential_steps, "")
        text = "jobs:\n  a:\n    name: A\n    steps:\n      - run: echo ${{ secrets.X }}\n"
        self.refused("unexecuted-unnamed-credential-step", U.credential_steps, text)
        ok = "jobs:\n  a:\n    name: A\n    steps:\n      - name: S\n        run: echo ${{ secrets.X }}\n      - name: T\n        run: echo ${{ secrets.GITHUB_TOKEN }}\n"
        self.assertEqual(U.credential_steps(ok), [("A", "S")])

    def test_a_new_run_that_reserved_and_then_failed_in_setup_is_evidence_too(self):
        # Sam 1793881491.714239: a NEW run identity with a successful reserve and every credential-bearing step skipped, not a pinned entry
        new_id, new_head = 41999999997, "c" * 40
        run = dict(load("run-41960376782.json"), id=new_id, head_sha=new_head)
        jobs = self.jobs()
        for j in jobs["jobs"]:
            j.update(run_id=new_id, head_sha=new_head)
        reserve = dict(PIN["reserved"], runId=str(new_id), atUtc="2026-11-06T03:15:17Z")
        settled_old = [dict(PIN["reserved"]), dict(PIN["reserved"], type="settle")]
        ch = [(ROOT_SHA, []), ("2" * 40, settled_old[:1]), ("3" * 40, settled_old), ("4" * 40, settled_old + [reserve])]
        self.assertEqual(U.pending_run(ch), str(new_id))
        doc = build(run, jobs, ch)
        digest, usage, at_utc = U.check_evidence(doc)
        self.assertEqual((doc["identity"], doc["journal"]["reserve"], doc["journal"]["headSha"]), ({"runId": str(new_id), "attempt": 1, "headSha": new_head}, reserve, "4" * 40))
        self.assertEqual(usage, {"requests": 0, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": 0, "runnerMinutes": 6})
        self.assertNotEqual(digest, DIGEST)
        # the run, its jobs and the journal's open reserve must all be the same identity
        self.refused("unexecuted-journal", build, dict(run, id=41999999996), None, ch)
        self.refused("unexecuted-journal", build, run, jobs, chain())                                   # the open reserve is another run's
        self.refused("unexecuted-run-differs", U.check_evidence, dict(doc, identity=dict(doc["identity"], headSha="d" * 40)))
        self.refused("unexecuted-journal", build, dict(load("run-41960376782.json"), run_attempt=2))     # the reserve is attempt 1
        self.refused("unexecuted-job-not-of-the-run", build, dict(load("run-41960376782.json"), head_sha="a" * 40))

    def test_the_run_must_be_completed_and_failed(self):
        run = load("run-41960376782.json")
        for over in ({"status": "in_progress"}, {"status": "queued"}, {"conclusion": "success"}, {"conclusion": "cancelled"}, {"conclusion": None}):
            self.refused("unexecuted-run-not-failed", build, dict(run, **over))

    def test_every_job_must_belong_to_this_run_attempt_and_head(self):
        for key, value in (("run_id", 41933223835), ("run_attempt", 2), ("head_sha", "b" * 40)):
            jobs = self.jobs()
            jobs["jobs"][2][key] = value
            self.refused("unexecuted-job-not-of-the-run", build, None, jobs)

    def test_each_job_must_be_present_once_completed_with_its_expected_conclusion(self):
        for index, code in ((0, "unexecuted-job-record"), (1, "unexecuted-job-gate"), (2, "unexecuted-job-reserve"), (3, "unexecuted-job-live"),
                            (4, "unexecuted-job-settle"), (5, "unexecuted-job-complete")):
            jobs = self.jobs()
            del jobs["jobs"][index]
            self.refused("unexecuted-jobs", build, None, jobs)           # a missing job
            jobs = self.jobs()
            jobs["jobs"][index]["status"] = "in_progress"
            self.refused(code, build, None, jobs)                          # an active job
            jobs = self.jobs()
            jobs["jobs"][index]["conclusion"] = "cancelled"
            self.refused(code, build, None, jobs)                          # a contradicting conclusion
        jobs = self.jobs()
        jobs["jobs"].append(dict(jobs["jobs"][2]))
        self.refused("unexecuted-jobs", build, None, jobs)                 # a duplicate

    def test_the_credential_steps_come_from_the_runs_own_workflow_and_must_cover_the_product_step(self):
        # derived from the workflow text at the run's head (its sha256 is bound in the document); the product-capable stage-runner run step must be
        # among them, so an empty, partial or mis-parsed list cannot make a run that executed look skipped
        doc = build()
        self.assertEqual(sorted(doc["credentialSteps"]), sorted(PIN["credentialSteps"]))
        self.assertEqual(doc["workflowSha256"], hashlib.sha256(workflow().encode("utf-8")).hexdigest())
        for label, change in (("drop the product step", lambda d: d.__setitem__("credentialSteps", [p for p in d["credentialSteps"] if not p[1].startswith("Stage runner (run)")])),
                              ("empty", lambda d: d["credentialSteps"].clear())):
            doc = build()
            change(doc)
            self.refused("unexecuted-credential-steps", U.check_evidence, doc)
        doc = build()
        doc["credentialSteps"][0] = [doc["credentialSteps"][0][0], "Discover the preinstalled browser against the reviewed baseline"]
        with self.assertRaises(U.Refused):
            U.check_evidence(doc)                                      # a step that is not skipped cannot be listed as one
        self.refused("unexecuted-credential-steps", build, None, None, None, "jobs:\n  live:\n    name: X\n    steps:\n      - name: A\n        run: true\n")

    def test_the_live_job_that_succeeded_or_is_still_running_is_not_evidence(self):
        for status, conclusion in (("completed", "success"), ("in_progress", None), ("completed", "cancelled")):
            jobs = self.jobs()
            self.live(jobs).update(status=status, conclusion=conclusion)
            self.refused("unexecuted-job-live", build, None, jobs)

    def test_every_credential_bearing_step_must_be_skipped(self):
        for _, name in PIN["credentialSteps"]:
            for conclusion in ("success", "cancelled", None):
                jobs = self.jobs()
                self.step(jobs, name)["conclusion"] = conclusion
                self.refused("unexecuted-credential-step-ran", build, None, jobs)
            jobs = self.jobs()
            self.step(jobs, name)["conclusion"] = "failure"
            self.refused("unexecuted-failed-step", build, None, jobs)                  # a credential step that ran and failed is a second failure
            jobs = self.jobs()
            self.live(jobs)["steps"] = [s for s in self.live(jobs)["steps"] if s["name"] != name]
            self.refused("unexecuted-credential-step-missing", build, None, jobs)      # missing is uncertain, not skipped
            jobs = self.jobs()
            self.live(jobs)["steps"].append(dict(self.step(jobs, name)))
            self.refused("unexecuted-credential-step-missing", build, None, jobs)      # duplicated

    def failed_at(self, failing, succeeded=()):
        """The real jobs with the failure moved: the proof succeeded, `succeeded` steps ran, `failing` failed, every later step skipped."""
        jobs = self.jobs()
        for step in self.live(jobs)["steps"]:
            step["conclusion"] = "success" if step["name"] == PIN["failedStep"] or step["name"] in succeeded else step["conclusion"]
        self.step(jobs, failing)["conclusion"] = "failure"
        return jobs

    def test_a_failed_preflight_settles_at_its_bounded_request_charge_and_nothing_else(self):
        # R10 run 42059286564 (Sam 1793897345.841829; PO 11-05): only the prerequisite preflight ran, and it failed. Its fixed charge is 10
        # campaign requests (2 sign-ins + 8 own-token reads, prerequisite_preflight.cjs charge); it makes no served-release identity read, no
        # Start, take or coaching call, and every later credential-bearing step is skipped.
        for jobs in (self.failed_at(U.PREFLIGHT_STEP),                                                        # the preflight itself failed
                     self.failed_at("Bind a clean detached checkout of the admitted tested release", ())):     # ... or a later step
            if self.step(jobs, U.PREFLIGHT_STEP)["conclusion"] != "failure":
                self.step(jobs, U.PREFLIGHT_STEP)["conclusion"] = "skipped"
            doc = build(jobs=jobs)
            if self.step(jobs, U.PREFLIGHT_STEP)["conclusion"] == "failure":
                self.assertEqual((doc["accounting"], doc["failedStep"]), ("preflight-bound", U.PREFLIGHT_STEP))
                self.assertEqual(U.check_evidence(doc)[1], {"requests": 10, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": 0, "runnerMinutes": 6})
        jobs = self.failed_at("Bind a clean detached checkout of the admitted tested release", (U.PREFLIGHT_STEP,))
        self.assertEqual(build(jobs=jobs)["accounting"], "preflight-bound")              # the preflight succeeded, a non-credential step failed
        doc = build(jobs=self.failed_at(U.PREFLIGHT_STEP))
        self.refused("unexecuted-accounting", U.check_evidence, dict(doc, accounting="none"))        # it cannot be claimed as zero
        self.refused("unexecuted-usage-differs", U.check_evidence, dict(doc, usage=dict(doc["usage"], requests=0)))

    def test_any_other_credential_bearing_step_that_ran_settles_at_the_reserved_caps(self):
        # usage after a non-preflight credential step is unknown: retained at the caps, never less (Sam 1793897309.565819)
        for failing, succeeded in (("Select the committed request and bind this run's inputs", (U.PREFLIGHT_STEP,)),
                                   ("Stage runner (install-tools, plans, stimulus preflight, gates)", (U.PREFLIGHT_STEP, "Select the committed request and bind this run's inputs")),
                                   ("Collect, verify the binding, qualify every selected row, and project the closed record",
                                    (U.PREFLIGHT_STEP, "Select the committed request and bind this run's inputs",
                                     "Stage runner (install-tools, plans, stimulus preflight, gates)", "Stage runner (run), bounded to the selected cases' live minutes"))):
            jobs = self.failed_at(failing, succeeded)
            for name in ("Bind a clean detached checkout of the admitted tested release", "Place the admitted continuity checkpoint as the runner's reconciliation",
                         "Approved window still fits the live run"):
                step = next((s for s in self.live(jobs)["steps"] if s["name"].startswith(name[:30])), None)
                if step is not None and step["conclusion"] == "skipped" and step["number"] < self.step(jobs, failing)["number"]:
                    step["conclusion"] = "success"
            doc = build(jobs=jobs)
            self.assertEqual(doc["accounting"], "capped", failing)
            held = PIN["reserved"]["allocation"]
            self.assertEqual({k: v for k, v in U.check_evidence(doc)[1].items() if k != "runnerMinutes"},
                             {k: held[k] for k in U.PRODUCT_KEYS}, failing)

    def test_the_live_job_must_have_failed_at_exactly_one_step_and_no_step_may_be_active(self):
        self.assertEqual(build()["failedStep"], PIN["failedStep"])
        jobs = self.jobs()
        self.step(jobs, PIN["failedStep"])["conclusion"] = "success"
        self.refused("unexecuted-failed-step", build, None, jobs)
        jobs = self.jobs()
        self.step(jobs, "Discover the preinstalled browser against the reviewed baseline")["conclusion"] = "failure"
        self.refused("unexecuted-failed-step", build, None, jobs)                       # a second failure
        jobs = self.jobs()
        next(s for s in self.live(jobs)["steps"] if s["name"].startswith("Collect, verify"))["status"] = "in_progress"
        self.refused("unexecuted-step-active", build, None, jobs)

    def test_the_journals_open_last_event_must_be_this_runs_one_reserve(self):
        settle = dict(PIN["reserved"], type="settle", allocation={k: 0 for k in PIN["reserved"]["allocation"]})
        self.assertEqual(build(ch=chain(head="1" * 40))["journal"]["headSha"], "1" * 40)            # any head, read from the journal
        for label, ch in (("another run's reserve", chain(events=[dict(PIN["reserved"], runId="41933223835")])),
                          ("a second reserve of this run", chain(events=[dict(PIN["reserved"]), dict(PIN["reserved"])])),
                          ("an extra event", chain(events=[dict(PIN["reserved"]), dict(PIN["reserved"], runId="41999999999")])),
                          ("already settled", [(ROOT_SHA, []), ("2" * 40, [dict(PIN["reserved"])]), ("3" * 40, [dict(PIN["reserved"]), settle])]),
                          ("genesis only", [(ROOT_SHA, [])])):
            with self.assertRaises(U.Refused, msg=label):
                build(ch=ch)
        self.refused("unexecuted-journal", build, None, None, [(ROOT_SHA, []), (PIN["journalHeadSha"], [])])      # no reserve at all

    def test_a_document_that_claims_other_usage_or_another_time_is_refused(self):
        for path, value in ((("usage", "runnerMinutes"), 7), (("usage", "requests"), 1), (("usage", "takes"), 1), (("atUtc",), "2026-11-05T03:21:45Z")):
            doc = build()
            target = doc
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            self.refused("unexecuted-usage-differs", U.check_evidence, doc)
        doc = build()
        doc["extra"] = 1
        self.refused("unexecuted-shape", U.check_evidence, doc)
        doc = build()
        doc["identity"]["runId"] = "41933223835"
        self.refused("unexecuted-run-differs", U.check_evidence, doc)
        doc = build()
        doc["identity"]["runId"] = "not-a-run"
        self.refused("unexecuted-identity", U.check_evidence, doc)

    def test_runner_time_is_the_live_job_rounded_up_and_never_zero(self):
        jobs = self.jobs()
        live = self.live(jobs)
        for completed, minutes in (("2026-11-05T03:16:25Z", 1), ("2026-11-05T03:16:26Z", 2), ("2026-11-05T03:21:25Z", 6), ("2026-11-05T03:21:26Z", 7), ("2026-11-05T03:15:25Z", 1)):
            live["completed_at"] = completed
            self.assertEqual(U.check_evidence(build(jobs=copy.deepcopy(jobs)))[1]["runnerMinutes"], minutes, completed)
        live["completed_at"] = "2026-11-05T03:15:24Z"
        self.refused("unexecuted-job-time", build, None, jobs)                  # ended before it started

    def test_the_cli_checks_a_document_and_refuses_with_exit_78(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "e.json")
            with open(path, "wb") as f:
                f.write(U.canon(build()) + b"\n")
            run = lambda *a: subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "unexecuted_attempt_evidence.py"), *a],
                                            capture_output=True, text=True)
            ok = run("check", "--evidence", path)
            self.assertEqual((ok.returncode, ok.stdout.split()), (0, [DIGEST, "2026-11-05T03:21:44Z", "6"]))
            with open(path, encoding="utf-8") as f:
                doc = json.load(f)
            doc["usage"]["runnerMinutes"] = 40
            with open(path, "w") as f:
                json.dump(doc, f)
            bad = run("check", "--evidence", path)
            self.assertEqual((bad.returncode, bad.stdout, bad.stderr.strip()), (78, "", "BLOCKED_SETUP: unexecuted-usage-differs"))
            self.assertEqual(run("check", "--evidence", os.path.join(d, "nope.json")).returncode, 78)


if __name__ == "__main__":
    unittest.main()
