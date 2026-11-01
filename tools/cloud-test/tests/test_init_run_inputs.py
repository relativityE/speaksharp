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
    # identityCap and cumulativeCeilingRequests are cumulative owner approvals; runCapRequests is per run.
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
        refused(self, "estimate-exceeds-per-run-identity-cap", I.check_ceilings, CFG, r, I.ALL_CASES, 329)
        six = ["AHT-04", "AHT-05", "AHT-06", "AHT-09", "AHT-10", "AHT-11"]
        r = live_request(six); r["estimate"]["identityReads"] = 21
        refused(self, "estimate-exceeds-per-run-identity-cap", I.check_ceilings, CFG, r, six, 329)

    def test_the_whole_job_must_end_before_the_approved_window_closes(self):
        r = live_request(["AHT-05"])  # 47 live minutes + 25 caller reserves = 72
        r["window"]["endUtc"] = "2026-11-01T15:12:00Z"
        I.check_window_fit(r, NOW, 47)
        r["window"]["endUtc"] = "2026-11-01T15:11:59Z"
        refused(self, "run-would-outlast-approved-window", I.check_window_fit, r, NOW, 47)


class Cumulative(unittest.TestCase):
    """identityCap and cumulativeCeilingRequests bound verified prior usage + open reservations + this run (Sam RETURN finding 2)."""

    def prior(self, **over):
        return dict({"requests": 7000, "identityReads": 90, "reservedRequests": 690, "reservedIdentityReads": 4}, **over)

    def test_nonzero_prior_usage_and_reservations_count_against_the_cumulative_caps(self):
        I.check_cumulative(live_request(), self.prior())  # 7000+690+4310 = 12000; 90+4+32 = 126
        refused(self, "cumulative-request-ceiling-exceeded", I.check_cumulative, live_request(), self.prior(requests=7001))
        refused(self, "cumulative-request-ceiling-exceeded", I.check_cumulative, live_request(), self.prior(reservedRequests=691))
        refused(self, "cumulative-identity-cap-exceeded", I.check_cumulative, live_request(), self.prior(identityReads=91))
        refused(self, "cumulative-identity-cap-exceeded", I.check_cumulative, live_request(), self.prior(reservedIdentityReads=5))

    def test_unknown_prior_usage_is_refused_never_zero(self):
        for prior in (None, {}, self.prior(requests=None), self.prior(identityReads=True), self.prior(reservedRequests=-1),
                      {k: v for k, v in self.prior().items() if k != "reservedIdentityReads"}):
            refused(self, "prior-usage-unknown", I.check_cumulative, live_request(), prior)


class Lineage(unittest.TestCase):
    """Workflow source vs tested product release (Sam RETURN finding 4): request-only descendants pass; product or dependency changes refuse
    unless an explicit approved older-release diagnostic is named."""

    def setUp(self):
        self.repo = GitRepo()
        self.addCleanup(shutil.rmtree, self.repo.dir)
        self.release = self.repo.commit({"frontend/app.json": {"v": 1}, "package.json": {"v": 1}})

    def req(self, **release):
        r = live_request(["AHT-05"])
        r["release"] = dict(r["release"], testedSha=self.release, **release)
        return r

    def test_a_request_only_descendant_is_accepted(self):
        head = self.repo.commit({"runs/r6.json": self.req(), "runs/r6-notes.json": {}})
        self.assertEqual(I.check_release_lineage(self.repo.dir, self.req(), "runs/r6.json", head), "request-only-descendant")

    def test_product_or_dependency_changes_after_the_tested_release_are_refused(self):
        for change in ({"frontend/app.json": {"v": 2}}, {"package.json": {"v": 2}}, {"runs/script.py": "x"}):
            head = self.repo.commit(dict({"runs/r6.json": self.req()}, **change))
            refused(self, "source-changes-product-beyond-request", I.check_release_lineage, self.repo.dir, self.req(), "runs/r6.json", head)

    def test_an_older_release_diagnostic_must_be_explicit_and_approved(self):
        head = self.repo.commit({"frontend/app.json": {"v": 2}, "runs/r6.json": self.req()})
        r = self.req(olderReleaseDiagnosticApprovalRef="slack:1793539017.431059")
        self.assertEqual(I.check_release_lineage(self.repo.dir, r, "runs/r6.json", head), "explicit-older-release-diagnostic")
        refused(self, "source-changes-product-beyond-request", I.check_release_lineage, self.repo.dir, self.req(olderReleaseDiagnosticApprovalRef=""), "runs/r6.json", head)

    def test_a_release_outside_the_source_history_is_refused(self):
        head = self.repo.commit({"runs/r6.json": self.req()})
        r = self.req(); r["release"]["testedSha"] = "b" * 40
        refused(self, "request-release-not-in-source-history", I.check_release_lineage, self.repo.dir, r, "runs/r6.json", head)
        r = live_request(); r["estimate"]["paidActionsAuthorizedUsd"] = 1
        refused(self, "paid-actions-refused", I.check_ceilings, CFG, r, I.ALL_CASES, 329)
        r = live_request(); r["estimate"]["window"]["worstCaseMinutes"] = 305
        refused(self, "estimate-worst-case-exceeds-case-limits", I.check_ceilings, CFG, r, I.ALL_CASES, 329)


