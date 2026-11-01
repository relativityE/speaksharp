"""GitHub live caller inputs (Sam 1793538100.358869, 1793538322.008999; RETURNs of b0100ad8 and 3e0279d6): a committed request in the ONE
reviewed location, its live/approval/window/source bindings, request-only lineage or a fully bound older-release diagnostic, complete-case
sampling, per-run and time ceilings (cumulative caps stay G5's), one account role bound to credential names, account ID and history, the
builder's real facts schema, the producer scope composed from the request and accepted by the real bootstrap, fail-closed continuity, and
qualification through the REAL verify_run_binding on a frozen snapshot followed by a separate all-selected-rows-PASS check bound to the record."""
import copy
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from _fixtures import ROOT, J, approved, fake_rv, receipt, reconciliation, sample
from _gate_fixtures import GateInputs
import check_gates as C
import init_run_inputs as I
import validate_run_request as V

SHA = "a" * 40
NOW = datetime(2026, 11, 1, 14, 0, tzinfo=timezone.utc)
ACCOUNT_ID = "00000000-0000-4000-8000-000000000001"  # synthetic; never a real account
CFG = J(os.path.join(ROOT, "config", "test-config.v1.json"))
FULL = J(os.path.join(ROOT, "tests", "fixtures", "full-request.json"))
KEYS = I._request_keys()
RUNS = I.REQUEST_DIR


