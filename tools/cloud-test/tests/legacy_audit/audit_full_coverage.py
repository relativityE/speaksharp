"""HISTORICAL AUDIT of the retained Cloud Test campaigns R4C/R5 (moved unchanged from tests/test_full_coverage.py at 96af08e7).

These tests verify the real sealed receipts and the figures derived from them. They are NOT part of the current suite (the current
`unittest discover -p test_*.py` never collects this directory), never earn current-execution credit and run only through
scripts/run_legacy_audit.py with the retained history present under tools/cloud-test/config/history. Without it they are reported as
not executed, never as passed."""
import copy
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _fixtures import ROOT, J, sample, reconciliation, wjson, needs_history  # noqa: E402

import derive_case_costs as DC  # noqa: E402
import full_coverage_budget as FB  # noqa: E402
import check_coverage as CC  # noqa: E402

RECEIPTS = os.path.join(ROOT, "config", "history", "receipts")


def costs():
    return {"runs": {lab: DC.derive_run(RECEIPTS, lab) for lab in ("R4C", "R5")}}


def catalog():
    return J("config", "assertion-catalog.json")


def r7():
    return J("config", "runs", "R7-full-coverage-proposal.json")


@needs_history
class CaseCostsFromGuardLogs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = costs()

    def test_per_case_costs_reconcile_to_each_runs_sealed_ledger(self):
        for lab, total in (("R4C", 2520), ("R5", 2085)):
            r = self.c["runs"][lab]
            self.assertTrue(r["reconciliation"]["ok"], r["reconciliation"])
            self.assertEqual(sum(x["requests"]["total"] for x in r["cases"]), total)
            self.assertEqual(len(r["cases"]), 15)

    def test_every_category_sums_to_the_ledger_and_the_total_is_fixed_plus_variable(self):
        for r in self.c["runs"].values():
            for x in r["cases"]:
                b = x["requests"]["byCategory"]
                # navigations are counted inside public as well, so the partition is public + preflight + auth + signed-in + model + coaching
                self.assertEqual(b["public"] + b["preflight"] + b["auth"] + b["signed-in"] + b["model"] + b["coaching"], x["requests"]["total"], x["case"])

    def test_known_cases_match_the_logs(self):
        r4c = {x["case"]: x for x in self.c["runs"]["R4C"]["cases"]}
        r5 = {x["case"]: x for x in self.c["runs"]["R5"]["cases"]}
        self.assertEqual(r4c["AHT-01"]["requests"]["total"], 157)
        self.assertEqual(r4c["AHT-05"]["requests"]["total"], 315)
        self.assertEqual(r5["AHT-10"]["requests"]["total"], 150)
        self.assertTrue(r5["AHT-10"]["lowerBound"])
        self.assertIn("stopped by its request allowance", " ".join(r5["AHT-10"]["lowerBoundBecause"]))
        self.assertEqual(r4c["AHT-12"]["startsPressed"], 1)
        self.assertEqual(r4c["AHT-12"]["takesSaved"], 0)

    def test_a_case_with_unexecuted_rows_is_marked_a_lower_bound(self):
        for r in self.c["runs"].values():
            for x in r["cases"]:
                self.assertEqual(x["lowerBound"], bool(x["rows"]["notRun"]) or "no guard stop summary" in x["lowerBoundBecause"] or any("allowance" in w for w in x["lowerBoundBecause"]), x["case"])

    def test_identity_reads_are_two_per_case(self):
        for r in self.c["runs"].values():
            self.assertTrue(all(x["identityReads"] == 2 for x in r["cases"]))
            self.assertEqual(r["totals"]["identityReadsLedger"], 32)

    def test_a_tampered_guard_log_is_a_reported_mismatch_not_a_silent_one(self):
        with tempfile.TemporaryDirectory() as d:
            import shutil
            shutil.copytree(os.path.join(RECEIPTS, "R5"), os.path.join(d, "R5"))
            led = os.path.join(d, "R5", "campaign-ledger.json")
            j = json.load(open(led)); j["used"]["total"] += 7; wjson(led, j)
            self.assertFalse(DC.derive_run(d, "R5")["reconciliation"]["ok"])


class RetainedCampaignAudit(unittest.TestCase):
    @needs_history
    def test_every_sealed_receipt_row_is_in_the_catalog(self):
        cat = catalog()["cases"]
        for lab in ("R4C", "R5"):
            for row in J("config", "history", "receipts", lab, "case-results.json")["cases"]:
                self.assertEqual(sorted(a["id"] for a in row["assertions"]), sorted(cat[row["caseId"]]["requiredAssertions"]))

    @needs_history
    def test_the_sealed_r5_results_are_reported_as_partial_92_of_204(self):
        req = r7()
        out = CC.assess(req, catalog(), J("config", "history", "receipts", "R5", "case-results.json"))
        self.assertFalse(out["fullLiveRun"])
        self.assertEqual(out["rowsExecuted"], 92)
        self.assertEqual(len(out["missing"]), 112)

    @needs_history
    def test_the_proposal_request_carries_exactly_the_derived_limits(self):
        r = r7()
        b = FB.with_sensitivity(sample()["cfg"], costs(), catalog(), reconciliation())
        self.assertEqual(r["proposedLimits"]["cumulativeCeilingRequests"], b["cumulative"]["requiredCeiling"])
        self.assertEqual(r["estimate"]["requests"]["runCap"], b["requests"]["runCap"])
        self.assertTrue(all(v is None for k, v in r["approvedLimits"].items()))
        self.assertTrue(r["proposal"])
        self.assertEqual(r["approvedOmissions"], [])


if __name__ == "__main__":
    unittest.main()
