"""Policy tests for .github/workflows/cloud-test.yml: manual only, secret-free, read-only, no Environment, bounded, evidence always captured."""
import json
import os
import re
import unittest

from _fixtures import REPO, ROOT, J

YML = os.environ.get("CLOUD_TEST_YML") or os.path.join(ROOT, "tests", "fixtures", "cloud-test.yml")
ALLOWED_ACTIONS = ("actions/checkout@", "actions/setup-python@", "actions/setup-node@", "actions/upload-artifact@")


class WorkflowPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import yaml
        with open(YML, encoding="utf-8") as f:
            cls.text = f.read()
        cls.doc = yaml.safe_load(cls.text)
        cls.cfg = J("config", "test-config.v1.json")
        cls.job = cls.doc["jobs"]["control-plane"]

    def steps(self):
        return self.job["steps"]

    def named(self, prefix):
        return [s for s in self.steps() if s.get("name", "").startswith(prefix)]

    def test_only_manual_dispatch_trigger(self):
        on = self.doc.get("on", self.doc.get(True))
        self.assertEqual(list(on.keys()), ["workflow_dispatch"])

    def test_default_mode_is_the_preflight_that_spends_nothing(self):
        inp = self.doc.get("on", self.doc.get(True))["workflow_dispatch"]["inputs"]
        self.assertEqual(inp["mode"]["default"], "preflight")
        self.assertEqual(inp["mode"]["options"], ["preflight", "report"])
        self.assertEqual(inp["latest_label"]["default"], "")
        self.assertNotIn("execute", json.dumps(inp))

    def test_there_is_exactly_one_job_and_it_has_no_execute_path(self):
        self.assertEqual(list(self.doc["jobs"]), ["control-plane"])
        self.assertFalse([x for x in self.steps() if "execute_run" in json.dumps(x)])

    def test_no_secret_no_variable_no_environment_no_token(self):
        for needle in ("secrets.", "secrets:", "vars.", "environment:", "GITHUB_TOKEN", "id-token", "inherit"):
            self.assertNotIn(needle, self.text, needle)

    def test_permissions_are_read_only(self):
        self.assertEqual(self.doc["permissions"], {"contents": "read"})
        self.assertNotIn("permissions", self.job)

    def test_runtime_is_bounded_by_the_configured_github_budget(self):
        self.assertEqual(self.job["timeout-minutes"], self.cfg["githubActions"]["maxRunnerMinutes"])
        self.assertEqual(self.doc["concurrency"]["cancel-in-progress"], False)

    def test_only_first_party_actions_and_a_pinned_python_dependency(self):
        for s in self.steps():
            if "uses" in s:
                self.assertTrue(s["uses"].startswith(ALLOWED_ACTIONS), s["uses"])
        pip = [s for s in self.steps() if "pip install" in s.get("run", "")]
        self.assertTrue(pip)
        for s in pip:
            self.assertRegex(s["run"], r"pyyaml==\d+\.\d+\.\d+")

    def test_checkout_has_full_history_and_does_not_persist_credentials(self):
        co = [s for s in self.steps() if str(s.get("uses", "")).startswith("actions/checkout")][0]
        self.assertEqual(co["with"], {"fetch-depth": 0, "persist-credentials": False})

    def test_inputs_are_never_interpolated_into_scripts(self):
        for s in self.steps():
            if "run" in s:
                self.assertNotIn("${{ inputs.", s["run"], s.get("name"))

    def test_the_pipeline_runs_secret_free_and_the_attestation_is_asserted_after_it(self):
        names = [s.get("name", "") for s in self.steps()]
        pl = next(i for i, n in enumerate(names) if n.startswith("Control-plane pipeline"))
        at = next(i for i, n in enumerate(names) if n.startswith("Assert the attestation"))
        self.assertLess(pl, at)
        self.assertIn("--require-secret-free", self.steps()[pl]["run"])
        self.assertIn('secretFree"] is True', self.steps()[at]["run"])
        self.assertIn('networkAttempts"] == 0', self.steps()[at]["run"])

    def test_offline_checks_require_the_integration_prerequisites(self):
        self.assertEqual(self.named("Offline checks")[0]["env"]["CT_REQUIRE_INTEGRATION"], "1")

    def test_the_browser_pin_is_verified_before_the_checks_and_failures_are_not_ignored(self):
        names = [s.get("name", "") for s in self.steps()]
        # Located by what it runs, not its name: the preserved fixture installs, the current workflow only verifies a preinstalled browser.
        pin = next(i for i, s in enumerate(self.steps()) if "scripts/install_browser.py" in s.get("run", ""))
        self.assertLess(pin, next(i for i, n in enumerate(names) if n.startswith("Offline checks")))
        for s in self.steps():
            self.assertNotIn("|| true", s.get("run", ""))
            self.assertNotIn("continue-on-error", s)
        self.assertNotIn("continue-on-error", json.dumps(self.job))

    def test_the_harness_is_verified_before_the_checks(self):
        names = [s.get("name", "") for s in self.steps()]
        self.assertLess(next(i for i, n in enumerate(names) if n.startswith("Verify the vendored reviewed harness")), next(i for i, n in enumerate(names) if n.startswith("Offline checks")))

    def test_evidence_is_uploaded_even_after_failure_with_the_configured_retention(self):
        ups = [s for s in self.steps() if str(s.get("uses", "")).startswith("actions/upload-artifact")]
        self.assertEqual(len(ups), 1)
        self.assertEqual(ups[0]["if"], "always()")
        self.assertEqual(ups[0]["with"]["retention-days"], self.cfg["artifacts"]["evidenceRetentionDays"])
        paths = ups[0]["with"]["path"]
        for bad in ("/cfg/", "plan-env", "private", ".env", "credentials"):
            self.assertNotIn(bad, paths)

    def test_no_shell_tracing_or_environment_dumps(self):
        self.assertNotRegex(self.text, r"set -[a-z]*x")
        self.assertNotRegex(self.text, r"\n\s*(env|printenv)\s*(\||$)")

    def test_the_model_evaluation_project_is_not_touched(self):
        for needle in ("model-downselection", "private-model-smoke", "gemini-model-currency", "comparison_cell", "comparison-authorization", "gh workflow run", "workflow_run"):
            self.assertNotIn(needle, self.text, needle)


if __name__ == "__main__":
    unittest.main()
