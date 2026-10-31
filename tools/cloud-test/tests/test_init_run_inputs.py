"""Latest-run inputs (Sam 1793472272.951949): first run, valid replacement, interrupted or missing prior record, mixed or unknown mode, consumed
or re-run attempts, invalid source/account approval bindings and exceeded current caps, through the one schema the pipeline also reads."""
import copy
import json
import os
import shutil
import subprocess
import tempfile
import unittest

from _fixtures import ROOT, J
import init_run_inputs as I
import publish_latest_record as LR

SHA = "a" * 40
CASES = ["AHT-05", "AHT-06"]


def facts(**over):
    f = {"ownerApprovalReference": "slack:1793472272.951949", "approvedBy": "sam", "reviewer": "jensen", "approvedSourceSha": SHA,
         "approvedCases": list(CASES), "approvedAccountRole": "existing-disposable",
         "receipts": {"analytics": "receipt:analytics-exclusion@aaaaaaaaaaaa", "disp": "receipt:disposition@aaaaaaaaaaaa",
                      "fence": "receipt:fence@aaaaaaaaaaaa", "review": "receipt:packet-review@aaaaaaaaaaaa"},
         "backend": {"manifestRef": "manifest:edge-generation-211", "generation": 211, "completion": "OFF", "migration129": "absent"}}
    f.update(over)
    return f


def terminal(run_id="100"):
    return {"runId": run_id, "attempt": 1, "sourceSha": SHA, "servedSha": SHA, "startedUtc": "2026-10-31T17:00:00Z", "endedUtc": "2026-10-31T17:30:00Z",
            "outcome": "failed", "cases": [{"caseId": "AHT-05", "result": "FAIL", "rows": {"pass": 3, "fail": 1, "notRun": 0}, "codes": []}], "codes": []}


def state(completed=None, in_progress=None):
    return {"schema": LR.SCHEMA, "latestCompleted": completed, "inProgress": in_progress}


