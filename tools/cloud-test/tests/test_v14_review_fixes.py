"""Workflow 1.4.0 review fixes: (1) each row is compared with the most recent earlier run that has a verdict for it, never always the previous run;
(2) the owner's unexplained usage is carried forward, never dropped; (3) an approved omission is incomplete coverage, never a full pass."""
import copy
import json
import os
import shutil
import tempfile
import unittest

from _fixtures import ROOT, REPO, TESTED, J, fake_rv, prerequisite, request_path, run_py, sample, wjson, needs_history
import reconcile_cumulative as RC
import select_baselines as SB
import check_coverage as CC
import derive_summary as DS
import workflow_report as W
from test_comparison_automation import derive_gap, synthetic_latest, writable, manifest
from _synthetic_history import shared as synthetic_history

RECEIPTS = os.path.join(ROOT, "config", "history", "receipts")
GAP03_PASS = {"AHT-12": {"press-bound-denial": "PASS", "denial-truthful-no-mic": "PASS"}}


def baseline_scenario(r4c_pass=(), r5_observed=(), never_observed=()):
    """Explicit synthetic verdicts for the baseline-selection scenarios below.

    No retained run is read or modified. Compatibility labels aren't evidence.
    """
    from _nightly import CATALOG
    rows = {(cid, aid) for cid, spec in CATALOG["cases"].items() for aid in spec["requiredAssertions"]}
    return (("R4C", {"fails": sorted(rows - set(r4c_pass) - set(never_observed)),
                     "notrun": list(never_observed), "sha": "2b48eabc3f900e2481c35bfef63550b0c531faa6"}),
            ("R5", {"notrun": sorted(rows - set(r5_observed))}))


