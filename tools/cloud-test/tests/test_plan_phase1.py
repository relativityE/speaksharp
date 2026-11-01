"""Run the real phase-1 builder on non-authority inputs, with no browser or model.

Only AHT-12 is selected, so the PDF/browser integration prerequisites are not
needed. The emitted private files are unit-test fixtures, never launch inputs.
"""
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from _fixtures import REPO, ROOT

SOURCE = "66328703bf47e865b730e229005411e78481d34c"


class ActualPhaseOne(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ct-phase1-synthetic-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.account = self.root / "synthetic-account.txt"
        self.account.write_text("00000000-0000-4000-8000-000000000001\n")
        self.request = self.root / "synthetic-request.json"
        self.request.write_text(json.dumps({"runId": "SYNTHETIC-NOT-A-RUN"}) + "\n")
        self.request.chmod(0o600)
        self.account_bindings = self.root / "account-bindings.json"
        self.account_bindings.write_text(json.dumps({
            "schema": "speaksharp.cloud-test.live-account-bindings.v1",
            "projectRef": "yxlapjuovrsvjswkwnrk",
            "projectOrigin": "https://yxlapjuovrsvjswkwnrk.supabase.co",
            "sourceBundleSha256": "a" * 64,
            "campaignId": "SYNTHETIC-NOT-A-RUN",
            "roles": {
                "existing-disposable": {
                    "accountId": "00000000-0000-4000-8000-000000000001",
                    "credentialVars": {"email": "THROWAWAY_TEST_EMAIL", "password": "THROWAWAY_TEST_PASSWORD"},
                },
                "maintained-read-only": {
                    "accountId": "00000000-0000-4000-8000-000000000002",
                    "credentialVars": {"email": "FREE_TEST_EMAIL", "password": "FREE_TEST_PASSWORD"},
                },
            },
        }) + "\n")
        self.account_bindings.chmod(0o600)

    def build(self, mode="full", remove=()):
        private = self.root / "private"
        env = {"PATH": os.environ["PATH"], "HOME": str(self.root),
               "BP_MODE": mode, "BP_PACKET": str(Path(ROOT) / "harness"),
               "BP_CHECKOUT": REPO, "BP_PRIVATE": str(private),
               "BP_SOURCE_SHA": SOURCE, "BP_CAMPAIGN": "SYNTHETIC-NOT-A-RUN",
               "BP_T0": "2099-01-01T00:00:00Z", "BP_T1": "2099-01-01T01:00:00Z",
               "BP_FACTS": str(Path(ROOT) / "tests/fixtures/plan-facts.PLACEHOLDER.json"),
               "BP_ACCOUNT_BINDINGS_FILE": str(self.account_bindings),
               "BP_LIVE_ACCOUNTS_SHA256": "a" * 64,
               "BP_REQUEST_FILE": str(self.request),
               "BP_REQUEST_SHA256": hashlib.sha256(self.request.read_bytes()).hexdigest(),
               "BP_ACCOUNT_ID_FILE": str(self.account), "BP_SELECT": "12", "BP_TOTAL": "5200",
               "VITE_SUPABASE_ANON_KEY": "placeholder-publishable-key"}
        for key in remove:
            env.pop(key)
        result = subprocess.run([sys.executable, "-I", str(Path(ROOT) / "harness-adapter/build_plan.py"), "phase1"],
                                env=env, capture_output=True, text=True)
        return result, private

    def test_generated_full_aht12_config_funds_the_actual_received_contract(self):
        result, private = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        config = json.loads((private / "cases/AHT-12.json").read_text())
        contract = json.loads((Path(ROOT) / "harness/bundle/config/cases/AHT-12.TEMPLATE.json").read_text())
        self.assertEqual(contract["_minimumStartPressCap"], 3)
        self.assertEqual(config["startPressCap"], contract["_minimumStartPressCap"])
        self.assertEqual(config["sourceSha"], SOURCE)
        self.assertEqual(config["servedSha"], SOURCE)

    def test_minimal_mode_is_still_a_partial_one_start_case(self):
        result, private = self.build("minimal")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        config = json.loads((private / "cases/AHT-12.json").read_text())
        self.assertEqual(config["startPressCap"], 1)
        self.assertEqual(config["sampleMode"], "minimal")

    def test_missing_publishable_input_refuses_before_config_generation(self):
        result, private = self.build(remove=("VITE_SUPABASE_ANON_KEY",))
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertFalse((private / "cases/AHT-12.json").exists())


if __name__ == "__main__":
    unittest.main()
