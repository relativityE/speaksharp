"""Entry refusals run the actual shell without tools, credentials or network."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from _fixtures import ROOT


class StageEntryRefusals(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ct-stage-entry-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def refused(self, *args, extra=None):
        result = subprocess.run(["bash", str(Path(ROOT) / "scripts/execute_run.sh"), *args],
                                env={"PATH": os.environ["PATH"], **(extra or {})},
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("BLOCKED_SETUP:", result.stderr)
        return result

    def test_missing_stage_is_explicitly_blocked(self):
        self.refused()

    def test_unknown_stage_is_blocked_before_other_inputs(self):
        result = self.refused("unknown-stage")
        self.assertIn("unknown stage", result.stderr)

    def test_missing_config_is_explicitly_blocked(self):
        result = self.refused("build-plan")
        self.assertIn("CT_CONFIG", result.stderr)

    def test_missing_output_is_explicitly_blocked(self):
        result = self.refused("build-plan", extra={"CT_CONFIG": str(Path(ROOT) / "config/test-config.v1.json")})
        self.assertIn("CT_OUT", result.stderr)

    def test_forbidden_key_is_refused_without_its_value(self):
        result = self.refused("run", extra={"SUPABASE_SERVICE_ROLE_KEY": "SYNTHETIC-must-not-appear"})
        self.assertNotIn("SYNTHETIC-must-not-appear", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