class BaselineIsTheMostRecentRunWithAVerdict(unittest.TestCase):
    def test_a_row_that_failed_in_r4c_and_was_not_run_in_r5_is_compared_with_r4c(self):
        d, cp = synthetic_latest(GAP03_PASS)
        g = derive_gap("GAP-03", d, cp)
        b = json.load(open(os.path.join(d, "baselines.json")))["gaps"]["GAP-03"]["rows"]
        self.assertEqual({k: v["baseline"] for k, v in b.items()}, {"AHT-12/press-bound-denial": "R4C", "AHT-12/denial-truthful-no-mic": "R4C"})
        self.assertEqual(b["AHT-12/denial-truthful-no-mic"]["baselineVerdict"], "FAIL")
        self.assertEqual(b["AHT-12/denial-truthful-no-mic"]["skippedRunsWithoutVerdict"], ["R5"])
        self.assertEqual(g["latest"]["comparedAgainst"], {"AHT-12/press-bound-denial": "R4C", "AHT-12/denial-truthful-no-mic": "R4C"})
        self.assertTrue(g["latest"]["comparable"])
        self.assertEqual(g["status"], "CLOSED")

    def test_the_same_result_cannot_be_reported_as_a_verified_fix_using_r5_alone(self):
        """The reviewed defect: pipeline.py compared with R5 only. R5 never tested these rows, so it cannot be the baseline of a fix."""
        d, cp = synthetic_latest(GAP03_PASS)
        g = derive_gap("GAP-03", d, cp, baselines=False)
        self.assertFalse(g["latest"]["comparable"])
        self.assertEqual(g["status"], "INCONCLUSIVE")
        self.assertNotEqual(g["status"], "CLOSED")
        self.assertIn("R5 has no verdict", g["latest"]["comparableReason"])

    def test_the_comparison_with_r4c_decides_comparability_not_r5(self):
        d, cp = synthetic_latest(GAP03_PASS, comparison_valid={"AHT-12": "not comparable"})
        g = derive_gap("GAP-03", d, cp)
        self.assertFalse(g["latest"]["comparable"])
        self.assertIn("vs R4C", g["latest"]["comparableReason"])
        self.assertEqual(g["status"], "INCONCLUSIVE")

    def test_a_row_that_r5_did_test_is_compared_with_r5(self):
        observed = [("AHT-12", "owner-bound"), ("AHT-12", "start-press-budget")]
        d, cp = synthetic_latest({"AHT-12": {"owner-bound": "PASS", "press-bound-denial": "PASS"}}, baseline_specs=baseline_scenario(r5_observed=observed))
        sel = json.load(open(os.path.join(d, "cfg.json")))
        out = SB.select({"gaps": [{"id": "G", "expectedPass": {"requirements": [{"case": "AHT-12", "assertions": ["owner-bound", "start-press-budget"]}]}}]}, sel, d, "R6T")
        self.assertEqual({k: v["baseline"] for k, v in out["gaps"]["G"]["rows"].items()}, {"AHT-12/owner-bound": "R5", "AHT-12/start-press-budget": "R5"})

    def test_every_gap_row_baseline_is_the_most_recent_earlier_run_with_a_verdict(self):
        d, _ = synthetic_latest(GAP03_PASS)
        cfg = json.load(open(os.path.join(d, "cfg.json")))
        out = SB.select(sample()["ledger"], cfg, d, "R6T")
        order = out["history"]
        for g in out["gaps"].values():
            for key, r in g["rows"].items():
                earlier = [lab for lab in out["priorRuns"] if r["verdicts"][lab] in ("PASS", "FAIL")]
                self.assertEqual(r["baseline"], earlier[-1] if earlier else None, key)
                if r["baseline"]:
                    self.assertEqual(r["verdicts"][r["baseline"]], r["baselineVerdict"])
        self.assertEqual(order, ["R4C", "R5", "R6T"])

    def test_journeys_name_their_previous_verdict_run_and_last_known_good(self):
        from _nightly import CATALOG
        rows4 = [("AHT-04", a) for a in CATALOG["cases"]["AHT-04"]["requiredAssertions"]]
        rows15 = [("AHT-15", a) for a in CATALOG["cases"]["AHT-15"]["requiredAssertions"]]
        d, _ = synthetic_latest(GAP03_PASS, baseline_specs=baseline_scenario(r4c_pass=rows4, r5_observed=rows15))
        cfg = json.load(open(os.path.join(d, "cfg.json")))
        j = SB.select(sample()["ledger"], cfg, d, "R6T")["journeys"]
        self.assertEqual((j["AHT-04"]["previousVerdictRun"], j["AHT-04"]["lastKnownGood"]), ("R4C", "R4C"))   # PASS in R4C, NOT RUN in R5
        self.assertEqual((j["AHT-15"]["previousVerdictRun"], j["AHT-15"]["lastKnownGood"]), ("R5", "R5"))
        self.assertEqual(j["AHT-02"]["previousVerdict"], "FAIL")
        self.assertIsNone(j["AHT-02"]["lastKnownGood"])      # never passed
        self.assertEqual(j["AHT-04"]["lastKnownGoodServedSha"], "2b48eabc3f900e2481c35bfef63550b0c531faa6")

    def test_a_row_nobody_tested_is_a_first_observation_not_a_blocker(self):
        d, cp = synthetic_latest({"AHT-14": {"download-fault-exercised": "PASS"}}, baseline_specs=baseline_scenario(never_observed=[("AHT-14", "download-fault-exercised")]))
        out = SB.select({"gaps": [{"id": "G", "expectedPass": {"requirements": [{"case": "AHT-14", "assertions": ["download-fault-exercised"]}]}}]}, json.load(open(os.path.join(d, "cfg.json"))), d, "R6T")
        self.assertIsNone(out["gaps"]["G"]["rows"]["AHT-14/download-fault-exercised"]["baseline"])

    def test_a_latest_run_that_is_not_in_the_history_is_refused(self):
        with self.assertRaises(ValueError):
            SB.select(sample()["ledger"], sample()["cfg"], RECEIPTS, "R9")