def utc(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def live_request(cases=None, **over):
    """The reviewed full fixture made live-shaped for unit checks; it is never written into the repository as a run request."""
    r = copy.deepcopy(FULL)
    r.pop("fixtureScope", None)
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
    r["approvedLimits"] = {"cumulativeCeilingRequests": 12000, "identityCap": 126, "runCapRequests": 4310 if full else 800,
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


def refused(test, code, fn, *a, **k):
    with test.assertRaises(I.Refused) as e:
        fn(*a, **k)
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
        self.head = self.repo.commit({RUNS + "r6.json": {"a": 1}, "frontend/r6.json": {"a": 1}, RUNS + "nested/r6.json": {"a": 1}})

    def test_only_the_reviewed_request_location_is_selectable(self):
        path, blob = I.select_request(self.repo.dir, RUNS + "r6.json", self.head)
        self.assertEqual((path, blob), (os.path.join(self.repo.dir, RUNS + "r6.json"), self.repo.git("rev-parse", self.head + ":" + RUNS + "r6.json")))
        for rel in ("frontend/r6.json", RUNS + "nested/r6.json", "tools/cloud-test/tests/fixtures/full-request.json"):
            refused(self, "request-not-in-the-reviewed-request-location", I.select_request, self.repo.dir, rel, self.head)
        for rel in ("/etc/r6.json", "../r6.json", RUNS + "../runs/r6.json", "", None):
            refused(self, "request-path", I.select_request, self.repo.dir, rel, self.head)

    def test_untracked_modified_or_other_source_requests_are_refused(self):
        put(os.path.join(self.repo.dir, RUNS + "new.json"), "{}")
        refused(self, "request-not-committed-at-source", I.select_request, self.repo.dir, RUNS + "new.json", self.head)
        put(os.path.join(self.repo.dir, RUNS + "r6.json"), '{"a": 2}')
        refused(self, "request-differs-from-commit", I.select_request, self.repo.dir, RUNS + "r6.json", self.head)
        refused(self, "checkout-not-at-source", I.select_request, self.repo.dir, RUNS + "r6.json", "b" * 40)


class CheckRequest(unittest.TestCase):
    def test_live_full_and_partial_requests_are_accepted(self):
        self.assertEqual(I.check_request(live_request(), NOW, KEYS), I.ALL_CASES)
        self.assertEqual(I.check_request(live_request(["AHT-04", "AHT-05"]), NOW, KEYS), ["AHT-04", "AHT-05"])

    def test_synthetic_runtime_shape_and_sampling_are_refused(self):
        for code, req in [("synthetic-request-refused", live_request(synthetic=True)),
                          ("synthetic-request-refused", {k: v for k, v in live_request().items() if k != "synthetic"}),
                          ("request-not-for-github-runtime", live_request(executionRuntime="Claude SpeakSharp R4")),
                          ("partial-selection-needs-selected-full-sampling", live_request(["AHT-05"], sampleMode="minimal")),
                          ("full-mode-needs-all-fifteen", live_request(["AHT-05"], coverageMode="full")),
                          ("request-schema", live_request(schema="speaksharp.cloud-test.run-request.v1")),
                          ("request-schema", live_request(fixtureScope="unit")),
                          ("request-schema", {k: v for k, v in live_request().items() if k != "purpose"})]:
            refused(self, code, I.check_request, req, NOW, KEYS)
        r = live_request(); r["release"]["testedSha"] = "HEAD"
        refused(self, "request-release-sha", I.check_request, r, NOW, KEYS)

    def test_missing_approvals_or_a_closed_window_are_refused(self):
        for mutate in (lambda r: r.update(selectionApprovalRef=None), lambda r: r["harness"].update(ownerApprovalRef=None),
                       lambda r: r["window"].update(approvalRef="")):
            r = live_request(); mutate(r)
            refused(self, "approval-reference-missing", I.check_request, r, NOW, KEYS)
        r = live_request(); r["approvedLimits"]["runCapRequests"] = None
        refused(self, "approved-limits-missing", I.check_request, r, NOW, KEYS)
        r = live_request(); r["window"]["endUtc"] = None
        refused(self, "approved-window-missing", I.check_request, r, NOW, KEYS)
        refused(self, "outside-approved-window", I.check_request, live_request(), datetime(2026, 11, 1, 20, 0, tzinfo=timezone.utc), KEYS)


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

    def test_per_run_request_identity_and_paid_ceilings_are_never_raised_by_input(self):
        r = live_request(); r["approvedLimits"]["runCapRequests"] = 6001
        refused(self, "approved-limit-above-mode-cap", I.check_ceilings, CFG, r, I.ALL_CASES, 329)
        r = live_request(); r["approvedLimits"]["runCapRequests"] = 3610
        refused(self, "estimate-exceeds-approved-run-cap", I.check_ceilings, CFG, r, I.ALL_CASES, 329)
        r = live_request(); r["estimate"]["identityReads"] = 33
        refused(self, "estimate-exceeds-per-run-identity-cap", I.check_ceilings, CFG, r, I.ALL_CASES, 329)
        six = ["AHT-04", "AHT-05", "AHT-06", "AHT-09", "AHT-10", "AHT-11"]
        r = live_request(six); r["estimate"]["identityReads"] = 21
        refused(self, "estimate-exceeds-per-run-identity-cap", I.check_ceilings, CFG, r, six, 329)
        r = live_request(); r["estimate"]["paidActionsAuthorizedUsd"] = 1
        refused(self, "paid-actions-refused", I.check_ceilings, CFG, r, I.ALL_CASES, 329)
        r = live_request(); r["estimate"]["window"]["worstCaseMinutes"] = 305
        refused(self, "estimate-worst-case-exceeds-case-limits", I.check_ceilings, CFG, r, I.ALL_CASES, 329)

    def test_the_whole_job_must_end_before_the_approved_window_closes(self):
        r = live_request(["AHT-05"])  # 47 live minutes + 25 caller reserves = 72
        r["window"]["endUtc"] = "2026-11-01T15:12:00Z"
        I.check_window_fit(r, NOW, 47)
        r["window"]["endUtc"] = "2026-11-01T15:11:59Z"
        refused(self, "run-would-outlast-approved-window", I.check_window_fit, r, NOW, 47)


class CumulativeCapsAreG5s(unittest.TestCase):
    """G5 (check_gates.py 131-170) is the authority for the CUMULATIVE caps (Sam RETURN 3e0279d6). The caller holds no second formula; this
    drives the REAL gate evaluator at its exact boundary with nonzero reconciled prior usage."""

    def setUp(self):
        s = sample()
        self.inputs = GateInputs(s)
        self.addCleanup(self.inputs.close)
        self.req, self.cfg, self.ledger, self.wf = self.inputs.request, self.inputs.cfg, s["ledger"], s["wf"]
        self.rc = reconciliation()

    def g5(self, req, ledger):
        from _common import parse_utc
        errs, _ = V.validate(req, self.cfg, ledger, self.wf, fake_rv(), self.rc)
        out = C.evaluate(req, self.cfg, ledger, self.wf, {"valid": not errs, "errors": errs}, {"passed": True}, receipt(req), str(self.inputs.root),
                         "final", fake_rv(), self.rc, parse_utc("2026-10-28T22:00:00Z"), receipts_root=str(self.inputs.receipts))
        return {g["id"]: g["status"] for g in out["gates"]}["G5"]

    def test_the_caller_has_no_cumulative_formula_of_its_own(self):
        self.assertFalse(hasattr(I, "check_cumulative"))

    def test_g5_exact_request_and_identity_boundaries_with_nonzero_prior_usage(self):
        r, l = approved(self.req, self.ledger)
        a, est, rc = r["approvedLimits"], r["estimate"], self.rc
        self.assertGreater(rc["requests"]["conservativeUsed"], 0)
        self.assertGreater(rc["identityReads"]["conservativeUsed"], 0)
        need = rc["requests"]["conservativeUsed"] + a["runCapRequests"] + rc["ceilings"]["protectedReserveRequests"] + est["identityReads"]
        a["cumulativeCeilingRequests"], a["identityCap"] = need, rc["identityReads"]["conservativeUsed"] + est["identityReads"]
        self.assertEqual(self.g5(r, l), "READY")
        a["cumulativeCeilingRequests"] = need - 1
        self.assertEqual(self.g5(r, l), "NOT-READY", "one request short of used + run cap + protected reserve + identity reads")
        a["cumulativeCeilingRequests"], a["identityCap"] = need, a["identityCap"] - 1
        self.assertEqual(self.g5(r, l), "NOT-READY", "one identity read short of used + reads")


class Lineage(unittest.TestCase):
    """Workflow source vs tested release (Sam RETURNs b0100ad8 #4 and 3e0279d6 #1)."""

    def setUp(self):
        self.repo = GitRepo()
        self.addCleanup(shutil.rmtree, self.repo.dir)
        self.release = self.repo.commit({"frontend/app.json": {"v": 1}, "package.json": {"v": 1}})

    def req(self):
        r = live_request(["AHT-05"])
        r["release"]["testedSha"] = self.release
        return r

    def lineage(self, head, diagnostic=None, blob="blob", cases=("AHT-05",)):
        return I.check_release_lineage(self.repo.dir, self.req(), RUNS + "r6.json", head, blob, list(cases), diagnostic, KEYS)

    def test_schema_valid_requests_in_the_reviewed_location_are_request_only_lineage(self):
        head = self.repo.commit({RUNS + "r6.json": self.req(), RUNS + "r5.json": live_request(["AHT-04"])})
        self.assertEqual(self.lineage(head), "request-only-descendant")

    def test_product_dependency_and_non_request_json_changes_refuse(self):
        for change in ({"frontend/app.json": {"v": 2}}, {"package.json": {"v": 2}}, {"frontend/runs/r6.json": self.req()},
                       {RUNS + "notes.json": {"not": "a request"}}, {RUNS + "script.py": "x"}):
            head = self.repo.commit(dict({RUNS + "r6.json": self.req()}, **change))
            refused(self, "source-changes-product-beyond-request", self.lineage, head)

    def test_an_older_release_diagnostic_is_bound_to_workflow_tested_request_and_selection(self):
        head = self.repo.commit({"frontend/app.json": {"v": 2}, RUNS + "r6.json": self.req()})
        good = {"approvalRef": "slack:1793539739.216639", "workflowSha": head, "testedSha": self.release, "requestBlob": "blob", "cases": ["AHT-05"]}
        self.assertEqual(self.lineage(head, good), "explicit-older-release-diagnostic")
        for k, v in (("workflowSha", "c" * 40), ("testedSha", "c" * 40), ("requestBlob", "other"), ("cases", ["AHT-06"]), ("approvalRef", "")):
            refused(self, "source-changes-product-beyond-request", self.lineage, head, dict(good, **{k: v}))
        refused(self, "source-changes-product-beyond-request", self.lineage, head, dict(good, extra=1))

    def test_a_diagnostic_without_a_product_change_and_a_release_outside_history_refuse(self):
        head = self.repo.commit({RUNS + "r6.json": self.req()})
        refused(self, "diagnostic-declared-without-product-change", self.lineage, head, {"approvalRef": "x"})
        r = self.req(); r["release"]["testedSha"] = "b" * 40
        refused(self, "request-release-not-in-source-history", I.check_release_lineage, self.repo.dir, r, RUNS + "r6.json", head, "blob", ["AHT-05"], None, KEYS)


class Account(unittest.TestCase):
    def free_cfg(self):
        cfg = copy.deepcopy(CFG)
        cfg["credentials"]["runEnvironment"]["stages"]["run"] += ["FREE_TEST_EMAIL", "FREE_TEST_PASSWORD"]
        return cfg

    def test_one_role_bound_to_its_credential_names_id_and_history(self):
        b = I.account_binding(CFG, ["AHT-05"], facts()["account"], ACCOUNT_ID)
        self.assertEqual(b["credentials"], {"email": "THROWAWAY_TEST_EMAIL", "password": "THROWAWAY_TEST_PASSWORD", "accountId": "THROWAWAY_TEST_ACCOUNT_ID"})
        a = dict(facts()["account"], role="maintained-read-only", historyRef="history:free@r5")
        # The reviewed run stage receives only the THROWAWAY names today, so AHT-15's maintained pair is refused, never renamed.
        refused(self, "role-credentials-not-in-run-stage-allowlist", I.account_binding, CFG, ["AHT-15"], a, ACCOUNT_ID)
        b = I.account_binding(self.free_cfg(), ["AHT-15"], a, ACCOUNT_ID)
        self.assertEqual((b["role"], b["credentials"]["email"], b["credentials"]["password"], b["historyRef"]),
                         ("maintained-read-only", "FREE_TEST_EMAIL", "FREE_TEST_PASSWORD", "history:free@r5"))
        self.assertNotIn(ACCOUNT_ID, json.dumps(b))

    def test_mixed_roles_wrong_account_and_missing_sources_are_refused(self):
        refused(self, "mixed-account-roles", I.account_binding, CFG, ["AHT-14", "AHT-15"], facts()["account"], ACCOUNT_ID)
        refused(self, "account-role-not-for-these-cases", I.account_binding, self.free_cfg(), ["AHT-15"], facts()["account"], ACCOUNT_ID)
        refused(self, "account-id-not-the-approved-account", I.account_binding, CFG, ["AHT-05"], facts()["account"], ACCOUNT_ID.replace("1", "2"))
        refused(self, "account-id-source-missing", I.account_binding, CFG, ["AHT-05"], facts()["account"], None)
        refused(self, "account-history-reference", I.account_binding, CFG, ["AHT-05"], dict(facts()["account"], historyRef=""), ACCOUNT_ID)


class Facts(unittest.TestCase):
    def test_the_builder_schema_is_produced_without_the_account_binding_or_diagnostic(self):
        out = I.translate_facts(facts(olderReleaseDiagnostic={"approvalRef": "x"}), live_request(), "github-direct")
        self.assertEqual(set(out), {"ownerApprovalReference", "approvedBy", "reviewer", "receipts"})
        self.assertEqual(set(out["receipts"]), {"pre", "rls", "analytics", "disp", "fence", "review"})

    def test_the_old_receipt_shape_and_unbound_approvals_are_refused(self):
        old = facts(receipts={k: "receipt:%s@aaaaaaaaaaaa" % k for k in ("analytics", "disp", "fence", "review")})
        refused(self, "facts-receipts", I.translate_facts, old, live_request(), "github-direct")
        refused(self, "facts-approval-not-the-request-approval", I.translate_facts, facts(ownerApprovalReference="slack:other.1"), live_request(), "github-direct")
        refused(self, "producer-review-reference-missing", I.translate_facts, facts(), live_request(), "github-producer")
        refused(self, "facts-shape", I.translate_facts, facts(approvedSourceSha=SHA), live_request(), "github-direct")


class ProducerScope(unittest.TestCase):
    """The producer scope is composed from the COMMITTED request and accepted by the REAL authenticated_job_bootstrap.validateBindings
    against the builder environment the REAL run_env.py derives from the same request (Sam RETURN 3e0279d6 #4)."""

    LIMITS = {"maxDeliveries": 4, "maxSupabaseRequests": 32, "maxTelemetryReads": 2}

    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.d)
        now = datetime.now(timezone.utc).replace(microsecond=0)
        self.req = live_request(["AHT-07"], evidenceScope=dict(self.LIMITS))
        self.req["window"].update(startUtc=utc(now - timedelta(hours=1)), endUtc=utc(now + timedelta(hours=3)))
        self.facts = I.translate_facts(facts(producerReviewReference="review:producer@1"), self.req, "github-producer")

    def bind(self, scope, account=ACCOUNT_ID, facts_over=None):
        private = os.path.join(self.d, "private-%d" % len(os.listdir(self.d)))
        os.mkdir(private, 0o700)
        scope_file, facts_file, acct, req_file, env_file = (os.path.join(private, n) for n in ("scope.json", "facts.json", "acct", "req.json", "env.txt"))
        for path, doc in ((scope_file, scope), (facts_file, dict(self.facts, **(facts_over or {}))), (acct, account), (req_file, self.req)):
            put(path, doc)
            os.chmod(path, 0o600)
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "run_env.py"), "--request", req_file, "--out", env_file], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(env_file, encoding="utf-8") as f:
            bp = dict(line.rstrip("\n").split("=", 1) for line in f if "=" in line)
        env = dict(bp, PATH=os.environ["PATH"], GITHUB_ACTIONS="true", GITHUB_REPOSITORY="relativityE/speaksharp", GITHUB_RUN_ID="123",
                   GITHUB_RUN_ATTEMPT="1", GITHUB_JOB="live", GITHUB_SHA="b" * 40, BP_FACTS=facts_file, BP_ACCOUNT_ID_FILE=acct)
        script = ("const b=require(process.argv[1]),{privateJson}=require(process.argv[2]),fs=require('node:fs');"
                  "const s=privateJson(process.argv[3],process.argv[4]);b.validateBindings(s,JSON.parse(fs.readFileSync(process.env.BP_FACTS)),process.env);"
                  "console.log('BOUND')")
        p = subprocess.run(["node", "-e", script, os.path.join(ROOT, "scripts", "authenticated_job_bootstrap.cjs"),
                            os.path.join(ROOT, "harness", "bundle", "harness", "with-authenticated-evidence.cjs"), scope_file, I._sha(scope_file)],
                           capture_output=True, text=True, env=env)
        return p.stdout.strip(), p.stderr

    def scope(self):
        return I.compose_scope(self.req, self.facts, ACCOUNT_ID, ["AHT-07"], "github-producer")

    def test_the_composed_scope_is_accepted_by_the_real_bootstrap(self):
        s = self.scope()
        self.assertEqual((s["caseIds"], s["campaignId"], s["sourceSha"]), (["AHT-07"], self.req["runId"], SHA))
        out, err = self.bind(s)
        self.assertEqual(out, "BOUND", err)

    def test_the_real_bootstrap_refuses_another_account_or_review_reference(self):
        self.assertNotEqual(self.bind(self.scope(), account=ACCOUNT_ID.replace("1", "2"))[0], "BOUND")
        out, err = self.bind(self.scope(), facts_over={"producerReviewReference": "review:other@1"})
        self.assertNotEqual(out, "BOUND")
        self.assertIn("SELECTED_SCOPE_DIFFERS", err)

    def test_scope_limits_window_and_route_are_checked_before_composition(self):
        for lim in ({}, dict(self.LIMITS, maxDeliveries=0), dict(self.LIMITS, maxSupabaseRequests=257), dict(self.LIMITS, extra=1)):
            refused(self, "evidence-scope-limits", I.compose_scope, dict(self.req, evidenceScope=lim), self.facts, ACCOUNT_ID, ["AHT-07"], "github-producer")
        r = copy.deepcopy(self.req); r["window"]["endUtc"] = utc(datetime.now(timezone.utc) + timedelta(hours=6))
        refused(self, "producer-scope-window-over-six-hours", I.compose_scope, r, self.facts, ACCOUNT_ID, ["AHT-07"], "github-producer")
        refused(self, "evidence-scope-only-for-producer-route", I.compose_scope, self.req, self.facts, ACCOUNT_ID, ["AHT-05"], "github-direct")
        self.assertIsNone(I.compose_scope(live_request(["AHT-05"]), self.facts, ACCOUNT_ID, ["AHT-05"], "github-direct"))


