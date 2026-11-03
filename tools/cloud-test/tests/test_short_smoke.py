import importlib.util
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from case_start_caps import CASE_IDS, MINIMAL_MINIMA, InputValidationError, request_caps  # noqa: E402
import run_env  # noqa: E402
import init_run_inputs as init  # noqa: E402
import check_coverage as coverage  # noqa: E402
from test_init_run_inputs import CFG, KEYS, NOW, live_request  # noqa: E402
from test_case_start_caps import SyntheticBuilder  # noqa: E402


def request():
    caps = dict(MINIMAL_MINIMA)
    return {
        "schema": "speaksharp.cloud-test.run-request.v2",
        "coverageMode": "smoke",
        "sampleMode": "smoke",
        "runId": "UNIT-SMOKE",
        "executionRuntime": "GitHub Actions SpeakSharp",
        "selection": [
            {"case": cid, "order": i + 1, "startPressCap": caps[cid], "plannedRequests": 1}
            for i, cid in enumerate(CASE_IDS)
        ],
        "estimate": {"starts": sum(caps.values()), "requests": {}, "providerBillableRequests": {}},
        "proposedLimits": {"startPressCaps": dict(caps)},
        "approvedLimits": {"startPressCaps": dict(caps)},
        "window": {},
        "release": {"backend": {}},
        "harness": {},
    }


def live_smoke_request():
    value = live_request()
    value["coverageMode"] = "smoke"
    value["sampleMode"] = "smoke"
    value["priority"] = "journey-smoke"
    caps = dict(MINIMAL_MINIMA)
    for row in value["selection"]:
        row["startPressCap"] = caps[row["case"]]
    value["proposedLimits"]["startPressCaps"] = copy.deepcopy(caps)
    value["approvedLimits"]["startPressCaps"] = copy.deepcopy(caps)
    value["approvedLimits"]["runCapRequests"] = 3000
    value["estimate"]["starts"] = sum(caps.values())
    value["estimate"]["identityReads"] = 32
    value["estimate"]["requests"]["runCap"] = 3000
    value["estimate"].pop("window", None)
    return value


