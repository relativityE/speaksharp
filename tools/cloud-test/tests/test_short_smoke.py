import importlib.util
import copy
import hashlib
import json
from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from case_start_caps import CASE_IDS, MINIMAL_MINIMA, InputValidationError, request_caps  # noqa: E402
import run_env  # noqa: E402
import init_run_inputs as init  # noqa: E402
import check_gates  # noqa: E402
import check_coverage as coverage  # noqa: E402
from test_init_run_inputs import ACCOUNT_ID, CFG, KEYS, NOW, SUPABASE_URL_OK, bundle_with, facts, live_request  # noqa: E402
from test_case_start_caps import SyntheticBuilder  # noqa: E402
import state_ref_writer  # noqa: E402


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
        start = "2026-11-03T17:30:00Z"
        value = init.materialize_authoritative_smoke_occurrence(str(ROOT.parents[1]), template, start)
        self.assertEqual(value["window"]["startUtc"], start)
        self.assertEqual(value["window"]["endUtc"], "2026-11-03T18:50:00Z")
        self.assertEqual(value["window"]["endToEndMinutes"], 80)
        self.assertEqual(value["window"]["liveMinutes"], 40)
        self.assertIn("not measured runtime", value["window"]["basis"])
        now = datetime(2026, 11, 3, 17, 30, 0, tzinfo=timezone.utc)
        cases = init.check_request(value, now, init._request_keys())
        cfg = json.loads((ROOT / "config/test-config.v1.json").read_text())
        live = init.check_ceilings(cfg, value, cases, 65)
        self.assertEqual(live, 40)
        self.assertEqual(check_gates.occurrence_window_limit(
            value, cfg["modes"]["smoke"]["limits"], False, 80), (80, []))
        init.check_window_fit(value, now, live)
        # A real dispatch has startup delay.  The occurrence must survive it,
        # while still refusing once less than live + collect remains.
        init.check_window_fit(value, datetime(2026, 11, 3, 17, 35, 0, tzinfo=timezone.utc), live)
        with self.assertRaisesRegex(init.Refused, "run-would-outlast-approved-window"):
            init.check_window_fit(value, datetime(2026, 11, 3, 18, 0, 1, tzinfo=timezone.utc), live)

    def test_occurrence_materializer_refuses_wrong_case_set_or_release(self):
        template = json.loads((ROOT / "config/runs/R10-3b040043-all15.json").read_text())
        with self.assertRaisesRegex(init.Refused, "smoke-occurrence-release"):
            init.materialize_smoke_occurrence(template, "2026-11-03T16:00:00Z", "slack:x", "slack:scope", "Akin", "bad", "b" * 40)
        template["selection"].pop()
        with self.assertRaisesRegex(init.Refused, "smoke-occurrence-selection"):
            init.materialize_smoke_occurrence(template, "2026-11-03T16:00:00Z", "slack:x", "slack:scope", "Akin", "a" * 40, "b" * 40)

    def test_exact_occurrence_bytes_are_rederived_from_the_committed_template(self):
        template_rel = "tools/cloud-test/config/runs/R10-3b040043-all15.json"
        template = json.loads((ROOT / "config/runs/R10-3b040043-all15.json").read_text())
        start = "2026-11-03T17:30:00Z"
        occurrence = init.materialize_authoritative_smoke_occurrence(str(ROOT.parents[1]), template, start)
        raw = json.dumps(occurrence, sort_keys=True, separators=(",", ":")).encode()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "occurrence.json"
            path.write_bytes(raw)
            selected = init.select_manual_occurrence(
                str(ROOT.parents[1]), template_rel, str(path),
                hashlib.sha256(raw).hexdigest(),
                init._git(str(ROOT.parents[1]), "rev-parse", "HEAD"), start)
            self.assertEqual(selected[2], raw)

            tampered = dict(occurrence)
            tampered["window"] = dict(occurrence["window"], endUtc="2026-11-03T17:21:00Z")
            bad = json.dumps(tampered, sort_keys=True, separators=(",", ":")).encode()
            path.write_bytes(bad)
            with self.assertRaisesRegex(init.Refused, "manual-occurrence-not-the-template-materialization"):
                init.select_manual_occurrence(
                    str(ROOT.parents[1]), template_rel, str(path),
                    hashlib.sha256(bad).hexdigest(),
                    init._git(str(ROOT.parents[1]), "rev-parse", "HEAD"), start)

    def test_occurrence_refuses_an_external_timestamp_or_expired_authority(self):
        template_rel = "tools/cloud-test/config/runs/R10-3b040043-all15.json"
        template = json.loads((ROOT / "config/runs/R10-3b040043-all15.json").read_text())
        occurrence = init.materialize_authoritative_smoke_occurrence(str(ROOT.parents[1]), template, "2026-11-03T17:30:00Z")
        raw = json.dumps(occurrence, sort_keys=True, separators=(",", ":")).encode()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "occurrence.json"
            path.write_bytes(raw)
            with self.assertRaisesRegex(init.Refused, "manual-occurrence-not-the-workflow-start"):
                init.select_manual_occurrence(
                    str(ROOT.parents[1]), template_rel, str(path), hashlib.sha256(raw).hexdigest(),
                    init._git(str(ROOT.parents[1]), "rev-parse", "HEAD"), "2026-11-03T17:30:01Z")
        with self.assertRaisesRegex(init.Refused, "one-off-grant-expired"):
            init.materialize_authoritative_smoke_occurrence(str(ROOT.parents[1]), template, "2026-11-04T10:40:01Z")

    def test_one_off_grant_rejects_caller_authority_release_checkpoint_and_scope_tampering(self):
        repo = str(ROOT.parents[1])
        template = json.loads((ROOT / "config/runs/R10-3b040043-all15.json").read_text())
        occurrence = init.materialize_authoritative_smoke_occurrence(repo, template, "2026-11-03T17:30:00Z")
        occurrence_raw = json.dumps(occurrence, sort_keys=True).encode()
        request_sha = hashlib.sha256(occurrence_raw).hexdigest()
        scope = json.loads((ROOT / "config/aggregate/period-scope.json").read_text())
        checkpoint = json.dumps({
            "headSha": "92d6ebf902351750c368d7d513116c6b1f19f80c",
            "scopeApprovalRef": scope["approvalRef"],
        }, sort_keys=True).encode()
        for field in init.CALLER_AUTHORITY_FIELDS:
            with self.assertRaisesRegex(init.Refused, "one-off-caller-authority-refused"):
                init.occurrence_action_approval({field: {}}, request_sha, checkpoint, occurrence, repo=repo)
        # The same exact checker used immediately before the real reserve
        # accepts the committed grant + committed scope + verified checkpoint.
        init.manual_reservation.admit_action_approval(b"{}", occurrence_raw, request_sha, checkpoint, repo)
        envelope = init.occurrence_action_approval({}, request_sha, checkpoint, occurrence, repo=repo)
        self.assertEqual(envelope["approvalRef"], scope["approvalRef"])
        self.assertEqual(envelope["selectionApprovalRef"], "chat:PO_R10_ALL15_SMOKE_2026-11-03")
        wrong_release = copy.deepcopy(occurrence)
        wrong_release["release"]["testedSha"] = "f" * 40
        with self.assertRaisesRegex(init.Refused, "relative-occurrence-request-release"):
            init.occurrence_action_approval({}, request_sha, checkpoint, wrong_release, repo=repo)
        stale = json.dumps({"headSha": "f" * 40, "scopeApprovalRef": scope["approvalRef"]}).encode()
        with self.assertRaisesRegex(init.Refused, "one-off-grant-checkpoint"):
            init.occurrence_action_approval({}, request_sha, stale, occurrence, repo=repo)
        original = init.manual_reservation.ACCEPTED_SCOPE_SHA256
        try:
            init.manual_reservation.ACCEPTED_SCOPE_SHA256 = "f" * 64
            with self.assertRaisesRegex(init.Refused, "one-off-grant-accounting"):
                init.occurrence_action_approval({}, request_sha, checkpoint, occurrence, repo=repo)
        finally:
            init.manual_reservation.ACCEPTED_SCOPE_SHA256 = original

    def test_committed_grant_scope_real_reserve_then_prepare_on_verified_chain(self):
        """The production reserve appends to a verified state chain, then the
        production prepare path consumes that exact open reserve. No hand-built
        checkpoint or direct approval-check shortcut participates."""
        repo = str(ROOT.parents[1])
        root = init.continuity_pins()["accepted_root"]
        template_rel = "tools/cloud-test/config/runs/R10-3b040043-all15.json"
        template = json.loads((ROOT / "config/runs/R10-3b040043-all15.json").read_text())
        start = "2026-11-03T17:30:00Z"
        occurrence = init.materialize_authoritative_smoke_occurrence(repo, template, start)
        occurrence_raw = json.dumps(occurrence, sort_keys=True, separators=(",", ":")).encode()
        request_sha = hashlib.sha256(occurrence_raw).hexdigest()
        bootstrap = (ROOT / "config/aggregate/accounting-bootstrap.json").read_bytes()
        scope = (ROOT / "config/aggregate/period-scope.json").read_bytes()
        source_sha = init._git(repo, "rev-parse", "HEAD")
        run_id = "41600000001"

        with tempfile.TemporaryDirectory(prefix="r10-real-path-") as tmp:
            remote = str(Path(tmp) / "state.git")
            writer = str(Path(tmp) / "writer")
            subprocess.run(["git", "init", "-q", "--bare", remote], check=True)
            subprocess.run(["git", "init", "-q", writer], check=True)
            subprocess.run(["git", "-C", writer, "fetch", "-q", repo, root], check=True)
            subprocess.run(["git", "-C", writer, "push", "-q", remote, "%s:%s" % (root, state_ref_writer.STATE_REF)], check=True)

            reserve_dir = Path(tmp) / "reserve"
            reserve_dir.mkdir()
            init.manual_reservation.execute(
                "reserve",
                {"request": occurrence_raw, "admittedSha256": request_sha, "runId": run_id,
                 "bootstrap": bootstrap, "scope": scope, "facts": b"{}", "atUtc": start},
                writer, remote, root, str(reserve_dir / "journal.json"), str(reserve_dir / "receipt.json"),
                init.continuity_pins(), remote, source_repo=repo)
            head = state_ref_writer.fetch_head(writer, remote, remote)
            chain = state_ref_writer.validate_chain(writer, head, root)
            self.assertEqual(chain[-1][1][-1]["provenance"], "request-sha256:" + request_sha)

            occurrence_file = Path(tmp) / "occurrence.json"
            occurrence_file.write_bytes(occurrence_raw)
            bundle = json.loads(bundle_with(ACCOUNT_ID))
            maintained_id = bundle["accounts"]["maintained-read-only"]["accountId"]
            nonsecret_facts = facts(
                ownerApprovalReference="chat:PO_R10_ALL15_SMOKE_2026-11-03",
                approvedBy="Akin", reviewer="review:unit@1",
                producerReviewReference="review:producer@1",
                accounts={
                    "existing-disposable": {"idSha256": hashlib.sha256(ACCOUNT_ID.encode()).hexdigest(),
                                            "historyRef": "history:throwaway@r10"},
                    "maintained-read-only": {"idSha256": hashlib.sha256(maintained_id.encode()).hexdigest(),
                                             "historyRef": "history:free@r10"},
                },
                backend={"manifestRef": "receipt:backend@r10", "generation": 1,
                         "completion": "OFF", "migration129": "absent"})
            args = SimpleNamespace(
                repo=repo, config="tools/cloud-test/config/test-config.v1.json", request=template_rel,
                manual_occurrence_file=str(occurrence_file), manual_occurrence_sha256=request_sha,
                workflow_start_utc=start, nightly_request_file=None, nightly_request_sha256=None,
                facts=json.dumps(nonsecret_facts), run_id=run_id, attempt=1, source_sha=source_sha,
                job_timeout_minutes=65, case10_observation=None)
            with mock.patch.object(init, "state_chain", return_value=chain), \
                    mock.patch.dict(os.environ, {"CLOUD_TEST_LIVE_ACCOUNTS": json.dumps(bundle),
                                                 "SUPABASE_URL": SUPABASE_URL_OK}):
                prepared = init.prepare(args, datetime(2026, 11, 3, 17, 35, 0, tzinfo=timezone.utc))
            self.assertEqual(prepared["requestSha256"], request_sha)
            self.assertEqual(prepared["liveMinutes"], 40)
            self.assertEqual(prepared["facts"]["actionApproval"]["selectionApprovalRef"],
                             "chat:PO_R10_ALL15_SMOKE_2026-11-03")
            self.assertEqual(prepared["facts"]["actionApproval"]["approvalRef"],
                             "chat:PO_R10_SCOPE_EXTENSION_2026-11-03")

    def test_completion_deadline_marks_queue_delay_incomplete_without_changing_settlement_period(self):
        template = json.loads((ROOT / "config/runs/R10-3b040043-all15.json").read_text())
        value = init.materialize_authoritative_smoke_occurrence(str(ROOT.parents[1]), template, "2026-11-03T17:30:00Z")
        raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
        self.assertTrue(init.completion_within_occurrence(raw, datetime(2026, 11, 3, 18, 50, 0, tzinfo=timezone.utc)))
        self.assertFalse(init.completion_within_occurrence(raw, datetime(2026, 11, 3, 18, 50, 1, tzinfo=timezone.utc)))
        scope = json.loads((ROOT / "config/aggregate/period-scope.json").read_text())
        self.assertLess(datetime(2026, 11, 3, 18, 50, 1, tzinfo=timezone.utc), init._utc(scope["periodEndUtc"]))
        with tempfile.TemporaryDirectory(prefix="completion-deadline-") as tmp:
            occurrence_file = Path(tmp) / "occurrence.json"
            occurrence_file.write_bytes(raw)
            self.assertEqual(init.main(["init_run_inputs.py", "completion-deadline",
                                        "--manual-occurrence-file", str(occurrence_file),
                                        "--now", "2026-11-03T18:50:00Z"]), 0)
            self.assertEqual(init.main(["init_run_inputs.py", "completion-deadline",
                                        "--manual-occurrence-file", str(occurrence_file),
                                        "--now", "2026-11-03T18:50:01Z"]), 79)

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