class PrepareFailsClosedOnContinuity(unittest.TestCase):
    def test_every_other_binding_valid_still_refuses_without_a_verified_checkpoint_and_writes_nothing(self):
        repo = GitRepo()
        self.addCleanup(shutil.rmtree, repo.dir)
        req = live_request(["AHT-05"])
        now = datetime.now(timezone.utc)
        req["window"].update(startUtc=utc(now - timedelta(hours=1)), endUtc=utc(now + timedelta(hours=1, minutes=30)))
        release = repo.commit({"tools/cloud-test/config/test-config.v1.json": CFG})
        req["release"]["testedSha"] = release
        stray = copy.deepcopy(req); stray["release"]["testedSha"] = "b" * 40
        head = repo.commit({RUNS + "r6.json": req, RUNS + "stray.json": stray})
        out, env, outputs = (os.path.join(repo.dir, n) for n in ("out", "env", "outputs"))
        bundle = bundle_with(ACCOUNT_ID)

        def prepare(rel):
            argv = ["prepare", "--repo", repo.dir, "--config", "tools/cloud-test/config/test-config.v1.json", "--request", rel,
                    "--facts", json.dumps(facts()), "--run-id", "123", "--attempt", "1", "--source-sha", head,
                    "--job-timeout-minutes", "150", "--out", out, "--env-file", env, "--outputs", outputs]
            p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "init_run_inputs.py"), *argv], capture_output=True, text=True,
                               env={"PATH": os.environ["PATH"], "CLOUD_TEST_LIVE_ACCOUNTS": bundle, "SUPABASE_URL": SUPABASE_URL_OK})
            self.assertNotIn(ACCOUNT_ID, p.stdout + p.stderr)
            self.assertNotIn("synthetic", p.stdout + p.stderr)
            self.assertFalse(any(os.path.exists(x) for x in (out, env, outputs)))
            return p.returncode, p.stderr.strip()

        self.assertEqual(prepare(RUNS + "r6.json"), (78, "BLOCKED_SETUP: continuity-checkpoint-contract-pending"))
        self.assertEqual(prepare(RUNS + "stray.json"), (78, "BLOCKED_SETUP: request-release-not-in-source-history"))


