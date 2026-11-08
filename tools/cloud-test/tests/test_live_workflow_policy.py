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



# TEMPORARY (PO 2026-11-05): protected main, or a MANUAL dispatch of exactly the R10 candidate branch. Restored to the
# main-only form before merge; the environment gate on the live job is asserted unchanged below.
PROTECTED_MAIN = ("((github.ref == 'refs/heads/main' && github.ref_protected == true) || "
                  "(github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/elon/r10-preflight-traffic-class'))")

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

    def test_only_the_live_job_enables_the_clean_room_namespace_immediately_before_the_offline_proof(self):
        """R10 run 41960376782: the offline proof's package tests need unshare -rn, which ubuntu runners block through AppArmor. The live job
        re-enables it exactly as cloud-test.yml does, on its own ephemeral runner, right before the proof, with no credential and no other job."""
        name = "Allow the clean-room network namespace on this ephemeral runner"
        holders = [(job, i) for job, spec in self.jobs.items() for i, st in enumerate(spec.get("steps") or []) if st.get("name") == name]
        self.assertEqual([job for job, _ in holders], ["live"])
        steps = self.jobs["live"]["steps"]
        i = holders[0][1]
        self.assertEqual(steps[i + 1]["name"], "Generate the exact-head browser-bound proof and offline checks")
        self.assertEqual(steps[i]["run"], "sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0\nunshare -rn true\n")
        self.assertEqual(set(steps[i]), {"name", "timeout-minutes", "run"})   # no env, secrets, uses or with
        self.assertEqual(self.text.count("sudo "), 1, "no other step gains sudo")

    def test_record_begin_sparse_checkout_contains_the_accounting_scope_used_by_one_off_grant(self):
        checkout = next(step for step in self.jobs["record-begin"]["steps"]
                        if str(step.get("uses", "")).startswith("actions/checkout@"))
        patterns = [line.strip() for line in checkout["with"]["sparse-checkout"].splitlines() if line.strip()]
        self.assertIn("tools/cloud-test/config/aggregate", patterns)
        with tempfile.TemporaryDirectory() as tmp:
            clone = os.path.join(tmp, "sparse")
            subprocess.run(["git", "clone", "--quiet", "--no-checkout", REPO, clone], check=True)
            subprocess.run(["git", "-C", clone, "sparse-checkout", "init", "--cone"], check=True)
            subprocess.run(["git", "-C", clone, "sparse-checkout", "set", *patterns], check=True)
            subprocess.run(["git", "-C", clone, "checkout", "--quiet", "HEAD"], check=True)
            probe = subprocess.run([
                "python3", "-c",
                "import os,sys;sys.path.insert(0,sys.argv[1]);import init_run_inputs as i;print(os.path.join(sys.argv[2],i.CONTINUITY_DIR,i.CONTINUITY_SCOPE))",
                os.path.join(clone, "tools", "cloud-test", "scripts"),
                clone,
            ], check=True, capture_output=True, text=True)
            scope = probe.stdout.strip()
            self.assertEqual(scope, os.path.join(clone, "tools", "cloud-test", "config", "aggregate", "period-scope.json"))
            self.assertTrue(os.path.isfile(scope), "record-begin must carry the scope one_off_grant reads")

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
        # A dispatch's facts are exactly the prerequisite preflight's augmented facts (fail closed when that step did not produce them).
        self.assertIn('else\n  (umask 077; printf \'%s\' "$MANUAL_OCCURRENCE_B64" | base64 -d > "$RUNNER_TEMP/manual-occurrence.json")\n'
                      '  [ -f "${CT_PREREQUISITE_FACTS:-}" ] && [ ! -L "${CT_PREREQUISITE_FACTS:-}" ] || '
                      '{ echo \'BLOCKED_SETUP: prerequisite-facts-missing\'; exit 78; }\n'
                      '  FACTS="$(cat "$CT_PREREQUISITE_FACTS")"\n'
                      '  SRC=(--request "$REQUEST" --manual-occurrence-file "$RUNNER_TEMP/manual-occurrence.json" \\\n'
                      '    --manual-occurrence-sha256 "$MANUAL_OCCURRENCE_SHA256" --workflow-start-utc "${MANUAL_WORKFLOW_START_UTC-}" --facts "$FACTS")\nfi\n', init["run"])
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
        self.assertEqual(begin["if"], "${{ !cancelled() && " + PROTECTED_MAIN + " && "
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
        # Run 41906815122: the tracking target #1763 is a pull request, so its comments need the pull-requests permission; only the two
        # record jobs (which list, create, update and read back that one comment) hold it, and no other job does.
        self.assertEqual(self.jobs["record-begin"]["permissions"], {"issues": "write", "pull-requests": "write", "actions": "read"})
        self.assertEqual(self.jobs["record-complete"]["permissions"], {"issues": "write", "pull-requests": "write", "actions": "read"})
        self.assertEqual(sorted(n for n, j in self.jobs.items() if "pull-requests" in (j.get("permissions") or {})),
                         ["record-begin", "record-complete"])
        self.assertEqual(self.jobs["live"]["permissions"], {"contents": "read"})
        self.assertEqual(self.jobs["live"]["environment"], "trusted-main-credentials")

    def test_record_begin_retires_only_the_exact_never_reserved_attempt_on_evidence_before_it_begins(self):
        begin = next(st for st in self.jobs["record-begin"]["steps"] if st.get("id") == "begin")
        run = begin["run"]
        guard = 'if [ "$GITHUB_EVENT_NAME" = workflow_dispatch ] && unreserved_run="$(python3 -I "$P" unreserved-candidate --previous "$RUNNER_TEMP/previous.md")"; then'
        self.assertIn(guard, run)
        # the evidence is GitHub's own report of that run and its jobs plus the validated journal, consumed by the one retirement command
        for needle in ('actions/runs/$unreserved_run" > "$RUNNER_TEMP/unreserved-run.json"', 'actions/runs/$unreserved_run/jobs?per_page=100',
                       "unreserved_attempt_evidence.py --run", "retire-unreserved --previous"):
            self.assertIn(needle, run)
        # no release identity is borrowed from the new dispatch's request, and nothing is completed
        for forbidden in ("testedSha", "tested_sha", "cfg_get.py", "MANUAL_REQUEST", " complete --previous"):
            self.assertNotIn(forbidden, run[run.index(guard):run.index('"$P" begin --previous')])
        self.assertNotIn("MANUAL_REQUEST", begin.get("env") or {})
        # after the pending-completion reconcile and strictly before `begin`, so any other stuck attempt still refuses there
        self.assertLess(run.index("pendingCompletion"), run.index(guard))
        self.assertLess(run.index("retire-unreserved"), run.index('"$P" begin --previous'))
        # review return: when a retirement happened, the stored comment is re-read and bound to the selected record immediately before the one
        # publication, and a record that moved since is never overwritten
        publish = run.index('--method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id"')
        reread = run.index('verify-predecessor --selected "$RUNNER_TEMP/selected.json" --current "$RUNNER_TEMP/predecessor-current.json"')
        self.assertIn('retired_unreserved=1', run[run.index(guard):run.index('"$P" begin --previous')])
        self.assertIn('if [ "${retired_unreserved:-}" = 1 ]; then', run)
        self.assertLess(run.index('"$P" begin --previous'), run.index('if [ "${retired_unreserved:-}" = 1 ]; then'))
        self.assertLess(reread, publish)
        self.assertIn('gh api "repos/$GITHUB_REPOSITORY/issues/comments/$id" > "$RUNNER_TEMP/predecessor-current.json"', run)
        # the step gained no credential and the job no permission beyond the PR-comment write
        self.assertIsNone(SECRET_REF.search(str(begin)))
        self.assertNotIn("contents", self.jobs["record-begin"]["permissions"])
        self.assertIn("tools/cloud-test/scripts", next(st for st in self.jobs["record-begin"]["steps"]
                                                      if st.get("uses", "").startswith("actions/checkout@"))["with"]["sparse-checkout"])

    def test_the_record_jobs_hold_no_live_credential(self):
        for name in ("record-begin", "record-complete"):
            self.assertIsNone(SECRET_REF.search(str(self.jobs[name])), name)
        protected_main = PROTECTED_MAIN
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
        self.assertEqual(self.text.count("secrets.CLOUD_TEST_LIVE_ACCOUNTS"), 2)  # prepare and the manual-only prerequisite preflight
        # A value derived from a Secret by an expression is not masked by Actions: the bundle is never parsed in a workflow expression.
        self.assertNotRegex(self.text, r"fromJSON\(\s*secrets\.")
        self.assertIn("THROWAWAY_TEST_PASSWORD: ${{ secrets.THROWAWAY_TEST_PASSWORD }}", self.text)
        # Case15 (Sam 1793554938.870679): the maintained-read-only role's password reaches the run step from its own Secret; its email
        # comes only from the private bundle, like THROWAWAY's.
        self.assertEqual(self.text.count("FREE_TEST_PASSWORD: ${{ secrets.FREE_TEST_PASSWORD }}"), 2)  # run step and the prerequisite preflight
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
        # select at begin, the begin readback after its write (Sam 1794147839), select before the terminal write, and the readback
        # verification after it: all bound to the one tracking issue
        self.assertEqual(self.text.count('--issue-url "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/issues/$TRACKING_ISSUE"'), 4)
        self.assertIn('--comment-id "$COMMENT_ID"', self.text)
        self.assertIn('--comment-id "$id"', self.text)

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
        # PO 2026-11-06 (working release first): exactly one more, the tested release's own pinned pnpm through Node's bundled corepack,
        # after the tested checkout is bound and before any stage; it reads its version only from that checkout and gets no extra env.
        pnpm = next(s for s in self.jobs["live"]["steps"] if s.get("name") == "Bind the tested release's pinned package manager (corepack)")
        self.assertEqual([(job, s["run"].strip()) for job, s in installs], [
            ("live", self.PY_YAML_INSTALL),
            ("live", self.B4_INSTALL),
            ("live", pnpm["run"].strip()),
        ])
        self.assertNotIn("env", pnpm)
        self.assertIn('corepack prepare "$pm" --activate', pnpm["run"])
        self.assertIn('"$CT_CHECKOUT/package.json"', pnpm["run"])
        self.assertIn("^pnpm@[0-9]+\\.[0-9]+\\.[0-9]+$", pnpm["run"])
        names = [s.get("name") for s in self.jobs["live"]["steps"]]
        self.assertLess(names.index("Bind a clean detached checkout of the admitted tested release"), names.index(pnpm["name"]))
        self.assertLess(names.index(pnpm["name"]), next(i for i, s in enumerate(self.jobs["live"]["steps"]) if "execute_run.sh" in s.get("run", "")))
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
        # P1: the exact admitted tested-release and the reviewed control tree both receive the same
        # pin-verified runtime packages. The former runs the journey; the latter runs the privileged
        # telemetry reader. Neither path may fall back to an unverified install.
        self.assertLess(at, copy)
        self.assertLess(copy, first_stage)
        script = steps[copy]["run"]
        self.assertIn('git -C "$GITHUB_WORKSPACE" worktree add --detach "$tested" "$TESTED_SHA"', script)
        self.assertIn('--config "$GITHUB_WORKSPACE/$CT_CONFIG" --checkout "$GITHUB_WORKSPACE" --runner-dir "$CT_EXISTING_DEPENDENCY_ROOT" --bind-playwright', script)
        self.assertIn('--config "$GITHUB_WORKSPACE/$CT_CONFIG" --checkout "$tested" --runner-dir "$CT_EXISTING_DEPENDENCY_ROOT"', script)
        self.assertEqual(script.count('--bind-playwright'), 2)
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
        self.assertIn('--checkout "$GITHUB_WORKSPACE" --runner-dir "$CT_EXISTING_DEPENDENCY_ROOT" --bind-playwright', provision["run"])
        self.assertIn('--checkout "$tested" --runner-dir "$CT_EXISTING_DEPENDENCY_ROOT" --bind-playwright', provision["run"])
        self.assertIn('--runner-dir "$CT_EXISTING_DEPENDENCY_ROOT" --bind-playwright', provision["run"])
        self.assertNotRegex(provision["run"], r"\b(npm|npx|pnpm|yarn|pip|apt|brew)\b")
        stage = next(i for i, s in enumerate(steps) if "for stage in install-tools build-plan" in s.get("run", ""))
        self.assertLess(steps.index(provision), stage)

    def test_no_browser_or_unreviewed_package_is_installed_or_downloaded(self):
        self.assertEqual(self.jobs["live"]["runs-on"], "ubuntu-26.04")
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
            "manifestSha256": "e5ec39f0640c749858754e7a1cd8a3be6af84630b2e5d8bf0ded690c7ea1140b",
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

    def test_handoffs_are_short_lived_and_closed_observation_and_timing_projections_are_retained(self):
        up = [s for s in self.jobs["live"]["steps"] if s.get("uses", "").startswith("actions/upload-artifact@")]
        self.assertEqual(len(up), 6)  # two short-lived job handoffs, the egress preflight and proxy receipts, two closed projections
        # PO's one-day rule for repository artifacts (Sam 1794158685.923749 / 1794160532.932219): EVERY live-job upload is kept ONE day
        self.assertEqual(sorted(u["with"]["retention-days"] for u in up), [1] * 6)
        short = [u for u in up if u["with"]["retention-days"] == 1]
        self.assertEqual(sorted(u["with"]["path"].rsplit("/", 1)[-1] for u in short),
                         ["case-timings.json", "egress-preflight.json", "first-observations.json", "latest-record.json", "receipt.json", "settle-input.json"])
        retained = [u for u in up if u["with"]["path"] in ("${{ runner.temp }}/case-timings.json", "${{ runner.temp }}/first-observations.json")]
        self.assertTrue(all(u["with"]["if-no-files-found"] == "error" for u in retained))
        project_observations = next(s for s in self.jobs["live"]["steps"] if s.get("name") == "Project the linked content-safe first observations")
        self.assertIn("init_run_inputs.py first-observations", project_observations["run"])
        project_timings = next(s for s in self.jobs["live"]["steps"] if s.get("name") == "Project content-free per-case timing telemetry")
        self.assertIn("init_run_inputs.py case-timings", project_timings["run"])
        self.assertIn('--case-results "$out/plan/run/case-results.json"', project_timings["run"])
        # Run 42142985744: the timing table is ALWAYS produced (every selected case, NOT RUN when the run never started, plus the stage trace),
        # while the collection steps that need the run's own files skip, rather than fail, when the run step never started.
        self.assertIn('--started-file "$out/started.txt" --stage-trace "$out/stage-trace.tsv"', project_timings["run"])
        self.assertEqual(project_timings["if"], "always()")
        retain_timings = next(s for s in self.jobs["live"]["steps"] if s.get("name") == "Retain content-free per-case timing telemetry")
        self.assertEqual(retain_timings["if"], "always()")
        run_step = next(s for s in self.jobs["live"]["steps"] if s.get("name", "").startswith("Stage runner (run)"))
        self.assertEqual(run_step["id"], "run")
        # A cancelled or timed-out run step is not `skipped`: collection still runs and records the run INCOMPLETE, and journal-settle runs
        # always() after a successful reserve, so the reservation is settled in-run (Bezos N1, Sam 1793965423.927829).
        self.assertTrue(self.jobs["journal-settle"]["if"].startswith("${{ always() && "))
        for name in ("Collect, verify the binding, qualify every selected row, and project the closed record",
                     "Project the linked content-safe first observations", "Retain the linked first observations for the next run"):
            step = next(s for s in self.jobs["live"]["steps"] if s.get("name") == name)
            self.assertEqual(step["if"], "always() && steps.init.outcome == 'success' && steps.run.outcome != 'skipped'", name)
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

    def test_the_dispatch_names_a_committed_template_and_materializes_one_exact_occurrence_from_the_workflow_start(self):
        on = self.doc.get("on", self.doc.get(True))
        self.assertEqual(sorted(on["workflow_dispatch"]["inputs"]), ["confirm", "facts", "request"])
        begin = self.jobs["record-begin"]
        validate = next(s for s in begin["steps"] if s.get("id") == "manual-occurrence")
        self.assertLess(begin["steps"].index(validate), next(i for i, s in enumerate(begin["steps"]) if s.get("id") == "begin"))
        self.assertIn('gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" --jq .run_started_at', validate["run"])
        self.assertIn("init_run_inputs.py occurrence-materialize", validate["run"])
        self.assertIn("init_run_inputs.py occurrence-check", validate["run"])
        self.assertIn('--manual-occurrence-sha256 "$MANUAL_OCCURRENCE_SHA256"', validate["run"])
        self.assertIn('--workflow-start-utc "$workflow_start_utc"', validate["run"])
        self.assertNotIn("inputs.occurrence", json.dumps(self.doc))
        self.assertEqual(begin["outputs"]["manual_occurrence_sha256"], "${{ steps.manual-occurrence.outputs.occurrence_sha256 }}")
        self.assertEqual(begin["outputs"]["manual_occurrence_b64"], "${{ steps.manual-occurrence.outputs.occurrence_b64 }}")
        self.assertEqual(begin["outputs"]["manual_workflow_start_utc"], "${{ steps.manual-occurrence.outputs.workflow_start_utc }}")
        init = next(s for s in self.jobs["live"]["steps"] if s.get("id") == "init")
        self.assertEqual(init["env"]["REQUEST"], "${{ inputs.request }}")
        self.assertIn("init_run_inputs.py prepare", init["run"])
        self.assertIn('--request "$REQUEST"', init["run"])
        self.assertIn('--manual-occurrence-file "$RUNNER_TEMP/manual-occurrence.json"', init["run"])
        self.assertIn('--workflow-start-utc "${MANUAL_WORKFLOW_START_UTC-}"', init["run"])
        for name in ("journal-reserve", "journal-settle"):
            writer = next(s for s in self.jobs[name]["steps"] if "CT_STATE_PUSH_TOKEN" in (s.get("env") or {}))
            self.assertEqual(writer["env"]["MANUAL_OCCURRENCE_SHA256"],
                             "${{ needs.record-begin.outputs.manual_occurrence_sha256 }}")
            self.assertEqual(writer["env"]["MANUAL_OCCURRENCE_B64"],
                             "${{ needs.record-begin.outputs.manual_occurrence_b64 }}")
        self.assertIn('--request "$RUNNER_TEMP/manual-occurrence.json" --admitted-sha256 "$MANUAL_OCCURRENCE_SHA256"',
                      writers_of(self.jobs, "journal-reserve"))
        reserve = next(s for s in self.jobs["journal-reserve"]["steps"] if "CT_STATE_PUSH_TOKEN" in (s.get("env") or {}))
        self.assertEqual(reserve["env"]["MANUAL_WORKFLOW_START_UTC"], "${{ needs.record-begin.outputs.manual_workflow_start_utc }}")
        self.assertIn('--workflow-start-utc "$MANUAL_WORKFLOW_START_UTC"', reserve["run"])
        self.assertIn('cfg_get.py "$RUNNER_TEMP/manual-occurrence.json" runId', writers_of(self.jobs, "journal-settle"))

    def test_the_job_timeout_is_the_one_prepare_checks_and_the_run_step_is_bounded_to_the_live_minutes(self):
        live = self.jobs["live"]
        self.assertEqual(live["timeout-minutes"], "${{ fromJSON(github.event_name == 'workflow_dispatch' && '85' || '340') }}")
        init = next(s for s in live["steps"] if s.get("id") == "init")
        self.assertEqual(init["env"]["JOB_TIMEOUT_MINUTES"], "${{ github.event_name == 'workflow_dispatch' && '85' || '340' }}")
        self.assertIn('--job-timeout-minutes "$JOB_TIMEOUT_MINUTES" ', init["run"])
        run = next(s for s in live["steps"] if s.get("run", "").strip() == "bash tools/cloud-test/scripts/execute_run.sh run")
        self.assertEqual(run["timeout-minutes"], "${{ fromJSON(steps.init.outputs.live_minutes) }}")

    def test_late_completion_is_incomplete_while_accounting_still_settles_safely(self):
        complete = next(s for s in self.jobs["record-complete"]["steps"] if "publish_latest_record.py" in s.get("run", ""))
        self.assertEqual(self.jobs["record-complete"]["needs"], ["record-begin", "live", "journal-settle"])
        self.assertEqual(complete["env"]["MANUAL_OCCURRENCE_B64"], "${{ needs.record-begin.outputs.manual_occurrence_b64 }}")
        self.assertEqual(complete["env"]["SETTLED"], "${{ needs.journal-settle.outputs.settled }}")
        self.assertIn("settlement-not-verified", complete["run"])
        self.assertIn("init_run_inputs.py completion-deadline", complete["run"])
        self.assertIn('[ "$deadline_status" -eq 79 ]', complete["run"])
        self.assertIn('[ "$within_envelope" = true ]', complete["run"])
        self.assertIn("publication_status", complete["run"])
        self.assertIn('published_at=', complete["run"])
        self.assertIn('--now "$published_at"', complete["run"])
        self.assertEqual(complete["env"]["NIGHTLY_REQUEST_SHA256"], "${{ needs.record-begin.outputs.nightly_request_sha256 }}")
        self.assertIn('occurrence_sha256="$NIGHTLY_REQUEST_SHA256"', complete["run"])
        self.assertIn('cfg_get.py "$RUNNER_TEMP/nightly-request.json" window.endUtc', complete["run"])
        self.assertIn("publish_latest_record.py", complete["run"])
        self.assertEqual(complete["run"].count("gh api --method PATCH"), 1)
        self.assertIn('--out "$RUNNER_TEMP/candidate.md"', complete["run"])
        self.assertNotIn('body=@$RUNNER_TEMP/candidate.md', complete["run"])
        self.assertIn('--status "$([ "$LIVE_RESULT" = cancelled ] && echo cancelled || echo incomplete)"', complete["run"])
        self.assertIn('pending --previous "$RUNNER_TEMP/previous.md"', complete["run"])
        self.assertIn('if [ "$attestable" = true ]', complete["run"])
        self.assertIn('attest --candidate "$RUNNER_TEMP/candidate.md"', complete["run"])
        uploads = [s for s in self.jobs["record-complete"]["steps"] if s.get("uses") == "actions/upload-artifact@v4"]
        self.assertEqual(len(uploads), 1)
        self.assertEqual(uploads[0]["with"]["path"], "${{ runner.temp }}/completion")
        # Owner rule (Sam 1794162379): repository artifacts are kept one day, the attestation included. An expired or missing attestation
        # no longer blocks the next run: record-begin retires that pending candidate as `completion-unverified` (never folded or upgraded).
        self.assertEqual(uploads[0]["with"]["retention-days"], 1)
        self.assertIn('cp "$receipt" "$RUNNER_TEMP/completion/settle-receipt.json"', complete["run"])
        self.assertIn('cp "$RUNNER_TEMP/manual-occurrence.json" "$RUNNER_TEMP/completion/occurrence.json"', complete["run"])
        self.assertIn('cp "$RUNNER_TEMP/nightly-request.json" "$RUNNER_TEMP/completion/occurrence.json"', complete["run"])
        begin = next(s for s in self.jobs["record-begin"]["steps"] if "publish_latest_record.py" in s.get("run", ""))
        self.assertIn('reconcile --previous "$RUNNER_TEMP/previous.md"', begin["run"])
        self.assertIn('actions/runs/$pending_run_id/artifacts', begin["run"])
        self.assertIn('actions/artifacts/$artifact_id/zip', begin["run"])
        self.assertIn('--attestation "$RUNNER_TEMP/prior-completion/completion-attestation.json"', begin["run"])
        self.assertIn('--settle-receipt "$RUNNER_TEMP/prior-completion/settle-receipt.json"', begin["run"])
        self.assertIn('--occurrence "$RUNNER_TEMP/prior-completion/occurrence.json"', begin["run"])
        run = begin["run"]
        branch = run.index('completion-artifact --previous "$RUNNER_TEMP/previous.md"')
        self.assertLess(branch, run.index('reconcile --previous "$RUNNER_TEMP/previous.md"'))
        absent = run.index('[ "$?" -eq 1 ] || exit 78', branch)
        self.assertLess(run.index('reconcile --previous "$RUNNER_TEMP/previous.md"'), absent)
        self.assertLess(absent, run.index('retire-unattested --previous "$RUNNER_TEMP/previous.md"'))
        # Sam 1794163556: terminal run/jobs and the validated reserve -> settle come before the listing can retire anything
        self.assertLess(absent, run.index('settled_attempt_evidence.py collect-pending --run "$RUNNER_TEMP/pending-run.json"'))
        self.assertLess(run.index('collect-pending'), run.index('retire-unattested --previous'))
        self.assertIn('--evidence "$RUNNER_TEMP/pending-evidence.json"', run[run.index('retire-unattested --previous'):])
        self.assertNotIn('"completion-artifact-missing-or-ambiguous"', run)
        # Sam 1794163062: an API failure stops the step (never read as "no artifact"): the listing call is unguarded under set -euo pipefail,
        # it paginates and slurps every page, and its exit status is not consumed by a pipe or an `||`
        self.assertTrue(run.lstrip().startswith("set -euo pipefail"))
        listing = next(l for l in run.splitlines() if "actions/runs/$pending_run_id/artifacts" in l).strip()
        self.assertEqual(listing, 'gh api --paginate --slurp "repos/$GITHUB_REPOSITORY/actions/runs/$pending_run_id/artifacts" > "$RUNNER_TEMP/prior-artifact-pages.json"')
        # a retirement re-reads and binds the stored predecessor before the one PATCH, like the other retirements
        self.assertLess(run.index('retire-unattested'), run.index('retired_unreserved=1', run.index('retire-unattested')))
        self.assertLess(run.index('retire-unattested'), run.index('verify-predecessor --selected'))
        # Settlement remains independent of the occurrence deadline: a late
        # publisher cannot claim completion, but held usage is still reconciled
        # under the accepted accounting period.
        settle = writers_of(self.jobs, "journal-settle")
        self.assertIn("manual_reservation.py settle", settle)
        self.assertNotIn("completion-deadline", settle)
        self.assertEqual(self.jobs["journal-settle"]["outputs"]["settled"], "${{ steps.settle.outputs.settled }}")

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
        # PO 2026-11-04 (R10 first-use prerequisites): exactly two steps of the live job hold the private bundle: the manual-only preflight,
        # which signs the two selected accounts in with their own passwords, and prepare. Nothing else does.
        pre = next(s for s in self.jobs["live"]["steps"] if s.get("name") == "Prove the selected accounts' bounded first-use prerequisites")
        self.assertEqual(pre["if"], "github.event_name == 'workflow_dispatch'")
        self.assertEqual(set(pre["env"]), {"FACTS", "MANUAL_OCCURRENCE_SHA256", "MANUAL_OCCURRENCE_B64", "CLOUD_TEST_LIVE_ACCOUNTS",
                                           "SUPABASE_URL", "SUPABASE_ANON_KEY", "THROWAWAY_TEST_PASSWORD", "FREE_TEST_PASSWORD"})
        self.assertEqual((pre["env"]["MANUAL_OCCURRENCE_SHA256"], pre["env"]["MANUAL_OCCURRENCE_B64"]),
                         ("${{ needs.record-begin.outputs.manual_occurrence_sha256 }}", "${{ needs.record-begin.outputs.manual_occurrence_b64 }}"))
        # Every preflight request is bounded by the authorized occurrence's deadline (record-begin's bytes, checked by digest).
        self.assertIn('--occurrence-file "$preflight/occurrence.json" --occurrence-sha256 "$MANUAL_OCCURRENCE_SHA256"', pre["run"])
        self.assertNotIn("SERVICE_ROLE", json.dumps(pre))
        holders = [s.get("name", s.get("uses")) for j in self.jobs.values() for s in j["steps"] if "CLOUD_TEST_LIVE_ACCOUNTS" in (s.get("env") or {})]
        self.assertEqual(holders, [pre["name"], init["name"]])

    def test_plan_build_receives_the_project_url_needed_to_resolve_account_bindings(self):
        setup = next(s for s in self.jobs["live"]["steps"] if "for stage in install-tools build-plan" in s.get("run", ""))
        self.assertEqual(setup["env"]["VITE_SUPABASE_URL"], "${{ vars.SUPABASE_URL }}")
        self.assertEqual(setup["env"]["VITE_SUPABASE_ANON_KEY"], "${{ secrets.SUPABASE_ANON_KEY }}")

    def test_the_approved_window_is_rechecked_immediately_before_the_run_step(self):
        steps = self.jobs["live"]["steps"]
        run = next(i for i, s in enumerate(steps) if s.get("run", "").strip() == "bash tools/cloud-test/scripts/execute_run.sh run")
        check = steps[run - 1]  # the run's reserve was appended before this job by journal-reserve (#1772 review 4446137323)
        self.assertEqual(check["run"].strip(), 'python3 -I tools/cloud-test/scripts/init_run_inputs.py window-check --request "$CT_REQUEST" '
                                               '--live-minutes "$LIVE_MINUTES" --request-sha256 "$REQUEST_SHA256" '
                                               '--execution-deadline "$EXECUTION_DEADLINE"')
        self.assertEqual(check["env"], {"LIVE_MINUTES": "${{ steps.init.outputs.live_minutes }}",
                                        "REQUEST_SHA256": "${{ steps.init.outputs.request_sha256 }}",
                                        "EXECUTION_DEADLINE": "${{ steps.init.outputs.execution_deadline }}"})
        self.assertNotIn("if", check, "a failed window check stops the job before admission")

    def test_one_execution_deadline_reaches_plan_construction_from_init_output_only(self):
        """Sam 1794071539 (design a): the stage runner builds the plan with the init step's execution_deadline output (never $GITHUB_ENV, never
        recomputed); the run step carries no second deadline of its own."""
        steps = self.jobs["live"]["steps"]
        stage = next(s for s in steps if s.get("name", "").startswith("Stage runner (install-tools"))
        self.assertEqual(stage["env"]["CT_EXECUTION_DEADLINE"], "${{ steps.init.outputs.execution_deadline }}")
        run = next(s for s in steps if s.get("run", "").strip() == "bash tools/cloud-test/scripts/execute_run.sh run")
        self.assertFalse({"CT_EXECUTION_DEADLINE", "CT_LIVE_MINUTES"} & set(run["env"]))

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
        runner = [s for s in self.jobs["live"]["steps"] if "execute_run.sh" in s.get("run", "") and "recover-ownership" not in s["run"]]
        self.assertEqual(len(runner), 3, "setup stages, run, collect (reserve and settle are the writer jobs')")
        for step in runner:
            self.assertEqual({k: step["env"].get(k) for k in want}, want, step.get("name"))

    def test_the_po_approved_loopback_egress_service_starts_before_the_preflight_and_stops_with_a_receipt(self):
        """PO 2026-11-08 "approve the local proxy": started right after checkout, before the egress preflight and every credential-bearing step;
        no secret, sudo or permission; exports only the uppercase HTTPS_PROXY on 127.0.0.1; stopped and its receipt kept one day."""
        steps = self.jobs["live"]["steps"]
        names = [s.get("name") or "Run " + s.get("uses", "") for s in steps]
        i = names.index("Start the restrictive loopback CONNECT egress service (PO-approved; no secret)")
        self.assertEqual(names[i - 1], "Run actions/checkout@v6")
        self.assertEqual(names[i + 1], "Egress readiness preflight (no network; closed receipt)")
        start = steps[i]
        self.assertNotIn("env", start)
        for needle in ("secrets.", "sudo", "vars.", "https_proxy", "NO_PROXY", "HTTP_PROXY="):
            self.assertNotIn(needle, start["run"], needle)
        self.assertIn('echo "HTTPS_PROXY=http://127.0.0.1:$port" >> "$GITHUB_ENV"', start["run"])
        self.assertIn("egress_connect_proxy.cjs --bundle tools/cloud-test/harness/bundle", start["run"])
        stop = names.index("Stop the egress service and keep its content-safe receipt")
        keep = names.index("Retain the egress service receipt (1 day)")
        self.assertEqual((steps[stop]["if"], steps[keep]["if"], steps[keep]["with"]["retention-days"]), ("always()", "always()", 1))
        self.assertLess(names.index("Collect, verify the binding, qualify every selected row, and project the closed record"), stop)
        self.assertLess(stop, keep)
        self.assertEqual(names[-1], "Remove the private run inputs")

    def test_an_early_refusal_before_init_leaves_every_always_step_safe_without_ct_out(self):
        """Run 42516864915 (Sam 1794167544): the egress preflight refused before init exported CT_OUT, and the always() settle-input
        projection died `CT_OUT: unbound variable` under set -u. Executed here exactly as GitHub runs it (bash -e, the step's own set -euo
        pipefail) with CT_OUT unset: it must exit 0 and project nothing. Every always()-only step must guard its first CT_OUT reference."""
        steps = self.jobs["live"]["steps"]
        step = next(s for s in steps if s.get("name", "").startswith("Project the closed settle input"))
        with tempfile.TemporaryDirectory() as d:
            script = os.path.join(d, "step.sh")
            with open(script, "w", encoding="utf-8") as f:
                f.write(step["run"])
            env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "RUNNER_TEMP": d, "HOME": d}
            p = subprocess.run(["bash", "-e", script], capture_output=True, text=True, env=env, cwd=d, timeout=60)
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertIn("no run record: the reservation stays open and counted", p.stdout)
            self.assertNotIn("unbound variable", p.stderr)
            self.assertFalse(os.path.exists(os.path.join(d, "settle")))
            # and with CT_OUT set but no record, the same closed no-op (the pre-existing path is unchanged)
            out = os.path.join(d, "out"); os.mkdir(out)
            p = subprocess.run(["bash", "-e", script], capture_output=True, text=True, env=dict(env, CT_OUT=out), cwd=d, timeout=60)
            self.assertEqual((p.returncode, "no run record" in p.stdout), (0, True), p.stderr)
        for s in steps:
            run = "\n".join(l for l in (s.get("run") or "").splitlines() if not l.lstrip().startswith("#"))
            if s.get("if") == "always()" and "CT_OUT" in run:
                first = run.index("CT_OUT")
                self.assertEqual(run[first - 2:first], "${", s.get("name"))
                self.assertTrue(run[first:].startswith("CT_OUT:-"), s.get("name"))

    def test_every_artifact_this_workflow_uploads_is_kept_one_day(self):
        """Owner, Nov 7: "We only want repository artifacts stored for 1 day" (Sam 1794162379: no attestation exception)."""
        uploads = [(job, s) for job, j in self.jobs.items() for s in j["steps"] if "upload-artifact" in str(s.get("uses", ""))]
        self.assertGreaterEqual(len(uploads), 7)
        for job, s in uploads:
            self.assertEqual(s["with"].get("retention-days"), 1, (job, s.get("name")))

    def test_the_ownership_recovery_runs_between_the_run_stage_and_collect_with_no_secret(self):
        """Sam 1794161531: SIGKILL skips the run stage's traps; recovery returns the trees only after every stage process stops."""
        steps = self.jobs["live"]["steps"]
        i = next(k for k, s in enumerate(steps) if "execute_run.sh recover-ownership" in s.get("run", ""))
        step = steps[i]
        self.assertEqual(steps[i - 1].get("id"), "run")
        self.assertTrue(steps[i + 1]["name"].startswith("Collect, verify the binding"))
        self.assertEqual(step["if"], "always() && steps.init.outcome == 'success' && steps.run.outcome != 'skipped'")
        self.assertEqual(step["env"], {"CT_RUN_STAGE_AS_ROOT": "1"})
        self.assertEqual(step["run"].strip(), "bash tools/cloud-test/scripts/execute_run.sh recover-ownership")
        self.assertNotIn("secrets.", json.dumps(step))
        self.assertLessEqual(step["timeout-minutes"], 3)

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
        facts_file = os.path.join(d, "prerequisite-facts.json")  # a dispatch reads its facts from the prerequisite preflight's output
        with open(facts_file, "w", encoding="utf-8") as f:
            f.write("{}")
        # the call index counts recorded files, so it survives the script's ( ... ) subshell
        shadow = ('python3() { __n=$(command ls "$CALLS" | command wc -l | command tr -d " "); env > "$CALLS/$__n.python3.env"; '
                  'printf "%s\\n" "$*" > "$CALLS/$__n.python3.argv"; }\n'
                  'base64() { __n=$(command ls "$CALLS" | command wc -l | command tr -d " "); env > "$CALLS/$__n.base64.env"; command base64 "$@"; }\n')
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "CALLS": calls, "GITHUB_EVENT_NAME": event, "RUNNER_TEMP": d,
               "PRIOR_STATE": "{}", "NIGHTLY_REQUEST_B64": base64.b64encode(b"{}").decode(), "NIGHTLY_REQUEST_SHA256": "a" * 64,
               "REQUEST": "r.json", "FACTS": "f.json", "CT_CONFIG": "c.json", "GITHUB_WORKSPACE": d, "GITHUB_RUN_ID": "101",
               "GITHUB_RUN_ATTEMPT": "1", "GITHUB_SHA": "4" * 40, "GITHUB_ENV": os.path.join(d, "env"), "GITHUB_OUTPUT": os.path.join(d, "out"),
               "MANUAL_OCCURRENCE_B64": base64.b64encode(b"{}").decode(), "MANUAL_OCCURRENCE_SHA256": "b" * 64,
               "CT_CASE10_PASSWORD": "case10-pw-value" if event == "schedule" else "", "CT_CASE10_ANON_KEY": "case10-anon-value" if event == "schedule" else "",
               "CT_PREREQUISITE_FACTS": facts_file,
               "JOB_TIMEOUT_MINUTES": "340" if event == "schedule" else "65"}
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
        self.assertEqual([k[2] for k in sorted(dispatch)], ["base64", "tools/cloud-test/scripts/init_run_inputs.py"])
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
            branch = run[run.index('if [ "$GITHUB_EVENT_NAME" != schedule ]; then'):run.index("\nfi\n", run.index(command))]
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
        for name, command in (("journal-reserve", "manual_reservation.py reserve"), ("journal-settle", "manual_reservation.py settle")):
            run = writers_of(jobs, name)
            # anchored on the reserve / settle command itself: the reserve step also holds the evidence-bound settle of a retired attempt, tested below
            manual = run[run.index(command):run.index("exit 0", run.index(command))]
            self.assertNotIn("--repo", manual)
            self.assertIn("--scope %s/%s" % (I.CONTINUITY_DIR, I.CONTINUITY_SCOPE), manual)
        self.assertIn("--bootstrap %s/%s" % (I.CONTINUITY_DIR, I.CONTINUITY_BOOTSTRAP), writers_of(jobs, "journal-reserve"))
        live = " ".join(st.get("run", "") for st in jobs["live"]["steps"])
        self.assertNotIn("manual-reserve", live)
        self.assertNotIn("manual-settle", live)