class Account(unittest.TestCase):
    def test_one_role_bound_to_its_credential_names_id_and_history(self):
        b = I.account_binding(CFG, ["AHT-05"], facts()["account"], ACCOUNT_ID)
        self.assertEqual(b["credentials"], {"email": "THROWAWAY_TEST_EMAIL", "password": "THROWAWAY_TEST_PASSWORD", "accountId": "THROWAWAY_TEST_ACCOUNT_ID"})
        a = dict(facts()["account"], role="maintained-read-only", historyRef="history:free@r5")
        # The reviewed run stage receives only the THROWAWAY names today, so AHT-15's maintained pair is refused, never renamed.
        refused(self, "role-credentials-not-in-run-stage-allowlist", I.account_binding, CFG, ["AHT-15"], a, ACCOUNT_ID)
        cfg = copy.deepcopy(CFG)
        cfg["credentials"]["runEnvironment"]["stages"]["run"] += ["FREE_TEST_EMAIL", "FREE_TEST_PASSWORD"]
        b = I.account_binding(cfg, ["AHT-15"], a, ACCOUNT_ID)
        self.assertEqual((b["role"], b["credentials"]["email"], b["credentials"]["password"], b["historyRef"]),
                         ("maintained-read-only", "FREE_TEST_EMAIL", "FREE_TEST_PASSWORD", "history:free@r5"))
        self.assertNotIn(ACCOUNT_ID, json.dumps(b))

    def test_mixed_roles_wrong_account_and_missing_sources_are_refused(self):
        refused(self, "mixed-account-roles", I.account_binding, CFG, ["AHT-14", "AHT-15"], facts()["account"], ACCOUNT_ID)
        cfg = copy.deepcopy(CFG)
        cfg["credentials"]["runEnvironment"]["stages"]["run"] += ["FREE_TEST_EMAIL", "FREE_TEST_PASSWORD"]
        refused(self, "account-role-not-for-these-cases", I.account_binding, cfg, ["AHT-15"], facts()["account"], ACCOUNT_ID)
        refused(self, "account-id-not-the-approved-account", I.account_binding, CFG, ["AHT-05"], facts()["account"], ACCOUNT_ID.replace("1", "2"))
        refused(self, "account-id-source-missing", I.account_binding, CFG, ["AHT-05"], facts()["account"], None)
        refused(self, "account-history-reference", I.account_binding, CFG, ["AHT-05"], dict(facts()["account"], historyRef=""), ACCOUNT_ID)


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
        req["window"].update(startUtc=(now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"), endUtc=(now + timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ"))
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
    """Composition with the REAL verify_run_binding.py on the builder's selected-full plan shape: all 15 plan.cases rows (each with driver
    and config bytes), the dispatch subset in plan.selection, and case results that mark the other rows notSelected (build_plan.py 345-368)."""

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
        self.write_results()
        for cid in self.SELECTED:
            self.write_case(cid, [("a", "PASS"), ("b", "PASS")])

    @staticmethod
    def sha(p):
        with open(p, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()

    def write_case(self, cid, rows, result="PASS", evidence=True):
        os.makedirs(os.path.join(self.cases, cid), exist_ok=True)
        ev = os.path.join(self.cases, cid, cid.lower() + "-1.json")
        put(ev, {"contentSafe": True})
        put(os.path.join(self.cases, cid, "case-result.json"),
            {"caseId": cid, "result": result, "assertions": [{"id": "%s-%s" % (cid.lower(), i), "result": r} for i, r in rows],
             "evidenceDigests": {cid.lower() + "-1.json": self.sha(ev)} if evidence else {}})

    def write_results(self, **over):
        cases = [{"caseId": c} if c in self.SELECTED else {"caseId": c, "notSelected": True} for c in I.ALL_CASES]
        put(self.results, dict({"campaignId": "C1", "sourceSha": SHA, "servedSha": SHA, "cases": cases}, **over))

    def qualify(self, run_verifier=I._run_verifier, selected=None):
        return I.qualify(self.plan, self.results, self.cases, selected or self.SELECTED, self.approval, self.code, os.path.join(self.d, "packet"),
                         os.path.join(self.d, "verification.json"), run_verifier)

    def test_the_real_verifier_and_every_selected_required_row_pass_qualifies_with_the_denominator(self):
        self.assertEqual(self.qualify(), {"qualified": True, "cases": self.SELECTED, "planCases": 15, "requiredRows": 4, "passRows": 4})
        self.assertEqual(J(os.path.join(self.d, "verification.json"))["failed"], 0)

    def test_verifier_success_alone_never_qualifies_a_failed_missing_or_duplicated_row(self):
        for rows, result, code in [([("a", "PASS"), ("b", "FAIL")], "FAIL", "case-not-pass:AHT-09"),
                                   ([("a", "PASS")], "PASS", "required-assertion-not-pass:AHT-09"),
                                   ([("a", "PASS"), ("b", "NOT RUN")], "PASS", "required-assertion-not-pass:AHT-09"),
                                   ([("a", "PASS"), ("b", "FAIL"), ("b", "PASS")], "PASS", "duplicate-assertion:AHT-09")]:
            self.write_case("AHT-09", rows, result)
            refused(self, code, self.qualify)
            self.assertEqual(J(os.path.join(self.d, "verification.json"))["failed"], 0, "the verifier itself passes " + code)

    def test_bytes_substituted_after_the_verifier_ran_are_refused(self):
        targets = {"config": lambda: os.path.join(self.d, "cfg", "AHT-05.json"), "result": lambda: os.path.join(self.cases, "AHT-05", "case-result.json"),
                   "evidence": lambda: os.path.join(self.cases, "AHT-05", "aht-05-1.json"), "plan": lambda: self.plan, "results": lambda: self.results}
        for name, target in targets.items():
            self.setUp()

            def swap(*a, target=target):
                v = I._run_verifier(*a)
                with open(target(), "ab") as f:
                    f.write(b" ")
                return v
            refused(self, "consumed-bytes-changed-during-verification", self.qualify, swap)

    def test_undispatched_unselected_dispatched_failed_and_denominator_controls(self):
        self.write_results(cases=[{"caseId": c, "reason": "not dispatched"} if c == "AHT-09" else {"caseId": c} if c in self.SELECTED
                                  else {"caseId": c, "notSelected": True} for c in I.ALL_CASES])
        refused(self, "case-not-dispatched:AHT-09", self.qualify)
        self.setUp()
        self.write_case("AHT-01", [("a", "PASS"), ("b", "PASS")])  # receipts present, so the verifier itself passes
        self.write_results(cases=[{"caseId": c} if c in self.SELECTED + ["AHT-01"] else {"caseId": c, "notSelected": True} for c in I.ALL_CASES])
        refused(self, "unselected-case-dispatched:AHT-01", self.qualify)
        self.setUp()
        self.write_results(campaignId="C2")
        refused(self, "binding-verification-failed", self.qualify)
        self.setUp()
        refused(self, "plan-selection-not-the-selected-cases", self.qualify, I._run_verifier, ["AHT-05"])
        plan = J(self.plan); plan["cases"] = [r for r in plan["cases"] if r["id"] in self.SELECTED]
        put(self.plan, plan)
        refused(self, "plan-denominator-not-fifteen", self.qualify)

    def test_a_stale_verification_output_is_refused(self):
        def stale(*a):
            v = I._run_verifier(*a)
            return dict(v, caseResultsSha256="0" * 64)
        refused(self, "binding-verification-stale", self.qualify, stale)


class Project(unittest.TestCase):
    RECORD = {"schema": "speaksharp.cloud-test.run-record.v1", "release": {"testedSha": SHA, "servedShaAtAdmission": SHA},
              "startedUtc": "2026-11-01T14:00:00Z", "endedUtc": "2026-11-01T14:30:00Z",
              "cases": [{"case": "AHT-05", "result": "PASS", "assertions": {"PASS": 2, "FAIL": 0, "NOT RUN": 0}}]}

    def test_passed_needs_the_qualification_of_exactly_the_recorded_cases(self):
        q = {"qualified": True, "cases": ["AHT-05"], "planCases": 15, "requiredRows": 2, "passRows": 2}
        self.assertEqual(I.project(self.RECORD, "123", 1, "c" * 40, SHA, q)["outcome"], "passed")
        for other in (None, {"qualified": True, "cases": ["AHT-05", "AHT-06"]}, {"qualified": False, "cases": ["AHT-05"]}):
            rec = I.project(self.RECORD, "123", 1, "c" * 40, SHA, other)
            self.assertEqual((rec["outcome"], rec["codes"]), ("failed", ["not-qualified"]), other)
        rec = I.project(self.RECORD, "123", 1, "c" * 40, SHA, q)
        self.assertEqual((rec["sourceSha"], rec["testedSha"], rec["servedSha"]), ("c" * 40, SHA, SHA))
        self.assertEqual(I.project(self.RECORD, "123", 1, "c" * 40, SHA, None)["codes"], ["not-qualified"])
        refused(self, "run-record-for-another-release", I.project, self.RECORD, "123", 1, "c" * 40, "b" * 40, q)


if __name__ == "__main__":
    unittest.main()
