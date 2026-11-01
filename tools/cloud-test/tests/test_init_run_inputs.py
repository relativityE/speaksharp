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
from unittest import mock
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
        path, blob, raw = I.select_request(self.repo.dir, RUNS + "r6.json", self.head)
        self.assertEqual((path, blob), (os.path.join(self.repo.dir, RUNS + "r6.json"), self.repo.git("rev-parse", self.head + ":" + RUNS + "r6.json")))
        self.assertEqual(raw, self.repo.git("cat-file", "blob", blob).encode(), "the admitted bytes are exactly the committed blob")
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
        # Credential NAMES only; the account id comes from the private bundle, never from a named Variable.
        self.assertEqual(b["credentials"], {"email": "THROWAWAY_TEST_EMAIL", "password": "THROWAWAY_TEST_PASSWORD"})
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

    def test_admission_publishes_the_committed_request_digest_and_every_consumer_reads_a_private_copy_of_those_bytes(self):
        # The continuity contract is stubbed HERE ONLY, to observe what admission would hand the later steps.
        repo = GitRepo()
        self.addCleanup(shutil.rmtree, repo.dir)
        req = live_request(["AHT-05"])
        now = datetime.now(timezone.utc)
        req["window"].update(startUtc=utc(now - timedelta(hours=1)), endUtc=utc(now + timedelta(hours=1, minutes=30)))
        req["release"]["testedSha"] = repo.commit({"tools/cloud-test/config/test-config.v1.json": CFG})
        head = repo.commit({RUNS + "r6.json": req})
        out, env, outputs = (os.path.join(repo.dir, n) for n in ("out", "env", "outputs"))
        argv = ["init_run_inputs.py", "prepare", "--repo", repo.dir, "--config", "tools/cloud-test/config/test-config.v1.json", "--request",
                RUNS + "r6.json", "--facts", json.dumps(facts()), "--run-id", "123", "--attempt", "1", "--source-sha", head,
                "--job-timeout-minutes", "150", "--out", out, "--env-file", env, "--outputs", outputs]
        with mock.patch.object(I, "verified_checkpoint", lambda path: None), \
                mock.patch.dict(os.environ, {"CLOUD_TEST_LIVE_ACCOUNTS": bundle_with(ACCOUNT_ID), "SUPABASE_URL": SUPABASE_URL_OK}):
            self.assertEqual(I.main(argv), 0)
        committed = repo.git("cat-file", "blob", head + ":" + RUNS + "r6.json").encode()
        with open(outputs, encoding="utf-8") as f:
            published = dict(line.split("=", 1) for line in f.read().splitlines())
        self.assertEqual(published["request_sha256"], hashlib.sha256(committed).hexdigest())
        with open(env, encoding="utf-8") as f:
            ct_request = dict(line.split("=", 1) for line in f.read().splitlines())["CT_REQUEST"]
        self.assertEqual(ct_request, os.path.join(out, "request.json"), "consumers read the private admitted copy, not the workspace file")
        with open(ct_request, "rb") as f:
            self.assertEqual(f.read(), committed)
        self.assertEqual(stat.S_IMODE(os.stat(ct_request).st_mode), 0o600)
        # The validated bundle, canonical and private, for the per-case role consumers; only its digest is an output, never a value.
        with open(env, encoding="utf-8") as f:
            bundle_file = dict(line.split("=", 1) for line in f.read().splitlines())["CT_LIVE_ACCOUNTS_FILE"]
        self.assertEqual(bundle_file, os.path.join(out, "live-accounts.json"))
        self.assertEqual(stat.S_IMODE(os.stat(bundle_file).st_mode), 0o600)
        with open(bundle_file, "rb") as f:
            canonical = f.read()
        parsed = I.parse_live_accounts_bundle(bundle_with(ACCOUNT_ID))
        self.assertEqual(canonical, json.dumps({"version": 1, "projectRef": parsed["projectRef"], "accounts": parsed["accounts"]},
                                                sort_keys=True, separators=(",", ":")).encode())
        self.assertEqual(published["live_accounts_sha256"], hashlib.sha256(canonical).hexdigest())
        with open(outputs, encoding="utf-8") as f:
            outputs_text = f.read()
        self.assertNotIn("synthetic", outputs_text)
        self.assertNotIn(ACCOUNT_ID, outputs_text)
        self.assertEqual(I.canonical_bundle_bytes(I.parse_live_accounts_bundle(canonical.decode())), canonical, "canonical bytes are a fixed point")
        # The window check accepts exactly those bytes, and refuses them once the workspace-style copy is rewritten.
        check = lambda: subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "init_run_inputs.py"), "window-check", "--request",
                                        ct_request, "--live-minutes", "47", "--request-sha256", published["request_sha256"]],
                                       capture_output=True, text=True, env={"PATH": os.environ["PATH"]})
        self.assertEqual(check().returncode, 0, check().stderr)
        os.chmod(ct_request, 0o600)
        put(ct_request, dict(req, window=dict(req["window"], endUtc="2099-01-01T00:00:00Z")))
        self.assertEqual((check().returncode, check().stderr.strip()), (78, "BLOCKED_SETUP: request-changed-since-admission"))


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

    def write_case(self, cid, rows, result="PASS", refresh=True):
        os.makedirs(os.path.join(self.cases, cid), exist_ok=True)
        ev = os.path.join(self.cases, cid, cid.lower() + "-1.json")
        put(ev, {"contentSafe": True})
        put(os.path.join(self.cases, cid, "summary.json"), {"caseId": cid})
        put(os.path.join(self.cases, cid, "case-result.json"),
            {"caseId": cid, "sourceSha": SHA, "servedSha": SHA, "result": result,  # per-case receipt identities, as the stricter verifier requires
             "assertions": [{"id": "%s-%s" % (cid.lower(), i), "result": r} for i, r in rows],
             "evidenceDigests": {cid.lower() + "-1.json": self.sha(ev)}})
        if refresh and cid in self.SELECTED and os.path.exists(self.results):
            self.write_results()  # the campaign row follows its case, as the real runner writes both

    def write_results(self, rows=None, patch=None, **over):
        """The campaign case-results as the real runner writes them: each dispatched row carries the case's own result and assertions
        (campaign-core.cjs); unselected rows are notSelected. `patch` replaces or edits single rows for negative controls."""
        def row(c):
            if c in self.SELECTED:
                case = J(os.path.join(self.cases, c, "case-result.json"))
                return {"caseId": c, "result": case["result"], "assertions": case["assertions"],
                        "executionReceipt": {"summarySha256": self.sha(os.path.join(self.cases, c, "summary.json"))}}
            return {"caseId": c, "result": "NOT RUN", "notSelected": True, "requestsUsed": 0, "reason": "Not selected by the approved case selection"}
        built = rows or [row(c) for c in I.ALL_CASES]
        for c, change in (patch or {}).items():
            built = [change(dict(r)) if r["caseId"] == c else r for r in built]
        put(self.results, dict({"campaignId": "C1", "sourceSha": SHA, "servedSha": SHA, "cases": built}, **over))

    def qualify(self, run_verifier=I._run_verifier, selected=None, mode="partial"):
        self.runs += 1
        request_file = os.path.join(self.d, "request-%d.json" % self.runs)
        put(request_file, self.request(selected, mode))
        ids = self.ids(request_file)
        return I.qualify(self.plan, self.results, self.cases, selected or self.SELECTED, self.approval, self.code,
                         os.path.join(self.d, "snapshot-%d" % self.runs), mode, ids, run_verifier)

    def request(self, selected=None, mode="partial"):
        """The committed request this campaign ran: runId = campaignId, the selection, the tested release and the harness CODE pin."""
        req = live_request(None if mode == "full" else list(selected or self.SELECTED), runId="C1")
        req["release"]["testedSha"] = SHA
        req["harness"]["codeManifestSha256"] = self.sha(self.code)
        return req

    def ids(self, request_file, catalog=None):
        """identities() shape over a synthetic catalog whose per-case sets are exactly this fixture's required assertions."""
        return {"requestSha256": self.sha(request_file), "request": J(request_file), "catalogSha256": "c" * 64,
                "catalog": catalog or {c: ["%s-a" % c.lower(), "%s-b" % c.lower()] for c in I.ALL_CASES}}

    def make_full(self):
        """The real full builder's shape: no partial markers, an explicit all-15 selection, every case dispatched with its receipts."""
        plan = J(self.plan)
        plan.pop("coverageMode"); plan.pop("assertionDepth")
        plan["selection"] = {"ids": list(I.ALL_CASES), "order": list(I.ALL_CASES), "ownerApprovalReference": "slack:1", "reason": "unit"}
        put(self.plan, plan)
        self.SELECTED = list(I.ALL_CASES)
        for cid in I.ALL_CASES:
            self.write_case(cid, [("a", "PASS"), ("b", "PASS")], refresh=False)
        self.write_results()

    def collect(self, request):
        """The REAL collector over the same case results (collect_run_record.py; campaign-runner rows carry their assertions)."""
        request["harness"]["codeManifestSha256"] = self.sha(self.code)  # the reviewed harness pin the run executed
        results = J(self.results)
        for row in results["cases"]:
            if row["caseId"] in self.SELECTED:
                case = J(os.path.join(self.cases, row["caseId"], "case-result.json"))
                row.update(result=case["result"], assertions=case["assertions"])
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
            rec = I.project(record, "123", 1, "c" * 40, SHA, q, q["requestSha256"])
            self.assertEqual((rec["outcome"], rec["coverage"], rec["campaignId"], len(rec["cases"])),
                             ("passed", "full" if mode == "full" else "batch", "C1", 15), mode)
            self.assertEqual(sum(c["result"] == "NOT SELECTED" for c in rec["cases"]), 0 if mode == "full" else 13)
            self.assertEqual((rec["requestSha256"], rec["catalogSha256"]), (q["requestSha256"], q["catalogSha256"]))
            # a full claim against a selected-full plan, and the reverse, are refused by the qualifier itself
            if mode == "full":
                refused(self, "plan-not-a-selected-full-plan", self.qualify, mode="partial")
            else:
                # A "full" claim on a selected-full campaign is refused at the request binding, before any plan inspection.
                refused(self, "request-selection-mismatch", self.qualify, mode="full")
            # the collector's campaign is the request runId; a qualification for another campaign never passes
            other = I.project(dict(record, runId="C2"), "123", 1, "c" * 40, SHA, q, q["requestSha256"])
            self.assertEqual((other["outcome"], other["coverage"]), ("failed", "unqualified"), mode)

    def test_a_request_substituted_after_admission_keeping_the_five_checked_fields_never_qualifies(self):
        # Sam 1793548687.416409: the five execution-identity checks (runId, selection, tested release, mode, harness CODE pin) do not bind the
        # request blob. Substitute window, approval and budget fields after admission while preserving those five exactly.
        record = self.collect(live_request(list(self.SELECTED), runId="C1"))
        request_file = os.path.join(self.d, "admitted.json")
        put(request_file, self.request())
        admitted = self.sha(request_file)
        substitute = self.request()
        substitute["window"].update(endUtc="2099-01-01T00:00:00Z", approvalRef="slack:1793549999.000001")
        substitute["selectionApprovalRef"] = "slack:1793549999.000002"
        substitute["approvedLimits"].update(runCapRequests=4000, cumulativeCeilingRequests=99999, identityCap=999, approvalRef="slack:1793549999.000003")
        substitute["estimate"]["requests"]["runCap"] = 4000
        self.assertEqual({k: substitute[k] for k in ("runId", "selection", "release", "coverageMode", "harness")},
                         {k: self.request()[k] for k in ("runId", "selection", "release", "coverageMode", "harness")})
        put(request_file, substitute)
        # The five field checks alone accept the substitute: they are not a blob binding.
        q = I.qualify(self.plan, self.results, self.cases, self.SELECTED, self.approval, self.code, os.path.join(self.d, "snapshot-substitute"),
                      "partial", self.ids(request_file))
        self.assertEqual((q["qualified"], q["outcome"]), (True, "passed"))
        self.assertNotEqual(q["requestSha256"], admitted)
        # The admission digest refuses it at qualification (bytes read once, hashed and parsed from the same bytes)...
        refused(self, "request-changed-since-admission", I.identities, request_file, "config-not-reached", admitted)
        for bad in (None, "", "1" * 63, "A" * 64, admitted.upper()):
            refused(self, "admitted-request-digest", I.admitted_request, request_file, bad)
        # ...and a qualification bound to any other request never projects as qualified.
        for digest in (admitted, None, "x"):
            rec = I.project(record, "123", 1, "c" * 40, SHA, q, digest)
            self.assertEqual((rec["outcome"], rec["coverage"], rec["requestSha256"], rec["codes"]), ("failed", "unqualified", None, ["not-qualified"]), digest)
        self.assertEqual(I.project(record, "123", 1, "c" * 40, SHA, q, q["requestSha256"])["outcome"], "passed", "the same bytes still bind")

    def test_a_complete_authenticated_fail_baseline_is_full_and_failed(self):
        # Sam 1793547120.015339: every required row executed (PASS or FAIL) is full coverage; FAILs make the outcome failed, never unqualified.
        self.make_full()
        self.write_case("AHT-03", [("a", "PASS"), ("b", "FAIL")], "FAIL")
        self.write_case("AHT-12", [("a", "FAIL"), ("b", "FAIL")], "FAIL")
        self.write_results()
        record = self.collect(live_request(runId="C1"))
        q = self.qualify(mode="full")
        self.assertEqual((q["qualified"], q["coverage"], q["outcome"], q["requiredRows"], q["passRows"], q["failRows"], q["notRunRows"]),
                         (True, "full", "failed", 30, 27, 3, 0))
        self.assertEqual(J(os.path.join(self.d, "snapshot-%d" % self.runs, "verification.json"))["failed"], 0)
        rec = I.project(record, "123", 1, "c" * 40, SHA, q, q["requestSha256"])
        self.assertEqual((rec["coverage"], rec["outcome"], rec["codes"], len(rec["cases"])), ("full", "failed", [], 15))
        self.assertEqual(sorted(c["caseId"] for c in rec["cases"] if c["result"] == "FAIL"), ["AHT-03", "AHT-12"])

    def test_a_not_run_or_missing_required_row_is_incomplete_never_full(self):
        for rows, result in ([("a", "PASS"), ("b", "NOT RUN")], "NOT RUN"), ([("a", "PASS")], "PASS"):
            self.setUp()
            self.write_case("AHT-09", rows, result)
            self.write_results()
            q = self.qualify()
            self.assertEqual((q["coverage"], q["outcome"], q["notRunRows"]), ("incomplete", "failed", 1), rows)

    def test_verifier_errors_malformed_evidence_and_missing_rows_never_qualify(self):
        # Real verify_run_binding semantics: a dispatched case without its case-result.json, or with unreadable JSON, makes it exit non-zero.
        os.remove(os.path.join(self.cases, "AHT-09", "case-result.json"))
        refused(self, "binding-verifier-failed", self.qualify)
        self.setUp()
        put(os.path.join(self.cases, "AHT-09", "case-result.json"), "{not json")
        refused(self, "binding-verifier-failed", self.qualify)
        self.setUp()
        put(os.path.join(self.cases, "AHT-09", "aht-09-1.json"), {"tampered": True})  # evidence no longer matches its digest
        refused(self, "binding-verifier-failed", self.qualify)
        self.setUp()
        self.write_case("AHT-09", [("a", "PASS"), ("b", "FAIL")], "PASS")  # the harness case result contradicts its rows
        refused(self, "case-result-inconsistent:AHT-09", self.qualify)
        self.setUp()
        self.write_case("AHT-09", [("a", "PASS"), ("b", "MAYBE")], "PASS")
        refused(self, "assertion-result-unknown:AHT-09", self.qualify)

    def test_required_assertions_must_be_exactly_the_catalog_set(self):
        # Remove a required assertion from AHT-09's config and refresh the plan's config digest: every hash stays coherent, the case can
        # even PASS, but it no longer covers the catalog (Sam RETURN 546429c4 #1).
        config = os.path.join(self.d, "cfg", "AHT-09.json")
        put(config, {"caseId": "AHT-09", "requiredAssertions": ["aht-09-a"]})
        plan = J(self.plan)
        for row in plan["cases"]:
            if row["id"] == "AHT-09":
                row["configSha256"] = self.sha(config)
        put(self.plan, plan)
        self.write_case("AHT-09", [("a", "PASS")], "PASS")
        refused(self, "required-assertions-not-the-catalog:AHT-09", self.qualify)
        # And a catalog that requires more than the config declares refuses the same way.
        self.setUp()
        catalog = {c: ["%s-a" % c.lower(), "%s-b" % c.lower()] for c in I.ALL_CASES}
        catalog["AHT-05"].append("aht-05-c")
        put(os.path.join(self.d, "req.json"), self.request())
        refused(self, "required-assertions-not-the-catalog:AHT-05", I.qualify, self.plan, self.results, self.cases, self.SELECTED, self.approval,
                self.code, os.path.join(self.d, "snapshot-cat"), "partial", self.ids(os.path.join(self.d, "req.json"), catalog))

    def test_a_substituted_request_refuses(self):
        for code, mutate in (("request-campaign-mismatch", lambda r: r.update(runId="C2")),
                             ("request-selection-mismatch", lambda r: r.update(selection=r["selection"][:1])),
                             ("request-release-mismatch", lambda r: r["release"].update(testedSha="b" * 40)),
                             ("request-mode-mismatch", lambda r: r.update(coverageMode="full")),
                             ("request-harness-mismatch", lambda r: r["harness"].update(codeManifestSha256="0" * 64))):
            self.runs += 1
            req = self.request()
            mutate(req)
            path = os.path.join(self.d, "sub-%d.json" % self.runs)
            put(path, req)
            refused(self, code, I.qualify, self.plan, self.results, self.cases, self.SELECTED, self.approval, self.code,
                    os.path.join(self.d, "snapshot-sub-%d" % self.runs), "partial", self.ids(path))

    def test_a_campaign_row_that_contradicts_its_case_file_refuses_even_when_the_outcome_is_failed(self):
        # AHT-09 genuinely FAILs (overall outcome failed either way); the campaign row reports a different status for one assertion.
        self.write_case("AHT-09", [("a", "PASS"), ("b", "FAIL")], "FAIL")
        self.write_results(patch={"AHT-09": lambda r: {**r, "assertions": [{"id": "aht-09-a", "result": "FAIL"}, {"id": "aht-09-b", "result": "FAIL"}]}})
        refused(self, "campaign-row-disagrees:AHT-09", self.qualify)
        for change in (lambda r: {**r, "result": "PASS"}, lambda r: {**r, "assertions": r["assertions"][:1]},
                       lambda r: {**r, "assertions": r["assertions"] + [{"id": "aht-09-z", "result": "FAIL"}]},
                       lambda r: {k: v for k, v in r.items() if k != "assertions"}):
            self.write_results(patch={"AHT-09": change})
            refused(self, "campaign-row-disagrees:AHT-09", self.qualify)
        self.write_results()
        self.assertEqual(self.qualify()["outcome"], "failed", "the agreeing artifacts qualify as failed")

    def test_the_assertion_catalog_must_be_the_pinned_bytes(self):
        cfg = copy.deepcopy(CFG)
        cfg["modes"]["full"]["assertionCatalog"]["sha256"] = "0" * 64
        d = os.path.join(self.d, "cfgroot", "config")
        os.makedirs(d)
        put(os.path.join(d, "test-config.v1.json"), cfg)
        shutil.copy(os.path.join(ROOT, cfg["modes"]["full"]["assertionCatalog"]["file"]), os.path.join(d, os.path.basename(cfg["modes"]["full"]["assertionCatalog"]["file"])))
        put(os.path.join(self.d, "r.json"), {})
        refused(self, "assertion-catalog-not-pinned", I.identities, os.path.join(self.d, "r.json"), os.path.join(d, "test-config.v1.json"),
                self.sha(os.path.join(self.d, "r.json")))

    def test_the_real_verifier_on_the_frozen_snapshot_and_every_selected_row_pass_qualifies_with_bindings(self):
        q = self.qualify()
        self.assertEqual({k: q[k] for k in ("qualified", "campaignId", "testedSha", "servedSha", "cases", "coverage", "outcome", "planCases",
                                            "requiredRows", "passRows", "failRows", "notRunRows")},
                         {"qualified": True, "campaignId": "C1", "testedSha": SHA, "servedSha": SHA, "cases": self.SELECTED, "coverage": "batch",
                          "outcome": "passed", "planCases": 15, "requiredRows": 4, "passRows": 4, "failRows": 0, "notRunRows": 0})
        self.assertEqual(q["codeManifestSha256"], self.sha(self.code))
        self.assertEqual(q["catalogSha256"], "c" * 64, "the fixture's synthetic catalog; identities() pins the real one")
        self.assertEqual((q["planSha256"], q["caseResultsSha256"]), (self.sha(self.plan), self.sha(self.results)))
        snap = os.path.join(self.d, "snapshot-1")
        self.assertEqual(J(os.path.join(snap, "verification.json"))["failed"], 0)
        self.assertEqual(stat.S_IMODE(os.stat(snap).st_mode), 0o700)

    def test_verifier_success_never_passes_a_failed_row_and_a_duplicate_refuses(self):
        self.write_case("AHT-09", [("a", "PASS"), ("b", "FAIL")], "FAIL")
        q = self.qualify()
        self.assertEqual((q["coverage"], q["outcome"], q["failRows"]), ("batch", "failed", 1))
        self.write_case("AHT-09", [("a", "PASS"), ("b", "FAIL"), ("b", "PASS")], "FAIL")
        refused(self, "duplicate-assertion:AHT-09", self.qualify)
        self.assertEqual(J(os.path.join(self.d, "snapshot-%d" % self.runs, "verification.json"))["failed"], 0, "the verifier itself passes")

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
            saved = {}
            for p in originals:
                with open(p, "rb") as f:
                    saved[p] = f.read()
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
        self.assertEqual(self.qualify(swap_restore)["outcome"], "failed", "the frozen FAIL decides, not the swapped bytes")

    def test_a_snapshot_changed_during_verification_is_refused(self):
        def tamper(*a):
            rc = I._run_verifier(*a)
            put(os.path.join(os.path.dirname(a[0]), "cases", "AHT-09", "case-result.json"), {"caseId": "AHT-09"})
            return rc
        refused(self, "snapshot-changed-during-verification", self.qualify, tamper)

    def test_undispatched_unselected_dispatched_denominator_and_selection_controls(self):
        self.write_results(patch={"AHT-09": lambda r: {**r, "reason": "not dispatched"}})
        refused(self, "case-not-dispatched:AHT-09", self.qualify)
        self.setUp()
        self.write_case("AHT-01", [("a", "PASS"), ("b", "PASS")])  # receipts present, so the verifier itself passes
        self.write_results(patch={"AHT-01": lambda r: {"caseId": "AHT-01"}})
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
                "startedUtc": "2026-11-01T14:00:00Z", "endedUtc": "2026-11-01T14:30:00Z", "cases": rows, "artifactDigests": {"case-results.json": "d" * 64},
                "harness": {"codeManifestSha256": "f" * 64}}

    def q(self, **over):
        return dict({"qualified": True, "campaignId": "R6-unit", "testedSha": SHA, "servedSha": SHA, "caseResultsSha256": "d" * 64,
                     "planSha256": "e" * 64, "cases": ["AHT-05", "AHT-09"], "coverage": "batch", "outcome": "passed",
                     "codeManifestSha256": "f" * 64, "requestSha256": "1" * 64, "catalogSha256": "2" * 64}, **over)

    def project(self, *a):
        """Projection against the admitted request digest this qualification fixture is bound to."""
        return I.project(*a, "1" * 64)

    def test_a_bound_batch_keeps_all_fifteen_rows_with_the_others_not_selected(self):
        rec = self.project(self.record(), "123", 1, "c" * 40, SHA, self.q())
        self.assertEqual((rec["outcome"], rec["coverage"], rec["campaignId"], len(rec["cases"])), ("passed", "batch", "R6-unit", 15))
        self.assertEqual(sorted(c["caseId"] for c in rec["cases"] if c["result"] == "PASS"), ["AHT-05", "AHT-09"])
        self.assertEqual({c["result"] for c in rec["cases"] if c["caseId"] not in ("AHT-05", "AHT-09")}, {"NOT SELECTED"})
        self.assertEqual((rec["sourceSha"], rec["testedSha"], rec["servedSha"]), ("c" * 40, SHA, SHA))

    def test_the_campaign_must_match_exactly_on_both_sides(self):
        for record_run, q_campaign in (("R6-other", "R6-unit"), ("R6-unit", "R6-other"), ("", ""), (None, None), ("R6-unit", None)):
            rec = self.project(dict(self.record(), runId=record_run), "123", 1, "c" * 40, SHA, self.q(campaignId=q_campaign))
            self.assertEqual((rec["outcome"], rec["coverage"], rec["campaignId"]), ("failed", "unqualified", None), (record_run, q_campaign))
        self.assertEqual(self.project(self.record(), "123", 1, "c" * 40, SHA, self.q())["campaignId"], "R6-unit")

    def test_a_qualification_for_another_record_campaign_or_release_never_passes(self):
        for over in ({"caseResultsSha256": "f" * 64}, {"servedSha": "b" * 40}, {"testedSha": "b" * 40}, {"qualified": False},
                     {"coverage": "unqualified"}, {"cases": ["AHT-05", "AHT-16"]}, {"codeManifestSha256": "0" * 64}, {"outcome": None}):
            rec = self.project(self.record(), "123", 1, "c" * 40, SHA, self.q(**over))
            self.assertEqual((rec["outcome"], rec["coverage"], rec["codes"]), ("failed", "unqualified", ["not-qualified"]), over)
            self.assertNotIn("NOT SELECTED", {c["result"] for c in rec["cases"]})
        rec = self.project(self.record(), "123", 1, "c" * 40, SHA, None)
        self.assertEqual((rec["outcome"], rec["codes"]), ("failed", ["not-qualified"]))
        for admitted in ("0" * 64, None, "", "1" * 63, "A" * 64):
            rec = I.project(self.record(), "123", 1, "c" * 40, SHA, self.q(), admitted)
            self.assertEqual((rec["outcome"], rec["coverage"], rec["requestSha256"]), ("failed", "unqualified", None), admitted)
        refused(self, "run-record-for-another-release", I.project, self.record(), "123", 1, "c" * 40, "b" * 40, self.q())

    def test_a_failed_or_incomplete_qualification_never_publishes_passed(self):
        failed = self.record()
        failed["cases"][8].update(result="FAIL", assertions={"PASS": 1, "FAIL": 1, "NOT RUN": 0})  # AHT-09
        rec = self.project(failed, "123", 1, "c" * 40, SHA, self.q(outcome="failed"))
        self.assertEqual((rec["outcome"], rec["coverage"], rec["codes"]), ("failed", "batch", []))
        rec = self.project(self.record(), "123", 1, "c" * 40, SHA, self.q(outcome="failed", coverage="incomplete"))
        self.assertEqual((rec["outcome"], rec["coverage"], rec["codes"]), ("failed", "incomplete", []))
        # A qualification whose outcome disagrees with the record's rows is not bound to this record.
        for record, q in ((self.record(), self.q(outcome="failed")), (failed, self.q(outcome="passed"))):
            rec = I.project(record, "123", 1, "c" * 40, SHA, q, q["requestSha256"])
            self.assertEqual((rec["outcome"], rec["coverage"], rec["codes"]), ("failed", "unqualified", ["not-qualified"]))

    def test_full_coverage_needs_all_fifteen_selected(self):
        record = self.record()
        for c in record["cases"]:
            c.update(result="PASS", reason=None, assertions={"PASS": 2, "FAIL": 0, "NOT RUN": 0})
        self.assertEqual(self.project(record, "123", 1, "c" * 40, SHA, self.q(cases=I.ALL_CASES, coverage="full"))["coverage"], "full")
        rec = self.project(self.record(), "123", 1, "c" * 40, SHA, self.q(coverage="full"))
        self.assertEqual((rec["outcome"], rec["coverage"]), ("failed", "unqualified"), "a 'full' claim for two cases is not bound")



