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

    def test_secret_values_come_only_from_secrets_and_account_identifiers_only_from_the_private_bundle(self):
        # Sam 1793544453.003099: passwords, tokens and keys are Secrets; account emails and ids travel only in CLOUD_TEST_LIVE_ACCOUNTS.
        for name in ("THROWAWAY_TEST_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY", "POSTHOG_PERSONAL_API_KEY", "SUPABASE_ANON_KEY"):
            self.assertNotRegex(self.text, r"vars\.%s\b" % name, name)
        self.assertNotRegex(self.text, r"vars\.[A-Z_]*(_EMAIL|_ACCOUNT_ID)\b")
        self.assertNotIn("secrets.THROWAWAY_TEST_EMAIL", self.text)
        self.assertEqual(self.text.count("secrets.CLOUD_TEST_LIVE_ACCOUNTS"), 1)
        # A value derived from a Secret by an expression is not masked by Actions: the bundle is never parsed in a workflow expression.
        self.assertNotRegex(self.text, r"fromJSON\(\s*secrets\.")
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
        # P2: the network install and the copy are bounded inside prepare's fixed setup allowance.
        import init_run_inputs as I
        copy = next(i for i, s in enumerate(steps) if "install_pdfjs.py" in s.get("run", ""))
        bounds = [steps[at].get("timeout-minutes"), steps[copy].get("timeout-minutes")]
        self.assertTrue(all(isinstance(b, int) and b > 0 for b in bounds), bounds)
        self.assertLessEqual(sum(bounds), I.SETUP_RESERVE_MINUTES)
        # P1: the pin-verifying copy into the checkout root comes after the install and before any stage, in copy (not check-only) mode,
        # from exactly the bound dependency root into exactly CT_CHECKOUT.
        self.assertLess(at, copy)
        self.assertLess(copy, first_stage)
        self.assertEqual(steps[copy]["run"].strip(), 'python3 -I tools/cloud-test/scripts/install_pdfjs.py --config "$CT_CONFIG" --checkout "$CT_CHECKOUT" '
                                                     '--runner-dir "$CT_EXISTING_DEPENDENCY_ROOT"')
        self.assertNotIn("env", steps[copy])
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

    def test_every_run_stage_name_is_supplied_and_the_bundle_reaches_only_prepare(self):
        with open(os.path.join(ROOT, "config", "test-config.v1.json"), encoding="utf-8") as f:
            names = json.load(f)["credentials"]["runEnvironment"]["stages"]["run"]
        run = next(s for s in self.jobs["live"]["steps"] if s.get("run", "").strip() == "bash tools/cloud-test/scripts/execute_run.sh run")
        # THROWAWAY_TEST_EMAIL reaches the run stage only through prepare's masked, safe $GITHUB_ENV export, never a step env value.
        self.assertNotIn("THROWAWAY_TEST_EMAIL", run["env"])
        self.assertTrue(set(names) - {"THROWAWAY_TEST_EMAIL"} <= set(run["env"]), set(names) - set(run["env"]))
        init = next(s for s in self.jobs["live"]["steps"] if s.get("id") == "init")
        self.assertEqual(init["env"]["CLOUD_TEST_LIVE_ACCOUNTS"], "${{ secrets.CLOUD_TEST_LIVE_ACCOUNTS }}")
        self.assertEqual(init["env"]["SUPABASE_URL"], "${{ vars.SUPABASE_URL }}")
        holders = [s.get("name", s.get("uses")) for j in self.jobs.values() for s in j["steps"] if "CLOUD_TEST_LIVE_ACCOUNTS" in (s.get("env") or {})]
        self.assertEqual(holders, [init["name"]])

    def test_the_approved_window_is_rechecked_immediately_before_the_run_step(self):
        steps = self.jobs["live"]["steps"]
        run = next(i for i, s in enumerate(steps) if s.get("run", "").strip() == "bash tools/cloud-test/scripts/execute_run.sh run")
        check = steps[run - 1]
        self.assertEqual(check["run"].strip(), 'python3 -I tools/cloud-test/scripts/init_run_inputs.py window-check --request "$CT_REQUEST" '
                                               '--live-minutes "$LIVE_MINUTES" --request-sha256 "$REQUEST_SHA256"')
        self.assertEqual(check["env"], {"LIVE_MINUTES": "${{ steps.init.outputs.live_minutes }}",
                                        "REQUEST_SHA256": "${{ steps.init.outputs.request_sha256 }}"})
        self.assertNotIn("if", check, "a failed window check stops the job before admission")

    def test_pass_needs_qualify_which_runs_the_real_binding_verifier_then_every_selected_row(self):
        collect = next(s for s in self.jobs["live"]["steps"] if s.get("name", "").startswith("Collect, verify the binding"))["run"]
        order = [collect.index(k) for k in ("execute_run.sh collect", "init_run_inputs.py qualify", '--snapshot-dir "$CT_OUT/qualification-snapshot"',
                                             'Q=(--qualification "$CT_OUT/qualification.json")', "init_run_inputs.py project")]
        self.assertEqual(order, sorted(order))
        for arg in ('--approval "$CT_OUT/plan/cfg/security-approval.json"', '--code-manifest "$HP/bundle/CODE.sha256"', '--cases "$CASES"',
                    '--coverage-mode "$COVERAGE_MODE"', '--request "$CT_REQUEST"', '--config "$CT_CONFIG"'):
            self.assertIn(arg, collect)
        self.assertNotIn("verify_run_binding.py --plan", collect, "the verifier runs inside qualify, on the bytes qualify snapshots")
        self.assertIn('--tested-sha "$TESTED_SHA"', collect)

    def test_the_runner_receives_the_admission_digests_only_from_init_step_outputs(self):
        want = {"CT_REQUEST_SHA256": "${{ steps.init.outputs.request_sha256 }}",
                "CT_LIVE_ACCOUNTS_SHA256": "${{ steps.init.outputs.live_accounts_sha256 }}"}
        runner = [s for s in self.jobs["live"]["steps"] if "execute_run.sh" in s.get("run", "")]
        self.assertEqual(len(runner), 3, "setup stages, run, collect")
        for step in runner:
            self.assertEqual({k: step["env"].get(k) for k in want}, want, step.get("name"))

    def test_the_private_run_inputs_are_removed_last_and_never_uploaded(self):
        steps = self.jobs["live"]["steps"]
        self.assertEqual((steps[-1].get("name"), steps[-1].get("if"), steps[-1].get("run", "").strip()),
                         ("Remove the private run inputs", "always()", 'rm -rf -- "$RUNNER_TEMP/run-inputs"'))
        for job in self.jobs.values():
            for step in job["steps"]:
                if "upload-artifact" in str(step.get("uses", "")):
                    self.assertNotIn("run-inputs", str((step.get("with") or {}).get("path", "")))

    def test_the_admitted_request_digest_reaches_qualify_and_project_only_from_the_init_step_output(self):
        # A step's outputs cannot be rewritten by a later step; $GITHUB_ENV can, so the digest never travels through it.
        step = next(s for s in self.jobs["live"]["steps"] if s.get("name", "").startswith("Collect, verify the binding"))
        self.assertEqual(step["env"]["REQUEST_SHA256"], "${{ steps.init.outputs.request_sha256 }}")
        qualify, project = step["run"].split("init_run_inputs.py project", 1)
        self.assertIn('--request-sha256 "$REQUEST_SHA256"', qualify.split("init_run_inputs.py qualify", 1)[1])
        self.assertIn('--request-sha256 "$REQUEST_SHA256"', project)
        written = [s.get("name") for j in self.jobs.values() for s in j["steps"] if "REQUEST_SHA256" in (s.get("env") or {})]
        self.assertTrue(all(s["env"]["REQUEST_SHA256"] == "${{ steps.init.outputs.request_sha256 }}"
                            for j in self.jobs.values() for s in j["steps"] if "REQUEST_SHA256" in (s.get("env") or {})), written)