class Build(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cfg = J("config", "test-config.v1.json")

    def build(self, prior, first_run=False, **over):
        args = dict(cfg=self.cfg, cases=list(CASES), facts=facts(), run_id="101", attempt=1, source_sha=SHA, prior_state=prior, first_run=first_run)
        args.update(over)
        return I.load_run_inputs(I.build(**args), "101", SHA)

    def test_first_run_only_when_no_record_exists(self):
        doc = self.build(state(), first_run=True)
        self.assertEqual(doc["prior"], {"mode": "first-run"})
        self.assertEqual(doc["counters"]["consumed"], {k: 0 for k in I.COUNTERS})
        self.assertEqual((doc["counters"]["scope"], doc["reservations"]["scope"]), ("run", "run"))
        with self.assertRaisesRegex(I.Refused, "first-run-declared-but-a-record-exists"):
            self.build(state(terminal()), first_run=True)

    def test_valid_replacement_carries_exactly_one_sanitized_terminal_record(self):
        doc = self.build(state(terminal("100")))
        self.assertEqual(doc["prior"], {"mode": "replacement", "record": LR.sanitize_record(terminal("100"))})
        self.assertEqual(doc["historyMode"], "latest-run")
        self.assertNotIn("R5", json.dumps(doc))

    def test_an_interrupted_or_running_prior_attempt_is_refused(self):
        for status in ("running", "cancelled", "incomplete"):
            live = {"runId": "100", "attempt": 1, "sourceSha": SHA, "startedUtc": "2026-10-31T17:00:00Z", "status": status}
            with self.subTest(status=status), self.assertRaisesRegex(I.Refused, "prior-attempt-not-terminal"):
                self.build(state(terminal("99"), live))

    def test_a_missing_or_unreadable_prior_is_never_an_empty_history(self):
        with self.assertRaisesRegex(I.Refused, "prior-missing-not-declared-first-run"):
            self.build(state())
        for bad in (None, {}, {"schema": "other", "latestCompleted": None, "inProgress": None},
                    dict(state(terminal()), extra=1), state(dict(terminal(), email="x@example.invalid"))):
            with self.subTest(bad=str(bad)[:50]), self.assertRaisesRegex(I.Refused, "prior-unreadable"):
                self.build(bad)

    def test_rerun_attempts_and_a_rerun_of_a_recorded_run_are_refused(self):
        with self.assertRaisesRegex(I.Refused, "rerun-attempt-refused"):
            self.build(state(terminal()), attempt=2)
        with self.assertRaisesRegex(I.Refused, "rerun-of-a-recorded-run"):
            self.build(state(terminal("101")))

    def test_approval_bindings_must_name_this_source_these_cases_and_one_account_role(self):
        for over, code in ((dict(approvedSourceSha="b" * 40), "approval-not-for-this-source"),
                           (dict(approvedCases=["AHT-05"]), "approval-not-for-these-cases"),
                           (dict(approvedAccountRole="maintained-read-only"), "approval-not-for-this-account-role"),
                           (dict(ownerApprovalReference="has spaces and words"), "facts-reference"),
                           (dict(extra="x"), "facts-shape")):
            with self.subTest(code=code), self.assertRaisesRegex(I.Refused, code):
                self.build(state(terminal()), facts=facts(**over))
        with self.assertRaisesRegex(I.Refused, "mixed-account-roles"):
            self.build(state(terminal()), cases=["AHT-05", "AHT-15"], facts=facts(approvedCases=["AHT-05", "AHT-15"]))

    def test_the_selection_cannot_exceed_the_current_cap(self):
        many = ["AHT-%02d" % n for n in range(1, 8)]
        with self.assertRaisesRegex(I.Refused, "selection-exceeds-current-cap"):
            self.build(state(terminal()), cases=many, facts=facts(approvedCases=many))


class Case10Binding(unittest.TestCase):
    """Jensen 1793472856.927699: AHT-10 needs its request-bound projection carried with provenance; it is never synthesized."""

    def test_selecting_case10_without_its_projection_is_refused(self):
        with self.assertRaisesRegex(I.Refused, "facts-shape"):
            I.build(J("config", "test-config.v1.json"), ["AHT-10"], facts(approvedCases=["AHT-10"]), "101", 1, SHA, state(terminal()), False)

    def test_a_projection_for_another_run_source_or_shape_is_refused(self):
        rec = {"schema": I.CASE10_SCHEMA, "runId": "101", "sourceSha": SHA, "accountSubjectSha256": "c" * 64, "evidenceRef": "receipt:case10-projection@aaaaaaaaaaaa",
               "projection": {}}
        for over, code in ((dict(runId="100"), "case10-projection-not-for-this-run"), (dict(sourceSha="b" * 40), "case10-projection-not-for-this-run"),
                           (dict(accountSubjectSha256="x"), "case10-projection-account"), (dict(extra=1), "case10-projection-shape")):
            with self.subTest(code=code), self.assertRaisesRegex(I.Refused, code):
                I.validate_case10(dict(rec, **over), "101", SHA)


class PipelineLatestRun(unittest.TestCase):
    """The pipeline reads the same schema and stops before anything is spent on a mixed mode or unconfigured per-run ceilings."""

    def run_pipeline(self, extra=()):
        d = tempfile.mkdtemp(prefix="ct-latest-run-")
        self.addCleanup(shutil.rmtree, d, True)
        req = J("tests", "fixtures", "partial-request.json")
        req["priorRuns"] = []
        sha = req["release"]["testedSha"]
        rp, ip = os.path.join(d, "request.json"), os.path.join(d, "run-inputs.json")
        with open(rp, "w") as f:
            json.dump(req, f)
        with open(ip, "w") as f:
            json.dump(I.build(J("config", "test-config.v1.json"), list(CASES), facts(approvedSourceSha=sha), "101", 1, sha, state(), True), f)
        r = subprocess.run(["python3", "-I", os.path.join(ROOT, "scripts", "pipeline.py"), "--request", rp, "--out-dir", os.path.join(d, "out"), "--stage", "final",
                            "--run-inputs", ip, *extra], capture_output=True, text=True, timeout=120)
        return r

    def test_historical_inputs_with_run_inputs_are_a_mixed_mode(self):
        r = self.run_pipeline(["--history-index", os.path.join(ROOT, "config", "history", "index.json")])
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn("mixed history modes", r.stdout)

    def test_unconfigured_per_run_ceilings_stop_before_any_gate(self):
        r = self.run_pipeline()
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn("latest-run-ceilings-not-configured", r.stdout)


class PipelineReader(unittest.TestCase):
    def setUp(self):
        self.doc = I.build(J("config", "test-config.v1.json"), list(CASES), facts(), "101", 1, SHA, state(terminal()), False)

    def test_mixed_or_unknown_history_modes_are_refused(self):
        for mode in ("historical", "latest-run+historical", None):
            d = copy.deepcopy(self.doc)
            d["historyMode"] = mode
            with self.subTest(mode=mode), self.assertRaisesRegex(I.Refused, "history-mode-unknown-or-mixed"):
                I.load_run_inputs(d)
        d = copy.deepcopy(self.doc)
        d["historyIndex"] = {"headHash": "0" * 64}
        with self.assertRaisesRegex(I.Refused, "run-inputs-shape"):
            I.load_run_inputs(d)

    def test_counters_stay_bound_to_this_run_and_a_consumed_cap_refuses(self):
        d = copy.deepcopy(self.doc)
        d["counters"]["runId"] = "100"
        with self.assertRaisesRegex(I.Refused, "counters-not-run-scoped"):
            I.load_run_inputs(d)
        d = copy.deepcopy(self.doc)
        d["counters"]["consumed"]["requests"] = d["counters"]["caps"]["requests"] + 1
        with self.assertRaisesRegex(I.Refused, "current-cap-exceeded"):
            I.load_run_inputs(d)
        with self.assertRaisesRegex(I.Refused, "run-inputs-for-another-run"):
            I.load_run_inputs(copy.deepcopy(self.doc), run_id="102")


class Projection(unittest.TestCase):
    def test_a_run_record_projects_to_statuses_and_counts_only(self):
        rr = {"schema": "speaksharp.cloud-test.run-record.v1", "release": {"testedSha": SHA, "servedShaAtAdmission": SHA},
              "startedUtc": "2026-10-31T18:00:00Z", "endedUtc": "2026-10-31T18:30:00Z", "purpose": "free text that must not travel",
              "cases": [{"case": "AHT-05", "result": "PASS", "reason": "free text", "assertions": {"PASS": 6, "FAIL": 0, "NOT RUN": 0, "total": 6},
                         "outcomeClass": "pass", "receiptDigest": "f" * 64}]}
        rec = I.project(rr, "101", 1, SHA)
        self.assertEqual(rec["outcome"], "passed")
        self.assertNotIn("free text", json.dumps(rec))
        with self.assertRaisesRegex(I.Refused, "run-record-for-another-source"):
            I.project(rr, "101", 1, "b" * 40)


class Cli(unittest.TestCase):
    def test_build_writes_the_inputs_and_refuses_with_exit_78(self):
        d = tempfile.mkdtemp(prefix="ct-run-inputs-")
        self.addCleanup(shutil.rmtree, d, True)
        prior = os.path.join(d, "prior.json")
        with open(prior, "w") as f:
            json.dump(state(terminal()), f)
        script = os.path.join(ROOT, "scripts", "init_run_inputs.py")
        base = ["python3", "-I", script, "build", "--config", os.path.join(ROOT, "config", "test-config.v1.json"), "--cases", ",".join(CASES),
                "--facts-refs", json.dumps(facts()), "--run-id", "101", "--source-sha", SHA, "--prior-state", prior]
        ok = subprocess.run(base + ["--attempt", "1", "--out", os.path.join(d, "out")], capture_output=True, text=True, timeout=60)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        with open(os.path.join(d, "out", "run-inputs.json")) as f:
            self.assertEqual(I.load_run_inputs(json.load(f))["runId"], "101")
        again = subprocess.run(base + ["--attempt", "2", "--out", os.path.join(d, "out2")], capture_output=True, text=True, timeout=60)
        self.assertEqual(again.returncode, 78)
        self.assertIn("rerun-attempt-refused", again.stderr)


if __name__ == "__main__":
    unittest.main()