# SHARED with tests/unit/verifyTestUsersLiveJourney.test.js: the identical vector text, pinned by the same sha256 in both suites, so the
# two consumers of the CLOUD_TEST_LIVE_ACCOUNTS bundle agree on every accepted and refused shape and its code.
VECTORS_TEXT = r'''{"bundles": [
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
["account id uppercase", "bundle-account-id", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"AAAAAAAA-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["account id v1", "bundle-account-id", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-1111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["account id not string", "bundle-account-id", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": 1}}}"],
["same email any case", "bundle-duplicate", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"THROWAWAY.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["same account id", "bundle-duplicate", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}}}"],
["email U+0085", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"a\\u0085@x.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email supplementary character", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"a\\ud83d\\ude00@x.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email non-ASCII letter", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"caf\\u00e9@x.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email NBSP", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"a\\u00a0b@x.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email 255 characters", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@x.invalid12\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email 254 characters", "ok", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@x.invalid12\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"]
],
"urls": [
["origin", "ok", "https://abcdefghijklmnopqrst.supabase.co"],
["origin with slash", "ok", "https://abcdefghijklmnopqrst.supabase.co/"],
["default port", "ok", "https://abcdefghijklmnopqrst.supabase.co:443"],
["upper-case host", "ok", "https://ABCDEFGHIJKLMNOPQRST.supabase.co"],
["http", "bundle-project-mismatch", "http://abcdefghijklmnopqrst.supabase.co"],
["other project", "bundle-project-mismatch", "https://zzzzzzzzzzzzzzzzzzzz.supabase.co"],
["suffixed domain", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.supabase.co.evil.example"],
["wrong domain", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.evil.example"],
["userinfo", "bundle-project-mismatch", "https://user:pw@abcdefghijklmnopqrst.supabase.co"],
["empty userinfo", "bundle-project-mismatch", "https://@abcdefghijklmnopqrst.supabase.co"],
["unexpected port", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.supabase.co:8443"],
["path", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.supabase.co/rest/v1"],
["query", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.supabase.co?x=1"],
["fragment", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.supabase.co#f"],
["not a URL", "bundle-project-mismatch", "not a url"],
["empty", "bundle-project-mismatch", ""]
]}'''
VECTORS_SHA256 = "ca05b324277e3c5318a6bd398204bb5e9fbc21941141b396161171f837108d58"
VECTOR_DOC = json.loads(VECTORS_TEXT)
VECTORS, URL_VECTORS = VECTOR_DOC["bundles"], VECTOR_DOC["urls"]
PROJECT = "abcdefghijklmnopqrst"
SUPABASE_URL_OK = "https://%s.supabase.co" % PROJECT


