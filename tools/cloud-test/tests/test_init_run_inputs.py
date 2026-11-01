"""GitHub live caller inputs (Sam 1793538100.358869, 1793538322.008999): a committed reviewed request only, its live/approval/window/source
bindings, complete-case sampling, request/identity/paid/time ceilings from the real config, one account role bound to credential names, account
ID and history, the builder's real facts schema, fail-closed continuity, and qualification through the REAL verify_run_binding followed by a
separate all-selected-rows-PASS check."""
import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from _fixtures import ROOT, J
import init_run_inputs as I

SHA = "a" * 40
NOW = datetime(2026, 11, 1, 14, 0, tzinfo=timezone.utc)
ACCOUNT_ID = "00000000-0000-4000-8000-000000000001"  # synthetic; never a real account
CFG = J(os.path.join(ROOT, "config", "test-config.v1.json"))
FULL = J(os.path.join(ROOT, "tests", "fixtures", "full-request.json"))


def live_request(cases=None, **over):
    """The reviewed full fixture made live-shaped for unit checks; it is never written as a run request."""
    r = copy.deepcopy(FULL)
    if cases is not None:
        r["selection"] = [s for s in r["selection"] if s["case"] in cases]
        r["coverageMode"] = "partial"
        r["estimate"]["requests"]["runCap"] = 700
        r["estimate"]["identityReads"] = 8
        r["estimate"].pop("window", None)
    r.update(synthetic=False, executionRuntime=I.RUNTIME, selectionApprovalRef="slack:1793538100.358869")
    r["release"]["testedSha"] = SHA
    r["harness"]["ownerApprovalRef"] = "slack:1793538100.358869"
    r["window"] = {"startUtc": "2026-11-01T13:00:00Z", "endUtc": "2026-11-01T20:00:00Z", "approvalRef": "slack:1793538100.358869"}
    full = r["coverageMode"] == "full"
    r["approvedLimits"] = {"cumulativeCeilingRequests": 12000, "identityCap": 32 if full else 20, "runCapRequests": 4310 if full else 800,
                           "approvalRef": "slack:1793538100.358869", "approvedBy": "sam"}
    r.update(over)
    return r


def facts(**over):
    f = {"ownerApprovalReference": "slack:1793538100.358869", "approvedBy": "sam", "reviewer": "jensen",
         "receipts": {k: "receipt:%s@aaaaaaaaaaaa" % k for k in I.RECEIPT_KEYS},
         "account": {"role": "existing-disposable", "idSha256": hashlib.sha256(ACCOUNT_ID.encode()).hexdigest(), "historyRef": "history:throwaway@r5"}}
    f.update(over)
    return f


def put(path, doc):
    with open(path, "w", encoding="utf-8") as f:
        f.write(doc if isinstance(doc, str) else json.dumps(doc))


def refused(test, code, fn, *a):
    with test.assertRaises(I.Refused) as e:
        fn(*a)
    test.assertEqual(str(e.exception), code)


class GitRepo:
    def __init__(self):
        self.dir = os.path.realpath(tempfile.mkdtemp())
        self.git("init", "-q")
        self.git("config", "user.email", "unit@example.invalid")
        self.git("config", "user.name", "unit")

    def git(self, *a):
        return subprocess.run(["git", "-C", self.dir, *a], check=True, capture_output=True, text=True).stdout.strip()

    def commit(self, files):
        for rel, doc in files.items():
            os.makedirs(os.path.dirname(os.path.join(self.dir, rel)), exist_ok=True)
            put(os.path.join(self.dir, rel), doc)
            self.git("add", "--", rel)
        self.git("commit", "-q", "-m", "unit")
        return self.git("rev-parse", "HEAD")