class UnexecutedAttemptRecovery(unittest.TestCase):
    """Run 41960376782 reserved, then its live job failed in setup. record-begin retires exactly that pinned attempt on closed evidence it
    collects with its existing `actions: read`; journal-reserve settles the reservation from the same evidence digest, at the exact journal head,
    in its one writer step and before the new reserve. No job gains a permission, and the live job is untouched."""
    @classmethod
    def setUpClass(cls):
        import yaml
        with open(YML, encoding="utf-8") as f:
            cls.jobs = yaml.safe_load(f)["jobs"]

    def begin(self):
        return next(s for s in self.jobs["record-begin"]["steps"] if s.get("id") == "begin")["run"]

    def test_record_begin_retires_the_pinned_attempt_after_the_evidence_and_before_begin_and_the_one_patch(self):
        run = self.begin()
        order = [run.index(x) for x in ("unexecuted_attempt_evidence.py pending", "git fetch --quiet --no-tags --depth=1 origin \"$open_head\"",
                                        "unexecuted_attempt_evidence.py collect", "unexecuted_attempt_evidence.py check", "unexecuted-candidate",
                                        "retire-unexecuted", "unreserved-candidate", " begin --previous", "verify-predecessor", "gh api --method PATCH")]
        self.assertEqual(order, sorted(order), "journal-keyed evidence, retirements, then begin, the predecessor re-read and the one PATCH")
        self.assertEqual(run.count("gh api --method PATCH"), 1)
        # Sam 1793881260.206739: the settle evidence is collected whenever the journal still holds the pinned reserve open, NOT only when the
        # record still names that attempt, so an interruption between the retirement and the settle is recovered by the next dispatch
        probe = run[run.index("unexecuted_sha256=''"):run.index("unexecuted-candidate")]
        self.assertIn('[ "$GITHUB_EVENT_NAME" = workflow_dispatch ]', probe, "a manual dispatch only")
        self.assertNotIn("previous.md", probe, "the probe does not consult the record")
        self.assertIn('actions/runs/$open_run/jobs?per_page=100', probe)
        # Sam 1793881491.714239: any reserved attempt; its credential steps come from ITS OWN workflow at its head, fetched without a credential
        self.assertIn('git show "$open_head:.github/workflows/cloud-test-live.yml" > "$RUNNER_TEMP/unexecuted-workflow.yml"', probe)
        self.assertIn('--workflow "$RUNNER_TEMP/unexecuted-workflow.yml"', probe)
        block = run[run.index("unexecuted-candidate") - 160:run.index(" begin --previous")]
        self.assertIn("retired_unreserved=1", block, "a retirement is bound to its predecessor before the PATCH, like the earlier one")
        self.assertIn('[ -n "$unexecuted_sha256" ] && unexecuted_run="$(python3 -I "$P" unexecuted-candidate --previous "$RUNNER_TEMP/previous.md" --evidence "$RUNNER_TEMP/unexecuted-evidence.json")"', block)
        self.assertIn("unexecuted_sha256=''", run)
        outputs = self.jobs["record-begin"]["outputs"]
        self.assertEqual(outputs["unexecuted_evidence_sha256"], "${{ steps.begin.outputs.unexecuted_evidence_sha256 }}")
        self.assertEqual(outputs["unexecuted_evidence_b64"], "${{ steps.begin.outputs.unexecuted_evidence_b64 }}")
        self.assertIn('echo "unexecuted_evidence_sha256=$unexecuted_sha256" >> "$GITHUB_OUTPUT"', run)

    def test_the_earlier_never_reserved_retirement_is_unchanged(self):
        run = self.begin()
        self.assertIn('unreserved-candidate --previous "$RUNNER_TEMP/previous.md"', run)
        # the reserved-attempt retirement runs first, so a reserved attempt never reaches the never-reserved path (which would refuse it)
        self.assertLess(run.index("unexecuted-candidate"), run.index("unreserved-candidate"))

    def test_a_settled_unpublished_attempt_is_retired_after_the_unexecuted_path_and_before_the_never_reserved_path(self):
        """Run 42483030590 (Sam 1794144135 / 1794145971): reserved, settled, record not publishable. Retired only when the closed
        settled-attempt evidence is collected AND the record names that attempt; a refusal falls through, so the never-reserved path below
        (which refuses a run the journal names) still decides and the run stays fail-closed. No re-settlement: journal-reserve is untouched."""
        run = self.begin()
        settled_collect = 'scripts/settled_attempt_evidence.py collect --run "$RUNNER_TEMP/settled-run.json"'
        start = run.index(settled_collect)
        block = run[run.rindex("if [", 0, start - 300):run.index("retired_unreserved=1", start) + 40]
        order = [run.index(x) for x in ("retire-unexecuted", settled_collect, '"$P" settled-candidate', "retire-settled",
                                        "unreserved_attempt_evidence.py", " begin --previous", "verify-predecessor", "gh api --method PATCH")]
        self.assertEqual(order, sorted(order))
        self.assertIn('[ "$GITHUB_EVENT_NAME" = workflow_dispatch ]', block, "a manual dispatch only")
        self.assertIn('if python3 -I tools/cloud-test/scripts/settled_attempt_evidence.py collect', block, "a refusal is a branch, not a step failure")
        self.assertIn('actions/runs/$settled_run/jobs?per_page=100', block)
        self.assertIn('mv "$RUNNER_TEMP/retired-settled.md" "$RUNNER_TEMP/previous.md"', block)
        self.assertIn("retired_unreserved=1", block, "bound to its predecessor before the one PATCH")
        self.assertEqual(run.count("gh api --method PATCH"), 1)
        # Sam 1794147839: the begin PATCH/POST is followed by a persisted readback of exactly the rendered body
        publish = run.index("gh api --method PATCH")
        readback = run.index('"$P" verify --previous "$RUNNER_TEMP/body.md" --comments "$RUNNER_TEMP/begin-readback.json"')
        self.assertLess(publish, readback)
        self.assertLess(run.index('id="$(gh api --method POST'), readback)
        self.assertLess(readback, run.index('echo "comment_id=$id" >> "$GITHUB_OUTPUT"'))
        self.assertIn('gh api "repos/$GITHUB_REPOSITORY/issues/comments/$id" --jq \'[.]\' > "$RUNNER_TEMP/begin-readback.json"', run)
        self.assertIn("NOT compare-and-swap", run)
        for job in ("journal-reserve", "journal-settle", "live", "record-complete"):
            self.assertNotIn("scripts/settled_attempt_evidence", json.dumps(self.jobs[job]), job)
            self.assertNotIn("retire-settled", json.dumps(self.jobs[job]), job)

    def test_journal_reserve_settles_before_it_reserves_in_its_one_writer_step_for_a_manual_dispatch_with_retired_evidence_only(self):
        run = writers_of(self.jobs, "journal-reserve")
        writer = next(s for s in self.jobs["journal-reserve"]["steps"] if "CT_STATE_PUSH_TOKEN" in (s.get("env") or {}))
        self.assertEqual(sum(1 for s in self.jobs["journal-reserve"]["steps"] if "CT_STATE_PUSH_TOKEN" in (s.get("env") or {})), 1)
        self.assertEqual(writer["env"]["UNEXECUTED_EVIDENCE_SHA256"], "${{ needs.record-begin.outputs.unexecuted_evidence_sha256 }}")
        self.assertEqual(writer["env"]["UNEXECUTED_EVIDENCE_B64"], "${{ needs.record-begin.outputs.unexecuted_evidence_b64 }}")
        settle, reserve = run.index("manual_reservation.py settle-unexecuted"), run.index("manual_reservation.py reserve")
        self.assertLess(settle, reserve)
        self.assertLess(run.index('if [ "$GITHUB_EVENT_NAME" != schedule ]; then'), settle, "inside the manual branch, never reached by a schedule")
        guard = run[run.rindex("if [", 0, settle):settle]
        self.assertIn('[ -n "$UNEXECUTED_EVIDENCE_SHA256" ]', guard)
        self.assertIn('--unexecuted-sha256 "$UNEXECUTED_EVIDENCE_SHA256"', run)
        self.assertIn("--scope tools/cloud-test/config/aggregate/period-scope.json", run[settle:reserve])
        self.assertIn('base64 -d > "$RUNNER_TEMP/unexecuted-evidence.json"', run[:settle + 200])

    def test_no_job_gains_a_permission_and_the_live_job_is_untouched(self):
        self.assertEqual(self.jobs["record-begin"]["permissions"], {"issues": "write", "pull-requests": "write", "actions": "read"})
        self.assertEqual(self.jobs["journal-reserve"]["permissions"], {"contents": "write"})
        self.assertEqual([n for n, j in self.jobs.items() if (j.get("permissions") or {}).get("contents") == "write"], ["journal-reserve", "journal-settle"])
        live = json.dumps(self.jobs["live"])
        for needle in ("unexecuted", "settle-unexecuted", "retire-unexecuted"):
            self.assertNotIn(needle, live)
        self.assertNotIn("unexecuted_evidence", json.dumps(self.jobs["record-complete"]))


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


