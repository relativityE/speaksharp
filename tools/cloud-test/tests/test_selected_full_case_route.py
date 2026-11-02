"""Request → environment → actual builder → actual assertion catalog, all synthetic.
No browser/product/account/provider traffic; missing stimulus still refuses execution.
"""
import copy
import datetime
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest
import shutil
import hashlib

from _fixtures import ROOT, REPO, J, sample, fake_rv, approved
import validate_run_request as validator
from test_case_start_caps import synthetic_allocation, synthetic_reconciliation


class SelectedFullCaseRoute(unittest.TestCase):
    def request(self):
        base = sample()
        request = copy.deepcopy(base["req"])
        request.update({"coverageMode": "partial", "sampleMode": "full", "executionRuntime": "GitHub Actions SpeakSharp", "priority": "restore-missing-evidence",
                        "targetedGaps": ["GAP-06"], "purpose": "SYNTHETIC full-depth cold-model Case04 and paired failure/recovery checks; not a live run"})
        request["release"]["testedSha"] = J("harness", "draft-adapters", "SOURCE.sha256.json")["sourceSha"]
        request["selection"] = [{"order": index + 1, "case": "AHT-%02d" % case, "gaps": ["GAP-06"], "role": "target",
                                 "needsCaptureDevice": True, "plannedRequests": requests, "gate": None,
                                 "reason": "SYNTHETIC full-case recovery assertions, no live authorization"}
                                for index, (case, requests) in enumerate(((4, 160), (13, 130), (14, 360)))]
        request["estimate"].update({"requests": {"planned": 650, "cleanupReserve": 50, "pooledSlack": 0, "runCap": 700},
                                    "identityReads": 8, "starts": 6, "takes": 3,
                                    "providerBillableRequests": {"coachingCap": 3, "basis": "SYNTHETIC upper bound, not actual provider cost"}})
        request["proposedLimits"].update({"runCapRequests": 700, "cumulativeCeilingRequests": 9000, "identityCap": 98,
                                         "startsCap": 100, "takesCap": 100, "paidActionsUsd": 0, "guardCaps": {"coaching": 3}})
        request["approvedLimits"] = {"cumulativeCeilingRequests": 9000, "identityCap": 98, "runCapRequests": 700,
                                     "startsCap": 100, "takesCap": 100, "approvalRef": "SYNTHETIC-NOT-AUTHORIZATION", "approvedBy": "UNIT-FIXTURE"}
        request["window"] = {"startUtc": "2026-10-30T00:00:00Z", "endUtc": "2099-01-01T00:00:00Z", "approvalRef": "SYNTHETIC-NOT-AUTHORIZATION"}
        request["selectionApprovalRef"] = "SYNTHETIC-NOT-AUTHORIZATION"
        synthetic_allocation(request)
        return base, request

    def environment(self, request):
        temporary = tempfile.TemporaryDirectory(prefix="selected-full-env-")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        request_file, reconciliation_file, output = root / "request.json", root / "reconciliation.json", root / "env.txt"
        request_file.write_text(json.dumps(request))
        reconciliation_file.write_text(json.dumps(synthetic_reconciliation()))
        request_sha = hashlib.sha256(request_file.read_bytes()).hexdigest()
        result = subprocess.run([sys.executable, "-I", str(Path(ROOT) / "scripts/run_env.py"), "--request", str(request_file),
                                 "--request-sha256", request_sha, "--reconciliation", str(reconciliation_file), "--out", str(output)],
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        values = {}
        for line in output.read_text().splitlines():
            name, value = line.split("=", 1)
            tokens = shlex.split(value)
            values[name] = tokens[0] if tokens else ""
        return values

    def plan(self):
        _, request = self.request()
        env = self.environment(request)
        self.assertEqual(env["BP_MODE"], "selected-full")
        directory, result, _ = self.stage(request, "build-plan")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return directory, json.loads((directory / "cfg/campaign-plan.json").read_text())

    def stage(self, request, stage, extra=None, capture=False, mislabel_reservation=False, substitute_plan=False,
              shared_root=None, campaign_exit=0, request_raw=None, config_path=None, reconciliation_value=None,
              reconciliation_raw=None):
        if shared_root is None:
            temporary = tempfile.TemporaryDirectory(prefix="selected-stage-")
            self.addCleanup(temporary.cleanup)
            root = Path(temporary.name).resolve()
        else:
            root = Path(shared_root).resolve()
        output = root / "out"
        output.mkdir(mode=0o700, exist_ok=True)
        req, facts, accounts = root / "request.json", root / "facts.json", root / "live-accounts.json"
        req.write_bytes(request_raw if request_raw is not None else json.dumps(request).encode()); req.chmod(0o600)
        reconciliation = output / "reconciliation.json"
        if reconciliation_raw is not None:
            reconciliation.write_bytes(reconciliation_raw)
        else:
            reconciliation.write_text(json.dumps(reconciliation_value if reconciliation_value is not None else synthetic_reconciliation()))
        facts_value = J("tests", "fixtures", "plan-facts.PLACEHOLDER.json")
        request_sha = hashlib.sha256(req.read_bytes()).hexdigest()
        reconciliation_sha = hashlib.sha256(reconciliation.read_bytes()).hexdigest()
        facts_value["actionApproval"] = {"schema": "speaksharp.case-start-approval.v1",
            "requestSha256": request_sha, "reconciliationSha256": reconciliation_sha,
            "approvalRef": request["approvedLimits"]["approvalRef"],
            "approvedBy": request["approvedLimits"]["approvedBy"],
            "selectionApprovalRef": request["selectionApprovalRef"]}
        facts.write_text(json.dumps(facts_value)); facts.chmod(0o600)
        project_ref = "yxlapjuovrsvjswkwnrk"
        accounts.write_text(json.dumps({"version": 1, "projectRef": project_ref, "accounts": {
            "existing-disposable": {"accountId": "00000000-0000-4000-8000-000000000001", "email": "unit@example.invalid"},
            "maintained-read-only": {"accountId": "00000000-0000-4000-8000-000000000002", "email": "maintained@example.invalid"}}}, sort_keys=True, separators=(",", ":")) + "\n")
        accounts.chmod(0o600)
        (root / "run-inputs").mkdir(mode=0o700, exist_ok=True)
        browser = root / "synthetic-browser"
        browser.write_bytes(b"synthetic browser identity; never executed\n")
        browser_identity = output / "browser-identity.json"
        browser_identity.write_text(json.dumps({"schema": "speaksharp.cloud-test.existing-browser.v1",
                                                "path": str(browser.resolve()),
                                                "observedBinarySha256": hashlib.sha256(browser.read_bytes()).hexdigest()}))
        env = {"PATH": os.environ["PATH"], "HOME": str(root), "CT_CONFIG": str(config_path or (Path(ROOT) / "config/test-config.v1.json")),
               "CT_OUT": str(output), "CT_REQUEST": str(req), "CT_REQUEST_SHA256": request_sha, "CT_CHECKOUT": REPO, "CT_FACTS_FILE": str(facts),
               "CT_LIVE_ACCOUNTS_FILE": str(accounts), "CT_LIVE_ACCOUNTS_SHA256": hashlib.sha256(accounts.read_bytes()).hexdigest(),
               "CT_PRIVATE_INPUT_DIR": str(root / "run-inputs"), "BP_BROWSER_IDENTITY": str(browser_identity),
               "VITE_SUPABASE_ANON_KEY": "SYNTHETIC-PUBLISHABLE",
               "VITE_SUPABASE_URL": "https://" + project_ref + ".supabase.co",
               "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "relativityE/speaksharp", "GITHUB_RUN_ID": "123",
               "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "live", "GITHUB_SHA": "b" * 40,
               "FREE_TEST_EMAIL": "maintained@example.invalid", "FREE_TEST_PASSWORD": "SYNTHETIC-FREE-PASSWORD",
               "THROWAWAY_TEST_EMAIL": "unit@example.invalid", "THROWAWAY_TEST_PASSWORD": "SYNTHETIC-PASSWORD"}
        record = root / "invocation.json"
        if capture:
            # An inert transport fixture records the selected command/environment NAMES.
            # It never executes admission, a campaign, a broker, browser or product request.
            binary = root / "bin"; binary.mkdir()
            real_node = shutil.which("node")
            shim = binary / "node"
            shim.write_text("#!" + sys.executable + "\nimport os,sys,json\n"
                            "if len(sys.argv)>1 and sys.argv[1]=='-e':\n"
                            " open(" + repr(str(record.with_name("identity-env.json"))) + ",'w').write(json.dumps(sorted(os.environ)))\n"
                            " os.execv(" + repr(real_node) + ",[" + repr(real_node) + "]+sys.argv[1:])\n"
                            "open(" + repr(str(record)) + ",'w').write(json.dumps({'args':sys.argv[1:],'names':sorted(os.environ)}))\n"
                            "sys.exit(" + repr(campaign_exit) + ")\n")
            shim.chmod(0o700)
            python_shim = binary / "python3"
            python_shim.write_text("#!" + sys.executable + "\nimport os,sys,json\n"
                                  "kind='reservation' if any(a.endswith('/scripts/reservations.py') for a in sys.argv[1:]) else 'helper'\n"
                                  "with open(" + repr(str(root / "python-env.jsonl")) + ",'a') as out:out.write(json.dumps({'kind':kind,'names':sorted(os.environ)})+'\\n')\n"
                                  "if kind=='reservation':sys.exit(0)\n"
                                  "os.execv(" + repr(sys.executable) + ",[" + repr(sys.executable) + "]+sys.argv[1:])\n")
            python_shim.chmod(0o700)
            env["PATH"] = str(binary) + os.pathsep + env["PATH"]
            (output / "plan/cfg").mkdir(parents=True, mode=0o700, exist_ok=True)
            plan_file = output / "plan/cfg/campaign-plan.json"
            if not plan_file.exists():
                plan_file.write_text("{}")
            consumption = output / "plan/cfg/build-plan-consumption.json"
            if not consumption.exists():
                consumption.write_text(json.dumps({"planSha256": hashlib.sha256(plan_file.read_bytes()).hexdigest()}))
            if substitute_plan:
                plan_file.write_text('{"substituted":true}')
            (output / "plan/producer-scope.json").write_text("{}")
            if request.get("priority") == "nightly-regression":
                for name in ("CT_HISTORY_INDEX", "CT_COUNTERS", "CT_GAP_LEDGER", "CT_RECEIPTS_ROOT", "CT_RESERVATIONS", "CT_APPROVAL"):
                    target = root / (name + ".json")
                    target.write_text("{}")
                    env[name] = str(target)
        env.update(extra or {})
        executable = Path(ROOT) / "scripts/execute_run.sh"
        if mislabel_reservation:
            # Deliberately recreate the caller mistake in an isolated script copy.
            # The generic stage=run transport must STILL keep broker keys out.
            body = executable.read_text()
            needle = 'run_stage reserve python3 -I "$ROOT/scripts/reservations.py" require'
            self.assertEqual(body.count(needle), 1)
            body = body.replace(needle, needle.replace("run_stage reserve", "run_stage run"))
            lines = body.splitlines(True)
            self.assertEqual(sum(line.startswith("ROOT=") for line in lines), 1)
            body = "".join("ROOT=" + shlex.quote(ROOT) + "\n" if line.startswith("ROOT=") else line for line in lines)
            executable = root / "isolated-caller.sh"
            executable.write_text(body)
        result = subprocess.run(["bash", str(executable), stage], env=env, capture_output=True, text=True, timeout=30)
        return output / ("plan0" if stage == "build-plan" else "plan"), result, record

    def catalog(self, directory, selected=True):
        return subprocess.run(["node", str(Path(ROOT) / "tests/node/plan-acceptance.cjs"), str(Path(ROOT) / "harness"),
                               str(directory / "cfg/campaign-plan.json"), str(Path(ROOT) / "config/assertion-catalog.json")]
                              + (["--selected-full"] if selected else []), cwd=REPO, capture_output=True, text=True, timeout=30)

    def test_request_validator_keeps_partial_scope_while_allowing_full_case_depth(self):
        base, request = self.request()
        cumulative = {"ceilings": {"requests": 10000, "protectedReserveRequests": 100, "identityReads": 100,
                                    "starts": 100, "takes": 100}, "starts": {"ownerCounted": 0}, "takes": {"ownerCounted": 0},
                      "requests": {"conservativeUsed": 0}, "identityReads": {"conservativeUsed": 0}}
        errors, _ = validator.validate(request, base["cfg"], base["ledger"], base["wf"], fake_rv(), cumulative)
        self.assertEqual(errors, [])

    def test_request_to_real_builder_preserves_full_case04_and_catalog_but_is_not_all15(self):
        directory, plan = self.plan()
        self.assertEqual((plan["coverageMode"], plan["assertionDepth"]), ("partial", "full"))
        self.assertEqual([c["id"] for c in plan["cases"]], ["AHT-%02d" % n for n in range(1, 16)])
        self.assertEqual(plan["selection"]["ids"], ["AHT-04", "AHT-13", "AHT-14"])
        self.assertEqual(plan["requestBudget"]["estimates"]["AHT-01"], 0)
        result = self.catalog(directory)
        facts = json.loads(result.stdout)
        for name in ("campaign plan structure", "request budget binding", "run identity"):
            self.assertEqual(facts[name], "ACCEPTED")
        self.assertEqual(facts["assertion catalog and failure caps"], "ACCEPTED")
        self.assertEqual(facts["every selected case preflight"], "ACCEPTED")
        self.assertTrue(facts["stimulus preflight receipt"].startswith("REFUSED:"))
        self.assertNotEqual(result.returncode, 0)  # source preparation is not execution admission
        entire_campaign = json.loads(self.catalog(directory, selected=False).stdout)
        self.assertIn("does not select every catalog journey", entire_campaign["assertion catalog and failure caps"])

    def test_missing_case04_recovery_assertion_cannot_pass_catalog(self):
        directory, plan = self.plan()
        config = Path(next(c for c in plan["cases"] if c["id"] == "AHT-04")["configFile"])
        value = json.loads(config.read_text())
        value["requiredAssertions"].remove("deliberate-recovery-saved")
        config.write_text(json.dumps(value))
        facts = json.loads(self.catalog(directory).stdout)
        self.assertIn("requiredAssertions differ", facts["assertion catalog and failure caps"])

    def test_lowered_case04_take_or_start_cap_cannot_pass_catalog(self):
        for key, value in (("takeCap", 0), ("startPressCap", 1)):
            with self.subTest(key=key):
                directory, plan = self.plan()
                config = Path(next(c for c in plan["cases"] if c["id"] == "AHT-04")["configFile"])
                data = json.loads(config.read_text())
                data[key] = value
                config.write_text(json.dumps(data))
                facts = json.loads(self.catalog(directory).stdout)
                self.assertIn("below the minimum", facts["assertion catalog and failure caps"])

    def test_evidence_free_preparation_rejects_privileged_environment(self):
        _, request = self.request()
        directory, result, _ = self.stage(request, "build-plan", {"SUPABASE_SERVICE_ROLE_KEY": "SYNTHETIC-ROLE"})
        self.assertEqual(result.returncode, 78)
        self.assertIn("service role belongs only", result.stderr)
        self.assertFalse((directory / "cfg/campaign-plan.json").exists())
        self.assertNotIn("SYNTHETIC-ROLE", result.stdout + result.stderr)

    def test_actual_job_identity_is_required_before_any_preparation(self):
        _, request = self.request()
        directory, result, _ = self.stage(request, "build-plan", {"GITHUB_ACTIONS": "false"})
        self.assertEqual(result.returncode, 78)
        self.assertIn("actual GitHub job identity required", result.stderr)
        self.assertFalse((directory / "cfg/campaign-plan.json").exists())

    def test_preexisting_account_bindings_are_refused_before_plan_build(self):
        _, request = self.request()
        with tempfile.TemporaryDirectory(prefix="prebuilt-bindings-") as directory:
            prebuilt = Path(directory).resolve() / "account-bindings.json"
            prebuilt.write_text('{"synthetic":"must-not-be-trusted"}')
            prebuilt.chmod(0o600)
            plan, result, _ = self.stage(request, "build-plan", {"CT_ACCOUNT_BINDINGS_FILE": str(prebuilt)})
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("prebuilt or replayed bindings are refused", result.stderr)
        self.assertFalse((plan / "cfg/campaign-plan.json").exists())

    def test_sequential_plan_builds_use_exclusive_bindings_from_the_same_bundle(self):
        _, request = self.request()
        with tempfile.TemporaryDirectory(prefix="sequential-plan-builds-") as directory:
            root = Path(directory).resolve()
            plan0, first, _ = self.stage(request, "build-plan", shared_root=root)
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            (root / "out/stimulus-preflight-receipt.json").write_text('{"synthetic":"NOT-A-RUN"}\n')
            plan, second, _ = self.stage(request, "build-plan-with-receipt", shared_root=root)
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            bindings = sorted((root / "run-inputs").glob("account-bindings.*.json"))
            self.assertEqual([path.name for path in bindings], [
                "account-bindings.build-plan-with-receipt.json",
                "account-bindings.build-plan.json",
            ])
            self.assertEqual(json.loads(bindings[0].read_text()), json.loads(bindings[1].read_text()))
            self.assertTrue((plan0 / "cfg/campaign-plan.json").is_file())
            self.assertTrue((plan / "cfg/campaign-plan.json").is_file())

    def test_run_stage_chooses_fixed_broker_only_for_evidence_cases_and_never_other_secrets(self):
        for producer in (False, True):
            with self.subTest(producer=producer):
                _, request = self.request()
                if producer:
                    request["selection"] = [{"case": "AHT-07"}]  # command-transport fixture, not a valid admission request
                extras = {"POSTHOG_PERSONAL_API_KEY": "SYNTHETIC-TELEMETRY", "UNKNOWN_SECRET": "SYNTHETIC-UNKNOWN"}
                if producer:
                    extras.update({"SUPABASE_URL": "https://yxlapjuovrsvjswkwnrk.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "SYNTHETIC-ROLE"})
                _, result, record = self.stage(request, "run", extras, capture=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                invocation = json.loads(record.read_text())
                self.assertTrue(invocation["args"][0].endswith("/with-authenticated-evidence.cjs" if producer else "/campaign-runner.cjs"))
                self.assertEqual("SUPABASE_SERVICE_ROLE_KEY" in invocation["names"], producer)
                self.assertEqual("POSTHOG_PERSONAL_API_KEY" in invocation["names"], producer)
                self.assertNotIn("UNKNOWN_SECRET", invocation["names"])
                self.assertIn("GITHUB_JOB", invocation["names"])
                self.assertNotIn("SYNTHETIC-ROLE", record.read_text())
                identity_names = json.loads(record.with_name("identity-env.json").read_text())
                for name in ("SUPABASE_SERVICE_ROLE_KEY", "POSTHOG_PERSONAL_API_KEY", "THROWAWAY_TEST_PASSWORD", "UNKNOWN_SECRET"):
                    self.assertNotIn(name, identity_names)

    def test_run_refuses_a_plan_substituted_after_build_without_starting_the_campaign_child(self):
        _, request = self.request()
        _, refused, record = self.stage(request, "run", capture=True, substitute_plan=True)
        self.assertEqual(refused.returncode, 78, refused.stdout + refused.stderr)
        self.assertIn("campaign plan changed after the build-time identity was retained", refused.stderr)
        self.assertFalse(record.exists(), "the campaign child must not start after plan substitution")

    def test_nightly_prelude_and_all_python_children_never_receive_broker_keys_even_if_mislabeled(self):
        for mislabeled in (False, True):
            with self.subTest(mislabeled=mislabeled):
                _, request = self.request()
                request["priority"] = "nightly-regression"
                request["selection"] = [{"case": "AHT-07"}]
                _, result, record = self.stage(request, "run", {
                    "SUPABASE_URL": "https://yxlapjuovrsvjswkwnrk.supabase.co",
                    "SUPABASE_SERVICE_ROLE_KEY": "SYNTHETIC-ROLE", "POSTHOG_PERSONAL_API_KEY": "SYNTHETIC-TELEMETRY"},
                    capture=True, mislabel_reservation=mislabeled)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                children = [json.loads(line) for line in record.with_name("python-env.jsonl").read_text().splitlines()]
                reservations = [child for child in children if child["kind"] == "reservation"]
                self.assertEqual(len(reservations), 1)
                for child in children:
                    self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", child["names"])
                    self.assertNotIn("POSTHOG_PERSONAL_API_KEY", child["names"])
                if not mislabeled:
                    self.assertNotIn("THROWAWAY_TEST_PASSWORD", reservations[0]["names"])
                parent = json.loads(record.read_text())
                self.assertTrue(parent["args"][0].endswith("/with-authenticated-evidence.cjs"))
                self.assertIn("SUPABASE_SERVICE_ROLE_KEY", parent["names"])
                self.assertIn("POSTHOG_PERSONAL_API_KEY", parent["names"])

    def test_composed_offline_route_builds_twice_selects_the_evidence_role_and_keeps_a_late_failure_reserved(self):
        """One composed control over the real stage dispatcher and manual ledger.

        It proves both build boundaries, the selected authenticated producer,
        and the fail-closed accounting result when execution fails after the
        reservation.  All transports are inert local shims.
        """
        from test_aggregate_receiver import AggregateReceiver
        from test_manual_reservation import ManualReservation, RUN

        receiver = AggregateReceiver("test_exact_pinned_bundle_reaches_the_actual_gate_consumers")
        receiver.setUp()
        ledger = ManualReservation("test_the_cli_refuses_while_the_writer_is_not_activated")
        ledger.setUp()
        fixture, request = self.request()
        _, ledger_doc = approved(copy.deepcopy(request), fixture["ledger"])
        now = datetime.datetime.now(datetime.timezone.utc)
        request["window"] = {
            "startUtc": (now - datetime.timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endUtc": (now + datetime.timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "approvalRef": "SYNTHETIC-NOT-AUTHORIZATION",
        }
        request["harness"]["ownerApprovalRef"] = "SYNTHETIC-NOT-AUTHORIZATION"
        request["ownerInputs"]["prDocsCloseout"] = {"status": "closed", "evidence": "SYNTHETIC-NOT-A-RUN"}
        request["expectedPassConfirmedByOwner"] = True
        request["proposedLimits"].update({
            "cumulativeCeilingRequests": 6901,
            "identityCap": 102,
            "startsCap": 50,
            "takesCap": 40,
            "ceilingIncreaseJustification": "SYNTHETIC TEST ONLY: exercise the admitted composed route; no live approval",
            "identityIncreaseJustification": "SYNTHETIC TEST ONLY: exercise the admitted composed route; no live approval",
        })
        request["approvedLimits"].update({
            "cumulativeCeilingRequests": 6901,
            "identityCap": 102,
            "startsCap": 50,
            "takesCap": 40,
        })
        receiver.request = request
        receiver.docs["reconciliation"].update(
            scopeApprovalRef=request["approvedLimits"]["approvalRef"])
        receiver.docs["release-verification"]["testedSha"] = request["release"]["testedSha"]
        receiver.docs["gap-ledger"] = ledger_doc
        receiver.request_raw = json.dumps(request, sort_keys=True).encode()
        receiver.manifest_raw, receiver.pins = receiver.rewrite_bundle(receiver.docs)
        receiver.manifest = json.loads(receiver.manifest_raw)
        receiver.manifest.update({"requestSha256": hashlib.sha256(receiver.request_raw).hexdigest(),
                                  "runId": request["runId"], "sourceSha": request["release"]["testedSha"],
                                  "workflowVersion": request["workflowVersion"],
                                  "codeManifestSha256": request["harness"]["codeManifestSha256"]})
        receiver.manifest_raw = json.dumps(receiver.manifest, sort_keys=True).encode()
        receiver.pins["manifestSha256"] = hashlib.sha256(receiver.manifest_raw).hexdigest()
        receiver.config["aggregateReceiver"] = dict(receiver.pins)
        request_raw = receiver.request_raw
        ledger.req = request_raw
        ledger.sha = hashlib.sha256(request_raw).hexdigest()
        config_path = receiver.root / "active-config.json"
        config_path.write_text(json.dumps(receiver.config))
        manifest_path = receiver.root / "manifest.json"
        manifest_path.write_bytes(receiver.manifest_raw)
        try:
            with tempfile.TemporaryDirectory(prefix="composed-selected-route-") as directory:
                root = Path(directory).resolve()
                common = {"shared_root": root, "request_raw": request_raw, "config_path": config_path,
                          "reconciliation_raw": (receiver.root / "reconciliation.json").read_bytes()}
                plan0, first, _ = self.stage(request, "build-plan", {"GITHUB_RUN_ID": RUN}, **common)
                self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
                initial_plan = json.loads((plan0 / "cfg/campaign-plan.json").read_text())
                created = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                browser = root / "synthetic-browser"
                selected_cases = {row["id"]: row for row in initial_plan["cases"]}
                stimulus = {
                    "schema": "speaksharp.stimulus-preflight.v1",
                    "createdAt": created,
                    "productTraffic": 0,
                    "codeManifestSha256": request["harness"]["codeManifestSha256"],
                    "chrome": {
                        "executablePath": str(browser.resolve()),
                        "sha256": hashlib.sha256(browser.read_bytes()).hexdigest(),
                    },
                    "cases": {
                        row["case"]: {
                            "mediaSha256": selected_cases[row["case"]]["mediaSha256"],
                            "captureGranted": True,
                            "ungrantedOutcome": "not-allowed",
                            "noDeviceOutcome": "not-found",
                            "speechDetected": True,
                            "alignment": {"status": "not-applicable"},
                            "ready": True,
                        }
                        for row in request["selection"] if row.get("needsCaptureDevice")
                    },
                }
                (root / "out/stimulus-preflight-receipt.json").write_text(json.dumps(stimulus))
                plan, second, _ = self.stage(request, "build-plan-with-receipt", {"GITHUB_RUN_ID": RUN}, **common)
                self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
                self.assertTrue((plan0 / "cfg/build-plan-consumption.json").is_file())
                self.assertTrue((plan / "cfg/build-plan-consumption.json").is_file())
                built_plan = json.loads((plan / "cfg/campaign-plan.json").read_text())
                consumption = json.loads((plan / "cfg/build-plan-consumption.json").read_text())
                self.assertEqual(built_plan["campaignId"], request["runId"])
                self.assertEqual(consumption["planSha256"], hashlib.sha256((plan / "cfg/campaign-plan.json").read_bytes()).hexdigest())

                checks = root / "offline-checks.json"; checks.write_text('{"passed":true}\n')
                proof = root / "offline-proof.json"
                proof.write_text(json.dumps({"codeManifestSha256": request["harness"]["codeManifestSha256"],
                                             "corrections": [{"id": "SYNTHETIC", "result": "PASS"}]}))
                runtime = {}
                for name in ("CT_HISTORY_INDEX", "CT_COUNTERS", "CT_RECEIPTS_ROOT", "CT_RESERVATIONS"):
                    target = root / (name + ".json"); target.write_text("{}\n"); runtime[name] = str(target)
                runtime.update({"GITHUB_RUN_ID": RUN, "CT_GAP_LEDGER": str(receiver.root / "gap-ledger.json"),
                                "CT_RETAINED_GATE_MANIFEST": str(manifest_path),
                                "CT_OFFLINE_CHECKS": str(checks), "CT_OFFLINE_PROOF": str(proof)})
                _, gated, _ = self.stage(request, "gate-and-validate", runtime, **common)
                self.assertEqual(gated.returncode, 0, gated.stdout + gated.stderr)
                gates = json.loads((root / "out/final-gates/gate-status.json").read_text())
                self.assertEqual((gates["decision"], next(g["status"] for g in gates["gates"] if g["id"] == "G7")),
                                 ("GO", "READY"))

                reservation = ledger.execute("reserve", ledger.reserve_inputs(), "composed-reserve")
                self.assertEqual((reservation["campaignId"], reservation["runId"], reservation["provenance"]),
                                 (request["runId"], RUN, "request-sha256:" + hashlib.sha256(request_raw).hexdigest()))
                self.assertEqual(ledger.receive()["outstandingReservations"], 1)
                _, failed, record = self.stage(request, "run", {"GITHUB_RUN_ID": RUN}, capture=True,
                                                campaign_exit=23, **common)
                self.assertEqual(failed.returncode, 23, failed.stdout + failed.stderr)
                invocation = json.loads(record.read_text())
                self.assertTrue(invocation["args"][0].endswith("/campaign-runner.cjs"))
                self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", invocation["names"])
                self.assertTrue((root / "out/started.txt").is_file())
                self.assertEqual(ledger.receive()["outstandingReservations"], 1,
                                 "a late campaign failure must not settle or release the reservation")
                self.assertEqual([event["type"] for event in ledger.chain()[-1][1]], ["reserve"])
        finally:
            ledger.doCleanups()
            receiver.doCleanups()