@needs_history
class PipelineComparesWithTheRightRun(unittest.TestCase):
    def test_the_pipeline_compares_the_latest_run_with_every_baseline_it_needs(self):
        prerequisite(__import__("subprocess").run(["git", "-C", REPO, "cat-file", "-e", TESTED + "^{commit}"], capture_output=True).returncode == 0, "git history with the tested SHA")
        d = tempfile.mkdtemp(prefix="ct-pipe-")
        for lab in ("R4", "R4B", "R4C", "R5"):
            shutil.copytree(os.path.join(RECEIPTS, lab), os.path.join(d, lab))
        shutil.copytree(os.path.join(RECEIPTS, "R5"), os.path.join(d, "R6T"))
        writable(d)
        p = os.path.join(d, "R6T", "case-results.json")
        cr = json.load(open(p)); cr["campaignId"] = "R6T"; cr["synthetic"] = True
        for c in cr["cases"]:
            if c["caseId"] == "AHT-12":
                for a in c["assertions"]:
                    if a["id"] in ("press-bound-denial", "denial-truthful-no-mic"):
                        a["result"] = "PASS"
        wjson(p, cr)
        case_path = os.path.join(d, "R6T", "AHT-12", "case-result.json")
        case = json.load(open(case_path)); case["synthetic"] = True
        for assertion in case["assertions"]:
            if assertion["id"] in ("press-bound-denial", "denial-truthful-no-mic"):
                assertion["result"] = "PASS"
        wjson(case_path, case)
        plan_path = os.path.join(d, "R6T", "campaign-plan.json")
        plan = json.load(open(plan_path)); plan["campaignId"] = "R6T"; plan["synthetic"] = True; wjson(plan_path, plan)
        if os.path.exists(os.path.join(d, "R6T", "plan.sha")):
            import hashlib
            with open(os.path.join(d, "R6T", "plan.sha"), "w") as handle:
                handle.write(hashlib.sha256(open(plan_path, "rb").read()).hexdigest() + "\n")
        cfg = copy.deepcopy(sample()["cfg"])
        from _synthetic_receipts import seal_in_place
        pin = seal_in_place(os.path.join(d, "R6T"), "R6T")
        cfg["history"]["runs"].append({"label": "R6T", "campaignId": "R6T", "servedSha": TESTED, "ledgersOnly": False, "receiptsManifestSha256": pin})
        cp = os.path.join(d, "cfg.json"); wjson(cp, cfg)
        out = os.path.join(d, "out")
        r = run_py("scripts/pipeline.py", "--request", request_path(), "--out-dir", out, "--config", cp, "--receipts-root", d, "--latest-label", "R6T",
                   "--repo", REPO, "--generated-at", "2026-10-29T00:00:00Z")
        # Comparison must still be computed for an unqualified release. This retained
        # request claims a deployed product fix without cloud-verified inclusion; its
        # admission refusal must remain distinct from a comparison/execution failure.
        self.assertEqual(r.returncode, 1, r.stdout[-1500:] + r.stderr[-1500:])
        validation = json.load(open(os.path.join(out, "request-validation.json")))
        self.assertFalse(validation["valid"])
        self.assertEqual(validation["errors"], ["priority prove-deployed-fix needs a targeted product-fix gap whose (non-candidate) fix has cloud-verified deployed inclusion; an undeployed or unverified fix cannot be proven"])
        self.assertTrue(json.load(open(os.path.join(out, "receipts-verification.json")))["allVerified"])
        for baseline in ("R4C", "R5"):
            comparison = json.load(open(os.path.join(out, "comparisons", baseline, "comparison.json")))
            self.assertEqual(comparison["receipts"]["problems"], [])
        self.assertTrue(json.load(open(os.path.join(out, "report/validation.json")))["valid"])
        self.assertEqual(json.load(open(os.path.join(out, "gate-status.json")))["decision"], "NO-GO")
        self.assertTrue(os.path.isfile(os.path.join(out, "comparisons", "R4C", "comparison.json")), "R4C was not compared although it holds the only verdict for the defect")
        self.assertTrue(os.path.isfile(os.path.join(out, "comparisons", "R5", "comparison.json")))
        gap = next(g for g in json.load(open(os.path.join(out, "ledger-derived.json")))["gaps"] if g["id"] == "GAP-03")
        self.assertEqual(gap["latest"]["comparedAgainst"], {"AHT-12/press-bound-denial": "R4C", "AHT-12/denial-truthful-no-mic": "R4C"})
        self.assertNotEqual(gap["status"], "CLOSED")           # R6T is an R5 copy: harness and release differ from R4C, so the comparison with R4C does not prove a fix
        self.assertIn("R4C", gap["latest"]["comparableReason"])
        self.assertIn("baselines.json", os.listdir(out))

    def test_a_mismatched_seal_stops_the_pipeline_before_comparison(self):
        prerequisite(__import__("subprocess").run(["git", "-C", REPO, "cat-file", "-e", TESTED + "^{commit}"], capture_output=True).returncode == 0, "git history with the tested SHA")
        with tempfile.TemporaryDirectory(prefix="ct-pipe-negative-") as d:
            for label in ("R4", "R4B", "R4C", "R5"):
                shutil.copytree(os.path.join(RECEIPTS, label), os.path.join(d, label))
            writable(d)
            with open(os.path.join(d, "R5", "AHT-12", "case-result.json"), "a") as handle:
                handle.write("\n")  # The pin remains unchanged: this MUST be rejected.
            out = os.path.join(d, "out")
            result = run_py("scripts/pipeline.py", "--request", request_path(), "--out-dir", out,
                            "--receipts-root", d, "--repo", REPO)
            self.assertEqual(result.returncode, 2)
            self.assertFalse(os.path.exists(os.path.join(out, "comparisons")))
            verification = json.load(open(os.path.join(out, "receipts-verification.json")))
            self.assertFalse(verification["allVerified"])
            self.assertIn("changed: AHT-12/case-result.json", verification["sets"]["R5"]["errors"])


