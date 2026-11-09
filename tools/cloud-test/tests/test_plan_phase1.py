"""Run the real phase-1 builder on non-authority inputs, with no browser or model.

Only AHT-12 is selected, so the PDF/browser integration prerequisites are not
needed. The emitted private files are unit-test fixtures, never launch inputs.
"""
import json
from pathlib import Path
import tempfile
import unittest

from _fixtures import ROOT
from test_case_start_caps import SOURCE, SyntheticBuilder


class ActualPhaseOne(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ct-phase1-synthetic-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()

    def build(self, mode="selected-full", remove=()):
        builder = SyntheticBuilder(self.root, cases=(12,), minimal=mode == "minimal")
        env = builder.env
        for key in remove:
            env.pop(key)
        result = builder.run()
        return result, Path(env["BP_PRIVATE"])

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
