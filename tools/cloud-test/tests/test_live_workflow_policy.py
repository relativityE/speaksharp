"""Policy tests for .github/workflows/cloud-test-live.yml (Sam 1793471205.454429 / 1793471318.770139 / 1793471406.529969 / 1793538100.358869):
manual only, one active run, no re-run attempt, isolated latest-record jobs without live credentials, credentials only from `secrets`, nothing
installed or downloaded, a committed request selected by path, the job and run-step time bounds, every run-stage name supplied, and PASS only
through the real binding verifier followed by qualification of every selected row."""
import json
import os
import re
import shutil
import subprocess
import tempfile
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

    def test_a_scheduled_run_is_gated_before_any_record_secret_or_live_job_and_no_cron_is_registered(self):
        # Sam 1793553158.013909: the cron stays a proposed artifact; nothing here is registered.
        on = self.doc.get("on", self.doc.get(True))
        self.assertNotIn("schedule", on)
        with open(os.path.join(ROOT, "config", "nightly", "schedule.proposed.yml"), encoding="utf-8") as f:
            self.assertIn("cron: '0 3 * * *'", f.read())
        self.assertEqual(set(self.jobs), {"nightly-gate", "record-begin", "journal-reserve", "live", "journal-settle", "record-complete"})
        gate = self.jobs["nightly-gate"]
        self.assertEqual((gate["if"], gate["permissions"]), ("github.event_name == 'schedule'", {"contents": "read", "actions": "read"}))
        self.assertIsNone(SECRET_REF.search(str(gate)), "the gate holds no credential")
        step = gate["steps"][-1]
        self.assertEqual(step["env"], {"NIGHTLY_SWITCH": "${{ vars.CLOUD_TEST_NIGHTLY_ENABLED }}", "SCHEDULE_CRON": "${{ github.event.schedule }}",
                                       "GH_TOKEN": "${{ github.token }}"})
        # The trigger time is the run's creation, read only when the switch is on; the gate decides the switch before anything else.
        self.assertIn('if [ "$NIGHTLY_SWITCH" = true ]; then TRIGGER_UTC="$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" '
                      '--jq .created_at)"; fi', step["run"])
        self.assertIn('nightly_request.py gate --switch "$NIGHTLY_SWITCH" --attempt "$GITHUB_RUN_ATTEMPT"', step["run"])
        self.assertIn('--cron "$SCHEDULE_CRON" --trigger-utc "$TRIGGER_UTC" --run-id "$GITHUB_RUN_ID" --tested-sha "$GITHUB_SHA" --outputs "$GITHUB_OUTPUT"',
                      step["run"])
        self.assertEqual(gate["outputs"], {"admitted": "${{ steps.gate.outputs.admitted }}", "request_sha256": "${{ steps.gate.outputs.request_sha256 }}",
                                           "request_b64": "${{ steps.gate.outputs.request_b64 }}"})
        begin = self.jobs["record-begin"]
        # The gate's admitted bytes and digest pass through record-begin unchanged; on schedule init admits exactly them, never inputs.request.
        self.assertEqual({k: begin["outputs"][k] for k in ("nightly_request_sha256", "nightly_request_b64")},
                         {"nightly_request_sha256": "${{ needs.nightly-gate.outputs.request_sha256 }}",
                          "nightly_request_b64": "${{ needs.nightly-gate.outputs.request_b64 }}"})
        init = next(s for s in self.jobs["live"]["steps"] if s.get("id") == "init")
        self.assertEqual((init["env"]["NIGHTLY_REQUEST_SHA256"], init["env"]["NIGHTLY_REQUEST_B64"]),
                         ("${{ needs.record-begin.outputs.nightly_request_sha256 }}", "${{ needs.record-begin.outputs.nightly_request_b64 }}"))
        self.assertIn('if [ "$GITHUB_EVENT_NAME" = schedule ]; then\n'
                      '  (umask 077; printf \'%s\' "$NIGHTLY_REQUEST_B64" | base64 -d > "$RUNNER_TEMP/nightly-request.json")\n'
                      '  SRC=(--nightly-request-file "$RUNNER_TEMP/nightly-request.json" --nightly-request-sha256 "$NIGHTLY_REQUEST_SHA256")\n', init["run"])
        self.assertIn('else\n  SRC=(--request "$REQUEST" --facts "$FACTS")\nfi\n', init["run"])
        # Case 10 design A: on schedule only, the observation step runs on exactly the gate's bytes BEFORE prepare, and only a record it
        # actually placed reaches prepare; a dispatch never runs it.
        nightly_branch = init["run"].split('if [ "$GITHUB_EVENT_NAME" = schedule ]; then\n', 1)[1].split("else\n", 1)[0]
        self.assertIn('case10_observation.py observe --request "$RUNNER_TEMP/nightly-request.json" \\\n'
                      '    --request-sha256 "$NIGHTLY_REQUEST_SHA256" --run-id "$GITHUB_RUN_ID" --attempt "$GITHUB_RUN_ATTEMPT" \\\n'
                      '    --repo "$GITHUB_WORKSPACE" --out "$RUNNER_TEMP/case10-observation.json"\n', nightly_branch)
        self.assertIn('if [ -f "$RUNNER_TEMP/case10-observation.json" ]; then SRC+=(--case10-observation "$RUNNER_TEMP/case10-observation.json"); fi',
                      nightly_branch)
        self.assertEqual(init["run"].count("case10_observation.py"), 1)
        self.assertLess(init["run"].index("case10_observation.py"), init["run"].index("init_run_inputs.py prepare"))
        self.assertIn('init_run_inputs.py prepare --repo "$GITHUB_WORKSPACE" --config "$CT_CONFIG" "${SRC[@]}" \\\n  --checkpoint', init["run"])
        self.assertEqual(init["run"].count("--facts"), 1, "a scheduled run never passes a facts input")
        self.assertEqual(begin["needs"], "nightly-gate")
        self.assertEqual(begin["if"], "${{ !cancelled() && github.ref == 'refs/heads/main' && github.ref_protected == true && "
                                      "(github.event_name == 'workflow_dispatch' || (github.event_name == 'schedule' && "
                                      "needs.nightly-gate.result == 'success' && needs.nightly-gate.outputs.admitted == 'true')) }}")
        self.assertIn('[ "$GITHUB_EVENT_NAME" = schedule ] && [ "$GATE_RESULT" = success ] && [ "$ADMITTED" = true ] || '
                      '{ echo "BLOCKED_SETUP: nightly-not-admitted"; exit 78; }', begin["steps"][0]["run"])
        # Every later job, including the always() record job, runs only after record-begin succeeded.
        self.assertEqual(self.jobs["live"]["needs"], ["record-begin", "journal-reserve"])  # J1: a scheduled run waits for its journal reserve
        self.assertEqual(self.jobs["record-complete"]["if"], "always() && needs.record-begin.result == 'success'")
        # Manual and nightly share ONE serialized group; an active run is never cancelled.
        self.assertEqual(self.doc["concurrency"], {"group": "cloud-test-live", "cancel-in-progress": False})

    def test_no_default_permission_and_each_job_holds_only_its_own(self):
        self.assertEqual(self.doc["permissions"], {})
        self.assertEqual(self.jobs["record-begin"]["permissions"], {"issues": "write"})
        self.assertEqual(self.jobs["record-complete"]["permissions"], {"issues": "write", "actions": "read"})
        self.assertEqual(self.jobs["live"]["permissions"], {"contents": "read"})
        self.assertEqual(self.jobs["live"]["environment"], "trusted-main-credentials")

    def test_the_record_jobs_hold_no_live_credential(self):
        for name in ("record-begin", "record-complete"):
            self.assertIsNone(SECRET_REF.search(str(self.jobs[name])), name)
        protected_main = "github.ref == 'refs/heads/main' && github.ref_protected == true"
        self.assertIn(protected_main, self.jobs["record-begin"]["if"])
        self.assertIn(protected_main, self.jobs["live"]["if"])
        self.assertIn("needs.record-begin.result == 'success'", self.jobs["live"]["if"])
        # the two state-ref writer jobs run on protected main only, like the jobs they serve
        for name in ("journal-reserve", "journal-settle"):
            self.assertIn(protected_main, self.jobs[name]["if"], name)
        # The privileged jobs execute control code only from the immutable SHA admitted by those job-level checks.
        for name in ("record-begin", "live", "journal-reserve", "journal-settle"):
            checkouts = [s for s in self.jobs[name]["steps"] if s.get("uses", "").startswith("actions/checkout@")]
            self.assertEqual(len(checkouts), 1, name)
            self.assertEqual(checkouts[0]["with"]["ref"], "${{ github.sha }}")

    def test_the_latest_record_is_bound_to_the_selected_tracking_issue(self):
        self.assertEqual(self.doc["env"]["TRACKING_ISSUE"], "1763")
        self.assertIn('[ -n "$TRACKING_ISSUE" ] || { echo "BLOCKED_SETUP: tracking-issue-not-bound"; exit 78; }', self.text)

    def test_a_rerun_attempt_and_an_unconfirmed_dispatch_are_refused_before_any_effect(self):
        first = self.jobs["record-begin"]["steps"][0]["run"]
        self.assertIn('[ "$GITHUB_RUN_ATTEMPT" = 1 ]', first)
        self.assertIn('[ "$CONFIRM" = LIVE ]', first)
        self.assertEqual(self.jobs["live"]["needs"], ["record-begin", "journal-reserve"])  # J1: a scheduled run waits for its journal reserve

    def test_secret_values_come_only_from_secrets_and_account_identifiers_only_from_the_private_bundle(self):
        # Sam 1793544453.003099: passwords, tokens and keys are Secrets; account emails and ids travel only in CLOUD_TEST_LIVE_ACCOUNTS.
        for name in ("THROWAWAY_TEST_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY", "POSTHOG_PERSONAL_API_KEY", "POSTHOG_PROJECT_ID", "SUPABASE_ANON_KEY"):
            self.assertNotRegex(self.text, r"vars\.%s\b" % name, name)
        self.assertNotRegex(self.text, r"vars\.[A-Z_]*(_EMAIL|_ACCOUNT_ID)\b")
        self.assertNotIn("secrets.THROWAWAY_TEST_EMAIL", self.text)
        self.assertEqual(self.text.count("secrets.CLOUD_TEST_LIVE_ACCOUNTS"), 1)
        # A value derived from a Secret by an expression is not masked by Actions: the bundle is never parsed in a workflow expression.
        self.assertNotRegex(self.text, r"fromJSON\(\s*secrets\.")
        self.assertIn("THROWAWAY_TEST_PASSWORD: ${{ secrets.THROWAWAY_TEST_PASSWORD }}", self.text)
        # Case15 (Sam 1793554938.870679): the maintained-read-only role's password reaches the run step from its own Secret; its email
        # comes only from the private bundle, like THROWAWAY's.
        self.assertEqual(self.text.count("FREE_TEST_PASSWORD: ${{ secrets.FREE_TEST_PASSWORD }}"), 1)
        self.assertNotIn("FREE_TEST_EMAIL: ${{", self.text)
        self.assertNotIn("throwaway-email-not-secret", self.text)

    def test_live_credentials_read_exactly_the_existing_repository_secrets(self):
        # PO decision (Sam 1793647229.528719): the existing repository Secrets are the single stored source, referenced by name; the
        # credential-bearing job stays bound to the protected environment on protected main.
        protected = {
            "CLOUD_TEST_LIVE_ACCOUNTS",
            "SUPABASE_ANON_KEY",
            "THROWAWAY_TEST_PASSWORD",
            "FREE_TEST_PASSWORD",
            "SUPABASE_SERVICE_ROLE_KEY",
            "POSTHOG_PERSONAL_API_KEY",
            "POSTHOG_PROJECT_ID",
        }
        references = set(re.findall(r"secrets\.([A-Z0-9_]+)", self.text))
        self.assertEqual(references, protected)
        self.assertEqual(self.jobs["live"]["environment"], "trusted-main-credentials")

    def test_the_record_jobs_bind_the_exact_issue_and_comment(self):
        # select at begin, select before the terminal write, and the readback verification after it: all bound to the one tracking issue
        self.assertEqual(self.text.count('--issue-url "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/issues/$TRACKING_ISSUE"'), 3)
        self.assertIn('--comment-id "$COMMENT_ID"', self.text)

    def test_producer_keys_reach_only_the_producer_route(self):
        protected = {
            "SUPABASE_SERVICE_ROLE_KEY": "SUPABASE_SERVICE_ROLE_KEY",
            "POSTHOG_PERSONAL_API_KEY": "POSTHOG_PERSONAL_API_KEY",
            "POSTHOG_PROJECT_ID": "POSTHOG_PROJECT_ID",
        }
        for name, secret in protected.items():
            refs = [line.strip() for line in self.text.splitlines() if ("secrets.%s" % secret) in line]
            self.assertEqual(refs, ["%s: ${{ steps.init.outputs.route == 'github-producer' && secrets.%s || '' }}" % (name, secret)])
        # Only the producer run step receives the project identifier; no other step or job mentions it.
        steps = [s for job in self.jobs.values() for s in job["steps"] if "POSTHOG_PROJECT_ID" in (s.get("env") or {})]
        self.assertEqual([s["run"].strip() for s in steps], ["bash tools/cloud-test/scripts/execute_run.sh run"])
        self.assertEqual(self.text.count("POSTHOG_PROJECT_ID"), 2, "exactly the env name and its Secret reference")

    def test_no_dispatch_input_or_context_value_is_interpolated_into_a_command(self):
        for job in self.jobs.values():
            for step in job["steps"]:
                self.assertNotRegex(step.get("run", ""), r"\$\{\{", step.get("name"))

    B4_INSTALL = "npm --prefix tools/cloud-test/runner ci --ignore-scripts --no-audit --no-fund"
    PY_YAML_INSTALL = "python3 -m pip install --quiet pyyaml==6.0.2"

    def test_the_only_installs_are_the_pinned_python_evidence_dependency_and_reviewed_lockfile(self):
        # The existing reviewed setup contract: pinned PyYAML plus the runner
        # lockfile, both before evidence generation; no lifecycle scripts or
        # browser acquisition.
        runs = [(job, s) for job, j in self.jobs.items() for s in j["steps"] if "run" in s]
        installer = re.compile(r"(^|[\s;&|(])(npm|npx|pnpm|yarn|pip3?|apt(-get)?|brew)\s")
        installs = [(job, s) for job, s in runs if installer.search(s["run"])]
        self.assertEqual([(job, s["run"].strip()) for job, s in installs], [
            ("live", self.PY_YAML_INSTALL),
            ("live", self.B4_INSTALL),
        ])
        steps = self.jobs["live"]["steps"]
        at = next(i for i, s in enumerate(steps) if s.get("run", "").strip() == self.B4_INSTALL)
        py = next(i for i, s in enumerate(steps) if s.get("run", "").strip() == self.PY_YAML_INSTALL)
        first_stage = next(i for i, s in enumerate(steps) if "execute_run.sh" in s.get("run", ""))
        proof = next(i for i, s in enumerate(steps) if "run_offline_checks.py" in s.get("run", ""))
        self.assertLess(py, proof)
        self.assertLess(at, proof)
        self.assertLess(proof, first_stage)
        self.assertNotIn("env", steps[at], "the install step receives no credential or extra environment")
        self.assertNotIn("env", steps[py], "the pinned Python install receives no credential or extra environment")
        # P2: both installs and the detached tested-release copy are bounded inside prepare's fixed setup allowance.
        import init_run_inputs as I
        copy = next(i for i, s in enumerate(steps) if "install_pdfjs.py" in s.get("run", ""))
        bounds = [steps[py].get("timeout-minutes"), steps[at].get("timeout-minutes"), steps[copy].get("timeout-minutes")]
        self.assertTrue(all(isinstance(b, int) and b > 0 for b in bounds), bounds)
        self.assertLessEqual(sum(bounds), I.SETUP_RESERVE_MINUTES)
        # P1: the pin-verifying copy goes into the exact admitted tested-release
        # checkout, never the workflow/source checkout.
        self.assertLess(at, copy)
        self.assertLess(copy, first_stage)
        script = steps[copy]["run"]
        self.assertIn('git -C "$GITHUB_WORKSPACE" worktree add --detach "$tested" "$TESTED_SHA"', script)
        self.assertIn('--config "$GITHUB_WORKSPACE/$CT_CONFIG" --checkout "$tested" --runner-dir "$CT_EXISTING_DEPENDENCY_ROOT"', script)
        self.assertIn('--bind-playwright', script)
        self.assertIn('echo "CT_CHECKOUT=$tested"', script)
        self.assertEqual(steps[copy]["env"], {"TESTED_SHA": "${{ steps.init.outputs.tested_sha }}"})
        env = self.jobs["live"]["env"]
        self.assertEqual(env["CT_EXISTING_DEPENDENCY_ROOT"], "${{ github.workspace }}/tools/cloud-test/runner")
        self.assertNotIn("CT_CHECKOUT", env)
        self.assertNotIn("CT_EXISTING_PDFJS_DIR", env)
        self.assertEqual(env["CT_SETUP_MODE"], "existing-only")

        evidence = steps[proof]
        self.assertEqual(evidence["env"], {
            "CT_REQUIRE_INTEGRATION": "1",
            "CT_EXISTING_PDFJS_DIR": "${{ github.workspace }}/tools/cloud-test/runner/node_modules/pdfjs-dist",
        })
        self.assertIn('CT_PROOF_FILE="$RUNNER_TEMP/offline-proof.json" python3 -I scripts/run_offline_checks.py', evidence["run"])

    def test_the_tested_release_resolves_verified_playwright_without_a_second_install(self):
        steps = self.jobs["live"]["steps"]
        provision = next(s for s in steps if "install_pdfjs.py" in s.get("run", "") and "--checkout" in s.get("run", ""))
        self.assertIn('--runner-dir "$CT_EXISTING_DEPENDENCY_ROOT" --bind-playwright', provision["run"])
        self.assertNotRegex(provision["run"], r"\b(npm|npx|pnpm|yarn|pip|apt|brew)\b")
        stage = next(i for i, s in enumerate(steps) if "for stage in install-tools build-plan" in s.get("run", ""))
        self.assertLess(steps.index(provision), stage)

    def test_no_browser_or_unreviewed_package_is_installed_or_downloaded(self):
        low = self.text.lower().replace(self.B4_INSTALL, "").replace(self.PY_YAML_INSTALL, "")
        for banned in ("playwright install", "install-deps", "apt-get", "setup-chrome", "browser-actions/", "--archive", "curl ", "wget ",
                       "npm ci", "npm install", "pnpm install", "pip install", "npx "):
            self.assertNotIn(banned, low)
        self.assertIn("--installed --environment github-hosted", self.text)
        self.assertIn("--baselines config/browser-baselines.v1.json", self.text)

    def test_the_discovered_browser_generates_the_exact_head_proof_consumed_by_both_g3_and_g10(self):
        steps = self.jobs["live"]["steps"]
        discover = next(i for i, s in enumerate(steps) if "--installed --environment github-hosted" in s.get("run", ""))
        proof = next(i for i, s in enumerate(steps) if "generate_offline_proof.py" in s.get("run", ""))
        setup = next(i for i, s in enumerate(steps) if "for stage in install-tools build-plan" in s.get("run", ""))
        self.assertLess(discover, proof); self.assertLess(proof, setup)
        script = steps[proof]["run"]
        for token in ('--browser-receipt "$CT_BROWSER_RECEIPT"', 'CT_PROOF_FILE="$RUNNER_TEMP/offline-proof.json"',
                      'CT_OFFLINE_PROOF=$RUNNER_TEMP/offline-proof.json', 'CT_OFFLINE_CHECKS=$RUNNER_TEMP/offline-checks.json'):
            self.assertIn(token, script)
        self.assertIn('CT_BROWSER_RECEIPT=$RUNNER_TEMP/browser-receipt.json', steps[discover]["run"])

    def test_retained_inputs_are_connected_and_manual_accounting_is_pinned(self):
        env = self.jobs["live"]["env"]
        self.assertEqual(env["CT_RETAINED_GATE_MANIFEST"], "${{ github.workspace }}/tools/cloud-test/config/aggregate/manifest.json")
        self.assertEqual(env["CT_HISTORY_INDEX"], "${{ github.workspace }}/tools/cloud-test/config/history/index.json")
        self.assertEqual(env["CT_RESERVATIONS"], "${{ github.workspace }}/tools/cloud-test/config/history/reservations.json")
        self.assertEqual(env["CT_APPROVAL"], "${{ github.workspace }}/tools/cloud-test/config/recurring-approval.json")
        self.assertEqual(env["CT_RECEIPTS_ROOT"], "${{ github.workspace }}/tools/cloud-test/config/history/receipts")
        with open(os.path.join(ROOT, "config", "test-config.v1.json"), encoding="utf-8") as f:
            receiver = json.load(f)["aggregateReceiver"]
        self.assertEqual(receiver, {
            "activated": True,
            "manifestSha256": "c8e177dabd25b134a582a7378574295ebc0ffdd28f4f28fc6b6b719d284365ef",
            "bundleRootSha256": "f6b59edbfcc20593cd13a87f362a6c68f5a37cfe424da87c0671881584afed19",
            "note": receiver["note"],
        })
        steps = self.jobs["live"]["steps"]
        bind = next(i for i, s in enumerate(steps) if s.get("name") == "Bind private runner paths and initialize the inactive accounting workspace")
        run = next(i for i, s in enumerate(steps) if s.get("run", "").strip() == "bash tools/cloud-test/scripts/execute_run.sh run")
        collect = next(s for s in steps if s.get("name", "").startswith("Collect, verify the binding"))["run"]
        self.assertLess(bind, run)
        workspace = steps[bind]["run"]
        for token in ('mkdir -m 700 "$state"', 'git -C "$state" init -b private-run-state',
                      'transport":"UNBOUND"', 'echo "CT_OUT=$RUNNER_TEMP/out"',
                      'echo "CT_STATE_REPO=$state"', '>> "$GITHUB_ENV"'):
            self.assertIn(token, workspace)
        self.assertIn('[ -z "$(git -C "$state" remote)" ]', workspace)
        for name in ("CT_OUT", "CT_STATE_REPO", "CT_STATE_JOURNAL_RESERVE", "CT_STATE_JOURNAL_SETTLE"):
            self.assertNotIn(name, env, "runner.temp is unavailable in a job-level env expression")
        self.assertIn('echo "CT_STATE_JOURNAL_RESERVE=$RUNNER_TEMP/cloud-test-state-reserve.json"', workspace)
        self.assertIn('echo "CT_STATE_JOURNAL_SETTLE=$RUNNER_TEMP/cloud-test-state-settle.json"', workspace)
        self.assertNotIn('CT_STATE_JOURNAL=', workspace)
        # Composed with J1 (#1772 thread 4442216960) and #1772 review 4446137323: every reserve and settle, scheduled or manual, is appended by
        # the journal-reserve / journal-settle writer jobs before and after the live job; the read-only live job writes no state at all, so no
        # checkout-local ledger stands in for durable state and the credentialed job never holds the push token.
        self.assertIn("reservations.py journal-reserve", writers_of(self.jobs, "journal-reserve"))
        self.assertIn("manual_reservation.py reserve", writers_of(self.jobs, "journal-reserve"))
        self.assertIn("manual_reservation.py settle", writers_of(self.jobs, "journal-settle"))
        live_runs = " ".join(st.get("run", "") for st in steps)
        for gone in ("execute_run.sh manual-reserve", "execute_run.sh manual-settle", "manual_reservation.py"):
            self.assertNotIn(gone, live_runs)
        self.assertNotIn("manual-release", self.text)
        runner = open(os.path.join(ROOT, "scripts", "execute_run.sh"), encoding="utf-8").read()
        self.assertIn('--accepted-input-dir "$accepted"', runner)
        self.assertIn('--receiver-receipt "$accepted/receiver-receipt.json"', runner)
        self.assertIn('--receiver-manifest "$CT_RETAINED_GATE_MANIFEST"', runner)
        # D2(a) composition: the gates read one reservation input, RES_IN: the legacy CT_RESERVATIONS file by default, replaced on the nightly
        # route by the verified journal snapshot.
        for token in ('--history-index "$CT_HISTORY_INDEX"', 'RES_IN="${CT_RESERVATIONS:-}"', '--reservations "$RES_IN"',
                      'RES_IN="$OUT/journal-snapshot.json"', '--approval "$CT_APPROVAL"', '--receipts-root "$CT_RECEIPTS_ROOT"'):
            self.assertIn(token, runner)
        self.assertIn('blocked "$recurring is required for retained-input recurring gates"', runner)
        self.assertIn('cmp -s "$accepted/reconciliation.json" "$OUT/reconciliation.json"', runner)
        # Nightly and approved manual full coverage share the authenticated v2 occurrence boundary. Historical inputs are verified before
        # current release verification is derived; the final receiver then binds all three runtime inputs.
        self.assertIn('--retained-out-dir "$retained"', runner)
        self.assertIn('--ledger "$retained/gap-ledger.json"', runner)
        self.assertIn('run_stage run node "$HP/bundle/harness/admission.cjs"', runner)
        self.assertIn('--current-identity-ledger "$identity_ledger"', runner)
        self.assertLess(runner.index('run_stage run node "$HP/bundle/harness/admission.cjs"'),
                        runner.index('--current-identity-ledger "$identity_ledger"'))
        # #1772 Code review 4449388865: the deferred v2 execution branch runs
        # pipeline.py a second time after producing its own authenticated
        # journal snapshot.  G11 consumes that file through --reservations;
        # --journal-snapshot alone only authenticates the occurrence envelope.
        # Inspect this exact invocation so the already-correct earlier pipeline
        # call cannot conceal a regression in the deferred branch.
        deferred = runner.split('marker="$OUT/manual-release-gates.deferred"', 1)[1]
        deferred = deferred.split('run_stage gate-and-validate node "$ROOT/tests/node/plan-acceptance.cjs"', 1)[0]
        final_pipeline = deferred.split('run_stage gate-and-validate python3 -I "$ROOT/scripts/pipeline.py"', 1)[1]

        def carries_both_authenticated_snapshot_inputs(command):
            return (command.count('--journal-snapshot "$RES_IN"') == 1
                    and command.count('--reservations "$RES_IN"') == 1)

        self.assertTrue(carries_both_authenticated_snapshot_inputs(final_pipeline))
        broken = final_pipeline.replace('--reservations "$RES_IN"', '', 1)
        self.assertFalse(carries_both_authenticated_snapshot_inputs(broken),
                         "the deferred v2 route must fail its control if G11's independent reservations input is omitted")
        self.assertEqual(self.jobs["live"]["permissions"], {"contents": "read"})
        manual = open(os.path.join(ROOT, "scripts", "manual_reservation.py"), encoding="utf-8").read()
        state = open(os.path.join(ROOT, "scripts", "state_ref_writer.py"), encoding="utf-8").read()
        self.assertLess(manual.index('_need(activated(), "manual-reservation-not-activated")'),
                        manual.index('_read(x.request)'))
        self.assertIn('REVIEWED_ROOT = "92d6ebf902351750c368d7d513116c6b1f19f80c"', state)

    def test_private_accounting_workspace_is_real_git_without_transport(self):
        step = next(s for s in self.jobs["live"]["steps"]
                    if s.get("name") == "Bind private runner paths and initialize the inactive accounting workspace")
        with tempfile.TemporaryDirectory(prefix="cloud-test-private-state-") as directory:
            env_file = os.path.join(directory, "github-env")
            env = {"PATH": os.environ["PATH"], "HOME": directory,
                   "RUNNER_TEMP": directory, "GITHUB_ENV": env_file}
            result = subprocess.run(["bash", "-c", step["run"]], capture_output=True, text=True, env=env)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            state = os.path.join(directory, "cloud-test-state")
            self.assertEqual(subprocess.run(["git", "-C", state, "remote"], capture_output=True, text=True).stdout, "")
            self.assertEqual(subprocess.run(["git", "-C", state, "rev-list", "--count", "HEAD"],
                                            capture_output=True, text=True).stdout.strip(), "1")
            receipt = json.load(open(os.path.join(directory, "manual-state-workspace.json"), encoding="utf-8"))
            self.assertEqual((receipt["transport"], receipt["activated"]), ("UNBOUND", False))
            exports = open(env_file, encoding="utf-8").read()
            self.assertIn("CT_STATE_REPO=" + state, exports)
            self.assertIn("CT_OUT=" + os.path.join(directory, "out"), exports)
            self.assertIn("CT_STATE_JOURNAL_RESERVE=" + os.path.join(directory, "cloud-test-state-reserve.json"), exports)
            self.assertIn("CT_STATE_JOURNAL_SETTLE=" + os.path.join(directory, "cloud-test-state-settle.json"), exports)

    def test_the_admitted_tested_release_gets_its_own_clean_checkout_and_the_source_checkout_fails_that_gate(self):
        """Request-only descendants remain workflow source, never tested product source."""
        step = next(s for s in self.jobs["live"]["steps"]
                    if s.get("name") == "Bind a clean detached checkout of the admitted tested release")
        for token in ('worktree add --detach "$tested" "$TESTED_SHA"',
                      '[ "$(git -C "$tested" rev-parse HEAD)" = "$TESTED_SHA" ]',
                      '[ -z "$(git -C "$tested" status --porcelain)" ]'):
            self.assertIn(token, step["run"])

        with tempfile.TemporaryDirectory(prefix="cloud-tested-source-gate-") as directory:
            repo = os.path.join(directory, "repo")
            tested = os.path.join(directory, "tested")
            os.mkdir(repo)

            def git(*args, check=True):
                return subprocess.run(["git", "-C", repo, *args], check=check, capture_output=True, text=True).stdout.strip()

            git("init", "-q")
            git("config", "user.email", "unit@example.invalid")
            git("config", "user.name", "unit")
            with open(os.path.join(repo, "pnpm-lock.yaml"), "w", encoding="utf-8") as out:
                out.write("lockfileVersion: '9.0'\n")
            git("add", "pnpm-lock.yaml")
            git("commit", "-q", "-m", "tested release")
            release = git("rev-parse", "HEAD")
            os.makedirs(os.path.join(repo, "tools", "cloud-test", "config", "runs"))
            with open(os.path.join(repo, "tools", "cloud-test", "config", "runs", "request.json"), "w", encoding="utf-8") as out:
                out.write('{"requestOnly":true}\n')
            git("add", "tools/cloud-test/config/runs/request.json")
            git("commit", "-q", "-m", "request-only descendant")
            workflow_source = git("rev-parse", "HEAD")
            self.assertNotEqual(workflow_source, release)

            git("worktree", "add", "--detach", tested, release)

            def source_gate(path):
                head = subprocess.run(["git", "-C", path, "rev-parse", "HEAD"], check=True,
                                      capture_output=True, text=True).stdout.strip()
                clean = subprocess.run(["git", "-C", path, "status", "--porcelain"], check=True,
                                       capture_output=True, text=True).stdout.strip()
                return head == release and clean == ""

            self.assertTrue(source_gate(tested), "the detached admitted release is the clean product source")
            self.assertFalse(source_gate(repo), "the newer request-only workflow checkout must fail the tested-source gate")
            shutil.rmtree(tested)

    def test_only_reviewed_actions_are_used(self):
        uses = sorted({s["uses"].split("@")[0] for j in self.jobs.values() for s in j["steps"] if "uses" in s})
        self.assertEqual(uses, ["actions/checkout", "actions/download-artifact", "actions/setup-node", "actions/setup-python", "actions/upload-artifact"])
        for j in self.jobs.values():
            for s in j["steps"]:
                if s.get("uses", "").startswith("actions/checkout@"):
                    self.assertIs(s["with"]["persist-credentials"], False)

    def test_the_handoff_artifact_is_short_lived_and_not_the_authoritative_record(self):
        up = [s for s in self.jobs["live"]["steps"] if s.get("uses", "").startswith("actions/upload-artifact@")]
        self.assertEqual(len(up), 2)  # the closed record (record job) and the closed settle input for journal-settle (J1, every route)
        self.assertTrue(all(u["with"]["retention-days"] == 1 for u in up))
        self.assertEqual(sorted(u["with"]["path"].rsplit("/", 1)[-1] for u in up), ["latest-record.json", "settle-input.json"])
        settle = next(u for u in up if u["with"]["path"].endswith("settle-input.json"))
        self.assertEqual(settle["if"], "always()")
        # Sam 1793580806.654369: the public artifact is the closed projection, never the collector's run record; journal-settle validates it
        project = next(st for st in self.jobs["live"]["steps"] if "settle_input.py project" in st.get("run", ""))
        self.assertIn('--record "$CT_OUT/run-record.json"', project["run"])
        self.assertFalse(any(u["with"]["path"].endswith("run-record.json") for u in up))
        settle_run = next(st["run"] for st in self.jobs["journal-settle"]["steps"] if "CT_STATE_PUSH_TOKEN" in (st.get("env") or {}))
        self.assertLess(settle_run.index("settle_input.py validate"), settle_run.index("reservations.py journal-settle"))
        self.assertLess(settle_run.index("settle_input.py validate"), settle_run.index("manual_reservation.py settle"))
        manual_settle = settle_run[settle_run.index("manual_reservation.py settle"):settle_run.index("exit 0", settle_run.index("manual_reservation.py settle"))]
        self.assertIn('--settle-input "$SETTLE"', manual_settle)  # its evidence is the embedded record digest (RETURN 1793645360.787039 #3)
        self.assertNotIn("--record", manual_settle)

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
        # Both account-role emails reach the run stage only through prepare's masked, safe $GITHUB_ENV export, never a step env value.
        role_emails = {"THROWAWAY_TEST_EMAIL", "FREE_TEST_EMAIL"}
        self.assertTrue(role_emails.isdisjoint(run["env"]))
        self.assertTrue(set(names) - role_emails <= set(run["env"]), set(names) - set(run["env"]))
        init = next(s for s in self.jobs["live"]["steps"] if s.get("id") == "init")
        self.assertEqual(init["env"]["CLOUD_TEST_LIVE_ACCOUNTS"], "${{ secrets.CLOUD_TEST_LIVE_ACCOUNTS }}")
        self.assertEqual(init["env"]["SUPABASE_URL"], "${{ vars.SUPABASE_URL }}")
        holders = [s.get("name", s.get("uses")) for j in self.jobs.values() for s in j["steps"] if "CLOUD_TEST_LIVE_ACCOUNTS" in (s.get("env") or {})]
        self.assertEqual(holders, [init["name"]])

    def test_plan_build_receives_the_project_url_needed_to_resolve_account_bindings(self):
        setup = next(s for s in self.jobs["live"]["steps"] if "for stage in install-tools build-plan" in s.get("run", ""))
        self.assertEqual(setup["env"]["VITE_SUPABASE_URL"], "${{ vars.SUPABASE_URL }}")
        self.assertEqual(setup["env"]["VITE_SUPABASE_ANON_KEY"], "${{ secrets.SUPABASE_ANON_KEY }}")

    def test_the_approved_window_is_rechecked_immediately_before_the_run_step(self):
        steps = self.jobs["live"]["steps"]
        run = next(i for i, s in enumerate(steps) if s.get("run", "").strip() == "bash tools/cloud-test/scripts/execute_run.sh run")
        check = steps[run - 1]  # the run's reserve was appended before this job by journal-reserve (#1772 review 4446137323)
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

    def test_the_admitted_continuity_checkpoint_is_placed_byte_checked_immediately_before_plan_construction(self):
        # Increment I (Sam 1793566031.065709): the bytes prepare admitted, digest-checked from init's step output, are the reconciliation
        # the stage runner's plan construction reads; placed once, never overwritten, right before the setup stages.
        steps = self.jobs["live"]["steps"]
        init = next(i for i, s in enumerate(steps) if s.get("id") == "init")
        place = next(i for i, s in enumerate(steps) if s.get("name") == "Place the admitted continuity checkpoint as the runner's reconciliation")
        setup = next(i for i, s in enumerate(steps) if "for stage in install-tools build-plan" in s.get("run", ""))
        self.assertEqual((init < place, place + 1), (True, setup))
        step = steps[place]
        self.assertEqual(step["env"], {"RECONCILIATION_SHA256": "${{ steps.init.outputs.reconciliation_sha256 }}"})
        self.assertNotIn("if", step)
        run = step["run"]
        order = [run.index(k) for k in ('SRC="$RUNNER_TEMP/run-inputs/reconciliation.json"', 'reconciliation-not-the-admitted-bytes',
                                         'reconciliation-already-present', 'cp -- "$SRC" "$DST"', 'reconciliation-copy-differs')]
        self.assertEqual(order, sorted(order))
        self.assertIn('DST="$CT_OUT/reconciliation.json"', run)
        self.assertNotIn("ln ", run, "a copy, never a link (the runner requires one regular file)")
        # Execute the step's own script: the admitted bytes land unchanged; other bytes, a missing digest or an existing target refuse.
        import hashlib
        import subprocess
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "run-inputs"))
            body = b'{"ceilings":{"starts":120},"starts":{"ownerCounted":0}}\n'
            with open(os.path.join(d, "run-inputs", "reconciliation.json"), "wb") as f:
                f.write(body)

            def place(digest, out):
                return subprocess.run(["bash", "-c", run], capture_output=True, text=True,
                                      env={"PATH": os.environ["PATH"], "RUNNER_TEMP": d, "CT_OUT": os.path.join(d, out), "RECONCILIATION_SHA256": digest})
            good = hashlib.sha256(body).hexdigest()
            self.assertEqual((place("0" * 64, "a").returncode, place("", "b").returncode), (78, 78))
            self.assertFalse(os.path.exists(os.path.join(d, "a", "reconciliation.json")))
            p = place(good, "out")
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            with open(os.path.join(d, "out", "reconciliation.json"), "rb") as f:
                self.assertEqual(f.read(), body)
            self.assertEqual(os.stat(os.path.join(d, "out", "reconciliation.json")).st_nlink, 1)
            self.assertEqual((place(good, "out").returncode, place(good, "out").stdout.strip()), (78, "BLOCKED_SETUP: reconciliation-already-present"))

    def test_the_runner_receives_the_admission_digests_only_from_init_step_outputs(self):
        want = {"CT_REQUEST_SHA256": "${{ steps.init.outputs.request_sha256 }}",
                "CT_LIVE_ACCOUNTS_SHA256": "${{ steps.init.outputs.live_accounts_sha256 }}"}
        runner = [s for s in self.jobs["live"]["steps"] if "execute_run.sh" in s.get("run", "")]
        self.assertEqual(len(runner), 3, "setup stages, run, collect (reserve and settle are the writer jobs')")
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

    def test_the_record_is_qualified_only_with_an_execution_provenance_verdict_from_the_producers_records(self):
        collect = next(s for s in self.jobs["live"]["steps"] if s.get("name", "").startswith("Collect, verify the binding"))["run"]
        order = [collect.index(k) for k in ("execute_run.sh collect", "init_run_inputs.py provenance", 'P=(--provenance "$CT_OUT/provenance.json")',
                                             "init_run_inputs.py project")]
        self.assertEqual(order, sorted(order))
        for arg in ('--build-receipt "$CT_OUT/plan/cfg/build-plan-consumption.json"', '--run-record "$CT_OUT/run-record.json"',
                    '--cases-dir "$CT_OUT/plan/run/cases"', '--run-id "$GITHUB_RUN_ID"', '"${Q[@]}" "${P[@]}"'):
            self.assertIn(arg, collect)

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

    def test_j1_journal_jobs_hold_the_only_write_permission_and_confine_the_token(self):
        # J1 (PO approval recorded 1793578273.517019): contents: write only in the two journal jobs, which serve scheduled runs and, since
        # #1772 review 4446137323, manual dispatches; never a PR, fork or other event.
        jobs = self.jobs
        for name in ("journal-reserve", "journal-settle"):
            job = jobs[name]
            self.assertEqual(job["permissions"], {"contents": "write"})
            self.assertIn("(github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')", job["if"])
            checkout = next(st for st in job["steps"] if str(st.get("uses", "")).startswith("actions/checkout"))
            self.assertIs(checkout["with"]["persist-credentials"], False)
            writers = [st for st in job["steps"] if "CT_STATE_PUSH_TOKEN" in (st.get("env") or {})]
            self.assertEqual(len(writers), 1)
            self.assertEqual(writers[0]["env"]["CT_STATE_PUSH_TOKEN"], "${{ github.token }}")
            self.assertIn("reservations.py journal-%s" % name.split("-")[1], writers[0]["run"])
            # the manual branch runs only off-schedule, and manual_reservation itself refuses nightly requests
            self.assertIn('if [ "$GITHUB_EVENT_NAME" != schedule ]; then', writers[0]["run"])
            self.assertIn("manual_reservation.py %s" % name.split("-")[1], writers[0]["run"])
            self.assertLess(writers[0]["run"].index("manual_reservation.py"), writers[0]["run"].index("reservations.py journal-"))
        self.assertEqual(self.text.count("CT_STATE_PUSH_TOKEN"), 2, "the token reaches only the two writer steps")
        self.assertEqual(jobs["live"]["permissions"], {"contents": "read"})
        # Case 10 (Sam 1793580806.654369): the observation reserve and settle run in the write jobs; the live job only observes, read-only
        self.assertIn("case10_observation.py reserve", writers_of(jobs, "journal-reserve"))
        self.assertIn("case10_observation.py settle", writers_of(jobs, "journal-settle"))
        live_runs = " ".join(st.get("run", "") for st in jobs["live"]["steps"])
        self.assertIn("case10_observation.py observe", live_runs)
        self.assertNotIn("case10_observation.py reserve", live_runs)
        self.assertNotIn("case10_observation.py settle", live_runs)
        self.assertNotIn("execute_run.sh reserve", self.text)
        self.assertNotIn("execute_run.sh settle", self.text)
        self.assertEqual(jobs["live"]["needs"], ["record-begin", "journal-reserve"])
        self.assertIn("needs.journal-reserve.result == 'success'", jobs["live"]["if"])
        self.assertNotIn("skipped", jobs["live"]["if"])  # #1772 review 4446137323: a dispatch, too, starts only after its reserve landed
        self.assertIn("needs.journal-reserve.result == 'success'", jobs["journal-settle"]["if"])
        # write is never granted at the workflow level or to any other job
        self.assertEqual([n for n, j in jobs.items() if (j.get("permissions") or {}).get("contents") == "write"], ["journal-reserve", "journal-settle"])



