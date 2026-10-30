"""Source policy oracle for the diagnostic runner's private/public artifact boundary."""
import copy
import os
from pathlib import Path
import unittest

import yaml
from _fixtures import REPO

RWT = "startsWith(github.event.inputs.diagnostic_dast_spec, 'tests/live/rwt-')"
SPEC = "tests/live/rwt-products-navigation.live.spec.ts"


def assert_upload_boundary(case, workflow):
    steps = workflow["jobs"]["gate-3-dast"]["steps"]
    uploads = [s for s in steps if s.get("uses", "").startswith("actions/upload-artifact@")]
    narrow = [s for s in uploads if s.get("name") == "Upload RWT receipts (content-free)"]
    case.assertEqual(len(narrow), 1)
    step = narrow[0]
    case.assertEqual(step["if"], "${{ always() && " + RWT + " }}")
    case.assertEqual(step["with"]["path"].split(), ["test-results/rwt/*.receipt.json", "test-results/rwt/*.readback.log", "test-results/rwt/*.human-worksheet.md", "test-results/rwt/*.readback-verdicts.json"])
    case.assertEqual(step["with"]["retention-days"], 14)
    case.assertEqual(step["with"]["if-no-files-found"], "error")
    broad = [s for s in uploads if "test-results/" in s["with"]["path"].split()]
    case.assertTrue(broad)  # Check every broad uploader, without fixing their number.
    for step in broad:
        condition = step["if"]
        case.assertTrue("diagnostic_dast_spec == ''" in condition or "!" + RWT in condition)


class RwtArtifactBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = Path(os.environ.get("RC_GATES_YML", str(Path(REPO) / ".github/workflows/rc-gates.yml")))
        cls.workflow = yaml.safe_load(source.read_text())

    def test_rwt_cannot_reach_a_broad_browser_report_upload(self):
        assert_upload_boundary(self, self.workflow)

    def test_negative_control_restoring_the_old_broad_condition_is_rejected(self):
        changed = copy.deepcopy(self.workflow)
        step = next(s for s in changed["jobs"]["gate-3-dast"]["steps"] if s.get("name") == "Upload ineligible diagnostic Gate 3 artifacts")
        step["if"] = "${{ always() && github.event.inputs.diagnostic_dast_spec != '' }}"
        with self.assertRaises(AssertionError):
            assert_upload_boundary(self, changed)

    def test_negative_control_adding_a_raw_report_path_is_rejected(self):
        changed = copy.deepcopy(self.workflow)
        step = next(s for s in changed["jobs"]["gate-3-dast"]["steps"] if s.get("name") == "Upload RWT receipts (content-free)")
        step["with"]["path"] += "\nplaywright-report/\n"
        with self.assertRaises(AssertionError):
            assert_upload_boundary(self, changed)

    def test_frontend_binding_is_separate_from_workflow_source_for_only_aht15(self):
        steps = self.workflow["jobs"]["gate-3-dast"]["steps"]
        bindings = []
        for name, key in (("Classify Gate 3 evidence target", "EXPECTED_RELEASE_SHA"),
                          ("Run DAST Live Gate (DIAGNOSTIC single spec — NOT a Gate 3 pass)", "EXPECTED_RELEASE_SHA"),
                          ("RWT telemetry readback (PostHog, per journey)", "RELEASE_SHA")):
            step = next(s for s in steps if s.get("name") == name)
            bindings.append(step["env"][key])
        self.assertEqual(len(set(bindings)), 1)
        self.assertIn(SPEC, bindings[0])
        self.assertIn("github.event.inputs.diagnostic_release_sha || github.sha", bindings[0])
        guard = next(s for s in steps if s.get("name") == "Validate bounded AHT15 release selection")
        self.assertIn("!= '" + SPEC + "'", guard["run"])
        self.assertIn("^[0-9a-f]{40}$", guard["run"])
        self.assertIn("exit 1", guard["run"])
        comparison = next(s for s in self.workflow["jobs"]["comparison-authorization"]["steps"] if s.get("name") == "Authorize one comparison cell (exact release, Production, repository owner)")
        self.assertEqual(comparison["env"]["EXPECTED_RELEASE_SHA"], "${{ github.sha }}")

    def test_diagnostic_does_not_become_release_qualification(self):
        steps = self.workflow["jobs"]["gate-3-dast"]["steps"]
        reject = next(s for s in steps if s.get("name") == "Reject diagnostic run as release qualification")
        self.assertEqual(reject["if"], "${{ always() && github.event.inputs.diagnostic_dast_spec != '' }}")
        self.assertIn("exit 1", reject["run"])

    def test_bound_human_worksheet_remains_available_for_finalization(self):
        steps = self.workflow["jobs"]["gate-3-dast"]["steps"]
        upload = next(s for s in steps if s.get("name") == "Upload RWT receipts (content-free)")
        self.assertIn("test-results/rwt/*.human-worksheet.md", upload["with"]["path"].split())
        self.assertIn("test-results/rwt/*.receipt.json", upload["with"]["path"].split())
