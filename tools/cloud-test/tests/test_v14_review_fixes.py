"""Workflow 1.4.0 review fixes: (1) each row is compared with the most recent earlier run that has a verdict for it, never always the previous run;
(2) the owner's unexplained usage is carried forward, never dropped; (3) an approved omission is incomplete coverage, never a full pass."""
import copy
import json
import os
import shutil
import tempfile
import unittest

from _fixtures import ROOT, REPO, TESTED, J, fake_rv, prerequisite, request_path, run_py, sample, wjson
import reconcile_cumulative as RC
import select_baselines as SB
import check_coverage as CC
import derive_summary as DS
import workflow_report as W
from test_comparison_automation import derive_gap, synthetic_latest, writable, manifest

RECEIPTS = os.path.join(ROOT, "config", "history", "receipts")
GAP03_PASS = {"AHT-12": {"press-bound-denial": "PASS", "denial-truthful-no-mic": "PASS"}}


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
        d, cp = synthetic_latest({"AHT-12": {"owner-bound": "PASS", "press-bound-denial": "PASS"}})
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
        d, _ = synthetic_latest(GAP03_PASS)
        cfg = json.load(open(os.path.join(d, "cfg.json")))
        j = SB.select(sample()["ledger"], cfg, d, "R6T")["journeys"]
        self.assertEqual((j["AHT-04"]["previousVerdictRun"], j["AHT-04"]["lastKnownGood"]), ("R4C", "R4C"))   # PASS in R4C, NOT RUN in R5
        self.assertEqual((j["AHT-15"]["previousVerdictRun"], j["AHT-15"]["lastKnownGood"]), ("R5", "R5"))
        self.assertEqual(j["AHT-02"]["previousVerdict"], "FAIL")
        self.assertIsNone(j["AHT-02"]["lastKnownGood"])      # never passed
        self.assertEqual(j["AHT-04"]["lastKnownGoodServedSha"], "2b48eabc3f900e2481c35bfef63550b0c531faa6")

    def test_a_row_nobody_tested_is_a_first_observation_not_a_blocker(self):
        d, cp = synthetic_latest({"AHT-14": {"download-fault-exercised": "PASS"}})
        out = SB.select({"gaps": [{"id": "G", "expectedPass": {"requirements": [{"case": "AHT-14", "assertions": ["download-fault-exercised"]}]}}]}, json.load(open(os.path.join(d, "cfg.json"))), d, "R6T")
        self.assertIsNone(out["gaps"]["G"]["rows"]["AHT-14/download-fault-exercised"]["baseline"])

    def test_a_latest_run_that_is_not_in_the_history_is_refused(self):
        with self.assertRaises(ValueError):
            SB.select(sample()["ledger"], sample()["cfg"], RECEIPTS, "R9")


class PipelineComparesWithTheRightRun(unittest.TestCase):
    def test_the_pipeline_compares_the_latest_run_with_every_baseline_it_needs(self):
        prerequisite(os.path.isdir(os.path.join(REPO, ".git")) and __import__("subprocess").run(["git", "-C", REPO, "cat-file", "-e", TESTED + "^{commit}"], capture_output=True).returncode == 0, "git history with the tested SHA")
        d = tempfile.mkdtemp(prefix="ct-pipe-")
        for lab in ("R4", "R4B", "R4C", "R5"):
            shutil.copytree(os.path.join(RECEIPTS, lab), os.path.join(d, lab))
        shutil.copytree(os.path.join(RECEIPTS, "R5"), os.path.join(d, "R6T"))
        writable(d)
        p = os.path.join(d, "R6T", "case-results.json")
        cr = json.load(open(p)); cr["campaignId"] = "R6T"
        for c in cr["cases"]:
            if c["caseId"] == "AHT-12":
                for a in c["assertions"]:
                    if a["id"] in ("press-bound-denial", "denial-truthful-no-mic"):
                        a["result"] = "PASS"
        wjson(p, cr)
        cfg = copy.deepcopy(sample()["cfg"])
        cfg["history"]["runs"].append({"label": "R6T", "campaignId": "R6T", "servedSha": TESTED, "ledgersOnly": False, "receiptsManifestSha256": manifest(os.path.join(d, "R6T"))})
        cp = os.path.join(d, "cfg.json"); wjson(cp, cfg)
        out = os.path.join(d, "out")
        r = run_py("scripts/pipeline.py", "--request", request_path(), "--out-dir", out, "--config", cp, "--receipts-root", d, "--latest-label", "R6T",
                   "--repo", REPO, "--generated-at", "2026-10-29T00:00:00Z")
        # exit 3 is the pipeline's own "actual spend over the cap" signal: the synthetic latest run is an R5 copy (2,085 requests) against a 180-request cap
        self.assertIn(r.returncode, (0, 3), r.stdout[-1500:] + r.stderr[-1500:])
        self.assertTrue(os.path.isfile(os.path.join(out, "comparisons", "R4C", "comparison.json")), "R4C was not compared although it holds the only verdict for the defect")
        self.assertTrue(os.path.isfile(os.path.join(out, "comparisons", "R5", "comparison.json")))
        gap = next(g for g in json.load(open(os.path.join(out, "ledger-derived.json")))["gaps"] if g["id"] == "GAP-03")
        self.assertEqual(gap["latest"]["comparedAgainst"], {"AHT-12/press-bound-denial": "R4C", "AHT-12/denial-truthful-no-mic": "R4C"})
        self.assertNotEqual(gap["status"], "CLOSED")           # R6T is an R5 copy: harness and release differ from R4C, so the comparison with R4C does not prove a fix
        self.assertIn("R4C", gap["latest"]["comparableReason"])
        self.assertIn("baselines.json", os.listdir(out))