class SelectRequest(unittest.TestCase):
    def setUp(self):
        self.repo = GitRepo()
        self.addCleanup(shutil.rmtree, self.repo.dir)
        self.head = self.repo.commit({"runs/r6.json": {"a": 1}, "tools/cloud-test/tests/fixtures/full-request.json": {"a": 1},
                                      "tools/cloud-test/templates/run-request.template.json": {"a": 1}})

    def test_a_committed_reviewed_request_is_selected_by_path(self):
        path, blob = I.select_request(self.repo.dir, "runs/r6.json", self.head)
        self.assertEqual(path, os.path.join(self.repo.dir, "runs/r6.json"))
        self.assertEqual(blob, self.repo.git("rev-parse", self.head + ":runs/r6.json"))

    def test_fixtures_templates_and_unsafe_paths_are_refused(self):
        for rel in ("tools/cloud-test/tests/fixtures/full-request.json", "tools/cloud-test/templates/run-request.template.json"):
            refused(self, "request-not-a-reviewed-run-request", I.select_request, self.repo.dir, rel, self.head)
        for rel in ("/etc/r6.json", "../r6.json", "runs/../runs/r6.json", "", None):
            refused(self, "request-path", I.select_request, self.repo.dir, rel, self.head)

    def test_untracked_modified_or_other_source_requests_are_refused(self):
        with open(os.path.join(self.repo.dir, "runs/new.json"), "w") as f:
            f.write("{}")
        refused(self, "request-not-committed-at-source", I.select_request, self.repo.dir, "runs/new.json", self.head)
        with open(os.path.join(self.repo.dir, "runs/r6.json"), "w") as f:
            f.write('{"a": 2}')
        refused(self, "request-differs-from-commit", I.select_request, self.repo.dir, "runs/r6.json", self.head)
        refused(self, "checkout-not-at-source", I.select_request, self.repo.dir, "runs/r6.json", "b" * 40)


class CheckRequest(unittest.TestCase):
    def test_live_full_and_partial_requests_are_accepted(self):
        self.assertEqual(I.check_request(live_request(), NOW), I.ALL_CASES)
        self.assertEqual(I.check_request(live_request(["AHT-04", "AHT-05"]), NOW), ["AHT-04", "AHT-05"])

    def test_synthetic_runtime_source_and_sampling_are_refused(self):
        for code, req in [("synthetic-request-refused", live_request(synthetic=True)),
                          ("synthetic-request-refused", {k: v for k, v in live_request().items() if k != "synthetic"}),
                          ("request-not-for-github-runtime", live_request(executionRuntime="Claude SpeakSharp R4")),
                          ("partial-selection-needs-selected-full-sampling", live_request(["AHT-05"], sampleMode="minimal")),
                          ("full-mode-needs-all-fifteen", live_request(["AHT-05"], coverageMode="full")),
                          ("request-schema", live_request(schema="speaksharp.cloud-test.run-request.v1"))]:
            refused(self, code, I.check_request, req, NOW)
        r = live_request(); r["release"]["testedSha"] = "HEAD"
        refused(self, "request-release-sha", I.check_request, r, NOW)

    def test_missing_approvals_or_a_closed_window_are_refused(self):
        for mutate in (lambda r: r.update(selectionApprovalRef=None), lambda r: r["harness"].update(ownerApprovalRef=None),
                       lambda r: r["window"].update(approvalRef="")):
            r = live_request(); mutate(r)
            refused(self, "approval-reference-missing", I.check_request, r, NOW)
        r = live_request(); r["approvedLimits"]["runCapRequests"] = None
        refused(self, "approved-limits-missing", I.check_request, r, NOW)
        r = live_request(); r["window"]["endUtc"] = None
        refused(self, "approved-window-missing", I.check_request, r, NOW)
        refused(self, "outside-approved-window", I.check_request, live_request(), datetime(2026, 11, 1, 20, 0, tzinfo=timezone.utc))


