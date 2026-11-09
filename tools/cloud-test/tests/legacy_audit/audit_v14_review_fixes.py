"""HISTORICAL AUDIT of the retained Cloud Test campaigns: the history tests of tests/test_v14_review_fixes.py, moved unchanged from 96af08e7 with the
module helpers they use. Not part of the current suite (never collected by `discover -p test_*.py`), never current-execution credit; run
only by scripts/run_legacy_audit.py with the retained history present. The current suite runs the same rules on the synthetic history."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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


@needs_history
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

    @needs_history
    def test_the_sealed_r5_identity_receipts_all_matched_the_tested_sha(self):
        r5 = J("config", "history", "receipts", "R5", "case-results.json")
        req = copy.deepcopy(self.req); req["release"]["testedSha"] = r5["sourceSha"]
        b = CC.deployed_version_binding(req, r5)
        self.assertTrue(b["ok"], b)
        self.assertEqual(b["receiptsChecked"], 30)


if __name__ == "__main__":
    import unittest
    unittest.main()
