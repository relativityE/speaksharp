"""The R10 manual all-15 request PROPOSAL stays a proposal: the reviewed template's shape, all 15 journeys with the
ledger's gaps and the current derived accounting figures, but no approval, release or harness pin. Prepare refuses it, and its location is not the
admitted one."""
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

    def test_derived_figures_do_not_approve_or_bind_the_proposal(self):
        r = self.req
        self.assertTrue(all(v is None for v in r["approvedLimits"].values()))
        self.assertTrue(all(v is None for v in r["window"].values()))
        self.assertEqual((r["selectionApprovalRef"], r["release"]["testedSha"], r["release"]["lastRunTestedSha"]), (None, None, None))
        self.assertTrue(all(v is None for v in r["release"]["backend"].values()))
        self.assertTrue(all(v is None for v in r["harness"].values()))
        self.assertEqual([s["plannedRequests"] for s in r["selection"]],
                         [340, 260, 230, 160, 320, 310, 360, 110, 260, 190, 330, 120, 130, 360, 130])
        self.assertEqual([s["needsCaptureDevice"] for s in r["selection"]],
                         [True, True, True, True, True, True, True, False, True, True, True, True, True, True, False])
        e = r["estimate"]
        self.assertEqual(e["requests"], {"planned": 3610, "cleanupReserve": 150, "pooledSlack": 550, "runCap": 4310})
        self.assertEqual([e[k] for k in ("identityReads", "starts", "takes", "githubRunnerMinutesMax")], [32, 42, 31, 359])
        self.assertEqual(e["window"], {"expectedMinutes": 111, "worstCaseMinutes": 304, "proposedMinutes": 330})
        self.assertEqual((e["paidActionsAuthorizedUsd"], r["proposedLimits"]["paidActionsUsd"]), (0, 0))
        self.assertEqual({k: r["proposedLimits"][k] for k in ("cumulativeCeilingRequests", "identityCap", "startsCap", "takesCap", "runCapRequests")},
                         {"cumulativeCeilingRequests": 4342, "identityCap": 32, "startsCap": 42, "takesCap": 31, "runCapRequests": 4310})
        self.assertIn("0 period usage + 4310 run cap + 0 protected reserve + 32 identity reads = 4342",
                      r["proposedLimits"]["ceilingIncreaseJustification"])
        self.assertEqual(sum(r["proposedLimits"]["startPressCaps"].values()), e["starts"])
        selection_caps = {row["case"]: row["startPressCap"] for row in r["selection"]}
        self.assertEqual(selection_caps, r["proposedLimits"]["startPressCaps"])

    def test_authenticated_evidence_scope_is_the_current_five_case_role_minimum(self):
        # AHT-01/02/03 each request coaching authority (one delivery, two Supabase reads).
        # AHT-07 requests coaching authority, feedback association and feedback receipt
        # (three deliveries, three Supabase reads, one telemetry read). AHT-08 requests
        # feedback association and feedback receipt (two deliveries, one Supabase read,
        # one telemetry read). No other case receives the privileged producer.
        expected = {"maxDeliveries": 8, "maxSupabaseRequests": 10, "maxTelemetryReads": 2}
        self.assertEqual(self.req["evidenceScope"], expected)
        self.assertEqual(load("tests/fixtures/nightly-template.synthetic.json")["evidenceScope"], expected)

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