class Ceilings(unittest.TestCase):
    def test_full_fifteen_fit_only_a_job_timeout_covering_case_limits_and_reserves(self):
        # 272 case minutes + admission 20 + inter-case 10 + cleanup 2 = 304 live; plus 15 setup and 10 collect = 329.
        self.assertEqual(I.check_ceilings(CFG, live_request(), I.ALL_CASES, 329), 304)
        refused(self, "time-exceeds-job-timeout", I.check_ceilings, CFG, live_request(), I.ALL_CASES, 328)
        refused(self, "job-timeout", I.check_ceilings, CFG, live_request(), I.ALL_CASES, 361)

    def test_partial_selections_use_partial_caps(self):
        six = ["AHT-04", "AHT-05", "AHT-06", "AHT-09", "AHT-10", "AHT-11"]
        # 95 case minutes + 32 harness reserves = 127 live (inside the partial 150); plus 25 caller reserves = 152.
        self.assertEqual(I.check_ceilings(CFG, live_request(six), six, 152), 127)
        refused(self, "time-exceeds-job-timeout", I.check_ceilings, CFG, live_request(six), six, 151)
        seven = six + ["AHT-13"]
        refused(self, "selection-exceeds-mode-cap", I.check_ceilings, CFG, live_request(seven), seven, 329)
        heavy = ["AHT-01", "AHT-02", "AHT-03", "AHT-12", "AHT-04", "AHT-07"]
        refused(self, "time-exceeds-mode-window", I.check_ceilings, CFG, live_request(heavy), heavy, 329)

    def test_request_identity_and_paid_ceilings_are_never_raised_by_input(self):
        r = live_request(); r["approvedLimits"]["runCapRequests"] = 6001
        refused(self, "approved-limit-above-mode-cap", I.check_ceilings, CFG, r, I.ALL_CASES, 329)
        r = live_request(); r["approvedLimits"]["runCapRequests"] = 3610
        refused(self, "estimate-exceeds-approved-run-cap", I.check_ceilings, CFG, r, I.ALL_CASES, 329)
        r = live_request(); r["estimate"]["identityReads"] = 33
        refused(self, "estimate-exceeds-approved-identity-cap", I.check_ceilings, CFG, r, I.ALL_CASES, 329)
        r = live_request(); r["estimate"]["paidActionsAuthorizedUsd"] = 1
        refused(self, "paid-actions-refused", I.check_ceilings, CFG, r, I.ALL_CASES, 329)
        r = live_request(); r["estimate"]["window"]["worstCaseMinutes"] = 305
        refused(self, "estimate-worst-case-exceeds-case-limits", I.check_ceilings, CFG, r, I.ALL_CASES, 329)


class Account(unittest.TestCase):
    def test_one_role_bound_to_its_credential_names_id_and_history(self):
        b = I.account_binding(["AHT-05"], facts()["account"], ACCOUNT_ID)
        self.assertEqual(b["credentials"], {"email": "THROWAWAY_TEST_EMAIL", "password": "THROWAWAY_TEST_PASSWORD", "accountId": "THROWAWAY_TEST_ACCOUNT_ID"})
        a = dict(facts()["account"], role="maintained-read-only", historyRef="history:free@r5")
        b = I.account_binding(["AHT-15"], a, ACCOUNT_ID)
        self.assertEqual((b["role"], b["credentials"]["email"], b["credentials"]["password"], b["historyRef"]),
                         ("maintained-read-only", "FREE_TEST_EMAIL", "FREE_TEST_PASSWORD", "history:free@r5"))
        self.assertNotIn(ACCOUNT_ID, json.dumps(b))

    def test_mixed_roles_wrong_account_and_missing_sources_are_refused(self):
        refused(self, "mixed-account-roles", I.account_binding, ["AHT-14", "AHT-15"], facts()["account"], ACCOUNT_ID)
        refused(self, "account-role-not-for-these-cases", I.account_binding, ["AHT-15"], facts()["account"], ACCOUNT_ID)
        refused(self, "account-id-not-the-approved-account", I.account_binding, ["AHT-05"], facts()["account"], ACCOUNT_ID.replace("1", "2"))
        refused(self, "account-id-source-missing", I.account_binding, ["AHT-05"], facts()["account"], None)
        refused(self, "account-history-reference", I.account_binding, ["AHT-05"], dict(facts()["account"], historyRef=""), ACCOUNT_ID)


