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
        self.assertIsNone(self.proposal["bootstrap"]["sha256"])
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
        ])
        self.assertTrue(all(item["disposition"] == "UNRESOLVED" and item["usage"] is None for item in doc["unresolved"][1:]))

    def test_root_and_scope_are_reviewable_but_cannot_activate(self):
        self.assertEqual(self.proposal["stateRef"], "refs/heads/cloud-test-state")
        self.assertEqual(self.proposal["stateRoot"], {
            "commit": "92d6ebf902351750c368d7d513116c6b1f19f80c",
            "tree": "cd2955341fbc0b2fa2379e3ef0494575323076f1",
            "ledgerSha256": "8d474b3e5abb686da19c674bf0f6eba2420f733a9baa27c1c018b6987ad20b68",
            "parentCount": 0,
            "events": 0,
        })
        scope = self.proposal["periodScope"]
        self.assertEqual(scope["knownMinimumCeilings"], {
            "requests": 12957,
            "protectedReserveRequests": 664,
            "identityReads": 152,
            "starts": 106,
            "takes": 69,
        })
        self.assertEqual((scope["ceilings"], scope["approvalRef"], scope["sha256"]), (None, None, None))
        self.assertFalse(self.proposal["rootRefCreationSelected"])
        self.assertFalse(self.proposal["activationPinsSelected"])
        self.assertFalse(self.proposal["knownLaterRunsResolved"])

    def test_exact_headroom_matches_the_proposed_run(self):
        minimum = self.proposal["periodScope"]["knownMinimumCeilings"]
        doc = accounting_rollup.parse_bootstrap(self.bootstrap_path.read_bytes())
        measured = doc["unresolved"][0]["usage"]
        known_used = {key: doc["usage"][key] + measured[key] for key in ("requests", "identityReads", "starts", "takes")}
        headroom = {
            "requests": minimum["requests"] - minimum["protectedReserveRequests"] - known_used["requests"],
            "identityReads": minimum["identityReads"] - known_used["identityReads"],
            "starts": minimum["starts"] - known_used["starts"],
            "takes": minimum["takes"] - known_used["takes"],
        }
        self.assertEqual(headroom, {"requests": 4342, "identityReads": 32, "starts": 42, "takes": 31})


if __name__ == "__main__":
    unittest.main()
