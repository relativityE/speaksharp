"""Request → environment → actual builder → actual assertion catalog, all synthetic.
No browser/product/account/provider traffic; missing stimulus still refuses execution.
"""
import copy
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest
import shutil

from _fixtures import ROOT, REPO, J, sample, fake_rv
import validate_run_request as validator
from test_case_start_caps import synthetic_allocation, synthetic_reconciliation, bind_synthetic_files


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
        request_file, output = root / "request.json", root / "env.txt"
        request_file.write_text(json.dumps(request))
        rc = root / "reconciliation.json"; rc.write_text(json.dumps(synthetic_reconciliation()))
        result = subprocess.run([sys.executable, "-I", str(Path(ROOT) / "scripts/run_env.py"), "--request", str(request_file), "--reconciliation", str(rc), "--out", str(output)],
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

    def stage(self, request, stage, extra=None, capture=False, mislabel_reservation=False):
        temporary = tempfile.TemporaryDirectory(prefix="selected-stage-")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        output = root / "out"
        output.mkdir(mode=0o700)
        req, facts, uid = root / "request.json", root / "facts.json", root / "account.txt"
        req.write_text(json.dumps(request)); req.chmod(0o600)
        facts.write_text(json.dumps(J("tests", "fixtures", "plan-facts.PLACEHOLDER.json"))); facts.chmod(0o600)
        bindings = bind_synthetic_files(root, request)
        (output / "reconciliation.json").write_bytes(Path(bindings["BP_RECONCILIATION_FILE"]).read_bytes())
        uid.write_text("00000000-0000-4000-8000-000000000001"); uid.chmod(0o600)
        env = {"PATH": os.environ["PATH"], "HOME": str(root), "CT_CONFIG": str(Path(ROOT) / "config/test-config.v1.json"),
               "CT_OUT": str(output), "CT_REQUEST": str(req), "CT_CHECKOUT": REPO, "CT_FACTS_FILE": str(facts),
               "CT_ACCOUNT_ID_FILE": str(uid), "VITE_SUPABASE_ANON_KEY": "SYNTHETIC-PUBLISHABLE",
               "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "relativityE/speaksharp", "GITHUB_RUN_ID": "123",
               "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "live", "GITHUB_SHA": "b" * 40,
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
                            "open(" + repr(str(record)) + ",'w').write(json.dumps({'args':sys.argv[1:],'names':sorted(os.environ)}))\n")
            shim.chmod(0o700)
            python_shim = binary / "python3"
            python_shim.write_text("#!" + sys.executable + "\nimport os,sys,json\n"
                                  "kind='reservation' if any(a.endswith('/scripts/reservations.py') for a in sys.argv[1:]) else 'helper'\n"
                                  "with open(" + repr(str(root / "python-env.jsonl")) + ",'a') as out:out.write(json.dumps({'kind':kind,'names':sorted(os.environ)})+'\\n')\n"
                                  "if kind=='reservation':sys.exit(0)\n"
                                  "os.execv(" + repr(sys.executable) + ",[" + repr(sys.executable) + "]+sys.argv[1:])\n")
            python_shim.chmod(0o700)
            env["PATH"] = str(binary) + os.pathsep + env["PATH"]
            (output / "plan/cfg").mkdir(parents=True, mode=0o700)
            (output / "plan/cfg/campaign-plan.json").write_text("{}")
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
