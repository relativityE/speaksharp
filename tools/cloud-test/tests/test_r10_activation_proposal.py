import hashlib
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
        self.assertEqual(hashlib.sha256(raw).hexdigest(), self.proposal["bootstrap"]["sha256"])
        self.assertEqual(doc["usage"], {
            "requests": 5529,
            "identityReads": 94,
            "starts": 46,
            "takes": 24,
            "coachingRequests": None,
            "runnerMinutes": None,
        })
        self.assertTrue(doc["authority"]["expired"])
        self.assertEqual(doc["unresolved"], [])

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
        self.assertEqual(scope["ceilings"], {
            "requests": 10535,
            "protectedReserveRequests": 664,
            "identityReads": 126,
            "starts": 88,
            "takes": 55,
        })
        self.assertEqual((scope["approvalRef"], scope["sha256"]), (None, None))
        self.assertFalse(self.proposal["rootRefCreationSelected"])
        self.assertFalse(self.proposal["activationPinsSelected"])

    def test_exact_headroom_matches_the_proposed_run(self):
        scope = self.proposal["periodScope"]
        historical = accounting_rollup.parse_bootstrap(self.bootstrap_path.read_bytes())["usage"]
        headroom = {
            "requests": scope["ceilings"]["requests"] - scope["ceilings"]["protectedReserveRequests"] - historical["requests"],
            "identityReads": scope["ceilings"]["identityReads"] - historical["identityReads"],
            "starts": scope["ceilings"]["starts"] - historical["starts"],
            "takes": scope["ceilings"]["takes"] - historical["takes"],
        }
        self.assertEqual(headroom, {"requests": 4342, "identityReads": 32, "starts": 42, "takes": 31})


if __name__ == "__main__":
    unittest.main()