class Qualify(unittest.TestCase):
    """Composition with the REAL verify_run_binding.py on a frozen snapshot of the builder's selected-full plan: all 15 plan.cases rows (driver
    and config bytes), the dispatch subset in plan.selection, and case results whose other rows are notSelected (campaign-core.cjs 116)."""

    SELECTED = ["AHT-05", "AHT-09"]

    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.d)
        adapters = os.path.join(self.d, "packet", "draft-adapters")
        os.makedirs(adapters)
        os.makedirs(os.path.join(self.d, "cfg"))
        rows, manifest = [], []
        for cid in I.ALL_CASES:
            driver, config = os.path.join(adapters, cid + ".cjs"), os.path.join(self.d, "cfg", cid + ".json")
            put(driver, "// %s driver\n" % cid)
            put(config, {"caseId": cid, "requiredAssertions": ["%s-a" % cid.lower(), "%s-b" % cid.lower()]})
            manifest.append("%s  draft-adapters/%s.cjs\n" % (self.sha(driver), cid))
            rows.append({"id": cid, "driverFile": driver, "driverSha256": self.sha(driver), "configFile": config, "configSha256": self.sha(config)})
        self.code = os.path.join(self.d, "packet", "CODE.sha256")
        put(self.code, "".join(manifest))
        self.plan = os.path.join(self.d, "campaign-plan.json")
        put(self.plan, {"campaignId": "C1", "sourceSha": SHA, "servedSha": SHA, "coverageMode": "partial", "assertionDepth": "full", "cases": rows,
                        "selection": {"ids": list(self.SELECTED), "order": list(self.SELECTED), "ownerApprovalReference": "slack:1", "reason": "unit"}})
        self.approval = os.path.join(self.d, "security-approval.json")
        put(self.approval, {"reviewedCodeManifestSha256": self.sha(self.code)})
        self.cases = os.path.join(self.d, "cases")
        self.results = os.path.join(self.d, "case-results.json")
        for cid in self.SELECTED:
            self.write_case(cid, [("a", "PASS"), ("b", "PASS")])
        self.write_results()
        self.runs = 0

    @staticmethod
    def sha(p):
        with open(p, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()

    def write_case(self, cid, rows, result="PASS"):
        os.makedirs(os.path.join(self.cases, cid), exist_ok=True)
        ev = os.path.join(self.cases, cid, cid.lower() + "-1.json")
        put(ev, {"contentSafe": True})
        put(os.path.join(self.cases, cid, "summary.json"), {"caseId": cid})
        put(os.path.join(self.cases, cid, "case-result.json"),
            {"caseId": cid, "result": result, "assertions": [{"id": "%s-%s" % (cid.lower(), i), "result": r} for i, r in rows],
             "evidenceDigests": {cid.lower() + "-1.json": self.sha(ev)}})

    def write_results(self, rows=None, **over):
        def row(c):
            if c in self.SELECTED:
                return {"caseId": c, "executionReceipt": {"summarySha256": self.sha(os.path.join(self.cases, c, "summary.json"))}}
            return {"caseId": c, "result": "NOT RUN", "notSelected": True, "requestsUsed": 0, "reason": "Not selected by the approved case selection"}
        put(self.results, dict({"campaignId": "C1", "sourceSha": SHA, "servedSha": SHA, "cases": rows or [row(c) for c in I.ALL_CASES]}, **over))

    def qualify(self, run_verifier=I._run_verifier, selected=None, mode="partial"):
        self.runs += 1
        return I.qualify(self.plan, self.results, self.cases, selected or self.SELECTED, self.approval, self.code,
                         os.path.join(self.d, "snapshot-%d" % self.runs), mode, run_verifier)

    def make_full(self):
        """The real full builder's shape: no partial markers, an explicit all-15 selection, every case dispatched with its receipts."""
        plan = J(self.plan)
        plan.pop("coverageMode"); plan.pop("assertionDepth")
        plan["selection"] = {"ids": list(I.ALL_CASES), "order": list(I.ALL_CASES), "ownerApprovalReference": "slack:1", "reason": "unit"}
        put(self.plan, plan)
        self.SELECTED = list(I.ALL_CASES)
        for cid in I.ALL_CASES:
            self.write_case(cid, [("a", "PASS"), ("b", "PASS")])
        self.write_results()

    def collect(self, request):
        """The REAL collector over the same case results (collect_run_record.py; campaign-runner rows carry their assertions)."""
        results = J(self.results)
        for row in results["cases"]:
            if row["caseId"] in self.SELECTED:
                row.update(result="PASS", assertions=J(os.path.join(self.cases, row["caseId"], "case-result.json"))["assertions"])
        put(self.results, results)
        ledgers = os.path.join(self.d, "ledgers"); os.makedirs(ledgers, exist_ok=True)
        put(os.path.join(ledgers, "campaign-ledger.json"), {"used": {"total": 1}})
        put(os.path.join(ledgers, "identity-ledger.json"), {"identityGets": 1})
        for name, doc in (("request.json", request), ("gate-status.json", {"decision": "GO"}), ("runner.json", {})):
            put(os.path.join(self.d, name), doc)
        out = os.path.join(self.d, "run-record.json")
        p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "collect_run_record.py"), "--request", os.path.join(self.d, "request.json"),
                            "--case-results", self.results, "--cases-dir", self.cases, "--ledger-dir", ledgers,
                            "--gate-status", os.path.join(self.d, "gate-status.json"), "--workflow", os.path.join(ROOT, "workflow.json"),
                            "--runner-json", os.path.join(self.d, "runner.json"), "--started-utc", "2026-11-01T14:00:00Z",
                            "--ended-utc", "2026-11-01T14:30:00Z", "--out", out], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        return J(out)

    def test_real_qualifier_collector_and_projection_compose_for_full_and_batch(self):
        for mode in ("partial", "full"):
            self.setUp()
            if mode == "full":
                self.make_full()
            request = live_request(None if mode == "full" else list(self.SELECTED), runId="C1")
            record = self.collect(request)
            q = self.qualify(mode=mode)
            rec = I.project(record, "123", 1, "c" * 40, SHA, q)
            self.assertEqual((rec["outcome"], rec["coverage"], rec["campaignId"], len(rec["cases"])),
                             ("passed", "full" if mode == "full" else "batch", "C1", 15), mode)
            self.assertEqual(sum(c["result"] == "NOT SELECTED" for c in rec["cases"]), 0 if mode == "full" else 13)
            # a full claim against a selected-full plan, and the reverse, are refused by the qualifier itself
            if mode == "full":
                refused(self, "plan-not-a-selected-full-plan", self.qualify, mode="partial")
            else:
                refused(self, "plan-not-a-full-coverage-plan", self.qualify, mode="full")
            # the collector's campaign is the request runId; a qualification for another campaign never passes
            other = I.project(dict(record, runId="C2"), "123", 1, "c" * 40, SHA, q)
            self.assertEqual((other["outcome"], other["coverage"]), ("failed", "unqualified"), mode)

    def test_the_real_verifier_on_the_frozen_snapshot_and_every_selected_row_pass_qualifies_with_bindings(self):
        q = self.qualify()
        self.assertEqual({k: q[k] for k in ("qualified", "campaignId", "testedSha", "servedSha", "cases", "coverage", "planCases", "requiredRows", "passRows")},
                         {"qualified": True, "campaignId": "C1", "testedSha": SHA, "servedSha": SHA, "cases": self.SELECTED, "coverage": "batch",
                          "planCases": 15, "requiredRows": 4, "passRows": 4})
        self.assertEqual((q["planSha256"], q["caseResultsSha256"]), (self.sha(self.plan), self.sha(self.results)))
        snap = os.path.join(self.d, "snapshot-1")
        self.assertEqual(J(os.path.join(snap, "verification.json"))["failed"], 0)
        self.assertEqual(stat.S_IMODE(os.stat(snap).st_mode), 0o700)

    def test_verifier_success_alone_never_qualifies_a_failed_missing_or_duplicated_row(self):
        for rows, result, code in [([("a", "PASS"), ("b", "FAIL")], "FAIL", "case-not-pass:AHT-09"),
                                   ([("a", "PASS")], "PASS", "required-assertion-not-pass:AHT-09"),
                                   ([("a", "PASS"), ("b", "NOT RUN")], "PASS", "required-assertion-not-pass:AHT-09"),
                                   ([("a", "PASS"), ("b", "FAIL"), ("b", "PASS")], "PASS", "duplicate-assertion:AHT-09")]:
            self.write_case("AHT-09", rows, result)
            refused(self, code, self.qualify)
            self.assertEqual(J(os.path.join(self.d, "snapshot-%d" % self.runs, "verification.json"))["failed"], 0, "the verifier itself passes " + code)

    def test_omitted_inputs_are_frozen_and_verified_too(self):
        mutations = {"approval": lambda: put(self.approval, {"reviewedCodeManifestSha256": "0" * 64}),
                     "listed packet file": lambda: put(os.path.join(self.d, "packet", "draft-adapters", "AHT-01.cjs"), "// changed\n"),
                     "planned driver": lambda: put(os.path.join(self.d, "packet", "draft-adapters", "AHT-09.cjs"), "// changed\n"),
                     "summary": lambda: put(os.path.join(self.cases, "AHT-09", "summary.json"), {"caseId": "other"}),
                     "evidence": lambda: put(os.path.join(self.cases, "AHT-09", "aht-09-1.json"), {"changed": True}),
                     }
        for name, mutate in mutations.items():
            self.setUp()
            mutate()
            refused(self, "binding-verifier-failed", self.qualify)
        # The verifier skips undispatched rows, so qualify checks every planned byte against the plan's own digests.
        self.setUp()
        put(os.path.join(self.d, "cfg", "AHT-01.json"), {"changed": True})
        refused(self, "planned-bytes-differ:AHT-01", self.qualify)

    def test_a_failed_missing_or_stale_verifier_output_is_refused(self):
        def passing_then(rc, write=True, stale=False):
            def run(*a):
                real = I._run_verifier(*a)
                self.assertEqual(real, 0)
                if not write:
                    os.remove(a[-1])
                elif stale:
                    v = J(a[-1]); v["caseResultsSha256"] = "0" * 64; put(a[-1], v)
                return rc
            return run
        refused(self, "binding-verifier-failed", self.qualify, passing_then(1))
        refused(self, "binding-verification-missing", self.qualify, passing_then(0, write=False))
        refused(self, "binding-verification-stale", self.qualify, passing_then(0, stale=True))

    def test_originals_swapped_during_verification_and_restored_cannot_change_the_result(self):
        originals = [self.plan, self.results, self.approval, self.code, os.path.join(self.cases, "AHT-09", "case-result.json"),
                     os.path.join(self.d, "cfg", "AHT-09.json"), os.path.join(self.d, "packet", "draft-adapters", "AHT-09.cjs")]

        def swap_restore(*a):
            saved = {p: open(p, "rb").read() for p in originals}
            for p in originals:
                with open(p, "wb") as f:
                    f.write(b"garbage")
            try:
                self.assertTrue(all(os.path.commonpath([x, self.d]) == self.d and "snapshot-" in x for x in a))
                return I._run_verifier(*a)
            finally:
                for p, data in saved.items():
                    with open(p, "wb") as f:
                        f.write(data)
        self.assertTrue(self.qualify(swap_restore)["qualified"])
        self.write_case("AHT-09", [("a", "PASS"), ("b", "FAIL")], "FAIL")
        self.write_results()
        refused(self, "case-not-pass:AHT-09", self.qualify, swap_restore)

    def test_a_snapshot_changed_during_verification_is_refused(self):
        def tamper(*a):
            rc = I._run_verifier(*a)
            put(os.path.join(os.path.dirname(a[0]), "cases", "AHT-09", "case-result.json"), {"caseId": "AHT-09"})
            return rc
        refused(self, "snapshot-changed-during-verification", self.qualify, tamper)

    def test_undispatched_unselected_dispatched_denominator_and_selection_controls(self):
        self.write_results(rows=[{"caseId": c, "reason": "not dispatched"} if c == "AHT-09" else
                                 {"caseId": c, "executionReceipt": {"summarySha256": self.sha(os.path.join(self.cases, c, "summary.json"))}} if c in self.SELECTED
                                 else {"caseId": c, "notSelected": True, "requestsUsed": 0} for c in I.ALL_CASES])
        refused(self, "case-not-dispatched:AHT-09", self.qualify)
        self.setUp()
        self.write_case("AHT-01", [("a", "PASS"), ("b", "PASS")])  # receipts present, so the verifier itself passes
        self.write_results(rows=[{"caseId": c} if c in self.SELECTED + ["AHT-01"] else {"caseId": c, "notSelected": True, "requestsUsed": 0}
                                 for c in I.ALL_CASES])
        refused(self, "unselected-case-dispatched:AHT-01", self.qualify)
        self.setUp()
        self.write_results(campaignId="C2")
        refused(self, "binding-verifier-failed", self.qualify)
        self.setUp()
        refused(self, "plan-selection-not-the-selected-cases", self.qualify, I._run_verifier, ["AHT-05"])
        plan = J(self.plan); plan["cases"] = [r for r in plan["cases"] if r["id"] in self.SELECTED]
        put(self.plan, plan)
        refused(self, "plan-denominator-not-fifteen", self.qualify)
        plan["cases"] = plan["cases"] + plan["cases"][:1]
        put(self.plan, plan)
        refused(self, "duplicate-plan-case", self.qualify)