class ShortSmokeContract(unittest.TestCase):
    def test_actual_initiation_derives_one_bounded_occurrence_that_admits(self):
        template = json.loads((ROOT / "config/runs/R10-3b040043-all15.json").read_text())
        start = "2026-11-03T16:00:00Z"
        value = init.materialize_smoke_occurrence(template, start, "slack:exact-occurrence", "Akin", "a" * 40, "b" * 40)
        self.assertEqual(value["window"]["startUtc"], start)
        self.assertEqual(value["window"]["endUtc"], "2026-11-03T17:05:00Z")
        self.assertIn("not measured runtime", value["window"]["basis"])
        now = datetime(2026, 11, 3, 16, 0, 0, tzinfo=timezone.utc)
        cases = init.check_request(value, now, init._request_keys())
        cfg = json.loads((ROOT / "config/test-config.v1.json").read_text())
        live = init.check_ceilings(cfg, value, cases, 65)
        self.assertEqual(live, 40)
        init.check_window_fit(value, now, live)

    def test_occurrence_materializer_refuses_wrong_case_set_or_release(self):
        template = json.loads((ROOT / "config/runs/R10-3b040043-all15.json").read_text())
        with self.assertRaisesRegex(init.Refused, "smoke-occurrence-release"):
            init.materialize_smoke_occurrence(template, "2026-11-03T16:00:00Z", "slack:x", "Akin", "bad", "b" * 40)
        template["selection"].pop()
        with self.assertRaisesRegex(init.Refused, "smoke-occurrence-selection"):
            init.materialize_smoke_occurrence(template, "2026-11-03T16:00:00Z", "slack:x", "Akin", "a" * 40, "b" * 40)

    def test_all_fifteen_smoke_maps_to_distinct_builder_mode(self):
        mode, caps = request_caps(request())
        self.assertEqual(mode, "smoke")
        self.assertEqual(tuple(caps), CASE_IDS)
        self.assertEqual(run_env.SAMPLE["smoke"], "smoke")
        self.assertEqual(run_env.BP_MODE["smoke"], "smoke")

    def test_smoke_never_accepts_a_subset_or_full_case_cap_invention(self):
        missing = request()
        missing["selection"].pop()
        missing["estimate"]["starts"] -= MINIMAL_MINIMA["AHT-15"]
        missing["proposedLimits"]["startPressCaps"].pop("AHT-15")
        missing["approvedLimits"]["startPressCaps"].pop("AHT-15")
        with self.assertRaisesRegex(InputValidationError, "full-selection"):
            request_caps(missing)

        wrong = request()
        wrong["sampleMode"] = "minimal"
        with self.assertRaisesRegex(InputValidationError, "mode-pair"):
            request_caps(wrong)

    def test_smoke_uses_minimum_actions_without_raising_any_case_cap(self):
        value = request()
        value["selection"][0]["startPressCap"] -= 1
        value["estimate"]["starts"] -= 1
        value["proposedLimits"]["startPressCaps"]["AHT-01"] -= 1
        value["approvedLimits"]["startPressCaps"]["AHT-01"] -= 1
        with self.assertRaisesRegex(InputValidationError, "selection-minimum"):
            request_caps(value)

    def test_config_is_short_non_full_and_keeps_case03_unchanged(self):
        cfg = json.loads((ROOT / "config" / "test-config.v1.json").read_text())
        smoke = cfg["modes"]["smoke"]
        self.assertFalse(smoke["countsAsFullLiveRun"])
        self.assertEqual(smoke["limits"]["maxSelectedCases"], 15)
        self.assertEqual(smoke["limits"]["maxWindowMinutes"], 40)
        self.assertEqual(smoke["recordingWindowMs"]["AHT-03"], 22000)
        self.assertEqual(smoke["recordingWindowMs"]["AHT-01"], 35000)
        self.assertEqual(smoke["recordingWindowMs"]["AHT-02"], 23100)
        self.assertTrue(all(v >= 5000 for v in smoke["recordingWindowMs"].values()))
        overhead = sum(smoke["window"][key] for key in ("admissionMaxMinutes", "interCaseAndReportMinutes", "cleanupReserveMinutes"))
        self.assertLessEqual(sum(smoke["caseMaxMs"].values()), (smoke["limits"]["maxWindowMinutes"] - overhead) * 60 * 1000)
        catalog = json.loads((ROOT / smoke["assertionCatalog"]["file"]).read_text())
        self.assertEqual(catalog["totalAssertions"], sum(len(row["requiredAssertions"]) for row in catalog["cases"].values()))
        self.assertEqual(catalog["minimumStarts"], sum(MINIMAL_MINIMA.values()))

    def test_live_input_admission_accepts_only_the_all_fifteen_smoke_pair(self):
        value = live_smoke_request()
        self.assertEqual(init.check_request(value, NOW, KEYS), init.ALL_CASES)
        subset = copy.deepcopy(value)
        subset["selection"].pop()
        with self.assertRaisesRegex(init.Refused, "smoke-mode-needs-all-fifteen"):
            init.check_request(subset, NOW, KEYS)
        wrong = copy.deepcopy(value)
        wrong["sampleMode"] = "full"
        with self.assertRaisesRegex(init.Refused, "smoke-mode-needs-smoke-sampling"):
            init.check_request(wrong, NOW, KEYS)

    def test_smoke_uses_its_own_forty_minute_live_ceiling(self):
        value = live_smoke_request()
        self.assertEqual(init.check_ceilings(CFG, value, init.ALL_CASES, 65), 40)
        with self.assertRaisesRegex(init.Refused, "time-exceeds-job-timeout"):
            init.check_ceilings(CFG, value, init.ALL_CASES, 64)

    def test_pipeline_builds_executable_coverage_commands_from_the_request_mode(self):
        spec = importlib.util.spec_from_file_location("smoke_pipeline", SCRIPTS / "pipeline.py")
        pipeline = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(pipeline)
        cfg = json.loads((ROOT / "config" / "test-config.v1.json").read_text())
        with tempfile.TemporaryDirectory(prefix="smoke-pipeline-command-") as root:
            root = Path(root)
            request_path = root / "request.json"
            request_path.write_text(json.dumps(live_smoke_request()))
            command = pipeline.coverage_command(str(request_path), cfg, str(root / "coverage.json"))
            self.assertEqual(command[0], "check_coverage.py")
            self.assertEqual(Path(command[command.index("--catalog") + 1]).name, "smoke-assertion-catalog.json")
            full = live_request(); full_path = root / "full.json"; full_path.write_text(json.dumps(full))
            full_command = pipeline.coverage_command(str(full_path), cfg, str(root / "full-coverage.json"))
            self.assertEqual(Path(full_command[full_command.index("--catalog") + 1]).name, "assertion-catalog.json")

    def test_real_builder_emits_the_pinned_smoke_contract_for_all_fifteen(self):
        with tempfile.TemporaryDirectory(prefix="cloud-test-smoke-builder-") as root:
            fixture = SyntheticBuilder(root, cases=range(1, 16), minimal=True)
            fixture.request["coverageMode"] = "smoke"
            fixture.request["sampleMode"] = "smoke"
            fixture.request["executionRuntime"] = "GitHub Actions SpeakSharp"
            facts = json.loads((ROOT / "tests/fixtures/plan-facts.PLACEHOLDER.json").read_text())
            facts["producerReviewReference"] = "UNIT-INDEPENDENT-REVIEW-NOT-A-RUN"
            fixture.repin(facts=facts)
            packet = ROOT / "harness"
            receiver = "draft-adapters/receivers/github-job-evidence-reader.cjs"
            descriptor = {
                "producerIdentity": "github-actions:relativityE/speaksharp:123:1:live",
                "jobId": "live",
                "producerCodeSha256": hashlib.sha256((packet / "bundle/harness/authenticated-job-producer.cjs").read_bytes()).hexdigest(),
                "receiverSourceSha256": hashlib.sha256((packet / receiver).read_bytes()).hexdigest(),
                "receiverRelativePath": receiver,
                "workflowSourceSha": "b" * 40,
                "reviewReference": facts["producerReviewReference"],
            }
            descriptor_path = Path(root) / "producer-descriptor.json"
            descriptor_path.write_text(json.dumps(descriptor))
            descriptor_path.chmod(0o600)
            fixture.env["BP_MODE"] = "smoke"
            fixture.env.update(
                BP_PRODUCER_MODE="same-github-job",
                BP_PRODUCER_DESCRIPTOR=str(descriptor_path),
                BP_PRODUCER_DESCRIPTOR_SHA256=hashlib.sha256(descriptor_path.read_bytes()).hexdigest(),
                GITHUB_ACTIONS="true",
                GITHUB_REPOSITORY="relativityE/speaksharp",
                GITHUB_RUN_ID="123",
                GITHUB_RUN_ATTEMPT="1",
                GITHUB_JOB="live",
                GITHUB_SHA="b" * 40,
            )
            phase1 = fixture.run("phase1")
            self.assertEqual(phase1.returncode, 0, phase1.stderr)
            phase2 = fixture.run("phase2")
            self.assertEqual(phase2.returncode, 0, phase2.stderr)
            plan = json.loads((Path(root) / "private/cfg/campaign-plan.json").read_text())
            catalog = json.loads((ROOT / "config/smoke-assertion-catalog.json").read_text())
            self.assertEqual(plan["coverageMode"], "smoke")
            self.assertEqual(plan["assertionDepth"], "smoke")
            self.assertEqual([row["id"] for row in plan["cases"]], list(CASE_IDS))
            for case_id in CASE_IDS:
                config = json.loads((Path(root) / f"private/cases/{case_id}.json").read_text())
                self.assertEqual(config["sampleMode"], "smoke")
                self.assertEqual(config["requiredAssertions"], catalog["cases"][case_id]["requiredAssertions"])
                self.assertEqual(config["recordingWindowMs"], CFG["modes"]["smoke"]["recordingWindowMs"][case_id])

    def test_smoke_coverage_can_be_complete_but_never_full_live(self):
        value = live_smoke_request()
        value["runId"] = "UNIT-SMOKE-COVERAGE"
        value["release"]["testedSha"] = "a" * 40
        catalog = json.loads((ROOT / "config" / "smoke-assertion-catalog.json").read_text())
        cases = []
        for case_id, spec in catalog["cases"].items():
            assertions = [{"id": row, "result": "PASS"} for row in spec["requiredAssertions"]]
            identity = {"result": "MATCH", "servedSha": "a" * 40, "expectedSha": "a" * 40}
            cases.append({"caseId": case_id, "assertions": assertions, "identityBefore": identity, "identityAfter": identity})
        results = {"campaignId": value["runId"], "sourceSha": "a" * 40, "servedSha": "a" * 40, "finalIdentity": "MATCH", "cases": cases}
        out = coverage.assess(value, catalog, results)
        self.assertEqual(out["kind"], "SMOKE")
        self.assertTrue(out["coverageComplete"])
        self.assertFalse(out["fullLiveRun"])
        self.assertIn("a smoke run does not claim full coverage", out["reasons"])


if __name__ == "__main__":
    unittest.main()