def bundle_with(throwaway_id):
    d = json.loads(next(v[2] for v in VECTORS if v[0] == "valid"))
    d["accounts"]["existing-disposable"]["accountId"] = throwaway_id
    return json.dumps(d)


class ExecutionProvenance(unittest.TestCase):
    """I4' caller-side receiving checks against Jensen's posted fields, with every expectation derived from a COMPLETE frozen plan:
    discriminating fixtures, including the decisive A-admitted / B-consumed-at-runtime / A-restored case in which reserve and collector
    both honestly report A, and a coherent substitution of expectations and receipts against unchanged plan bytes."""
    A, B = "a" * 64, "b" * 64
    SELECTED = ["AHT-05", "AHT-09"]
    ID = {"campaignId": "C1", "runId": "123", "attempt": 1}
    SOURCE, SERVED = "1" * 40, "2" * 40  # distinct, valid source and served releases

    def plan(self, built_from=None, **over):
        """The builder's full shape: campaign, source and served release, the request digest it was built from, all 15 case rows."""
        doc = {"campaignId": "C1", "sourceSha": self.SOURCE, "servedSha": self.SERVED, "requestSha256": built_from or self.A,
               "coverageMode": "partial", "assertionDepth": "full", "selection": {"ids": list(self.SELECTED), "order": list(self.SELECTED)},
               "cases": [{"id": c, "configFile": "configs/%s.json" % c, "configSha256": hashlib.sha256(c.encode()).hexdigest(),
                          "driverFile": "drivers/%s.cjs" % c, "driverSha256": "d" * 64} for c in I.ALL_CASES]}
        doc.update(over)
        return doc

    def world(self, built_from=None):
        """One honest execution; `built_from` is the request digest build_plan actually read (B in the swap case)."""
        reader = lambda consumer, digest=self.A, **extra: dict(self.ID, requestSha256=digest, consumer=consumer,  # noqa: E731
                                                               consumedAtUtc="2026-11-01T17:00:00Z", **extra)
        w = {"admitted": self.A, "identity": dict(self.ID), "case_results_raw": b'{"cases":[]}', "selected": list(self.SELECTED),
             "readers": [reader("reservation", allocation={}, reservationEntryHash="e" * 64), reader("build-plan", built_from or self.A),
                         reader("collector")]}
        return self.rebind(w, self.plan(built_from))

    def rebind(self, w, plan_doc):
        """Coherently (re)derive everything downstream of a plan: builder record, runtime receipts from the plan rows, collection digests."""
        w["plan_raw"] = json.dumps(plan_doc, sort_keys=True).encode()
        plan_sha = hashlib.sha256(w["plan_raw"]).hexdigest()
        w["readers"][1]["planSha256"] = plan_sha
        rows = {r.get("id"): r for r in plan_doc.get("cases") or [] if isinstance(r, dict)} if isinstance(plan_doc.get("cases"), list) else {}
        w["runtime"] = [dict(self.ID, caseId=c, planSha256=plan_sha, configSha256=(rows.get(c) or {}).get("configSha256"), requestSha256=self.A,
                             sourceSha=plan_doc.get("sourceSha"), servedSha=plan_doc.get("servedSha")) for c in self.SELECTED]
        self.recollect(w)
        return w

    def recollect(self, w):
        w["collection"] = {"requestSha256": self.A, "caseResultsSha256": hashlib.sha256(w["case_results_raw"]).hexdigest(),
                           "runtimeReceiptDigests": {r["caseId"]: I._canon_digest(r) for r in w["runtime"]}}

    def check(self, w):
        return I.check_execution_provenance(**w)

    def test_an_honest_execution_binds(self):
        self.assertEqual(self.check(self.world())["cases"], self.SELECTED)

    def test_a_admitted_b_consumed_at_runtime_a_restored_is_refused_although_reserve_and_collector_report_a(self):
        w = self.world(built_from=self.B)
        self.assertEqual({r["consumer"]: r["requestSha256"] for r in w["readers"]}, {"reservation": self.A, "build-plan": self.B, "collector": self.A})
        self.assertEqual(w["collection"]["requestSha256"], self.A)
        refused(self, "request-not-the-admitted-request:build-plan", self.check, w)
        # A builder record that misreports A is caught by the executed plan's own bytes, which the runtime receipts bind by digest.
        w["readers"][1]["requestSha256"] = self.A
        refused(self, "runtime-plan-not-from-the-admitted-request", self.check, w)

    def test_a_coherent_substitution_of_expectations_and_receipts_against_the_unchanged_plan_is_refused(self):
        # Sam 1793551555.012439: substitute the release and config the receipts claim, refresh the collection digests, keep plan bytes.
        for over, code in (({"sourceSha": "3" * 40}, "runtime-source-release:AHT-05"), ({"servedSha": "4" * 40}, "runtime-served-release:AHT-05"),
                           ({"configSha256": "c" * 64}, "runtime-receipt-not-bound:AHT-05")):
            w = self.world()
            plan_before = w["plan_raw"]
            for rr in w["runtime"]:
                rr.update(over)
            self.recollect(w)
            self.assertEqual(w["plan_raw"], plan_before)
            refused(self, code, self.check, w)

    def test_the_plan_itself_must_be_complete_this_campaigns_and_name_a_valid_release(self):
        for over, code in (({"campaignId": "C2"}, "plan-not-this-campaign"), ({"campaignId": None}, "plan-not-this-campaign"),
                           ({"sourceSha": "s" * 40}, "plan-release"), ({"servedSha": None}, "plan-release"),
                           ({"cases": None}, "plan-cases"), ({"cases": [None]}, "plan-cases"), ({"cases": [{"id": 5}]}, "plan-cases")):
            w = self.rebind(self.world(), self.plan(**over))
            with self.subTest(over=over):
                refused(self, code, self.check, w)
        doc = self.plan()
        doc["cases"] = doc["cases"] + [dict(doc["cases"][0])]
        refused(self, "plan-cases", self.check, self.rebind(self.world(), doc))
        for mutate in (lambda rows: [r for r in rows if r["id"] != "AHT-09"], lambda rows: [dict(r, configSha256=None) if r["id"] == "AHT-09" else r for r in rows],
                       lambda rows: [dict(r, configSha256="Z" * 64) if r["id"] == "AHT-09" else r for r in rows]):
            doc = self.plan()
            doc["cases"] = mutate(doc["cases"])
            w = self.rebind(self.world(), doc)  # receipts coherently carry the plan's missing/null/malformed config
            refused(self, "planned-config-digests", self.check, w)

    def test_a_swap_seen_by_any_single_reader_is_refused_at_that_reader(self):
        for k, consumer in enumerate(I.REQUIRED_READERS):
            w = self.world()
            w["readers"][k]["requestSha256"] = self.B
            refused(self, "request-not-the-admitted-request:" + consumer, self.check, w)
        w = self.world()
        w["collection"]["requestSha256"] = self.B
        refused(self, "request-not-the-admitted-request:collection", self.check, w)

    def test_missing_duplicate_unknown_or_foreign_reader_records_are_refused(self):
        for mutate, code in ((lambda w: w["readers"].pop(0), "request-not-the-admitted-request:reservation"),
                             (lambda w: w["readers"].append(dict(w["readers"][2])), "request-reader-record"),
                             (lambda w: w["readers"][0].update(consumer="other"), "request-reader-record"),
                             (lambda w: w["readers"][2].pop("consumedAtUtc"), "request-reader-record"),
                             (lambda w: w["readers"][0].update(runId="124"), "reader-not-this-attempt:reservation"),
                             (lambda w: w["readers"][1].update(attempt=2), "reader-not-this-attempt:build-plan"),
                             (lambda w: w["readers"][2].update(campaignId="C2"), "reader-not-this-attempt:collector"),
                             (lambda w: w.update(readers=None), "request-reader-record"),
                             (lambda w: w.update(readers=[None]), "request-reader-record")):
            w = self.world()
            mutate(w)
            refused(self, code, self.check, w)

    def test_runtime_receipts_must_run_the_built_plan_and_its_config_for_exactly_the_selected_cases(self):
        for mutate, code in ((lambda w: w["readers"][1].update(planSha256="0" * 64), "runtime-plan-not-the-built-plan"),
                             (lambda w: w["runtime"][1].update(configSha256="0" * 64), "runtime-receipt-not-bound:AHT-09"),
                             (lambda w: w["runtime"][1].update(configSha256=None), "runtime-receipt-not-bound:AHT-09"),
                             (lambda w: w["runtime"][0].update(requestSha256=self.B), "runtime-receipt-not-bound:AHT-05"),
                             (lambda w: w["runtime"][0].update(attempt=2), "runtime-receipt-not-bound:AHT-05"),
                             (lambda w: w["runtime"][1].pop("servedSha"), "runtime-receipt-not-bound:AHT-09"),
                             (lambda w: w["runtime"].pop(), "runtime-receipts-not-the-selected-cases"),
                             (lambda w: w["runtime"].append(dict(w["runtime"][0])), "duplicate-runtime-receipt"),
                             (lambda w: w.update(runtime=None), "runtime-receipt-shape"),
                             (lambda w: w.update(runtime=[{"caseId": 5}]), "runtime-receipt-shape")):
            w = self.world()
            mutate(w)
            refused(self, code, self.check, w)
        for field, code in (("sourceSha", "runtime-source-release:AHT-05"), ("servedSha", "runtime-served-release:AHT-05")):
            for bad in ("s" * 40, "1" * 39, None, "A" * 40):
                w = self.world()
                w["runtime"][0][field] = bad
                refused(self, code, self.check, w)

    def test_the_collection_record_binds_these_results_and_each_runtime_receipt(self):
        w = self.world()
        w["case_results_raw"] = b'{"cases":[1]}'
        refused(self, "collection-not-these-case-results", self.check, w)
        w = self.world()
        w["collection"]["runtimeReceiptDigests"]["AHT-05"] = "0" * 64
        refused(self, "collection-runtime-digests", self.check, w)
        w = self.world()
        w["collection"]["runtimeReceiptDigests"] = None
        refused(self, "collection-runtime-digests", self.check, w)
        w = self.world()
        w["collection"] = None
        refused(self, "request-not-the-admitted-request:collection", self.check, w)

    def test_the_admission_identity_is_strict_and_attempt_one_even_when_every_record_agrees(self):
        for over in ({"attempt": 2}, {"attempt": True}, {"attempt": 1.0}, {"runId": 123}, {"runId": "12a"}, {"campaignId": ""},
                     {"campaignId": " C1"}, {"campaignId": None}):
            w = self.world()
            w["identity"].update(over)
            for rec in w["readers"] + w["runtime"]:
                rec.update(over)
            refused(self, "execution-identity", self.check, w)
        for k, v in ((0, True), (1, 1.0)):
            w = self.world()
            w["readers"][k]["attempt"] = v
            refused(self, "reader-not-this-attempt:" + I.REQUIRED_READERS[k], self.check, w)
        w = self.world()
        w["runtime"][0]["attempt"] = True
        refused(self, "runtime-receipt-not-bound:AHT-05", self.check, w)

    def test_inputs_are_validated_before_lookups_with_deliberate_refusals(self):
        for key, value, code in (("admitted", "", "admitted-request-digest"), ("admitted", None, "admitted-request-digest"),
                                 ("admitted", "A" * 64, "admitted-request-digest"), ("identity", None, "execution-identity"),
                                 ("selected", [], "case-selection"), ("selected", [[]], "case-selection"), ("selected", [None], "case-selection"),
                                 ("selected", ["AHT-16"], "case-selection"), ("selected", ["AHT-05", "AHT-05"], "case-selection"),
                                 ("selected", "AHT-05", "case-selection"), ("plan_raw", "not bytes", "provenance-inputs"),
                                 ("plan_raw", b"{not json", "runtime-plan-unreadable"), ("plan_raw", b"[]", "runtime-plan-unreadable"),
                                 ("case_results_raw", None, "provenance-inputs")):
            w = self.world()
            w[key] = value
            with self.subTest(key=key, value=str(value)[:20]):
                refused(self, code, self.check, w)