# The cumulative-usage arithmetic runs on the SYNTHETIC history and owner counters (tests/fixtures/synthetic-history/inputs.v1.json):
#   measured requests 500 + 200 + 2550 + 2550 = 5800; owner-counted 3250 + 2550 + 40 = 5840, so 40 requests are unexplained
#   measured identity reads 10 + 10 + 32 + 32 = 84; owner-counted 86, so 2 reads are unexplained
#   owner Starts/takes 30/30 through R5; each synthetic run logs 15 Starts and 15 takes (one per journey)
SYNTH_RECEIPTS = synthetic_history().receipts


def synthetic_cfg():
    return copy.deepcopy(synthetic_history().cfg)


def counters_through(stated="R5", frozen="R5"):
    c = copy.deepcopy(synthetic_history().counters_doc)
    c["statedThroughRun"] = stated
    c["frozen"]["throughRun"] = frozen
    return c


def with_later_run(reads=4, requests=130, logs=True):
    d = tempfile.mkdtemp(prefix="ct-carry-")
    for lab in ("R4", "R4B", "R4C", "R5"):
        shutil.copytree(os.path.join(SYNTH_RECEIPTS, lab), os.path.join(d, lab))
    shutil.copytree(os.path.join(d, "R5"), os.path.join(d, "R6T"))
    writable(d)
    wjson(os.path.join(d, "R6T", "campaign-ledger.json"), {"used": {"total": requests, "signed-in": requests - 10, "public": 10}})
    wjson(os.path.join(d, "R6T", "identity-ledger.json"), {"identityGets": reads, "receipts": []})
    if not logs:
        for r, _, fs in os.walk(os.path.join(d, "R6T")):
            for f in fs:
                if f == "action-reservations.jsonl":
                    os.remove(os.path.join(r, f))
    cfg = synthetic_cfg()
    cfg["history"]["runs"].append({"label": "R6T", "campaignId": "R6T", "servedSha": "x", "ledgersOnly": False})
    return d, cfg