def counters_through(stated="R5", frozen="R5"):
    c = json.load(open(os.path.join(ROOT, "config/history/owner-counters.json")))
    c["statedThroughRun"] = stated
    c["frozen"]["throughRun"] = frozen
    return c


def with_later_run(reads=4, requests=130, logs=True):
    d = tempfile.mkdtemp(prefix="ct-carry-")
    for lab in ("R4", "R4B", "R4C", "R5"):
        shutil.copytree(os.path.join(RECEIPTS, lab), os.path.join(d, lab))
    shutil.copytree(os.path.join(d, "R5"), os.path.join(d, "R6T"))
    writable(d)
    wjson(os.path.join(d, "R6T", "campaign-ledger.json"), {"used": {"total": requests, "signed-in": requests - 10, "public": 10}})
    wjson(os.path.join(d, "R6T", "identity-ledger.json"), {"identityGets": reads, "receipts": []})
    if not logs:
        for r, _, fs in os.walk(os.path.join(d, "R6T")):
            for f in fs:
                if f == "action-reservations.jsonl":
                    os.remove(os.path.join(r, f))
    cfg = copy.deepcopy(sample()["cfg"])
    cfg["history"]["runs"].append({"label": "R6T", "campaignId": "R6T", "servedSha": "x", "ledgersOnly": False})
    return d, cfg


