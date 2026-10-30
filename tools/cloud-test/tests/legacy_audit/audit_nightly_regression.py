"""HISTORICAL AUDIT of the retained Cloud Test campaigns: the history tests of tests/test_nightly_regression.py, moved unchanged from 96af08e7 with the
module helpers they use. Not part of the current suite (never collected by `discover -p test_*.py`), never current-execution credit; run
only by scripts/run_legacy_audit.py with the retained history present. The current suite runs the same rules on the synthetic history."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import copy


import json


import os


import subprocess


import sys


import tempfile


import unittest


from _fixtures import ROOT, J, run_py, sample, wjson, needs_history


from _nightly import CATALOG, SHA, history, make_run, request, utc


import check_coverage as CC


import check_gates as CG


import derive_alerts as DA


import history_index as HI


import recurring_budget as RB


import validate_run_request as V


import verify_catalog_history as VC


BROKEN = ("AHT-07", CATALOG["cases"]["AHT-07"]["requiredAssertions"][1])


OTHER = ("AHT-12", CATALOG["cases"]["AHT-12"]["requiredAssertions"][2])


def alerts_for(root, cfg, label, **kw):
    req = request(label, SHA[label])
    cov = CC.assess(req, CATALOG, json.load(open(os.path.join(root, label, "case-results.json"))))
    return DA.derive(cfg, root, label, cov, **kw), cov


class OtherAlertKinds(unittest.TestCase):
    @needs_history
    def test_the_sealed_history_gives_real_alerts_for_r5(self):
        out = DA.derive(J("config", "test-config.v1.json"), os.path.join(ROOT, "config", "history", "receipts"), "R5", {"fullLiveRun": False, "kind": "PARTIAL", "statement": "92 of 204 required rows executed", "reasons": ["partial"], "missing": []})
        kinds = sorted(a["kind"] for a in out["alerts"])
        self.assertIn("COVERAGE-INCOMPLETE", kinds)
        self.assertIn("RECOVERED", kinds)          # AHT-10 leave-released: FAIL in R4C, PASS in R5
        self.assertEqual(kinds.count("STILL-FAILING"), 2)   # AHT-02 and AHT-03 never passed


class RetainedHistory(unittest.TestCase):
    @needs_history
    def test_the_shipped_index_verifies_and_is_pinned(self):
        cfg = J("config", "test-config.v1.json")
        idx = J("config", "history", "index.json")
        self.assertEqual(HI.verify(idx, cfg, os.path.join(ROOT, "config", "history", "receipts")), [])
        self.assertEqual(cfg["history"]["index"]["headHash"], idx["headHash"])
        self.assertEqual([e["label"] for e in idx["entries"]], ["R4", "R4B", "R4C", "R5"])
        r5 = idx["entries"][3]["summary"]
        self.assertEqual((r5["rows"], r5["rowsExecuted"]), ({"PASS": 90, "FAIL": 2, "NOT RUN": 112}, 92))

    def build(self, *specs):
        root, cfg = history(*specs)
        idx = HI.wrap(HI.derive(cfg, root, 1))
        return root, cfg, idx


class AdditiveCatalog(unittest.TestCase):
    def snaps(self):
        return {1: copy.deepcopy(CATALOG)}

    def v2(self, mutate):
        c = copy.deepcopy(CATALOG); mutate(c)
        return c

    @needs_history
    def test_history_is_judged_against_the_catalog_of_its_own_time(self):
        """R5 stays 92 of 204 however large the catalog grows: its index entry was recorded against v1 and is never recomputed against v2."""
        idx = J("config", "history", "index.json")
        self.assertEqual({e["catalogVersion"] for e in idx["entries"]}, {1})
        c2 = self.v2(lambda c: c["cases"]["AHT-01"]["requiredAssertions"].append("new-check"))
        r5 = J("config", "history", "receipts", "R5", "case-results.json")
        old = CC.assess(request("R5-x", r5["sourceSha"]), CATALOG, r5)
        self.assertEqual((old["rowsExecuted"], old["rowsRequired"]), (92, 204))
        newer = CC.assess(request("R5-x", r5["sourceSha"]), c2, r5)
        self.assertEqual(newer["rowsRequired"], 205)
        self.assertEqual(idx["entries"][3]["summary"]["rowsTotal"], 204)


class StandingApprovalOfRecurringCost(unittest.TestCase):
    def setUp(self):
        self.s = sample()
        self.req = request("R9-N2")
        self.req["window"] = {"startUtc": "2026-11-02T03:00:00Z", "endUtc": "2026-11-02T08:00:00Z", "approvalRef": "standing-1"}
        est = self.req["estimate"]
        self.ap = {"status": "APPROVED", "approvedBy": "owner", "approvalRef": "standing-1", "approvedAtUtc": "2026-11-01T00:00:00Z", "validFromUtc": "2026-11-01T00:00:00Z", "expiresUtc": "2026-12-01T00:00:00Z",
                   "periodStartUtc": "2026-11-01T00:00:00Z", "cadence": {"runsPerPeriod": 30, "period": "30 days"},
                   "perRunCaps": {"runCapRequests": est["requests"]["runCap"], "identityReads": est["identityReads"], "starts": est["starts"], "takes": est["takes"],
                                  "coachingRequests": est["providerBillableRequests"]["coachingCap"], "windowMinutes": est["window"]["proposedMinutes"], "githubRunnerMinutes": 30, "paidActionsUsd": 0},
                   "periodCaps": {"requests": 30 * est["requests"]["runCap"], "identityReads": 30 * est["identityReads"], "starts": 30 * est["starts"], "takes": 30 * est["takes"],
                                  "coachingRequests": 30 * est["providerBillableRequests"]["coachingCap"], "githubRunnerMinutes": 30 * 30, "paidActionsUsd": 0}}

    def gate(self, ap=None, req=None, index=None, now="2026-11-02T03:00:00Z"):
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, "config"))
        wjson(os.path.join(d, "config", "recurring-approval.json"), ap if ap is not None else self.ap)
        return CG.recurring_gate(req or self.req, self.s["cfg"], d, index, utc(now))

    @needs_history
    def test_the_nightly_request_is_valid_and_a_partial_nightly_is_not(self):
        s = self.s
        from _fixtures import fake_rv, reconciliation
        b = V.derive_budget(s["cfg"], reconciliation(), os.path.join(ROOT, "config", "history", "receipts"))
        errs, _ = V.validate(J("config", "runs", "R8-nightly-regression-proposal.json"), s["cfg"], s["ledger"], s["wf"], fake_rv(), reconciliation(), b)
        self.assertEqual(errs, [])
        bad = J("config", "runs", "R8-nightly-regression-proposal.json"); bad["coverageMode"] = "partial"; bad["sampleMode"] = "minimal"
        errs, _ = V.validate(bad, s["cfg"], s["ledger"], s["wf"], fake_rv(), reconciliation(), None)
        self.assertTrue(any("only for coverageMode full" in e for e in errs), errs)

    @needs_history
    def test_the_proposal_is_derived_flagged_and_keeps_unknown_costs_unknown(self):
        from _fixtures import reconciliation
        budget = json.load(open(os.path.join(ROOT, "FULL-COVERAGE-BUDGET.json"))) if os.path.exists(os.path.join(ROOT, "FULL-COVERAGE-BUDGET.json")) else None
        import full_coverage_budget as FB
        import derive_case_costs as DC
        costs = {"runs": {lab: DC.derive_run(os.path.join(ROOT, "config", "history", "receipts"), lab) for lab in ("R4C", "R5")}}
        budget = FB.compute(self.s["cfg"], costs, CATALOG, reconciliation())
        p = RB.proposal(self.s["cfg"], budget, J("config", "history", "index.json"), 30)
        self.assertIn("NOT APPROVED", p["status"])
        self.assertEqual(p["periodTotals"]["requests"], 30 * budget["requests"]["runCap"])
        self.assertFalse(p["measuredFullRunAvailable"])
        self.assertEqual(p["unknownCosts"]["cloudAgentUsd"], "unknown")
        self.assertEqual(p["periodTotals"]["paidActionsUsd"], 0)


if __name__ == "__main__":
    import unittest
    unittest.main()