class Case10ObserveCredentials(unittest.TestCase):
    """Sam 1793582780.014609: the observe step's credential environment. Scheduled runs only, from Secrets, on the one step that already
    holds the private bundle, under names nothing else reads; the reader subprocess receives them by explicit hand-off only."""
    def test_the_case10_credentials_reach_only_the_init_step_on_scheduled_runs(self):
        import yaml
        with open(YML, encoding="utf-8") as f:
            text = f.read()
        doc = yaml.safe_load(text)
        init = next(st for st in doc["jobs"]["live"]["steps"] if st.get("id") == "init")
        self.assertEqual(init["env"]["CT_CASE10_PASSWORD"], "${{ github.event_name == 'schedule' && secrets.THROWAWAY_TEST_PASSWORD || '' }}")
        self.assertEqual(init["env"]["CT_CASE10_ANON_KEY"], "${{ github.event_name == 'schedule' && secrets.SUPABASE_ANON_KEY || '' }}")
        others = [st for job in doc["jobs"].values() for st in job["steps"] if st is not init]
        for name in ("CT_CASE10_PASSWORD", "CT_CASE10_ANON_KEY"):
            self.assertFalse(any(name in json.dumps(st) for st in others), name)  # no other step names it
        self.assertIn("case10_observation.py observe", init["run"])

    def children(self, event):
        """Sam 1793584373.385389, behavioural: the REAL init script, with python3 and base64 shadowed by shell functions that record the
        environment each child would receive (exported variables only), then the real base64 runs."""
        import base64
        import shutil
        import subprocess
        import tempfile
        import yaml
        with open(YML, encoding="utf-8") as f:
            init = next(st for st in yaml.safe_load(f)["jobs"]["live"]["steps"] if st.get("id") == "init")
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        calls = os.path.join(d, "calls")
        os.mkdir(calls)
        # the call index counts recorded files, so it survives the script's ( ... ) subshell
        shadow = ('python3() { __n=$(command ls "$CALLS" | command wc -l | command tr -d " "); env > "$CALLS/$__n.python3.env"; '
                  'printf "%s\\n" "$*" > "$CALLS/$__n.python3.argv"; }\n'
                  'base64() { __n=$(command ls "$CALLS" | command wc -l | command tr -d " "); env > "$CALLS/$__n.base64.env"; command base64 "$@"; }\n')
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "CALLS": calls, "GITHUB_EVENT_NAME": event, "RUNNER_TEMP": d,
               "PRIOR_STATE": "{}", "NIGHTLY_REQUEST_B64": base64.b64encode(b"{}").decode(), "NIGHTLY_REQUEST_SHA256": "a" * 64,
               "REQUEST": "r.json", "FACTS": "f.json", "CT_CONFIG": "c.json", "GITHUB_WORKSPACE": d, "GITHUB_RUN_ID": "101",
               "GITHUB_RUN_ATTEMPT": "1", "GITHUB_SHA": "4" * 40, "GITHUB_ENV": os.path.join(d, "env"), "GITHUB_OUTPUT": os.path.join(d, "out"),
               "CT_CASE10_PASSWORD": "case10-pw-value" if event == "schedule" else "", "CT_CASE10_ANON_KEY": "case10-anon-value" if event == "schedule" else ""}
        p = subprocess.run(["bash", "-c", shadow + init["run"]], env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        out = {}
        for fn in sorted(os.listdir(calls), key=lambda x: int(x.split(".")[0])):
            if fn.endswith(".env"):
                n, tool = fn.split(".")[:2]
                argv = open(os.path.join(calls, "%s.python3.argv" % n)).read() if tool == "python3" else "base64"
                out[(int(n), tool, argv.split()[1] if tool == "python3" else "base64")] = open(os.path.join(calls, fn)).read()
        return out

    def test_only_the_observe_child_receives_the_case10_credentials(self):
        seen = self.children("schedule")
        self.assertEqual([k[2] for k in sorted(seen)], ["base64", "tools/cloud-test/scripts/case10_observation.py",
                                                        "tools/cloud-test/scripts/init_run_inputs.py"])
        for (_, _, what), env in seen.items():
            names = {line.split("=", 1)[0] for line in env.splitlines()}
            if what.endswith("case10_observation.py"):
                self.assertIn("CT_CASE10_PASSWORD=case10-pw-value", env.splitlines())
                self.assertIn("CT_CASE10_ANON_KEY=case10-anon-value", env.splitlines())
            else:  # base64 before it and prepare after it receive neither name nor value
                self.assertFalse({"CT_CASE10_PASSWORD", "CT_CASE10_ANON_KEY", "C10_PASSWORD", "C10_ANON_KEY"} & names, what)
                self.assertNotIn("case10-pw-value", env)
                self.assertNotIn("case10-anon-value", env)
        dispatch = self.children("workflow_dispatch")
        self.assertEqual([k[2] for k in sorted(dispatch)], ["tools/cloud-test/scripts/init_run_inputs.py"])
        for env in dispatch.values():
            self.assertFalse({"CT_CASE10_PASSWORD", "CT_CASE10_ANON_KEY"} & {line.split("=", 1)[0] for line in env.splitlines()})


class ManualPathNeverRunsOnSchedule(unittest.TestCase):
    """#1772 review 4446137323: a manual dispatch's reserve and settle are appended by the authenticated writer jobs (the live job has
    contents: read and no push token, so it could never persist them). The manual branch runs only off-schedule and ends the step; a
    scheduled run never reaches it, and manual_reservation refuses nightly requests in any case."""
    def test_manual_reserve_and_settle_run_only_off_schedule_in_the_writer_jobs(self):
        import yaml
        with open(YML, encoding="utf-8") as f:
            jobs = yaml.safe_load(f)["jobs"]
        for name, command in (("journal-reserve", "manual_reservation.py reserve"), ("journal-settle", "manual_reservation.py settle")):
            run = writers_of(jobs, name)
            branch = run[run.index('if [ "$GITHUB_EVENT_NAME" != schedule ]; then'):run.index("\nfi\n", run.index("manual_reservation.py"))]
            self.assertIn(command, branch)
            self.assertIn("exit 0", branch, "the manual branch never falls through to the nightly commands")
            # the dispatched request is confined to the one reviewed request location and must be committed at this protected-main commit
            for guard in ('tools/cloud-test/config/runs/*.json) ;;', '*..*|*//*)', 'git cat-file -e "$GITHUB_SHA:$MANUAL_REQUEST"'):
                self.assertIn(guard, branch)
            self.assertEqual(next(st for st in jobs[name]["steps"] if "CT_STATE_PUSH_TOKEN" in (st.get("env") or {}))["env"]["MANUAL_REQUEST"],
                             "${{ inputs.request }}")
        self.assertIn("--admitted-sha256", writers_of(jobs, "journal-reserve"))
        # RETURN 1793645360.787039: the approval is admitted by the writer before the append (#2), the writer never uses the workflow
        # checkout as its transport repository (#1), and the continuity inputs are the ones init_run_inputs reads (addendum).
        self.assertIn('--facts "$RUNNER_TEMP/manual-facts.json"', writers_of(jobs, "journal-reserve"))
        import init_run_inputs as I
        for name in ("journal-reserve", "journal-settle"):
            run = writers_of(jobs, name)
            manual = run[run.index("manual_reservation.py"):run.index("exit 0", run.index("manual_reservation.py"))]
            self.assertNotIn("--repo", manual)
            self.assertIn("--scope %s/%s" % (I.CONTINUITY_DIR, I.CONTINUITY_SCOPE), manual)
        self.assertIn("--bootstrap %s/%s" % (I.CONTINUITY_DIR, I.CONTINUITY_BOOTSTRAP), writers_of(jobs, "journal-reserve"))
        live = " ".join(st.get("run", "") for st in jobs["live"]["steps"])
        self.assertNotIn("manual-reserve", live)
        self.assertNotIn("manual-settle", live)


def writers_of(jobs, name):
    return next(st["run"] for st in jobs[name]["steps"] if "CT_STATE_PUSH_TOKEN" in (st.get("env") or {}))


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
