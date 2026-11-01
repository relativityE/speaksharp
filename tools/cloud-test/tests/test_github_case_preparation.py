"""Real builder, synthetic scope only: GitHub does not imply privileged evidence.
No browser, login, account, product traffic or authoritative runtime receipt.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import datetime
import hashlib

from _fixtures import ROOT, J, wjson
from test_case_start_caps import SyntheticBuilder


class IndependentGithubCasePreparation(unittest.TestCase):
    def build(self, case, actual_job=True, bootstrap=False, extra_env=None):
        temporary = tempfile.TemporaryDirectory(prefix="gh-case-prep-")
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name).resolve()
        facts_value = J("tests", "fixtures", "plan-facts.PLACEHOLDER.json")
        facts_value["producerReviewReference"] = "UNIT-INDEPENDENT-REVIEW-NOT-A-RUN"
        builder = SyntheticBuilder(base, cases=(case,))
        builder.request["executionRuntime"] = "GitHub Actions SpeakSharp"
        builder.repin(facts=facts_value)
        uid = base / "account.txt"
        uid.write_text("00000000-0000-4000-8000-000000000001")
        output = Path(builder.env["BP_PRIVATE"])
        env = builder.env
        env.update({
            "BP_ACCOUNT_ID_FILE": str(uid),
            "BP_HOST_DB": "yxlapjuovrsvjswkwnrk.supabase.co",
            "BP_RUNTIME": "GitHub Actions SpeakSharp", "BP_PRODUCER_MODE": "unavailable",
            "GITHUB_ACTIONS": "true" if actual_job else "false",
            "GITHUB_REPOSITORY": "relativityE/speaksharp", "GITHUB_RUN_ID": "123",
            "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "live", "GITHUB_SHA": "b" * 40,
        })
        env.update(extra_env or {})
        results = []
        if bootstrap:
            now = datetime.datetime.now(datetime.timezone.utc)
            builder.request["window"] = {"startUtc": (now - datetime.timedelta(seconds=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                         "endUtc": (now + datetime.timedelta(minutes=60)).strftime("%Y-%m-%dT%H:%M:%SZ")}
            builder.repin(facts=facts_value)
            env.update(builder.env)
            source = env["BP_SOURCE_SHA"]
            scope = {"ownerAccountId": uid.read_text(), "sourceSha": source, "servedSha": source,
                     "campaignId": env["BP_CAMPAIGN"], "caseIds": ["AHT-%02d" % case],
                     "notBefore": env["BP_T0"], "deadlineAt": env["BP_T1"],
                     "maxDeliveries": 8, "maxSupabaseRequests": 16, "maxTelemetryReads": 2,
                     "ownerApprovalReference": facts_value["ownerApprovalReference"],
                     "producerReviewReference": facts_value["producerReviewReference"]}
            authorization = base / "selected-scope.json"
            authorization.write_text(json.dumps(scope))
            authorization.chmod(0o600)
            output.mkdir(mode=0o700)
            results.append(subprocess.run(["node", str(Path(ROOT) / "scripts/authenticated_job_bootstrap.cjs"),
                            "--authorization", str(authorization), "--authorization-sha256",
                            hashlib.sha256(authorization.read_bytes()).hexdigest()], env=env,
                            capture_output=True, text=True, timeout=30))
            return output, results
        for phase in ("phase1", "phase2"):
            result = builder.run(phase)
            results.append(result)
            if result.returncode:
                break
        return output, results

    def test_case04_keeps_full_recovery_contract_without_privileged_producer(self):
        directory, results = self.build(4)
        self.assertEqual([r.returncode for r in results], [0, 0], [r.stderr for r in results])
        plan = json.loads((directory / "cfg/campaign-plan.json").read_text())
        self.assertEqual(plan["runtime"], "GitHub Actions SpeakSharp")
        self.assertEqual([c["id"] for c in plan["cases"]], ["AHT-%02d" % n for n in range(1, 16)])
        self.assertEqual(plan["selection"]["ids"], ["AHT-04"])
        selected = next(c for c in plan["cases"] if c["id"] == "AHT-04")
        self.assertNotIn("producerReceiverFile", selected)
        config = json.loads(Path(selected["configFile"]).read_text())
        self.assertEqual((config["takeCap"], config["startPressCap"]), (1, 2))
        self.assertNotIn("sampleMode", config)
        self.assertIn("deliberate-recovery-saved", config["requiredAssertions"])
        self.assertNotIn("privateEvidenceProducers", config)

    def test_case15_preparation_also_needs_no_server_evidence_authority(self):
        directory, results = self.build(15)
        self.assertEqual([r.returncode for r in results], [0, 0], [r.stderr for r in results])
        plan = json.loads((directory / "cfg/campaign-plan.json").read_text())
        self.assertEqual([c["id"] for c in plan["cases"]], ["AHT-%02d" % n for n in range(1, 16)])
        self.assertEqual(plan["selection"]["ids"], ["AHT-15"])
        selected = next(c for c in plan["cases"] if c["id"] == "AHT-15")
        self.assertNotIn("producerReceiverFile", selected)

    def test_evidence_dependent_cases_still_refuse_without_actual_producer(self):
        for case in (1, 2, 3, 7, 8):
            with self.subTest(case=case):
                directory, results = self.build(case)
                self.assertNotEqual(results[-1].returncode, 0)
                self.assertEqual(results[-1].stderr.strip(), "BLOCKED_SETUP: INVALID_BINDING_INPUT")
                self.assertFalse((directory / "cfg/campaign-plan.json").exists())

    def test_ordinary_shell_cannot_claim_github_runtime(self):
        directory, results = self.build(4, actual_job=False)
        self.assertNotEqual(results[-1].returncode, 0)
        self.assertEqual(results[-1].stderr.strip(), "BLOCKED_SETUP: INVALID_BINDING_INPUT")
        self.assertFalse((directory / "cfg/campaign-plan.json").exists())

    def test_bootstrap_invokes_both_real_builder_phases_and_stops_before_execution(self):
        directory, results = self.build(7, bootstrap=True)
        self.assertEqual([r.returncode for r in results], [0], [r.stderr for r in results])
        receipt = json.loads(results[0].stdout)
        self.assertEqual(receipt["kind"], "same-job-preparation-not-live-result")
        for key in ("plan", "scope", "descriptor"):
            self.assertEqual(hashlib.sha256(Path(receipt[key]["file"]).read_bytes()).hexdigest(), receipt[key]["sha256"])
        plan = json.loads((directory / "cfg/campaign-plan.json").read_text())
        self.assertEqual([c["id"] for c in plan["cases"]], ["AHT-%02d" % n for n in range(1, 16)])
        self.assertEqual(plan["selection"]["ids"], ["AHT-07"])
        selected = next(c for c in plan["cases"] if c["id"] == "AHT-07")
        self.assertTrue(selected["producerReceiverFile"].endswith("github-job-evidence-reader.cjs"))
        self.assertFalse((directory / "run").exists())
