"""Real seal/index negative controls on bounded synthetic data, no product traffic."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "scripts"))
from _synthetic_receipts import seal_synthetic  # noqa: E402
import history_index  # noqa: E402
import verify_receipts  # noqa: E402


class SyntheticReceiptIntegrity(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ct-synthetic-integrity-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        raw = self.root / "raw"
        (raw / "AHT-01").mkdir(parents=True)
        data = {
            "case-results.json": {"synthetic": True, "campaignId": "SYNTHETIC-1",
                                  "sourceSha": "a1" * 20, "servedSha": "a1" * 20,
                                  "result": "NOT RUN", "safetyStopped": False,
                                  "finalIdentity": "NOT RUN", "cases": []},
            "campaign-ledger.json": {"synthetic": True, "used": {"total": 7},
                                     "updated": "2099-01-01T00:00:00Z"},
            "identity-ledger.json": {"synthetic": True, "identityGets": 2, "receipts": []},
            "AHT-01/fact.json": {"synthetic": True, "result": "NOT RUN"},
        }
        for name, value in data.items():
            (raw / name).write_text(json.dumps(value) + "\n")
        self.sealed = self.root / "SYNTHETIC-1"
        pin = seal_synthetic(raw, self.sealed, "SYNTHETIC-1")
        self.cfg = {"history": {"runs": [{"label": "SYNTHETIC-1", "campaignId": "SYNTHETIC-1",
                                         "servedSha": "a1" * 20, "ledgersOnly": False,
                                         "receiptsManifestSha256": pin}]}}
        self.pin = pin

    def test_actual_sealer_and_validator_agree_without_placeholder_pins(self):
        self.assertNotEqual(self.pin, "0" * 64)
        errors, count = verify_receipts.verify_set(str(self.sealed), self.pin)
        self.assertEqual(errors, [])
        self.assertGreater(count, 0)
        approval = json.loads((self.sealed / "security-approval.json").read_text())
        self.assertTrue(approval["synthetic"])
        self.assertIsNone(approval["approvedBy"])
        self.assertIsNone(approval["approvalRef"])

    def test_changed_or_removed_fixture_is_rejected_by_actual_validator(self):
        fact = self.sealed / "AHT-01/fact.json"
        fact.chmod(0o600)
        fact.write_text('{"synthetic":true,"result":"PASS"}\n')
        self.assertIn("changed: AHT-01/fact.json", verify_receipts.verify_set(str(self.sealed), self.pin)[0])
        fact.unlink()
        self.assertIn("missing: AHT-01/fact.json", verify_receipts.verify_set(str(self.sealed), self.pin)[0])

    def test_resealing_changed_data_does_not_match_original_pin(self):
        fact = self.sealed / "AHT-01/fact.json"
        fact.chmod(0o600)
        fact.write_text('{"synthetic":true,"result":"PASS"}\n')
        successor = self.root / "new-seal"
        next_pin = seal_synthetic(self.sealed, successor, "SYNTHETIC-1")
        self.assertNotEqual(next_pin, self.pin)
        self.assertTrue(any("pinned hash" in error for error in
                            verify_receipts.verify_set(str(successor), self.pin)[0]))

    def test_actual_index_binds_measured_counters_and_rejects_changed_history(self):
        index = history_index.wrap(history_index.derive(self.cfg, str(self.root), 1))
        self.cfg["history"]["index"] = {"headHash": index["headHash"]}
        self.assertEqual(history_index.verify(index, self.cfg, str(self.root)), [])
        self.assertEqual(index["entries"][0]["summary"]["requests"], 7)
        changed = copy.deepcopy(index)
        changed["entries"][0]["summary"]["requests"] = 0
        self.assertTrue(history_index.verify(changed, self.cfg, str(self.root)))
        ledger = self.sealed / "campaign-ledger.json"
        ledger.chmod(0o600)
        ledger.write_text('{"synthetic":true,"used":{"total":0}}')
        self.assertTrue(history_index.verify(index, self.cfg, str(self.root)))


if __name__ == "__main__":
    unittest.main()
