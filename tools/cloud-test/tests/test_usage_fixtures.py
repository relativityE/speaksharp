"""Exercise real cumulative/seal boundaries with synthetic, mutable-test-only data."""
import copy
import json
import unittest

from _fixtures import sample
from _usage_fixtures import UsageHistory
import history_index
import reconcile_cumulative
import verify_receipts


class HermeticUsageHistory(unittest.TestCase):
    def setUp(self):
        self.history = UsageHistory(sample()["cfg"])
        self.addCleanup(self.history.close)

    def test_all_four_sets_verify_with_real_nonplaceholder_seals(self):
        for entry in self.history.cfg["history"]["runs"]:
            with self.subTest(label=entry["label"]):
                errors, count = verify_receipts.verify_set(str(self.history.receipts / entry["label"]), entry["receiptsManifestSha256"])
                self.assertEqual(errors, [])
                self.assertGreater(count, 0)
                self.assertNotEqual(entry["receiptsManifestSha256"], "0" * 64)

    def test_no_generated_receipt_claims_an_approved_live_run(self):
        for base in self.history.receipts.iterdir():
            receipt = json.loads((base / "case-results.json").read_text())
            approval = json.loads((base / "security-approval.json").read_text())
            self.assertTrue(receipt["synthetic"])
            self.assertEqual(receipt["cases"], [])
            self.assertEqual(receipt["result"], "NOT RUN")
            self.assertIsNone(approval["approvedBy"])
            self.assertIsNone(approval["approvalRef"])

    def test_real_reconciliation_carries_the_declared_discrepancy(self):
        result = reconcile_cumulative.reconcile(self.history.cfg, self.history.counters, str(self.history.receipts))
        self.assertEqual(result["requests"]["measuredFromSealedLedgers"], 5421)
        self.assertEqual(result["requests"]["unreconciled"], 108)
        self.assertEqual(result["requests"]["conservativeUsed"], 5529)
        self.assertEqual(result["identityReads"]["conservativeUsed"], 94)

    def test_actual_index_verifies_and_rejects_a_changed_counter(self):
        index = history_index.wrap(history_index.derive(self.history.cfg, str(self.history.receipts), 2))
        self.assertEqual(history_index.verify(index, self.history.cfg, str(self.history.receipts)), [])
        bad = copy.deepcopy(index)
        bad["entries"][0]["summary"]["requests"] = 0
        self.assertTrue(history_index.verify(bad, self.history.cfg, str(self.history.receipts)))


if __name__ == "__main__":
    unittest.main()
