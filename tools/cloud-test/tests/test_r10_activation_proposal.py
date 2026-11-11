import json
import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import accounting_rollup  # noqa: E402


class R10ActivationProposal(unittest.TestCase):
    def setUp(self):
        self.proposal = json.loads((ROOT / "config/proposals/R10-manual-activation.proposal.json").read_text())
        self.bootstrap_path = ROOT / self.proposal["bootstrap"]["path"].removeprefix("tools/cloud-test/")

    def test_historical_bootstrap_is_well_formed_and_exactly_pinned(self):
        raw = self.bootstrap_path.read_bytes()
        doc = accounting_rollup.parse_bootstrap(raw)
        self.assertEqual(self.proposal["bootstrap"]["sha256"], "0a3e60271dc703f12cf02684450a9f74bc7f60d5c3f610a86bb9eaddc268f174")
        self.assertEqual(doc["usage"], {
            "requests": 5529,
            "identityReads": 94,
            "starts": 46,
            "takes": 24,
            "coachingRequests": None,
            "runnerMinutes": None,
        })
        self.assertTrue(doc["authority"]["expired"])
        self.assertEqual(doc["unresolved"][0]["disposition"], "MEASURED")
        self.assertEqual(doc["unresolved"][0]["usage"], {
            "requests": 2422,
            "identityReads": 26,
            "starts": 18,
            "takes": 14,
            "coachingRequests": 8,
            "runnerMinutes": None,
        })
        self.assertEqual([item["ref"] for item in doc["unresolved"][1:]], [
            "gha-run:41071743003",
            "gha-run:41115876890",
            "gha-run:41134025368",
            "gha-run:41231659142",
            "gha-run:41322870182",
            "gha-run:41325698722",
            "git:187e0ccbdf96def6eeaba2708ad2d28f2fe552ef",
        ])
        self.assertTrue(all(item["disposition"] == "UNRESOLVED" and item["usage"] is None for item in doc["unresolved"][1:]))
        self.assertEqual(doc["asOfUtc"], "2026-11-02T20:12:15Z")
        self.assertTrue({
            "git:187e0ccbdf96def6eeaba2708ad2d28f2fe552ef",
            "git:d6e0f12f151773dd772cfc77e082bab3d771f7ab",
            "git:598439511c1d2cdd97147d3dbd6d7f723b13eb05",
        }.issubset(set(doc["sourceRecords"])))

    def test_root_and_scope_are_exactly_the_selected_bytes(self):
        self.assertEqual(self.proposal["stateRef"], "refs/heads/cloud-test-state")
        self.assertEqual(self.proposal["stateRoot"], {
            "commit": "92d6ebf902351750c368d7d513116c6b1f19f80c",
            "tree": "cd2955341fbc0b2fa2379e3ef0494575323076f1",
            "ledgerSha256": "8d474b3e5abb686da19c674bf0f6eba2420f733a9baa27c1c018b6987ad20b68",
            "parentCount": 0,
            "events": 0,
        })
        scope = self.proposal["periodScope"]
        self.assertLessEqual(json.loads(self.bootstrap_path.read_text())["asOfUtc"], scope["periodStartUtc"])
        expected = {"requests": 4342, "protectedReserveRequests": 0, "identityReads": 32, "starts": 42, "takes": 31}
        self.assertEqual(scope["carryover"], "none")
        self.assertEqual(scope["knownMinimumCeilings"], expected)
        self.assertEqual((scope["ceilings"], scope["approvalRef"], scope["sha256"]),
                         (expected, "slack:1793814535.013849", "ee4d3d5ea2c343433ff2b1d7fd36aecdf5ca1438faf0836402d18ac74ddbe397"))
        self.assertTrue(self.proposal["rootRefCreationSelected"])
        self.assertTrue(self.proposal["activationPinsSelected"])
        scope_path = ROOT / "config/aggregate/period-scope.json"
        self.assertEqual(accounting_rollup.hashlib.sha256(scope_path.read_bytes()).hexdigest(), scope["sha256"])
        committed_scope = accounting_rollup.parse_scope(json.loads(scope_path.read_text()))
        self.assertEqual(committed_scope["approvalRef"], scope["approvalRef"])
        self.assertFalse(self.proposal["knownLaterRunsResolved"])

    def test_known_measured_usage_is_not_relabelled_as_current_headroom(self):
        doc = accounting_rollup.parse_bootstrap(self.bootstrap_path.read_bytes())
        measured = doc["unresolved"][0]["usage"]
        known_used = {key: doc["usage"][key] + measured[key] for key in ("requests", "identityReads", "starts", "takes")}
        self.assertEqual(known_used, {"requests": 7951, "identityReads": 120, "starts": 64, "takes": 38})
        expected = {"requests": 4342, "protectedReserveRequests": 0, "identityReads": 32, "starts": 42, "takes": 31}
        self.assertEqual(self.proposal["periodScope"]["knownMinimumCeilings"], expected)
        self.assertEqual(self.proposal["periodScope"]["ceilings"], expected)
        self.assertFalse(self.proposal["knownLaterRunsResolved"])
        self.assertIn("remain UNRESOLVED", self.proposal["historicalDisposition"])


if __name__ == "__main__":
    unittest.main()