class WindowAtAdmission(unittest.TestCase):
    def test_the_remaining_window_must_hold_live_and_collect_and_is_never_reset(self):
        r = live_request(["AHT-05"])
        r["window"]["endUtc"] = "2026-11-01T14:57:00Z"  # 47 live + 10 collect = 57 minutes from NOW
        I.check_window_remaining(r, NOW, 47)
        refused(self, "approved-window-too-short-at-admission", I.check_window_remaining, r, NOW + timedelta(seconds=1), 47)
        refused(self, "live-minutes", I.check_window_remaining, r, NOW, 0)


class LiveAccountsBundle(unittest.TestCase):
    def test_the_shared_vectors_are_the_pinned_ones_and_every_code_agrees(self):
        self.assertEqual(hashlib.sha256(VECTORS_TEXT.encode()).hexdigest(), VECTORS_SHA256)
        self.assertGreater(len(VECTORS), 20)
        for name, code, raw in VECTORS:
            if code == "ok":
                self.assertEqual(I.parse_live_accounts_bundle(raw)["projectRef"], PROJECT, name)
            else:
                refused(self, code, I.parse_live_accounts_bundle, raw)

    def test_the_shared_origin_vectors_agree(self):
        for name, code, url in URL_VECTORS:
            self.assertEqual(I.is_project_origin(url, PROJECT), code == "ok", name)
        b = I.parse_live_accounts_bundle(bundle_with(ACCOUNT_ID))
        for name, code, url in URL_VECTORS:
            if code != "ok":
                refused(self, code, I.role_account, b, "existing-disposable", url)

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