class UnexplainedUsageIsCarriedForward(unittest.TestCase):
    def test_the_current_snapshot_is_unchanged(self):
        rc = RC.reconcile(synthetic_cfg(), counters_through(), SYNTH_RECEIPTS)
        self.assertEqual((rc["requests"]["measuredFromSealedLedgers"], rc["requests"]["unreconciled"], rc["requests"]["conservativeUsed"]), (5800, 40, 5840))
        self.assertEqual((rc["identityReads"]["measuredFromSealedLedgers"], rc["identityReads"]["unreconciled"], rc["identityReads"]["conservativeUsed"]), (84, 2, 86))
        self.assertEqual(rc["snapshot"]["carriedForwardUnexplained"], {"requests": 40, "identityReads": 2})

    def test_84_measured_86_reported_plus_4_new_is_90_not_88(self):
        """The reviewed defect: max(measured, owner) = max(88, 86) = 88 dropped the owner's 2 unexplained reads as soon as measured usage passed the snapshot.
        (The original retained figures were 92 measured, 94 reported, 98 not 96; the same rule on the synthetic counters.)"""
        d, cfg = with_later_run(reads=4)
        rc = RC.reconcile(cfg, counters_through("R5", "R6T"), d)          # the freeze was moved forward without restating the owner's numbers
        self.assertEqual(rc["identityReads"]["measuredFromSealedLedgers"], 84 + 4)
        self.assertEqual(rc["identityReads"]["conservativeUsed"], 84 + 4 + 2)
        self.assertNotEqual(rc["identityReads"]["conservativeUsed"], max(84 + 4, 86))
        self.assertEqual(rc["requests"]["conservativeUsed"], 5800 + 130 + 40)     # not max(5930, 5840)
        self.assertEqual(rc["snapshot"]["runsAddedAfterStatement"], ["R6T"])

    def test_with_the_freeze_unchanged_the_new_run_is_added_once_and_the_difference_stays(self):
        import spend_report as S
        d, cfg = with_later_run(reads=4)
        rc = RC.reconcile(cfg, counters_through(), d)
        self.assertEqual(rc["identityReads"]["conservativeUsed"], 86)
        self.assertEqual([x["label"] for x in rc["afterFreeze"]], ["R6T"])
        rr = {"spend": {"requests": 130, "byCategory": {"signed-in": 120, "public": 10}, "identityReads": 4, "starts": 1, "takes": 0}}
        out = S.build(sample()["req"], cfg, rc, rr, None, None, "R6T", d)
        self.assertEqual(out["countedOnce"]["afterRun"]["identityReads"], 86 + 4)
        self.assertEqual(out["countedOnce"]["afterRun"]["requests"], 5840 + 130)

    def test_both_routes_agree(self):
        d, cfg = with_later_run(reads=4)
        a = RC.reconcile(cfg, counters_through("R5", "R6T"), d)
        b = RC.reconcile(cfg, counters_through(), d)
        self.assertEqual(a["identityReads"]["conservativeUsed"], b["identityReads"]["conservativeUsed"] + 4)
        self.assertEqual(a["requests"]["conservativeUsed"], b["requests"]["conservativeUsed"] + 130)

    def test_measured_usage_above_the_owner_count_is_never_reduced(self):
        # owner-counted below the ledgers: identity 80 < 84 measured; requests 3000 + 2550 + 40 = 5590 < 5800 measured
        c = counters_through(); c["identityReadsCumulative"] = 80; c["requests"]["allowanceBaselineThroughR4C"] = 3000
        rc = RC.reconcile(synthetic_cfg(), c, SYNTH_RECEIPTS)
        self.assertEqual(rc["identityReads"]["conservativeUsed"], 84)
        self.assertEqual(rc["requests"]["conservativeUsed"], 5800)

    def test_a_snapshot_that_does_not_say_what_it_covers_is_rejected(self):
        c = counters_through(); del c["statedThroughRun"]
        with self.assertRaises(ValueError) as e:
            RC.reconcile(synthetic_cfg(), c, SYNTH_RECEIPTS)
        self.assertIn("stale or unlabeled", str(e.exception))

    def test_a_freeze_earlier_than_the_statement_is_rejected(self):
        with self.assertRaises(ValueError):
            RC.reconcile(synthetic_cfg(), counters_through("R5", "R4C"), SYNTH_RECEIPTS)

    def test_a_statement_about_an_unknown_run_is_rejected(self):
        with self.assertRaises(ValueError):
            RC.reconcile(synthetic_cfg(), counters_through("R9", "R5"), SYNTH_RECEIPTS)

    def test_starts_and_takes_are_carried_from_the_later_runs_reservation_logs(self):
        d, cfg = with_later_run()
        rc = RC.reconcile(cfg, counters_through("R5", "R6T"), d)
        self.assertEqual((rc["starts"]["ownerCounted"], rc["takes"]["ownerCounted"]), (30 + 15, 30 + 15))

    def test_a_later_run_without_reservation_logs_cannot_be_carried_and_is_rejected(self):
        d, cfg = with_later_run(logs=False)
        with self.assertRaises(ValueError) as e:
            RC.reconcile(cfg, counters_through("R5", "R6T"), d)
        self.assertIn("restate the owner counters", str(e.exception))

    def test_the_requirement_for_the_next_run_uses_the_carried_figure(self):
        d, cfg = with_later_run(reads=4)
        rc = RC.reconcile(cfg, counters_through("R5", "R6T"), d)
        n = RC.need(rc, 4310, 32)
        self.assertEqual(n["requiredIdentityCap"], 90 + 32)
        self.assertEqual(n["requiredCeiling"], rc["requests"]["conservativeUsed"] + 4310 + 664 + 32)


