"""Policy tests for .github/workflows/cloud-test-live.yml (Sam 1793471205.454429 / 1793471318.770139 / 1793471406.529969 / 1793538100.358869):
manual only, one active run, no re-run attempt, isolated latest-record jobs without live credentials, credentials only from `secrets`, nothing
installed or downloaded, a committed request selected by path, the job and run-step time bounds, every run-stage name supplied, and PASS only
through the real binding verifier followed by qualification of every selected row."""
import json
import os
import re
import unittest

from _fixtures import REPO, ROOT

YML = os.path.join(REPO, ".github", "workflows", "cloud-test-live.yml")
SECRET_REF = re.compile(r"\$\{\{\s*[^}]*secrets\.")


class LiveWorkflowPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import yaml
        with open(YML, encoding="utf-8") as f:
            cls.text = f.read()
        cls.doc = yaml.safe_load(cls.text)
        cls.jobs = cls.doc["jobs"]

    def test_manual_dispatch_only_with_one_active_run(self):
        on = self.doc.get("on", self.doc.get(True))
        self.assertEqual(list(on), ["workflow_dispatch"])
        self.assertEqual(self.doc["concurrency"], {"group": "cloud-test-live", "cancel-in-progress": False})

    def test_no_default_permission_and_each_job_holds_only_its_own(self):
        self.assertEqual(self.doc["permissions"], {})
        self.assertEqual(self.jobs["record-begin"]["permissions"], {"issues": "write"})
        self.assertEqual(self.jobs["record-complete"]["permissions"], {"issues": "write", "actions": "read"})
        self.assertEqual(self.jobs["live"]["permissions"], {"contents": "read"})

    def test_the_record_jobs_hold_no_live_credential(self):
        for name in ("record-begin", "record-complete"):
            self.assertIsNone(SECRET_REF.search(str(self.jobs[name])), name)

    def test_the_latest_record_is_inactive_until_the_tracking_issue_is_bound(self):
        self.assertEqual(self.doc["env"]["TRACKING_ISSUE"], "")
        self.assertIn('[ -n "$TRACKING_ISSUE" ] || { echo "BLOCKED_SETUP: tracking-issue-not-bound"; exit 78; }', self.text)

    def test_a_rerun_attempt_and_an_unconfirmed_dispatch_are_refused_before_any_effect(self):
        first = self.jobs["record-begin"]["steps"][0]["run"]
        self.assertIn('[ "$GITHUB_RUN_ATTEMPT" = 1 ]', first)
        self.assertIn('[ "$CONFIRM" = LIVE ]', first)
        self.assertEqual(self.jobs["live"]["needs"], "record-begin")

    def test_secret_values_come_only_from_secrets_and_the_throwaway_email_from_its_variable(self):
        # PO 18:46:25Z (Sam 1793472433.458519): THROWAWAY_TEST_EMAIL is appropriately a repository Variable; passwords, tokens and keys are Secrets.
        for name in ("THROWAWAY_TEST_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY", "POSTHOG_PERSONAL_API_KEY", "SUPABASE_ANON_KEY"):
            self.assertNotRegex(self.text, r"vars\.%s\b" % name, name)
        self.assertIn("THROWAWAY_TEST_EMAIL: ${{ vars.THROWAWAY_TEST_EMAIL }}", self.text)
        self.assertNotIn("secrets.THROWAWAY_TEST_EMAIL", self.text)
        self.assertIn("THROWAWAY_TEST_PASSWORD: ${{ secrets.THROWAWAY_TEST_PASSWORD }}", self.text)
        self.assertNotIn("throwaway-email-not-secret", self.text)

    def test_the_record_jobs_bind_the_exact_issue_and_comment(self):
        self.assertEqual(self.text.count('--issue-url "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/issues/$TRACKING_ISSUE"'), 2)
        self.assertIn('--comment-id "$COMMENT_ID"', self.text)

    def test_producer_keys_reach_only_the_producer_route(self):
        for name in ("SUPABASE_SERVICE_ROLE_KEY", "POSTHOG_PERSONAL_API_KEY"):
            refs = [line.strip() for line in self.text.splitlines() if ("secrets.%s" % name) in line]
            self.assertEqual(refs, ["%s: ${{ steps.init.outputs.route == 'github-producer' && secrets.%s || '' }}" % (name, name)])

    def test_no_dispatch_input_or_context_value_is_interpolated_into_a_command(self):
        for job in self.jobs.values():
            for step in job["steps"]:
                self.assertNotRegex(step.get("run", ""), r"\$\{\{", step.get("name"))

    B4_INSTALL = "npm --prefix tools/cloud-test/runner ci --ignore-scripts --no-audit --no-fund"

    def test_the_only_install_is_the_reviewed_lockfile_on_the_ephemeral_runner(self):
        # B4 (Sam 1793543299.974409): exactly one install, the runner lockfile, no lifecycle scripts, before the stage runner; nothing else.
        runs = [(job, s) for job, j in self.jobs.items() for s in j["steps"] if "run" in s]
        installer = re.compile(r"(^|[\s;&|(])(npm|npx|pnpm|yarn|pip3?|apt(-get)?|brew)\s")
        installs = [(job, s) for job, s in runs if installer.search(s["run"])]
        self.assertEqual([(job, s["run"].strip()) for job, s in installs], [("live", self.B4_INSTALL)])
        steps = self.jobs["live"]["steps"]
        at = next(i for i, s in enumerate(steps) if s.get("run", "").strip() == self.B4_INSTALL)
        first_stage = next(i for i, s in enumerate(steps) if "execute_run.sh" in s.get("run", ""))
        self.assertLess(at, first_stage)
        self.assertNotIn("env", steps[at], "the install step receives no credential or extra environment")
        env = self.jobs["live"]["env"]
        self.assertEqual(env["CT_EXISTING_DEPENDENCY_ROOT"], "${{ github.workspace }}/tools/cloud-test/runner")
        self.assertEqual(env["CT_EXISTING_PDFJS_DIR"], "${{ github.workspace }}/tools/cloud-test/runner/node_modules/pdfjs-dist")
        self.assertEqual(env["CT_SETUP_MODE"], "existing-only")

    def test_no_browser_or_other_package_is_installed_or_downloaded(self):
        low = self.text.lower().replace(self.B4_INSTALL, "")
        for banned in ("playwright install", "install-deps", "apt-get", "setup-chrome", "browser-actions/", "--archive", "curl ", "wget ",
                       "npm ci", "npm install", "pnpm install", "pip install", "npx "):
            self.assertNotIn(banned, low)
        self.assertIn("--installed --environment github-hosted", self.text)
        self.assertIn("--baselines config/browser-baselines.v1.json", self.text)

    def test_only_reviewed_actions_are_used(self):
        uses = sorted({s["uses"].split("@")[0] for j in self.jobs.values() for s in j["steps"] if "uses" in s})
        self.assertEqual(uses, ["actions/checkout", "actions/download-artifact", "actions/setup-node", "actions/setup-python", "actions/upload-artifact"])
        for j in self.jobs.values():
            for s in j["steps"]:
                if s.get("uses", "").startswith("actions/checkout@"):
                    self.assertIs(s["with"]["persist-credentials"], False)

    def test_the_handoff_artifact_is_short_lived_and_not_the_authoritative_record(self):
        up = [s for s in self.jobs["live"]["steps"] if s.get("uses", "").startswith("actions/upload-artifact@")]
        self.assertEqual(len(up), 1)
        self.assertEqual(up[0]["with"]["retention-days"], 1)
        self.assertTrue(up[0]["with"]["path"].endswith("latest-record.json"))

    def test_the_dispatch_names_a_committed_request_and_never_generates_one(self):
        on = self.doc.get("on", self.doc.get(True))
        self.assertEqual(sorted(on["workflow_dispatch"]["inputs"]), ["confirm", "facts", "request"])
        init = next(s for s in self.jobs["live"]["steps"] if s.get("id") == "init")
        self.assertEqual(init["env"]["REQUEST"], "${{ inputs.request }}")
        self.assertIn("init_run_inputs.py prepare", init["run"])
        self.assertIn('--request "$REQUEST"', init["run"])

    def test_the_job_timeout_is_the_one_prepare_checks_and_the_run_step_is_bounded_to_the_live_minutes(self):
        live = self.jobs["live"]
        self.assertLessEqual(live["timeout-minutes"], 360)
        init = next(s for s in live["steps"] if s.get("id") == "init")
        self.assertIn("--job-timeout-minutes %d " % live["timeout-minutes"], init["run"])
        run = next(s for s in live["steps"] if s.get("run", "").strip() == "bash tools/cloud-test/scripts/execute_run.sh run")
        self.assertEqual(run["timeout-minutes"], "${{ fromJSON(steps.init.outputs.live_minutes) }}")

    def test_every_run_stage_name_is_supplied_and_account_ids_come_from_variables(self):
        with open(os.path.join(ROOT, "config", "test-config.v1.json"), encoding="utf-8") as f:
            names = json.load(f)["credentials"]["runEnvironment"]["stages"]["run"]
        run = next(s for s in self.jobs["live"]["steps"] if s.get("run", "").strip() == "bash tools/cloud-test/scripts/execute_run.sh run")
        self.assertTrue(set(names) <= set(run["env"]), set(names) - set(run["env"]))
        init = next(s for s in self.jobs["live"]["steps"] if s.get("id") == "init")
        self.assertEqual(init["env"]["THROWAWAY_TEST_ACCOUNT_ID"], "${{ vars.THROWAWAY_TEST_ACCOUNT_ID }}")
        self.assertEqual(init["env"]["FREE_TEST_ACCOUNT_ID"], "${{ vars.FREE_TEST_ACCOUNT_ID }}")

    def test_pass_needs_qualify_which_runs_the_real_binding_verifier_then_every_selected_row(self):
        collect = self.jobs["live"]["steps"][-2]["run"]
        order = [collect.index(k) for k in ("execute_run.sh collect", "init_run_inputs.py qualify", '--snapshot-dir "$CT_OUT/qualification-snapshot"',
                                             'Q=(--qualification "$CT_OUT/qualification.json")', "init_run_inputs.py project")]
        self.assertEqual(order, sorted(order))
        for arg in ('--approval "$CT_OUT/plan/cfg/security-approval.json"', '--code-manifest "$HP/bundle/CODE.sha256"', '--cases "$CASES"',
                    '--coverage-mode "$COVERAGE_MODE"'):
            self.assertIn(arg, collect)
        self.assertNotIn("verify_run_binding.py --plan", collect, "the verifier runs inside qualify, on the bytes qualify snapshots")
        self.assertIn('--tested-sha "$TESTED_SHA"', collect)

if __name__ == "__main__":
    unittest.main()