class UnexplainedUsageIsCarriedForward(unittest.TestCase):
    def test_the_current_snapshot_is_unchanged(self):
        rc = RC.reconcile(sample()["cfg"], counters_through(), RECEIPTS)
        self.assertEqual((rc["requests"]["measuredFromSealedLedgers"], rc["requests"]["unreconciled"], rc["requests"]["conservativeUsed"]), (5421, 108, 5529))
        self.assertEqual((rc["identityReads"]["measuredFromSealedLedgers"], rc["identityReads"]["unreconciled"], rc["identityReads"]["conservativeUsed"]), (92, 2, 94))
        self.assertEqual(rc["snapshot"]["carriedForwardUnexplained"], {"requests": 108, "identityReads": 2})

    def test_92_measured_94_reported_plus_4_new_is_98_not_96(self):
        """The reviewed defect: max(measured, owner) = max(96, 94) = 96 dropped the owner's 2 unexplained reads as soon as measured usage passed the snapshot."""
        d, cfg = with_later_run(reads=4)
        rc = RC.reconcile(cfg, counters_through("R5", "R6T"), d)          # the freeze was moved forward without restating the owner's numbers
        self.assertEqual(rc["identityReads"]["measuredFromSealedLedgers"], 96)
        self.assertEqual(rc["identityReads"]["conservativeUsed"], 98)
        self.assertNotEqual(rc["identityReads"]["conservativeUsed"], max(96, 94))
        self.assertEqual(rc["requests"]["conservativeUsed"], 5421 + 130 + 108)     # not max(5551, 5529)
        self.assertEqual(rc["snapshot"]["runsAddedAfterStatement"], ["R6T"])

    def test_with_the_freeze_unchanged_the_new_run_is_added_once_and_the_difference_stays(self):
        import spend_report as S
        d, cfg = with_later_run(reads=4)
        rc = RC.reconcile(cfg, counters_through(), d)
        self.assertEqual(rc["identityReads"]["conservativeUsed"], 94)
        self.assertEqual([x["label"] for x in rc["afterFreeze"]], ["R6T"])
        rr = {"spend": {"requests": 130, "byCategory": {"signed-in": 120, "public": 10}, "identityReads": 4, "starts": 1, "takes": 0}}
        out = S.build(sample()["req"], cfg, rc, rr, None, None, "R6T", d)
        self.assertEqual(out["countedOnce"]["afterRun"]["identityReads"], 98)
        self.assertEqual(out["countedOnce"]["afterRun"]["requests"], 5529 + 130)

    def test_both_routes_agree(self):
        d, cfg = with_later_run(reads=4)
        a = RC.reconcile(cfg, counters_through("R5", "R6T"), d)
        b = RC.reconcile(cfg, counters_through(), d)
        self.assertEqual(a["identityReads"]["conservativeUsed"], b["identityReads"]["conservativeUsed"] + 4)
        self.assertEqual(a["requests"]["conservativeUsed"], b["requests"]["conservativeUsed"] + 130)

    def test_measured_usage_above_the_owner_count_is_never_reduced(self):
        c = counters_through(); c["identityReadsCumulative"] = 90; c["requests"]["allowanceBaselineThroughR4C"] = 3000
        rc = RC.reconcile(sample()["cfg"], c, RECEIPTS)
        self.assertEqual(rc["identityReads"]["conservativeUsed"], 92)
        self.assertEqual(rc["requests"]["conservativeUsed"], 5421)

    def test_a_snapshot_that_does_not_say_what_it_covers_is_rejected(self):
        c = counters_through(); del c["statedThroughRun"]
        with self.assertRaises(ValueError) as e:
            RC.reconcile(sample()["cfg"], c, RECEIPTS)
        self.assertIn("stale or unlabeled", str(e.exception))

    def test_a_freeze_earlier_than_the_statement_is_rejected(self):
        with self.assertRaises(ValueError):
            RC.reconcile(sample()["cfg"], counters_through("R5", "R4C"), RECEIPTS)

    def test_a_statement_about_an_unknown_run_is_rejected(self):
        with self.assertRaises(ValueError):
            RC.reconcile(sample()["cfg"], counters_through("R9", "R5"), RECEIPTS)

    def test_starts_and_takes_are_carried_from_the_later_runs_reservation_logs(self):
        d, cfg = with_later_run()
        rc = RC.reconcile(cfg, counters_through("R5", "R6T"), d)
        self.assertEqual((rc["starts"]["ownerCounted"], rc["takes"]["ownerCounted"]), (46 + 14, 24 + 9))

    def test_a_later_run_without_reservation_logs_cannot_be_carried_and_is_rejected(self):
        d, cfg = with_later_run(logs=False)
        with self.assertRaises(ValueError) as e:
            RC.reconcile(cfg, counters_through("R5", "R6T"), d)
        self.assertIn("restate the owner counters", str(e.exception))

    def test_the_requirement_for_the_next_run_uses_the_carried_figure(self):
        d, cfg = with_later_run(reads=4)
        rc = RC.reconcile(cfg, counters_through("R5", "R6T"), d)
        n = RC.need(rc, 4310, 32)
        self.assertEqual(n["requiredIdentityCap"], 98 + 32)
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

    def test_the_sealed_r5_identity_receipts_all_matched_the_tested_sha(self):
        r5 = J("config", "history", "receipts", "R5", "case-results.json")
        req = copy.deepcopy(self.req); req["release"]["testedSha"] = r5["sourceSha"]
        b = CC.deployed_version_binding(req, r5)
        self.assertTrue(b["ok"], b)
        self.assertEqual(b["receiptsChecked"], 30)


if __name__ == "__main__":
    unittest.main()