class ApprovedOmissionsAreIncompleteCoverage(unittest.TestCase):
    def results(self, req, ex=None):
        cat = json.load(open(os.path.join(ROOT, "config", "assertion-catalog.json")))
        sha = req["release"]["testedSha"]
        ident = {"result": "MATCH", "servedSha": sha, "expectedSha": sha}
        return {"campaignId": req["runId"], "sourceSha": sha, "servedSha": sha, "finalIdentity": "MATCH", "safetyStopped": False,
                "cases": [{"caseId": c, "identityBefore": dict(ident), "identityAfter": dict(ident), "assertions": [{"id": a, "result": (ex or {}).get((c, a), "PASS")} for a in v["requiredAssertions"]]} for c, v in cat["cases"].items()]}

    def request(self, n):
        req = J("config", "runs", "R7-full-coverage-proposal.json")
        cat = json.load(open(os.path.join(ROOT, "config", "assertion-catalog.json")))
        rows = [(c, a) for c, v in cat["cases"].items() for a in v["requiredAssertions"]][:n]
        req["approvedOmissions"] = [{"case": c, "assertion": a, "reason": "named", "approvalRef": "owner-%d" % i} for i, (c, a) in enumerate(rows)]
        return req, {r: "NOT RUN" for r in rows}

    def test_one_or_many_approved_omissions_never_make_a_full_run(self):
        cat = json.load(open(os.path.join(ROOT, "config", "assertion-catalog.json")))
        for n in (1, 5, 30):
            req, ex = self.request(n)
            out = CC.assess(req, cat, self.results(req, ex))
            self.assertFalse(out["fullLiveRun"], n)
            self.assertFalse(out["coverageComplete"], n)
            self.assertEqual(out["rowsExecuted"], 204 - n)
            self.assertEqual(len(out["approvedOmissionsApplied"]), n)
            self.assertEqual(out["kind"], "FULL-INCOMPLETE (approved omissions)")

    def test_the_summary_cannot_be_ready_with_an_approved_omission(self):
        import test_pipeline_and_report as T
        T.SummaryRules.setUpClass()
        inst = T.SummaryRules("test_ready_only_when_everything_holds")
        req, ex = self.request(1)
        cov = CC.assess(req, json.load(open(os.path.join(ROOT, "config", "assertion-catalog.json"))), self.results(req, ex))
        f = inst.derive(True, ["CLOSED"] * 6, latest=inst.latest(inst.all_pass()), coverage=cov)
        self.assertEqual(f["status"], "LIMITED")
        self.assertIn("203 of 204", f["readiness"])
        self.assertIn("approved omission", f["readiness"])
        full = CC.assess(req, json.load(open(os.path.join(ROOT, "config", "assertion-catalog.json"))), self.results(req))
        self.assertTrue(full["fullLiveRun"])
        self.assertEqual(inst.derive(True, ["CLOSED"] * 6, latest=inst.latest(inst.all_pass()), coverage=full)["status"], "READY")

    def test_the_report_refuses_a_full_claim_that_carries_an_omission(self):
        import test_pipeline_and_report as T
        if not hasattr(T.ReportRefusals, "rep_cache"):
            T.ReportRefusals.setUpClass()
        rep = copy.deepcopy(T.ReportRefusals.rep_cache)
        rep["coverage"] = {"fullLiveRun": True, "kind": "FULL", "missing": [], "approvedOmissionsApplied": [{"case": "AHT-02", "assertion": "owner-bound"}], "rowsExecuted": 203, "rowsRequired": 204, "coverageMode": "full", "casesRequired": 15}
        errs = W.validate(rep, sample()["wf"])
        self.assertTrue(any("approved omissions are incomplete coverage" in e for e in errs), errs)

    @needs_history
    def test_the_validator_warns_that_an_omission_is_not_a_full_pass(self):
        import validate_run_request as V
        from _fixtures import reconciliation
        s = sample()
        req, _ = self.request(1)
        b = V.derive_budget(s["cfg"], reconciliation(), RECEIPTS)
        errs, warns = V.validate(req, s["cfg"], s["ledger"], s["wf"], fake_rv(), reconciliation(), b)
        self.assertEqual(errs, [])
        self.assertTrue(any("incomplete coverage" in w and "full 204-row pass" in w for w in warns), warns)