class Facts(unittest.TestCase):
    def test_the_builder_schema_is_produced_without_the_account_binding(self):
        out = I.translate_facts(facts(), live_request(), "github-direct")
        self.assertEqual(set(out), {"ownerApprovalReference", "approvedBy", "reviewer", "receipts"})
        self.assertEqual(set(out["receipts"]), {"pre", "rls", "analytics", "disp", "fence", "review"})

    def test_the_old_receipt_shape_and_unbound_approvals_are_refused(self):
        old = facts(receipts={k: "receipt:%s@aaaaaaaaaaaa" % k for k in ("analytics", "disp", "fence", "review")})
        refused(self, "facts-receipts", I.translate_facts, old, live_request(), "github-direct")
        refused(self, "facts-approval-not-the-request-approval", I.translate_facts, facts(ownerApprovalReference="slack:other.1"), live_request(), "github-direct")
        refused(self, "producer-review-reference-missing", I.translate_facts, facts(), live_request(), "github-producer")
        self.assertEqual(I.translate_facts(facts(producerReviewReference="review:producer@1"), live_request(), "github-producer")["producerReviewReference"], "review:producer@1")
        refused(self, "facts-shape", I.translate_facts, facts(approvedSourceSha=SHA), live_request(), "github-direct")


class PrepareFailsClosedOnContinuity(unittest.TestCase):
    def test_every_other_binding_valid_still_refuses_without_a_verified_checkpoint_and_writes_nothing(self):
        repo = GitRepo()
        self.addCleanup(shutil.rmtree, repo.dir)
        req = live_request(["AHT-05"])
        now = datetime.now(timezone.utc)
        req["window"].update(startUtc=(now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"), endUtc=(now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"))
        release = repo.commit({"tools/cloud-test/config/test-config.v1.json": CFG})
        req["release"]["testedSha"] = release
        stray = dict(req, release=dict(req["release"], testedSha="b" * 40))
        head = repo.commit({"runs/r6.json": req, "runs/stray.json": stray})
        out, env, outputs = (os.path.join(repo.dir, n) for n in ("out", "env", "outputs"))

        def prepare(rel):
            argv = ["prepare", "--repo", repo.dir, "--config", "tools/cloud-test/config/test-config.v1.json", "--request", rel,
                    "--facts", json.dumps(facts()), "--run-id", "123", "--attempt", "1", "--source-sha", head,
                    "--job-timeout-minutes", "150", "--out", out, "--env-file", env, "--outputs", outputs]
            p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "init_run_inputs.py"), *argv], capture_output=True, text=True,
                               env={"PATH": os.environ["PATH"], "THROWAWAY_TEST_ACCOUNT_ID": ACCOUNT_ID})
            self.assertNotIn(ACCOUNT_ID, p.stdout + p.stderr)
            self.assertFalse(any(os.path.exists(x) for x in (out, env, outputs)))
            return p.returncode, p.stderr.strip()

        self.assertEqual(prepare("runs/r6.json"), (78, "BLOCKED_SETUP: continuity-checkpoint-contract-pending"))
        self.assertEqual(prepare("runs/stray.json"), (78, "BLOCKED_SETUP: request-release-not-in-source-history"))


