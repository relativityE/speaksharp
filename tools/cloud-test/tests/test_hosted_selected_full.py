"""Offline connection controls. Synthetic fixtures are never live authorization."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/hosted_selected_full.py"
spec = importlib.util.spec_from_file_location("hosted_selected_full", SCRIPT)
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


class HostedSelectedFull(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="hosted-contract-synthetic-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.root.chmod(0o700)
        self.sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=h.REPO,
                                  capture_output=True, text=True, check=True).stdout.strip()
        self.env = {"PATH": os.environ["PATH"], "HOME": str(self.root), "GITHUB_ACTIONS": "true",
                    "GITHUB_REPOSITORY": "relativityE/speaksharp", "GITHUB_RUN_ID": "123",
                    "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "selected-full", "GITHUB_SHA": self.sha,
                    "CT_CHROME": "/synthetic-existing-chrome", "CT_EXISTING_DEPENDENCY_ROOT": "/synthetic-dependencies",
                    "CT_EXISTING_PDFJS_DIR": "/synthetic-pdfjs", "CT_SETUP_MODE": "acquire",
                    "THROWAWAY_TEST_EMAIL": "synthetic-only@example.invalid",
                    "THROWAWAY_TEST_PASSWORD": "SYNTHETIC-NOT-A-CREDENTIAL",
                    "VITE_SUPABASE_ANON_KEY": "SYNTHETIC-PUBLISHABLE",
                    "SUPABASE_SERVICE_ROLE_KEY": "SYNTHETIC-PRIVILEGED",
                    "POSTHOG_PERSONAL_API_KEY": "SYNTHETIC-TELEMETRY",
                    "SUPABASE_URL": "https://example.invalid", "GITHUB_TOKEN": "DO-NOT-FORWARD"}
        self.request = {"runId": "SYNTHETIC-NOT-A-RUN", "executionRuntime": "GitHub Actions SpeakSharp",
                        "sampleMode": "full", "coverageMode": "partial", "priority": "owner-test",
                        "selection": [{"case": "AHT-08"}], "selectionApprovalRef": "SYNTHETIC-NOT-AUTHORITY",
                        "release": {"testedSha": "a" * 40},
                        "window": {"startUtc": "2026-01-01T00:00:00Z", "endUtc": "2026-01-01T01:00:00Z"}}
        self.now = h.stamp("2026-01-01T00:30:00Z")
        self.config = json.loads((SCRIPT.parent.parent / "config/test-config.v1.json").read_text())
        data = {"CT_CONFIG": self.config, "CT_REQUEST": self.request,
                "CT_FACTS_FILE": {"ownerApprovalReference": "SYNTHETIC", "approvedBy": "SYNTHETIC", "reviewer": "SYNTHETIC"},
                "CT_ACCOUNT_ID_FILE": "00000000-0000-4000-8000-000000000001\n"}
        self.manifest = {"schema": "speaksharp.hosted-selected-full.v1", "workflowSha": self.sha,
                         "campaignId": self.request["runId"], "servedSha": "a" * 40,
                         "selectionApprovalRef": self.request["selectionApprovalRef"],
                         "privateDelivery": {"kind": "pre-mounted-private-store",
                                             "materializationSelectionRef": "SYNTHETIC", "durableReturnSelectionRef": "SYNTHETIC"},
                         "inputs": {}}
        for key in h.INPUTS | {"CT_EVIDENCE_SCOPE_FILE"}:
            self.set_input(key, data.get(key, {"synthetic": "NOT-A-RUN"}))
        self.state = {"schema": "speaksharp.hosted-continuity.v1", "reconciled": True,
                      "reconciliationRef": "SYNTHETIC", "nextCampaignId": self.request["runId"]}
        self.refresh_continuity()
        self.save_manifest()

    def set_input(self, key, value):
        path = self.root / (key + ".json")
        if key == "CT_RECEIPTS_ROOT":
            path.mkdir(mode=0o700)
            receipt = path / "synthetic.json"
            receipt.write_text(json.dumps(value))
            receipt.chmod(0o600)
            self.manifest["inputs"][key] = {"path": path.name, "sha256": h.inventory_digest(path)}
            return
        if key == "CT_CONFIG":
            path.write_bytes((SCRIPT.parent.parent / "config/test-config.v1.json").read_bytes())
        else:
            path.write_text(value if isinstance(value, str) else json.dumps(value))
        path.chmod(0o600)
        self.manifest["inputs"][key] = {"path": path.name, "sha256": h.inventory_digest(path)}

    def refresh_continuity(self):
        for target, source in (("accountSha256", "CT_ACCOUNT_ID_FILE"), ("countersSha256", "CT_COUNTERS"),
                               ("reservationsSha256", "CT_RESERVATIONS"), ("historyIndexSha256", "CT_HISTORY_INDEX")):
            self.state[target] = self.manifest["inputs"][source]["sha256"]
        p = self.root / "continuity.json"
        p.write_text(json.dumps(self.state))
        p.chmod(0o600)
        self.manifest["continuitySha256"] = h.digest(p.read_bytes())

    def save_manifest(self):
        p = self.root / "hosted-inputs.json"
        p.write_text(json.dumps(self.manifest))
        p.chmod(0o600)
        self.pin = h.digest(p.read_bytes())

    def prepared(self):
        self.save_manifest()
        return h.prepare(self.root, self.pin, self.env, self.now)

    def execute(self, runner):
        self.save_manifest()
        return h.execute(self.root, self.pin, self.env, now=lambda: self.now, run_stage=runner)

    def test_valid_full_selection_keeps_exact_private_input_paths(self):
        _, paths, request, _ = self.prepared()
        self.assertEqual(request["sampleMode"], "full")
        self.assertEqual(set(paths), h.INPUTS | {"CT_EVIDENCE_SCOPE_FILE"})
        self.assertEqual(paths["CT_COUNTERS"], str(self.root / "CT_COUNTERS.json"))

    def test_no_transport_or_durable_return_selection_refuses_before_child(self):
        for field in ("materializationSelectionRef", "durableReturnSelectionRef"):
            with self.subTest(field=field):
                value = self.manifest["privateDelivery"].pop(field)
                try:
                    with self.assertRaisesRegex(h.Refused, "PRIVATE_DELIVERY_NOT_SELECTED"):
                        self.execute(lambda *_: self.fail("must not execute"))
                finally:
                    self.manifest["privateDelivery"][field] = value

    def test_each_missing_private_input_refuses_no_fallback(self):
        for key in h.INPUTS:
            with self.subTest(key=key):
                value = self.manifest["inputs"].pop(key)
                try:
                    with self.assertRaisesRegex(h.Refused, "INPUT_SET_DIFFERS"):
                        self.prepared()
                finally:
                    self.manifest["inputs"][key] = value

    def test_tampered_input_and_manifest_refuse(self):
        (self.root / "CT_COUNTERS.json").write_text("{}")
        with self.assertRaisesRegex(h.Refused, "INPUT_DIGEST_DIFFERS"):
            self.prepared()
        with self.assertRaisesRegex(h.Refused, "INPUT_DIGEST_DIFFERS"):
            h.prepare(self.root, "0" * 64, self.env, self.now)

    def test_symlink_escape_and_public_permissions_refuse(self):
        p = self.root / "CT_COUNTERS.json"
        p.chmod(0o644)
        with self.assertRaisesRegex(h.Refused, "PRIVATE_FILE_REQUIRED"):
            self.prepared()
        p.unlink()
        p.symlink_to(self.root / "CT_ACCOUNT_ID_FILE.json")
        with self.assertRaisesRegex(h.Refused, "INPUT_PATH_INVALID"):
            self.prepared()

    def test_cumulative_state_and_account_cannot_reset_silently(self):
        for key in ("reconciled", "reconciliationRef", "nextCampaignId", "accountSha256",
                    "countersSha256", "reservationsSha256", "historyIndexSha256"):
            with self.subTest(key=key):
                value = self.state.pop(key)
                try:
                    p = self.root / "continuity.json"
                    p.write_text(json.dumps(self.state))
                    self.manifest["continuitySha256"] = h.digest(p.read_bytes())
                    with self.assertRaisesRegex(h.Refused, "CUMULATIVE_CONTINUITY_REQUIRED"):
                        self.prepared()
                finally:
                    self.state[key] = value
        self.refresh_continuity()

    def test_actual_job_source_window_and_scope_are_required(self):
        for key, value in (("GITHUB_ACTIONS", "false"), ("GITHUB_REPOSITORY", "other/repo"),
                           ("GITHUB_RUN_ID", "x"), ("GITHUB_SHA", "b" * 40)):
            with self.subTest(key=key):
                env = dict(self.env, **{key: value})
                with self.assertRaises(h.Refused):
                    h.prepare(self.root, self.pin, env, self.now)
        with self.assertRaisesRegex(h.Refused, "WINDOW_CLOSED"):
            h.prepare(self.root, self.pin, self.env, self.now + 3600)
        del self.manifest["inputs"]["CT_EVIDENCE_SCOPE_FILE"]
        with self.assertRaisesRegex(h.Refused, "PRODUCER_SCOPE_REQUIRED"):
            self.prepared()

    def test_partial_diagnostic_cannot_be_presented_as_full_journey(self):
        self.request["sampleMode"] = "partial"
        self.set_input("CT_REQUEST", self.request)
        with self.assertRaisesRegex(h.Refused, "FULL_JOURNEY_REQUEST_REQUIRED"):
            self.prepared()

    def test_receipts_root_must_be_directory_and_inventory_complete(self):
        root = self.root / self.manifest["inputs"]["CT_RECEIPTS_ROOT"]["path"]
        extra = root / "unaccounted.json"
        extra.write_text("{}")
        extra.chmod(0o600)
        with self.assertRaisesRegex(h.Refused, "INPUT_DIGEST_DIFFERS"):
            self.prepared()
        self.manifest["inputs"]["CT_RECEIPTS_ROOT"] = dict(self.manifest["inputs"]["CT_COUNTERS"])
        with self.assertRaisesRegex(h.Refused, "INPUT_TYPE_DIFFERS"):
            self.prepared()

    def test_concurrent_store_lock_refuses_even_with_different_campaign(self):
        fd = os.open(self.root / "hosted.lock", os.O_RDWR | os.O_CREAT, 0o600)
        try:
            h.fcntl.flock(fd, h.fcntl.LOCK_EX | h.fcntl.LOCK_NB)
            with self.assertRaisesRegex(h.Refused, "PRIVATE_STORE_IN_USE"):
                self.execute(lambda *_: self.fail("no overlapping job"))
        finally:
            os.close(fd)

    def test_real_stage_order_and_credentials_reach_only_their_stage(self):
        calls = []

        def child(stage, env, out, timeout):
            calls.append(stage)
            self.assertNotIn("GITHUB_TOKEN", env)
            self.assertEqual(env["CT_SETUP_MODE"], "existing-only")
            self.assertGreater(timeout, 0)
            for key in h.PRIVILEGED:
                self.assertEqual(key in env, stage == "run")
            self.assertEqual("THROWAWAY_TEST_PASSWORD" in env, stage == "run")
            if stage in ("build-plan", "build-plan-with-receipt"):
                self.assertIn("VITE_SUPABASE_ANON_KEY", env)
            self.assertEqual(Path(env["CT_COUNTERS"]), self.root / "CT_COUNTERS.json")
            return 0

        self.assertEqual(self.execute(child), 0)
        self.assertEqual(calls, ["install-tools", "build-plan", "stimulus-preflight", "build-plan-with-receipt",
                                 "gate-and-validate", "run", "collect"])
        pending = json.loads((self.root / "pending-reconciliation.json").read_text())
        self.assertIn("REQUIRES_RECONCILIATION", pending["disposition"])
        with self.assertRaisesRegex(h.Refused, "PREVIOUS_ATTEMPT_UNRECONCILED"):
            self.execute(lambda *_: self.fail("no automatic retry"))

    def test_gate_failure_never_starts_live_or_collect_and_is_retained(self):
        calls = []

        def child(stage, *_):
            calls.append(stage)
            return 3 if stage == "gate-and-validate" else 0

        self.assertEqual(self.execute(child), 78)
        self.assertNotIn("run", calls)
        self.assertNotIn("collect", calls)
        self.assertTrue((self.root / "pending-reconciliation.json").exists())

    def test_failed_live_run_is_collected_and_cannot_become_success(self):
        calls = []

        def child(stage, *_):
            calls.append(stage)
            return 6 if stage == "run" else 0

        self.assertEqual(self.execute(child), 78)
        self.assertEqual(calls[-2:], ["run", "collect"])
        receipt = json.loads((self.root / ("attempt-" + self.request["runId"]) / "entrypoint-receipt.json").read_text())
        self.assertEqual(receipt["stages"][-2], {"stage": "run", "exit": 6})
        self.assertNotIn("PASS", json.dumps(receipt))

    def test_exception_leaves_pending_and_private_receipt_no_false_cleanup(self):
        def child(*_):
            raise RuntimeError("SYNTHETIC-PRIVATE-ERROR")

        with self.assertRaises(RuntimeError):
            self.execute(child)
        out = self.root / ("attempt-" + self.request["runId"])
        receipt = (out / "entrypoint-receipt.json").read_text()
        self.assertNotIn("SYNTHETIC-PRIVATE-ERROR", receipt)
        self.assertIn("NOT_INFERRED_FROM_EXIT", receipt)
        self.assertTrue((self.root / "pending-reconciliation.json").exists())

    def test_uncertain_run_launch_still_attempts_collect_without_inventing_exit(self):
        calls = []

        def child(stage, *_):
            calls.append(stage)
            if stage == "run":
                raise RuntimeError("unknown child launch state")
            return 0

        with self.assertRaises(RuntimeError):
            self.execute(child)
        self.assertEqual(calls[-2:], ["run", "collect"])
        out = self.root / ("attempt-" + self.request["runId"])
        receipt = json.loads((out / "entrypoint-receipt.json").read_text())
        self.assertEqual(receipt["stages"][-2], {"stage": "run", "exit": None})

    def test_forbidden_credentials_refuse_and_missing_run_credential_stops(self):
        self.env["STRIPE_SECRET_KEY"] = "SYNTHETIC"
        with self.assertRaisesRegex(h.Refused, "FORBIDDEN_CREDENTIAL_PRESENT"):
            self.execute(lambda *_: self.fail("must not run"))
        del self.env["STRIPE_SECRET_KEY"]
        del self.env["SUPABASE_SERVICE_ROLE_KEY"]
        calls = []
        with self.assertRaisesRegex(h.Refused, "PRODUCER_CREDENTIAL_UNAVAILABLE"):
            self.execute(lambda stage, *_: calls.append(stage) or 0)
        self.assertNotIn("run", calls)

    def test_actual_stage_runner_refuses_absent_existing_browser_without_live_run(self):
        # This invokes the real fixed stage script, not a stand-in. The browser
        # does not exist, so setup must refuse; no product request is authorized.
        self.assertFalse(Path(self.env["CT_CHROME"]).exists())
        self.save_manifest()
        self.assertEqual(h.execute(self.root, self.pin, self.env, now=lambda: self.now), 78)
        out = self.root / ("attempt-" + self.request["runId"])
        receipt = json.loads((out / "entrypoint-receipt.json").read_text())
        self.assertEqual(receipt["stages"], [{"stage": "install-tools", "exit": 78}])
        self.assertFalse((out / "run.log").exists())
        self.assertIn("existing browser verification failed", (out / "install-tools.log").read_text())

    def test_parent_cancellation_forwards_to_owned_stage_and_restores_handlers(self):
        handlers = {}
        sentinel = object()
        child = mock.Mock(pid=123456)
        entered = False

        def wait(**_):
            nonlocal entered
            if not entered:
                entered = True
                handlers[h.signal.SIGTERM](h.signal.SIGTERM, None)
            return 0

        def register(sig, fn):
            handlers[sig] = fn
            return sentinel

        child.wait.side_effect = wait
        out = self.root / "synthetic-cancel"
        out.mkdir()
        with mock.patch.object(h.subprocess, "Popen", return_value=child), \
                mock.patch.object(h.signal, "signal", side_effect=register), \
                mock.patch.object(h.os, "killpg") as kill:
            with self.assertRaisesRegex(h.Refused, "HOSTED_STAGE_INTERRUPTED"):
                h.invoke_stage("run", {}, out, 1)
            kill.assert_called_once_with(child.pid, h.signal.SIGTERM)
            self.assertIs(handlers[h.signal.SIGTERM], sentinel)
            self.assertIs(handlers[h.signal.SIGINT], sentinel)

    def test_stage_timeout_kills_owned_group_and_retains_nonzero_exit(self):
        child = mock.Mock(pid=123456)
        child.wait.side_effect = [h.subprocess.TimeoutExpired("synthetic", 1), 0]
        out = self.root / "synthetic-timeout"
        out.mkdir()
        with mock.patch.object(h.subprocess, "Popen", return_value=child), \
                mock.patch.object(h.os, "killpg") as kill:
            self.assertEqual(h.invoke_stage("run", {}, out, 1), 124)
            kill.assert_called_once_with(child.pid, h.signal.SIGKILL)


if __name__ == "__main__":
    unittest.main()