class DeployedVersionBinding(unittest.TestCase):
    """Nightly regression needs every result bound to the deployed version that was tested."""
    def setUp(self):
        self.req = J("config", "runs", "R7-full-coverage-proposal.json")
        self.cat = json.load(open(os.path.join(ROOT, "config", "assertion-catalog.json")))
        self.res = ApprovedOmissionsAreIncompleteCoverage().results(self.req)

    def test_a_matching_run_is_bound(self):
        out = CC.assess(self.req, self.cat, self.res)
        self.assertTrue(out["deployedVersionBinding"]["ok"])
        self.assertEqual(out["deployedVersionBinding"]["receiptsChecked"], 30)
        self.assertTrue(out["fullLiveRun"])

    def test_a_different_served_version_mid_run_is_not_a_full_live_run(self):
        self.res["cases"][6]["identityAfter"]["servedSha"] = "1" * 40
        out = CC.assess(self.req, self.cat, self.res)
        self.assertFalse(out["fullLiveRun"])
        self.assertFalse(out["deployedVersionBinding"]["ok"])
        self.assertIn("AHT-07 identityAfter", out["deployedVersionBinding"]["problems"][0])

    def test_a_drift_result_or_a_missing_receipt_or_final_mismatch_fails(self):
        for mutate in (lambda r: r["cases"][0]["identityBefore"].update(result="DRIFT"), lambda r: r["cases"][1].pop("identityBefore"), lambda r: r.update(finalIdentity="DRIFT"),
                       lambda r: r.update(servedSha="2" * 40)):
            res = copy.deepcopy(self.res); mutate(res)
            self.assertFalse(CC.assess(self.req, self.cat, res)["fullLiveRun"])

    def test_results_with_no_identity_receipts_are_unproven_not_ok(self):
        for c in self.res["cases"]:
            c.pop("identityBefore"); c.pop("identityAfter")
        out = CC.assess(self.req, self.cat, self.res)
        self.assertFalse(out["deployedVersionBinding"]["ok"])
        self.assertFalse(out["fullLiveRun"])

    @needs_history
    def test_the_sealed_r5_identity_receipts_all_matched_the_tested_sha(self):
        r5 = J("config", "history", "receipts", "R5", "case-results.json")
        req = copy.deepcopy(self.req); req["release"]["testedSha"] = r5["sourceSha"]
        b = CC.deployed_version_binding(req, r5)
        self.assertTrue(b["ok"], b)
        self.assertEqual(b["receiptsChecked"], 30)


if __name__ == "__main__":
    unittest.main()