class Qualify(unittest.TestCase):
    """Composition: the REAL verify_run_binding.py writes --out for exactly this plan and these case results, then qualify decides."""

    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.d)
        os.makedirs(os.path.join(self.d, "packet", "draft-adapters"))
        driver = os.path.join(self.d, "packet", "draft-adapters", "AHT-05.cjs")
        put(driver, "// driver\n")
        code = os.path.join(self.d, "packet", "CODE.sha256")
        put(code, "%s  draft-adapters/AHT-05.cjs\n" % self.sha(driver))
        self.config = os.path.join(self.d, "AHT-05.json")
        put(self.config, {"requiredAssertions": ["a-1", "a-2"]})
        self.plan = os.path.join(self.d, "plan.json")
        put(self.plan, {"campaignId": "C1", "sourceSha": SHA, "servedSha": SHA, "cases": [{"id": "AHT-05", "driverFile": driver, "driverSha256": self.sha(driver),
                   "configFile": self.config, "configSha256": self.sha(self.config)}]})
        self.approval = os.path.join(self.d, "approval.json")
        put(self.approval, {"reviewedCodeManifestSha256": self.sha(code)})
        self.cases = os.path.join(self.d, "cases")
        os.makedirs(os.path.join(self.cases, "AHT-05"))
        self.results = os.path.join(self.d, "case-results.json")
        self.code = code

    @staticmethod
    def sha(p):
        with open(p, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()

    def run_case(self, rows, result="PASS", campaign=None):
        put(os.path.join(self.cases, "AHT-05", "case-result.json"),
            {"caseId": "AHT-05", "result": result, "assertions": [{"id": i, "result": r} for i, r in rows], "evidenceDigests": {}})
        put(self.results, {"campaignId": campaign or "C1", "sourceSha": SHA, "servedSha": SHA, "cases": [{"caseId": "AHT-05"}]})
        out = os.path.join(self.d, "verification-%d.json" % len(os.listdir(self.d)))
        p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "verify_run_binding.py"), "--plan", self.plan, "--case-results", self.results,
                            "--approval", self.approval, "--code-manifest", self.code, "--packet-root", os.path.join(self.d, "packet"), "--cases-dir", self.cases,
                            "--out", out], capture_output=True, text=True)
        return p.returncode, J(out)

    def test_verifier_pass_and_every_required_row_pass_qualifies(self):
        rc, v = self.run_case([("a-1", "PASS"), ("a-2", "PASS")])
        self.assertEqual(rc, 0)
        self.assertEqual(I.qualify(v, self.plan, self.results, self.cases, ["AHT-05"]), {"qualified": True, "cases": ["AHT-05"]})

    def test_verifier_success_alone_never_qualifies_a_failed_or_missing_row(self):
        for rows, result, code in [([("a-1", "PASS"), ("a-2", "FAIL")], "FAIL", "case-not-pass:AHT-05"),
                                   ([("a-1", "PASS")], "PASS", "required-assertion-not-pass:AHT-05"),
                                   ([("a-1", "PASS"), ("a-2", "NOT RUN")], "PASS", "required-assertion-not-pass:AHT-05")]:
            rc, v = self.run_case(rows, result)
            self.assertEqual(rc, 0, "the verifier itself passes these")
            refused(self, code, I.qualify, v, self.plan, self.results, self.cases, ["AHT-05"])

    def test_undispatched_failed_verification_stale_output_and_other_selection_are_refused(self):
        rc, v = self.run_case([("a-1", "PASS"), ("a-2", "PASS")], campaign="C2")
        self.assertEqual(rc, 1)
        refused(self, "binding-verification-failed", I.qualify, v, self.plan, self.results, self.cases, ["AHT-05"])
        rc, v = self.run_case([("a-1", "PASS"), ("a-2", "PASS")])
        put(self.results, {"campaignId": "C1", "sourceSha": SHA, "servedSha": SHA, "cases": [{"caseId": "AHT-05", "reason": "not dispatched"}]})
        refused(self, "binding-verification-stale", I.qualify, v, self.plan, self.results, self.cases, ["AHT-05"])
        v = dict(v, caseResultsSha256=self.sha(self.results))
        refused(self, "case-not-dispatched:AHT-05", I.qualify, v, self.plan, self.results, self.cases, ["AHT-05"])
        refused(self, "plan-not-the-selected-cases", I.qualify, v, self.plan, self.results, self.cases, ["AHT-05", "AHT-06"])


if __name__ == "__main__":
    unittest.main()
