"""Small, sealed arithmetic fixtures; not retained Cloud evidence or run authority.

R4/R4B/R4C/R5 are compatibility labels required by the cumulative-counter
contract. All files are generated in a temporary directory, with no real
transcripts, identities, approvals or original receipt bytes.
"""
import copy
import json
from pathlib import Path
import tempfile

from _synthetic_receipts import seal_synthetic


class UsageHistory:
    def __init__(self, config):
        self._temporary = tempfile.TemporaryDirectory(prefix="ct-usage-synthetic-")
        self.root = Path(self._temporary.name)
        self.receipts = self.root / "receipts"
        self.receipts.mkdir()
        self.cfg = copy.deepcopy(config)
        self.cfg["history"] = {"runs": [], "order": ["R4", "R4B", "R4C", "R5"],
                               "comparisonBaselines": ["R4C", "R5"],
                               "note": "SYNTHETIC arithmetic controls; NO LIVE AUTHORITY"}
        # Fixed independent input numbers exercise a nonzero discrepancy, a
        # frozen boundary and later additions. They are not live usage claims.
        inputs = (("R4", 570, 10), ("R4B", 246, 10),
                  ("R4C", 2520, 40), ("R5", 2085, 32))
        for label, requests, identities in inputs:
            raw = self.root / (label + "-raw")
            raw.mkdir()
            values = {
                "case-results.json": {"synthetic": True, "campaignId": "SYNTHETIC-" + label,
                                      "sourceSha": "a1" * 20, "servedSha": "a1" * 20,
                                      "result": "NOT RUN", "cases": [], "finalIdentity": "NOT RUN"},
                "campaign-ledger.json": {"synthetic": True, "used": {"total": requests},
                                         "updated": "2099-01-01T00:00:00Z"},
                "identity-ledger.json": {"synthetic": True, "identityGets": identities, "receipts": []},
            }
            for name, value in values.items():
                (raw / name).write_text(json.dumps(value) + "\n", encoding="utf-8")
            (raw / "AHT-01").mkdir()
            (raw / "AHT-01/action-reservations.jsonl").write_text(
                json.dumps({"synthetic": True, "kind": "start", "ordinal": 1, "caseId": "AHT-01"}) + "\n",
                encoding="utf-8")
            pin = seal_synthetic(raw, self.receipts / label, "SYNTHETIC-" + label)
            self.cfg["history"]["runs"].append({"label": label, "campaignId": "SYNTHETIC-" + label,
                                                "servedSha": "a1" * 20, "ledgersOnly": True,
                                                "receiptsManifestSha256": pin})
        self.counters = {"synthetic": True, "scope": "NO LIVE AUTHORITY",
                         "statedThroughRun": "R5", "frozen": {"throughRun": "R5", "asOfUtc": "2099-01-01T00:01:00Z"},
                         "requests": {"allowanceBaselineThroughR4C": 3406, "outsideRunEstimate": 38},
                         "identityReadsCumulative": 94, "startsCumulative": 0, "takesCumulative": 0,
                         "ceilings": {"requests": 6700, "protectedReserveRequests": 664,
                                      "identityReads": 98, "starts": 50, "takes": 40}}

    def close(self):
        # The real sealer intentionally makes its output read-only. Only these
        # newly generated, private fixtures are made removable by their owner.
        for path in self.root.rglob("*"):
            if path.is_file():
                path.chmod(0o600)
        self._temporary.cleanup()
