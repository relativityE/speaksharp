"""Explicit offline admission inputs. These stubs are not author evidence.

The unit tests exercise the real gate evaluator with deliberately supplied
positive/negative records. None of these files is an actual reviewed harness
receipt, selected campaign, operator approval or historical binding.
"""
import copy
import json

from _usage_fixtures import UsageHistory


class GateInputs(UsageHistory):
    def __init__(self, sample):
        super().__init__(sample["cfg"])
        self.request = copy.deepcopy(sample["req"])
        self.request["harness"]["codeManifestSha256"] = self.cfg["harness"]["expectedCodeManifestSha256"]
        self.request["harness"]["packetManifestSha256"] = self.cfg["harness"]["expectedPacketManifestSha256"]
        self.request["harness"]["offlineProofFile"] = "unit-proof.json"
        (self.root / "unit-proof.json").write_text(json.dumps({
            "synthetic": True, "scope": "UNIT INPUT ONLY; NOT AUTHOR EXECUTION EVIDENCE",
            "codeManifestSha256": self.request["harness"]["codeManifestSha256"],
            "corrections": [{"id": "SYNTHETIC-validator-positive", "result": "PASS"}],
        }) + "\n", encoding="utf-8")
        for row in self.request["priorRuns"]:
            row["bindingFile"] = row["label"] + "-unit-binding.json"
            (self.root / row["bindingFile"]).write_text(json.dumps({
                "synthetic": True, "scope": "UNIT INPUT ONLY; NOT HISTORICAL EVIDENCE",
                "passed": 1, "failed": 0,
            }) + "\n", encoding="utf-8")
