"""The R10 manual all-15 request PROPOSAL (Sam 1793556832.735079) stays a proposal: the reviewed template's shape, all 15 journeys with the
ledger's gaps, and no approval, release, harness pin or budget figure bound. Prepare refuses it, and its location is not the admitted one."""
import json
import os
import unittest
from datetime import datetime, timezone

from _fixtures import ROOT
import init_run_inputs as I

REL = "config/proposals/R10-manual-all15.proposal.json"


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


class R10Proposal(unittest.TestCase):
    def setUp(self):
        self.req = load(REL)

    def test_it_has_the_reviewed_shape_and_selects_all_fifteen_with_the_ledger_gaps(self):
        self.assertTrue(I.request_shape_ok(self.req, I._request_keys()))
        self.assertEqual((self.req["proposal"], self.req["coverageMode"], self.req["sampleMode"], self.req["priority"], self.req["synthetic"]),
                         (True, "full", "full", "full-coverage", False))
        self.assertEqual([s["case"] for s in self.req["selection"]], I.ALL_CASES)
        ledger = load("config/gap-ledger.json")
        observed = {(o["case"], g["id"]) for g in ledger["gaps"] for o in g["observations"] if isinstance(o, dict) and o.get("case")}
        self.assertEqual({(s["case"], g) for s in self.req["selection"] for g in s["gaps"]}, observed)
        self.assertEqual(self.req["targetedGaps"], sorted(g["id"] for g in ledger["gaps"]))

    def test_nothing_is_approved_bound_or_typed(self):
        r = self.req
        self.assertTrue(all(v is None for v in r["approvedLimits"].values()))
        self.assertTrue(all(v is None for v in r["window"].values()))
        self.assertEqual((r["selectionApprovalRef"], r["release"]["testedSha"], r["release"]["lastRunTestedSha"]), (None, None, None))
        self.assertTrue(all(v is None for v in r["release"]["backend"].values()))
        self.assertTrue(all(v is None for v in r["harness"].values()))
        self.assertTrue(all(s["plannedRequests"] is None and s["needsCaptureDevice"] is None for s in r["selection"]))
        e = r["estimate"]
        self.assertTrue(all(v is None for v in e["requests"].values()))
        self.assertEqual([e[k] for k in ("identityReads", "starts", "takes", "githubRunnerMinutesMax")], [None] * 4)
        self.assertEqual((e["paidActionsAuthorizedUsd"], r["proposedLimits"]["paidActionsUsd"]), (0, 0))
        self.assertTrue(all(v is None for k, v in r["proposedLimits"].items() if k not in ("paidActionsUsd", "guardCaps")))

    def test_prepare_refuses_it_and_its_location_is_not_admitted(self):
        with self.assertRaises(I.Refused) as e:
            I.check_request(self.req, datetime(2026, 11, 2, tzinfo=timezone.utc), I._request_keys())
        self.assertEqual(str(e.exception), "request-release-sha")
        self.assertFalse(("tools/cloud-test/" + REL).startswith(I.REQUEST_DIR))
        with self.assertRaises(I.Refused) as e:
            I.select_request(os.path.dirname(os.path.dirname(ROOT)), "tools/cloud-test/" + REL, "0" * 40)
        self.assertEqual(str(e.exception), "request-not-in-the-reviewed-request-location")


if __name__ == "__main__":
    unittest.main()