class TimingStepExecution(unittest.TestCase):
    """Sam 1793931423.224679: execute the ACTUAL `run:` text of the timing step, with the environment the job would give it."""

    def setUp(self):
        import yaml  # noqa: PLC0415 - the policy tests already require it
        with open(YML, encoding="utf-8") as f:
            steps = yaml.safe_load(f)["jobs"]["live"]["steps"]
        self.step = next(s for s in steps if s.get("name") == "Project content-free per-case timing telemetry")
        self.d = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(__import__("shutil").rmtree, self.d)

    def run_step(self, **env):
        base = {"PATH": os.environ["PATH"], "RUNNER_TEMP": self.d, "GITHUB_RUN_ID": "42142985744", "GITHUB_RUN_ATTEMPT": "1",
                "GITHUB_SHA": "7" * 40, "GITHUB_EVENT_NAME": "workflow_dispatch", "WORKFLOW_START_UTC": "2026-11-06T01:18:48Z",
                "MANUAL_REQUEST": "tools/cloud-test/config/runs/R10-3b040043-all15.json", "CASES": "", "NIGHTLY_REQUEST_B64": ""}
        base.update(env)
        r = subprocess.run(["bash", "-c", self.step["run"]], cwd=REPO, env=base, capture_output=True, text=True)
        out = os.path.join(self.d, "case-timings.json")
        return r, (json.load(open(out, encoding="utf-8")) if os.path.exists(out) else None)

    def test_a_failure_before_init_still_yields_every_case_from_the_committed_request(self):
        # proof, preflight or init failed: no CASES, no CT_REQUEST, CT_OUT never created
        r, doc = self.run_step()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(doc["outcome"], "not-started")
        self.assertEqual({c["result"] for c in doc["cases"]}, {"NOT RUN"})
        self.assertEqual(len(doc["cases"]), 15)
        self.assertEqual(doc["binding"], {"runId": "42142985744", "runAttempt": 1, "headSha": "7" * 40})

    def test_started_without_results_is_unknown_through_the_actual_step(self):
        out = os.path.join(self.d, "ct-out"); os.makedirs(out)
        with open(os.path.join(out, "started.txt"), "w", encoding="utf-8") as f:
            f.write("2026-11-06T01:30:00Z\n")
        r, doc = self.run_step(CT_OUT=out, CASES="AHT-01,AHT-15")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(doc["outcome"], "started-without-results")
        by = {c["caseId"]: c["result"] for c in doc["cases"]}
        self.assertEqual((by["AHT-01"], by["AHT-15"], by["AHT-02"]), ("UNKNOWN", "UNKNOWN", "NOT SELECTED"))

    def test_a_scheduled_run_without_init_takes_the_selection_from_its_admitted_nightly_request(self):
        import base64  # noqa: PLC0415
        req = {"selection": [{"case": "AHT-03"}, {"case": "AHT-09"}]}
        r, doc = self.run_step(GITHUB_EVENT_NAME="schedule", MANUAL_REQUEST="",
                               NIGHTLY_REQUEST_B64=base64.b64encode(json.dumps(req).encode()).decode(), WORKFLOW_START_UTC="")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(doc["selectedCases"], ["AHT-03", "AHT-09"])
        self.assertEqual(sum(c["result"] == "NOT RUN" for c in doc["cases"]), 2)