class Project(unittest.TestCase):
    """The real collector keeps all 15 rows; qualification binds to THIS record's case-results digest and releases (Sam RETURN 3e0279d6 #3)."""

    def record(self):
        rows = [{"case": c, "result": "PASS" if c in ("AHT-05", "AHT-09") else "NOT RUN", "reason": None if c in ("AHT-05", "AHT-09") else "Not selected",
                 "assertions": {"PASS": 2, "FAIL": 0, "NOT RUN": 0} if c in ("AHT-05", "AHT-09") else {"PASS": 0, "FAIL": 0, "NOT RUN": 0}}
                for c in I.ALL_CASES]
        return {"schema": "speaksharp.cloud-test.run-record.v1", "runId": "R6-unit", "release": {"testedSha": SHA, "servedShaAtAdmission": SHA},
                "startedUtc": "2026-11-01T14:00:00Z", "endedUtc": "2026-11-01T14:30:00Z", "cases": rows, "artifactDigests": {"case-results.json": "d" * 64}}

    def q(self, **over):
        return dict({"qualified": True, "campaignId": "R6-unit", "testedSha": SHA, "servedSha": SHA, "caseResultsSha256": "d" * 64,
                     "planSha256": "e" * 64, "cases": ["AHT-05", "AHT-09"], "coverage": "batch"}, **over)

    def test_a_bound_batch_keeps_all_fifteen_rows_with_the_others_not_selected(self):
        rec = I.project(self.record(), "123", 1, "c" * 40, SHA, self.q())
        self.assertEqual((rec["outcome"], rec["coverage"], rec["campaignId"], len(rec["cases"])), ("passed", "batch", "R6-unit", 15))
        self.assertEqual(sorted(c["caseId"] for c in rec["cases"] if c["result"] == "PASS"), ["AHT-05", "AHT-09"])
        self.assertEqual({c["result"] for c in rec["cases"] if c["caseId"] not in ("AHT-05", "AHT-09")}, {"NOT SELECTED"})
        self.assertEqual((rec["sourceSha"], rec["testedSha"], rec["servedSha"]), ("c" * 40, SHA, SHA))

    def test_the_campaign_must_match_exactly_on_both_sides(self):
        for record_run, q_campaign in (("R6-other", "R6-unit"), ("R6-unit", "R6-other"), ("", ""), (None, None), ("R6-unit", None)):
            rec = I.project(dict(self.record(), runId=record_run), "123", 1, "c" * 40, SHA, self.q(campaignId=q_campaign))
            self.assertEqual((rec["outcome"], rec["coverage"], rec["campaignId"]), ("failed", "unqualified", None), (record_run, q_campaign))
        self.assertEqual(I.project(self.record(), "123", 1, "c" * 40, SHA, self.q())["campaignId"], "R6-unit")

    def test_a_qualification_for_another_record_campaign_or_release_never_passes(self):
        for over in ({"caseResultsSha256": "f" * 64}, {"servedSha": "b" * 40}, {"testedSha": "b" * 40}, {"qualified": False},
                     {"coverage": "unqualified"}, {"cases": ["AHT-05", "AHT-16"]}):
            rec = I.project(self.record(), "123", 1, "c" * 40, SHA, self.q(**over))
            self.assertEqual((rec["outcome"], rec["coverage"], rec["codes"]), ("failed", "unqualified", ["not-qualified"]), over)
            self.assertNotIn("NOT SELECTED", {c["result"] for c in rec["cases"]})
        rec = I.project(self.record(), "123", 1, "c" * 40, SHA, None)
        self.assertEqual((rec["outcome"], rec["codes"]), ("failed", ["not-qualified"]))
        refused(self, "run-record-for-another-release", I.project, self.record(), "123", 1, "c" * 40, "b" * 40, self.q())

    def test_full_coverage_needs_all_fifteen_selected(self):
        record = self.record()
        for c in record["cases"]:
            c.update(result="PASS", reason=None, assertions={"PASS": 2, "FAIL": 0, "NOT RUN": 0})
        self.assertEqual(I.project(record, "123", 1, "c" * 40, SHA, self.q(cases=I.ALL_CASES, coverage="full"))["coverage"], "full")
        rec = I.project(self.record(), "123", 1, "c" * 40, SHA, self.q(coverage="full"))
        self.assertEqual((rec["outcome"], rec["coverage"]), ("failed", "unqualified"), "a 'full' claim for two cases is not bound")



