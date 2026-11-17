"""Source policy oracle for the diagnostic runner's private/public artifact boundary."""
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml
from _fixtures import REPO, ROOT, prerequisite, run_py
import install_pdfjs

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


DISCOVER = "Validate bounded RWT release selection"
CLASSIFY = "Classify Gate 3 evidence target"
DAST = "Run DAST Live Gate (DIAGNOSTIC single spec — NOT a Gate 3 pass)"
TELEMETRY = "RWT telemetry readback (PostHog, per journey)"
DISCOVERED = "${{ steps.rwt_release.outputs.release_sha }}"
FALLBACK = "${{ steps.rwt_release.outputs.release_sha || github.event.inputs.diagnostic_release_sha || github.sha }}"


def assert_release_binding(case, workflow):
    """#1834 contract. An RWT spec resolves the release production actually serves, and every RWT consumer uses that
    discovered SHA. Classification and the DAST step also serve non-RWT diagnostics, so they keep the dispatch-input and
    workflow-SHA fallback after the discovered value. Telemetry runs only for RWT and takes the discovered SHA alone: a
    fallback there could put an unobserved SHA in place of a failed discovery."""
    steps = workflow["jobs"]["gate-3-dast"]["steps"]
    named = lambda n: next(s for s in steps if s.get("name") == n)
    discover = named(DISCOVER)
    case.assertEqual(discover.get("id"), "rwt_release")
    case.assertNotIn("if", discover)
    case.assertNotIn("continue-on-error", discover)
    case.assertEqual([l.strip() for l in discover["run"].strip().splitlines()], [
        'if [[ "$DIAGNOSTIC_SPEC" == tests/live/rwt-* ]]; then',
        "node tools/cloud-test/scripts/resolve_rwt_served_release.mjs resolve",
        "else",
        "node tools/cloud-test/scripts/validate_rwt_release_binding.cjs",
        "fi"])
    case.assertEqual(discover["env"]["DIAGNOSTIC_SPEC"], "${{ github.event.inputs.diagnostic_dast_spec }}")
    case.assertEqual(discover["env"]["DIAGNOSTIC_RELEASE"], "${{ github.event.inputs.diagnostic_release_sha }}")
    case.assertEqual(discover["env"]["SELECTED_GATE"], "${{ github.event.inputs.gate }}")
    case.assertEqual(discover["env"]["DIAGNOSTIC_GREP"], "${{ github.event.inputs.diagnostic_dast_grep }}")
    case.assertLess(steps.index(discover), next(i for i, s in enumerate(steps) if s.get("uses") == "./.github/actions/setup-environment"))
    case.assertEqual(named(CLASSIFY)["env"]["EXPECTED_RELEASE_SHA"], FALLBACK)
    case.assertEqual(named(DAST)["env"]["EXPECTED_RELEASE_SHA"], FALLBACK)
    telemetry = named(TELEMETRY)
    case.assertEqual(telemetry["if"], "${{ always() && " + RWT + " }}")
    case.assertEqual(telemetry["env"]["RELEASE_SHA"], DISCOVERED)
    calls = telemetry["run"].count("pnpm -s telemetry:readback-qualification")
    case.assertGreaterEqual(calls, 1)
    case.assertEqual(telemetry["run"].count('pnpm -s telemetry:readback-qualification --release-sha "$RELEASE_SHA"'), calls)
    comparison = next(s for s in workflow["jobs"]["comparison-authorization"]["steps"] if s.get("name") == "Authorize one comparison cell (exact release, Production, repository owner)")
    case.assertEqual(comparison["env"]["EXPECTED_RELEASE_SHA"], "${{ github.sha }}")


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

    def test_release_binding_uses_discovered_rwt_release_and_keeps_the_non_rwt_fallback(self):
        assert_release_binding(self, self.workflow)

    def test_negative_controls_a_loosened_release_binding_is_rejected(self):
        def mutate(step_name, change):
            changed = copy.deepcopy(self.workflow)
            change(next(s for s in changed["jobs"]["gate-3-dast"]["steps"] if s.get("name") == step_name))
            return changed
        cases = {
            "telemetry falls back to the dispatch input or workflow SHA": mutate(TELEMETRY, lambda s: s["env"].__setitem__("RELEASE_SHA", FALLBACK)),
            "telemetry pinned to the workflow SHA": mutate(TELEMETRY, lambda s: s["env"].__setitem__("RELEASE_SHA", "${{ github.sha }}")),
            "a readback queried against the workflow SHA": mutate(TELEMETRY, lambda s: s.__setitem__("run", s["run"].replace('--release-sha "$RELEASE_SHA"', '--release-sha "$GITHUB_SHA"', 1))),
            "failed discovery tolerated": mutate(DISCOVER, lambda s: s.__setitem__("continue-on-error", True)),
            "discovery made conditional": mutate(DISCOVER, lambda s: s.__setitem__("if", "${{ false }}")),
            "RWT routed back to the old single validator": mutate(DISCOVER, lambda s: s.__setitem__("run", "node tools/cloud-test/scripts/validate_rwt_release_binding.cjs")),
            "classification loses the non-RWT fallback": mutate(CLASSIFY, lambda s: s["env"].__setitem__("EXPECTED_RELEASE_SHA", DISCOVERED)),
        }
        for label, changed in cases.items():
            with self.subTest(label), self.assertRaises(AssertionError):
                assert_release_binding(self, changed)

    def test_negative_control_missing_discovery_cannot_qualify_telemetry(self):
        # A failed discovery leaves steps.rwt_release.outputs.release_sha empty, and the always() readback still runs with
        # RELEASE_SHA="". The real readback script, in an isolated checkout bound to the verified runner dependencies (the
        # same binding test_full_plan's governed-reader control uses), must HOLD (exit 1, which the step records as HOLD and
        # fails) on the missing release before it reads credentials or queries anything, and must never print QUALIFIED.
        runner = Path(ROOT) / "runner"
        for package in install_pdfjs.PLAYWRIGHT_PACKAGES:
            prerequisite((runner / "node_modules" / package / "package.json").is_file(), "npm ci in tools/cloud-test/runner")
        with tempfile.TemporaryDirectory(prefix="ct-missing-discovery-") as d:
            checkout = Path(d) / "checkout"
            (checkout / "scripts").mkdir(parents=True)
            shutil.copy2(Path(REPO) / "scripts/telemetry-readback-qualification.mts", checkout / "scripts/telemetry-readback-qualification.mts")
            shutil.copytree(Path(REPO) / "frontend/src", checkout / "frontend/src")
            shutil.copy2(Path(REPO) / "frontend/package.json", checkout / "frontend/package.json")
            bound = run_py("scripts/install_pdfjs.py", "--checkout", str(checkout), "--runner-dir", str(runner), "--bind-playwright")
            self.assertEqual(bound.returncode, 0, bound.stderr)
            # Exactly the step's call shape when discovery produced nothing: an empty --release-sha and an empty RELEASE_SHA.
            env = {"PATH": os.environ["PATH"], "HOME": d, "RELEASE_SHA": ""}
            result = subprocess.run(["node", "--import", "tsx", str(checkout / "scripts/telemetry-readback-qualification.mts"),
                                     "--release-sha", "", "--journey-id", "missing-discovery-control", "--traffic-type", "canary"],
                                    cwd=checkout, env=env, capture_output=True, text=True, timeout=120)
            self.assertEqual(result.returncode, 1, result.stderr[-2000:])
            self.assertNotIn("QUALIFIED", result.stdout)
            lines = [l for l in result.stdout.splitlines() if l.startswith("TELEMETRY_READBACK_QUALIFICATION_EVIDENCE ")]
            self.assertEqual(len(lines), 1, result.stdout + result.stderr)
            evidence = json.loads(lines[0].split(" ", 1)[1])
            self.assertEqual(evidence["verdict"], "HOLD")
            self.assertEqual(evidence["release_sha"], "")
            self.assertIn("no --release-sha supplied", evidence["reasons"][0])

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