class PdfjsComposition(unittest.TestCase):
    """B4 P1: the REAL install_pdfjs.py, composed as the live job runs it: copy mode from the runner dependency root into the checkout root,
    then execute_run's --check-only with --source-dir. Synthetic package bytes with their own pins; no network and no install."""

    def setUp(self):
        import hashlib
        import json as _json
        import shutil
        import tempfile
        self.d = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.d)
        self.runner = os.path.join(self.d, "runner")
        pkg = os.path.join(self.runner, "node_modules", "pdfjs-dist")
        os.makedirs(os.path.join(pkg, "legacy", "build"))
        with open(os.path.join(pkg, "package.json"), "w") as f:
            f.write('{"name":"pdfjs-dist","version":"4.10.38"}')
        with open(os.path.join(pkg, "legacy", "build", "pdf.mjs"), "w") as f:
            f.write("export const synthetic = true;\n")
        def sha(p):
            with open(p, "rb") as f:
                return hashlib.sha256(f.read()).hexdigest()
        self.pkg = pkg
        self.config = os.path.join(self.d, "config.json")
        with open(self.config, "w") as f:
            _json.dump({"tools": {"pdfjs": {"version": "4.10.38", "relativePdfMjs": "legacy/build/pdf.mjs",
                                            "packageJsonSha256": sha(os.path.join(pkg, "package.json")),
                                            "pdfMjsSha256": sha(os.path.join(pkg, "legacy", "build", "pdf.mjs"))}}}, f)
        self.checkout = os.path.join(self.d, "checkout")
        os.makedirs(self.checkout)

    def run_helper(self, *args):
        import subprocess
        import sys
        return subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "install_pdfjs.py"), "--config", self.config, *args],
                              capture_output=True, text=True)

    def test_copy_then_execute_run_check_only_composes_on_a_clean_checkout(self):
        self.assertEqual(self.run_helper("--checkout", self.checkout, "--check-only", "--source-dir", self.pkg).returncode, 78,
                         "a clean hosted checkout refuses without the copy (the original P1 failure)")
        self.assertEqual(self.run_helper("--checkout", self.checkout, "--runner-dir", self.runner).returncode, 0)
        r = self.run_helper("--checkout", self.checkout, "--check-only", "--source-dir", self.pkg)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_a_conflicting_checkout_copy_is_refused_and_never_overwritten(self):
        dst = os.path.join(self.checkout, "node_modules", "pdfjs-dist", "legacy", "build")
        os.makedirs(dst)
        with open(os.path.join(self.checkout, "node_modules", "pdfjs-dist", "package.json"), "w") as f:
            f.write('{"name":"pdfjs-dist","version":"9.9.9"}')
        with open(os.path.join(dst, "pdf.mjs"), "w") as f:
            f.write("other")
        r = self.run_helper("--checkout", self.checkout, "--runner-dir", self.runner)
        self.assertEqual(r.returncode, 78)
        self.assertIn("not overwritten", r.stderr)
        with open(os.path.join(dst, "pdf.mjs")) as f:
            self.assertEqual(f.read(), "other")


if __name__ == "__main__":
    unittest.main()