# SHARED with tests/unit/verifyTestUsersLiveJourney.test.js: the identical vector text, pinned by the same sha256 in both suites, so the
# two consumers of the CLOUD_TEST_LIVE_ACCOUNTS bundle agree on every accepted and refused shape and its code.
VECTORS_TEXT = r'''[
["valid", "ok", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["missing", "bundle-missing", ""],
["whitespace only", "bundle-missing", "   \n"],
["not JSON", "bundle-not-json", "{not json"],
["too large", "bundle-too-large", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"],
["version 2", "bundle-shape", "{\"version\": 2, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["version true", "bundle-shape", "{\"version\": true, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["top-level password", "bundle-shape", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}, \"password\": \"p\"}"],
["top-level array", "bundle-shape", "[]"],
["account password", "bundle-shape", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\", \"password\": \"p\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["account id missing", "bundle-shape", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\"}}}"],
["role missing", "bundle-shape", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}}}"],
["extra role", "bundle-shape", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}, \"pro\": {\"email\": \"p@x.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}}}"],
["project uppercase", "bundle-project", "{\"version\": 1, \"projectRef\": \"ABCDEFGHIJKLMNOPQRST\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["project short", "bundle-project", "{\"version\": 1, \"projectRef\": \"abc\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email LF", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"a@x.invalid\\nX: y\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email CR", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"a@x.invalid\\r\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email tab", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"a\\t@x.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email DEL", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"a@x.invalid\\u007f\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email no at", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email two at", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"a@b@x.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email leading space", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \" a@x.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email not string", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": 7, \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["account id uppercase", "bundle-account-id", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["account id v1", "bundle-account-id", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-1111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["account id not string", "bundle-account-id", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": 1}}}"],
["same email any case", "bundle-duplicate", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"THROWAWAY.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["same account id", "bundle-duplicate", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}}}"]
]'''
VECTORS_SHA256 = "c9a074ad1bfa047ab0991a68921f7af9dd6016883945c5da7968a0db0cab410d"
VECTORS = json.loads(VECTORS_TEXT)
PROJECT = "abcdefghijklmnopqrst"
SUPABASE_URL_OK = "https://%s.supabase.co" % PROJECT


def bundle_with(throwaway_id):
    d = json.loads(next(v[2] for v in VECTORS if v[0] == "valid"))
    d["accounts"]["existing-disposable"]["accountId"] = throwaway_id
    return json.dumps(d)


class LiveAccountsBundle(unittest.TestCase):
    def test_the_shared_vectors_are_the_pinned_ones_and_every_code_agrees(self):
        self.assertEqual(hashlib.sha256(VECTORS_TEXT.encode()).hexdigest(), VECTORS_SHA256)
        self.assertGreater(len(VECTORS), 20)
        for name, code, raw in VECTORS:
            if code == "ok":
                self.assertEqual(I.parse_live_accounts_bundle(raw)["projectRef"], PROJECT, name)
            else:
                refused(self, code, I.parse_live_accounts_bundle, raw)

    def test_role_truth_project_binding_and_the_maintained_role_refusal(self):
        b = I.parse_live_accounts_bundle(bundle_with(ACCOUNT_ID))
        self.assertEqual(I.role_account(b, "existing-disposable", SUPABASE_URL_OK)["accountId"], ACCOUNT_ID)
        # maintained-read-only data never fills THROWAWAY_* names; it refuses until Jensen's FREE allowlist/config contract exists (B6).
        refused(self, "maintained-read-only-live-execution-unavailable", I.role_account, b, "maintained-read-only", SUPABASE_URL_OK)
        for url in ("https://zzzzzzzzzzzzzzzzzzzz.supabase.co", "", None, "not a url"):
            refused(self, "bundle-project-mismatch", I.role_account, b, "existing-disposable", url)

    def test_masks_cover_the_whole_bundle_even_when_malformed_and_every_extracted_value(self):
        self.assertEqual(I.mask_values("{not json"), ["{not json"])
        raw = bundle_with(ACCOUNT_ID)
        b = I.parse_live_accounts_bundle(raw)
        want = {raw} | {v for a in b["accounts"].values() for v in (a["email"], a["email"].lower(), a["accountId"])}
        self.assertEqual(set(I.mask_values(raw)), want)
        self.assertEqual(I.mask_commands(["a%b", "x\ny"]), ["::add-mask::a%25b", "::add-mask::x%0Ay", "::add-mask::x", "::add-mask::y"])
        self.assertEqual(I.mask_commands(["%0A"]), ["::add-mask::%250A"])
        for cmd in I.mask_commands(I.mask_values('{"a":\n"b"}')):
            self.assertNotRegex(cmd, r"[\r\n]")

    def test_the_env_file_writer_refuses_any_unsafe_name_or_value_before_writing(self):
        d = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, d)
        path = os.path.join(d, "env")
        for bad in ({"THROWAWAY_TEST_EMAIL": "a@x.invalid\nINJECTED=1"}, {"THROWAWAY_TEST_EMAIL": "a@x.invalid\r"}, {"lower": "v"},
                    {"A-B": "v"}, {"OK": 7}, {"OK": "tab\tvalue"}):
            refused(self, "unsafe-environment-value", I.write_env_file, path, bad)
            self.assertFalse(os.path.exists(path))
        I.write_env_file(path, {"B": "2", "A": "1@x.invalid"})
        with open(path) as f:
            self.assertEqual(f.read(), "A=1@x.invalid\nB=2\n")

    def test_prepare_masks_before_any_refusal_and_never_prints_a_value(self):
        for raw in (bundle_with(ACCOUNT_ID), "{not json\nsecond line"):
            p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "init_run_inputs.py"), "prepare", "--repo", "/nonexistent",
                                "--run-id", "1", "--attempt", "1", "--source-sha", SHA], capture_output=True, text=True,
                               env={"PATH": os.environ["PATH"], "GITHUB_ACTIONS": "true", "CLOUD_TEST_LIVE_ACCOUNTS": raw})
            self.assertEqual(p.returncode, 78)
            lines = p.stdout.splitlines()
            self.assertTrue(lines and all(line.startswith("::add-mask::") for line in lines), lines)
            self.assertIn(I.mask_commands([raw])[0], lines)
            for line in raw.splitlines() + ([ACCOUNT_ID, "synthetic"] if raw.startswith("{\"") else []):
                self.assertNotIn(line, p.stderr)


if __name__ == "__main__":
    unittest.main()
