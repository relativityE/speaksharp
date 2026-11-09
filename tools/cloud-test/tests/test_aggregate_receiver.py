"""Inactive, digest-pinned content-free retained-input receiver controls."""
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from _fixtures import ROOT, approved, fake_rv, reconciliation, sample
import aggregate_receiver as A
import check_gates as C
import full_coverage_budget as FB
import validate_run_request as V
from test_full_coverage import catalog, costs
from test_init_run_inputs import live_request
from case_start_caps import MINIMAL_MINIMA


class AggregateReceiver(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="aggregate-receiver-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        fixture = sample()
        self.request, self.ledger = approved(fixture["req"], fixture["ledger"])
        self.config, self.workflow = copy.deepcopy(fixture["cfg"]), copy.deepcopy(fixture["wf"])
        self.request["release"]["testedSha"] = "a" * 40
        self.request["approvedLimits"] = {**(self.request.get("approvedLimits") or {}), "approvalRef": "slack-1793000000.000001"}
        labels = [p["label"] for p in self.request["priorRuns"]]
        configured = {r["label"]: r["receiptsManifestSha256"] for r in self.config["history"]["runs"]}
        rc = reconciliation()
        rc.update(source="accepted-rollup", root="b" * 40, headSha="c" * 40,
                  scopeApprovalRef=self.request["approvedLimits"]["approvalRef"])
        release = fake_rv(); release["testedSha"] = "a" * 40
        self.docs = {
            "reconciliation": rc,
            "release-verification": release,
            "gap-ledger": self.ledger,
            "prior-run-verification": {"schema": "speaksharp.cloud-test.prior-run-verification.v1",
                "producers": ["verify_receipts.py", "verify_run_binding.py"], "runs": [
                {"label": label, "receiptsManifestSha256": configured[label],
                 "receiptsVerificationSha256": "e" * 64, "receiptCount": 1, "errors": [],
                 "binding": {"sha256": "d" * 64, "passed": 1, "failed": 0}}
                for label in labels]},
            "comparison-prior": json.loads((Path(ROOT) / "tests/fixtures/accepted-comparison-R5-vs-R4C.json").read_text()),
            "case-costs": {"schema": "speaksharp.cloud-test.case-costs.v1", "derived": True, **costs()},
        }
        entries = {}
        for name, doc in self.docs.items():
            data = json.dumps(doc, sort_keys=True).encode()
            filename = name + ".json"
            (self.root / filename).write_bytes(data)
            entries[name] = {"file": filename, "sha256": hashlib.sha256(data).hexdigest()}
        self.request_raw = json.dumps(self.request, sort_keys=True).encode()
        self.manifest = {"schema": A.SCHEMA, "requestSha256": hashlib.sha256(self.request_raw).hexdigest(), "runId": self.request["runId"],
                         "sourceSha": "a" * 40, "workflowVersion": self.request["workflowVersion"],
                         "codeManifestSha256": self.request["harness"]["codeManifestSha256"], "components": entries,
                         "bundleRootSha256": A.component_root(entries)}
        self.manifest_raw = json.dumps(self.manifest, sort_keys=True).encode()
        self.pins = {"activated": True, "manifestSha256": hashlib.sha256(self.manifest_raw).hexdigest(),
                     "bundleRootSha256": self.manifest["bundleRootSha256"]}
        self.config["aggregateReceiver"] = dict(self.pins)

    def rewrite_bundle(self, docs):
        manifest = copy.deepcopy(self.manifest)
        for name, doc in docs.items():
            payload = json.dumps(doc, sort_keys=True).encode()
            (self.root / (name + ".json")).write_bytes(payload)
            manifest["components"][name]["sha256"] = hashlib.sha256(payload).hexdigest()
        manifest["bundleRootSha256"] = A.component_root(manifest["components"])
        raw = json.dumps(manifest, sort_keys=True).encode()
        return raw, {"activated": True, "manifestSha256": hashlib.sha256(raw).hexdigest(),
                     "bundleRootSha256": manifest["bundleRootSha256"]}

    def receive(self, manifest=None, pins=None):
        return A.receive(manifest or self.manifest_raw, str(self.root), self.request_raw, self.config, pins or self.pins)

    def test_exact_pinned_bundle_reaches_the_actual_gate_consumers(self):
        docs = self.receive()
        self.assertEqual(set(docs), set(A.REQUIRED))
        self.assertTrue(all(r["passed"] for r in docs["prior-run-verification"]["runs"]))
        self.assertTrue(all(r["reconciliation"]["ok"] for r in docs["case-costs"]["runs"].values()))
        _, accepted, _envelope = A.receive_bundle(self.manifest_raw, str(self.root), self.request_raw, self.config, self.pins)
        receipt = A.receiver_receipt(self.manifest_raw, self.request_raw, accepted, self.pins)
        self.assertEqual((receipt["requestSha256"], receipt["sourceSha"]),
                         (hashlib.sha256(self.request_raw).hexdigest(), "a" * 40))
        self.assertEqual(receipt["acceptedSha256"]["reconciliation"], A.digest(accepted["reconciliation"]))
        # The accepted components reach the ordinary product consumers, not a
        # receiver-only boolean assertion.
        budget = FB.compute(self.config, docs["case-costs"], catalog(), docs["reconciliation"])
        errors, _ = V.validate(self.request, self.config, docs["gap-ledger"], self.workflow,
                               docs["release-verification"], docs["reconciliation"], budget)
        self.assertEqual(errors, [])
        gate = C.evaluate(self.request, self.config, docs["gap-ledger"], self.workflow,
                          {"valid": True, "errors": []}, {"passed": True}, None, str(self.root),
                          rv=docs["release-verification"], rc=docs["reconciliation"],
                          prior_verification=docs["prior-run-verification"], prior_comparison=docs["comparison-prior"],
                          receiver_receipt=receipt, request_sha256=hashlib.sha256(self.request_raw).hexdigest(), receiver_verified=True)
        self.assertEqual(next(g["status"] for g in gate["gates"] if g["id"] == "G7"), "READY")

    def test_missing_substituted_stale_or_unknown_evidence_refuses(self):
        expected = {"inactive": "aggregate-receiver-not-activated", "manifest": "aggregate-manifest-not-pinned",
                    "component": "aggregate-component-digest:comparison-prior", "source": "aggregate-source-binding",
                    "unknown": "aggregate-manifest-shape", "prior": "aggregate-prior-run-verification",
                    "cost": "aggregate-case-costs"}
        for case in ("inactive", "manifest", "component", "source", "unknown", "prior", "cost"):
            docs = copy.deepcopy(self.docs)
            _, _ = self.rewrite_bundle(docs)
            manifest, pins = copy.deepcopy(self.manifest), dict(self.pins)
            if case == "inactive":
                pins["activated"] = False
            elif case == "manifest":
                pins["manifestSha256"] = "0" * 64
            elif case == "component":
                (self.root / manifest["components"]["comparison-prior"]["file"]).write_text("{}")
            elif case == "source":
                manifest["sourceSha"] = "f" * 40
            elif case == "unknown":
                manifest["components"]["extra"] = {"file": "x", "sha256": "0" * 64}
            elif case == "prior":
                docs["prior-run-verification"]["runs"][0]["binding"]["failed"] = 1
            else:
                docs["case-costs"]["runs"].pop(self.config["history"]["comparisonBaselines"][0])
            if case in ("source", "unknown"):
                data = json.dumps(manifest, sort_keys=True).encode(); pins["manifestSha256"] = hashlib.sha256(data).hexdigest()
            else:
                data = self.manifest_raw
            if case in ("prior", "cost"):
                data, pins = self.rewrite_bundle(docs)
            with self.subTest(case=case), self.assertRaises(A.Refused) as error:
                self.receive(data, pins)
            self.assertEqual(str(error.exception), expected[case])

    def test_header_only_or_unprovenanced_comparison_is_not_evidence(self):
        for case in ("header-only", "wrong-generator"):
            docs = copy.deepcopy(self.docs)
            if case == "header-only":
                docs["comparison-prior"] = {
                    "schema": "speaksharp.run-comparison.v1",
                    "previous": {"label": self.config["history"]["comparisonBaselines"][0]},
                    "current": {"label": self.config["history"]["comparisonBaselines"][1]},
                }
            else:
                docs["comparison-prior"]["generator"]["name"] = "caller-authored-summary"
            manifest, pins = self.rewrite_bundle(docs)
            with self.subTest(case=case), self.assertRaises(A.Refused) as error:
                self.receive(manifest, pins)
            self.assertEqual(str(error.exception), "aggregate-comparison-basis")

    def test_cli_refuses_before_reading_missing_inputs_while_unactivated(self):
        config = self.root / "inactive-config.json"
        config.write_text(json.dumps({"aggregateReceiver": {"activated": False}}))
        result = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "aggregate_receiver.py"),
                                 "--manifest", "/missing", "--request", "/missing", "--config", str(config), "--out-dir", str(self.root / "out")],
                                capture_output=True, text=True)
        self.assertEqual((result.returncode, result.stderr.strip()), (78, "BLOCKED_SETUP: aggregate-receiver-not-activated"))

    def test_the_received_bundle_runs_the_ordinary_validation_and_gate_pipeline(self):
        config = self.root / "active-config.json"; config.write_text(json.dumps(self.config))
        request = self.root / "request.json"; request.write_bytes(self.request_raw)
        manifest = self.root / "manifest.json"; manifest.write_bytes(self.manifest_raw)
        accepted, output = self.root / "accepted", self.root / "pipeline-output"
        result = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "aggregate_receiver.py"),
                                 "--manifest", str(manifest), "--request", str(request), "--config", str(config), "--out-dir", str(accepted)],
                                capture_output=True, text=True, env={"PATH": os.environ["PATH"], "HOME": str(self.root)})
        self.assertEqual(result.returncode, 0, result.stderr)
        proof = self.root / "proof.json"
        proof.write_text(json.dumps({"codeManifestSha256": self.request["harness"]["codeManifestSha256"],
                                    "corrections": [{"id": "SYNTHETIC", "result": "PASS"}]}))
        checks = self.root / "checks.json"; checks.write_text('{"passed":true}\n')
        created = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        stimulus = self.root / "stimulus.json"
        stimulus.write_text(json.dumps({"createdAt": created, "productTraffic": 0,
            "codeManifestSha256": self.request["harness"]["codeManifestSha256"],
            "cases": {s["case"]: {"ready": True} for s in self.request["selection"] if s.get("needsCaptureDevice")}}))
        # These foreign paths deliberately contain unusable values.  Once the
        # receiver is admitted, the standalone gate consumer must use the exact
        # verified retained bytes for all three inputs rather than pairing a
        # genuine receipt with caller-selected current evidence.
        foreign = self.root / "foreign"; foreign.mkdir()
        for name in ("gap-ledger", "release-verification", "reconciliation"):
            (foreign / (name + ".json")).write_text('{}\n')
        result = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "pipeline.py"),
                                 "--request", str(request), "--config", str(config), "--workflow", os.path.join(ROOT, "workflow.json"),
                                 "--ledger", str(foreign / "gap-ledger.json"),
                                 "--accepted-input-dir", str(accepted), "--receiver-receipt", str(accepted / "receiver-receipt.json"),
                                 "--receiver-manifest", str(manifest),
                                 "--offline-checks", str(checks), "--offline-proof", str(proof), "--stimulus-receipt", str(stimulus),
                                 "--stage", "final", "--out-dir", str(output), "--require-secret-free"],
                                capture_output=True, text=True, env={"PATH": os.environ["PATH"], "HOME": str(self.root)})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(json.loads((output / "request-validation.json").read_text())["valid"])
        gates = json.loads((output / "gate-status.json").read_text())["gates"]
        self.assertEqual(next(g["status"] for g in gates if g["id"] == "G7"), "READY")
        consumed = json.loads((output / "comparison-consumption.json").read_text())
        self.assertEqual((len(consumed["journeys"]), consumed["manifestSha256"]),
                         (15, self.pins["manifestSha256"]))
        standalone = self.root / "standalone-gates.json"
        direct = subprocess.run([
            sys.executable, "-I", os.path.join(ROOT, "scripts", "check_gates.py"),
            "--request", str(request), "--config", str(config),
            "--ledger", str(foreign / "gap-ledger.json"), "--workflow", os.path.join(ROOT, "workflow.json"),
            "--release-verification", str(foreign / "release-verification.json"),
            "--reconciliation", str(foreign / "reconciliation.json"),
            "--validation", str(output / "request-validation.json"),
            "--offline-checks", str(checks), "--offline-proof", str(proof),
            "--stimulus-receipt", str(stimulus), "--prior-verification", str(accepted / "prior-run-verification.json"),
            "--prior-comparison", str(accepted / "comparison-prior.json"),
            "--receiver-receipt", str(accepted / "receiver-receipt.json"),
            "--receiver-manifest", str(manifest), "--accepted-input-dir", str(accepted),
            "--stage", "final", "--base", ROOT, "--out", str(standalone),
        ], capture_output=True, text=True, env={"PATH": os.environ["PATH"], "HOME": str(self.root)})
        self.assertEqual(direct.returncode, 0, direct.stdout + direct.stderr)
        direct_gates = json.loads(standalone.read_text())["gates"]
        self.assertEqual(next(g["status"] for g in direct_gates if g["id"] == "G7"), "READY")
        self.assertEqual(next(g["status"] for g in direct_gates if g["id"] == "G2"), "READY")

    def test_received_smoke_request_uses_smoke_denominator_in_actual_report_pipeline(self):
        request_value = live_request()
        request_value["coverageMode"] = "smoke"
        request_value["sampleMode"] = "smoke"
        request_value["priority"] = "journey-smoke"
        for row in request_value["selection"]:
            row["startPressCap"] = MINIMAL_MINIMA[row["case"]]
            row["plannedRequests"] = 100
        starts = sum(MINIMAL_MINIMA.values())
        request_value["estimate"]["starts"] = starts
        request_value["estimate"]["identityReads"] = 32
        request_value["estimate"]["requests"].update(planned=1500, cleanupReserve=150, pooledSlack=350, runCap=2000)
        request_value["estimate"].pop("window", None)
        request_value["proposedLimits"]["startPressCaps"] = dict(MINIMAL_MINIMA)
        request_value["proposedLimits"]["runCapRequests"] = 2000
        request_value["proposedLimits"]["cumulativeCeilingRequests"] = request_value["approvedLimits"]["cumulativeCeilingRequests"]
        request_value["approvedLimits"]["startPressCaps"] = dict(MINIMAL_MINIMA)
        request_value["approvedLimits"]["runCapRequests"] = 2000
        request_value["approvedLimits"]["approvalRef"] = self.docs["reconciliation"]["scopeApprovalRef"]
        self.request = request_value
        self.request_raw = json.dumps(self.request, sort_keys=True).encode()
        self.manifest["requestSha256"] = hashlib.sha256(self.request_raw).hexdigest()
        self.manifest["runId"] = self.request["runId"]
        self.manifest["workflowVersion"] = self.request["workflowVersion"]
        self.manifest["codeManifestSha256"] = self.request["harness"]["codeManifestSha256"]
        release = self.docs["release-verification"]
        release["frontend"] = dict(release["frontend"], evidence="synthetic identity ledger", ageHours=1.0)
        release.setdefault("commitVerdicts", [])
        release_raw = json.dumps(release, sort_keys=True).encode()
        (self.root / "release-verification.json").write_bytes(release_raw)
        self.manifest["components"]["release-verification"]["sha256"] = hashlib.sha256(release_raw).hexdigest()
        self.manifest["bundleRootSha256"] = A.component_root(self.manifest["components"])
        self.manifest_raw = json.dumps(self.manifest, sort_keys=True).encode()
        self.pins = {"activated": True, "manifestSha256": hashlib.sha256(self.manifest_raw).hexdigest(),
                     "bundleRootSha256": self.manifest["bundleRootSha256"]}
        self.config["aggregateReceiver"] = dict(self.pins)

        config = self.root / "smoke-config.json"; config.write_text(json.dumps(self.config))
        request = self.root / "smoke-request.json"; request.write_bytes(self.request_raw)
        manifest = self.root / "smoke-manifest.json"; manifest.write_bytes(self.manifest_raw)
        accepted, output = self.root / "smoke-accepted", self.root / "smoke-output"
        received = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "aggregate_receiver.py"),
                                   "--manifest", str(manifest), "--request", str(request), "--config", str(config), "--out-dir", str(accepted)],
                                  capture_output=True, text=True, env={"PATH": os.environ["PATH"], "HOME": str(self.root)})
        self.assertEqual(received.returncode, 0, received.stdout + received.stderr)
        proof = self.root / "smoke-proof.json"
        proof.write_text(json.dumps({"result": "PASS", "codeManifestSha256": self.request["harness"]["codeManifestSha256"],
                                     "testsPassed": 1, "testsFailed": 0,
                                     "planControls": {"negative": 1, "negativeRefused": 1, "positive": 1, "positiveAccepted": 1},
                                     "corrections": [{"id": "SYNTHETIC", "correction": "synthetic offline proof",
                                                       "result": "PASS", "tests": [], "mutationControls": []}]}))
        checks = self.root / "smoke-checks.json"; checks.write_text('{"passed":true}\n')
        created = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        stimulus = self.root / "smoke-stimulus.json"
        stimulus.write_text(json.dumps({"createdAt": created, "productTraffic": 0,
            "codeManifestSha256": self.request["harness"]["codeManifestSha256"],
            "cases": {s["case"]: {"ready": True} for s in self.request["selection"] if s.get("needsCaptureDevice")}}))
        result = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "pipeline.py"),
                                 "--request", str(request), "--config", str(config), "--workflow", os.path.join(ROOT, "workflow.json"),
                                 "--accepted-input-dir", str(accepted), "--receiver-receipt", str(accepted / "receiver-receipt.json"),
                                 "--receiver-manifest", str(manifest), "--offline-checks", str(checks), "--offline-proof", str(proof),
                                 "--stimulus-receipt", str(stimulus), "--stage", "final", "--out-dir", str(output), "--require-secret-free"],
                                capture_output=True, text=True, env={"PATH": os.environ["PATH"], "HOME": str(self.root)})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        coverage = json.loads((output / "coverage.json").read_text())
        self.assertEqual(coverage["kind"], "NO RUN")
        self.assertEqual(coverage["coverageMode"], "smoke")
        self.assertEqual(coverage["rowsRequired"], 142)    # + AHT-07 older-take-association, + AHT-02/03 smoke-focus-readback
        self.assertEqual(coverage["casesRequired"], 15)
        self.assertFalse(coverage["fullLiveRun"])
        summary = json.loads((output / "summary.json").read_text())
        self.assertEqual(summary["fields"]["readinessBasis"]["runKind"], "NO RUN")
        report = json.loads((output / "report" / "report.json").read_text())
        self.assertEqual(report["coverageMode"], "smoke")
        self.assertEqual(report["coverage"]["rowsRequired"], 142)

    def test_verified_buffers_are_consumed_even_if_the_caller_substitutes_after_validation(self):
        config = self.root / "active-config-substitution.json"; config.write_text(json.dumps(self.config))
        request = self.root / "request-substitution.json"; request.write_bytes(self.request_raw)
        manifest = self.root / "manifest-substitution.json"; manifest.write_bytes(self.manifest_raw)
        accepted = self.root / "accepted-substitution"
        result = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "aggregate_receiver.py"),
                                 "--manifest", str(manifest), "--request", str(request), "--config", str(config), "--out-dir", str(accepted)],
                                capture_output=True, text=True, env={"PATH": os.environ["PATH"], "HOME": str(self.root)})
        self.assertEqual(result.returncode, 0, result.stderr)
        _, buffers, receipt = A.verified_accepted(str(manifest), str(request), str(accepted), self.config)
        original = buffers["comparison-prior"]
        (accepted / "comparison-prior.json").write_text('{"substituted":true}\n')
        snapshot = self.root / "consumer-snapshot"
        A.materialize_verified(str(snapshot), buffers, receipt)
        self.assertEqual((snapshot / "comparison-prior.json").read_bytes(), original)
        with self.assertRaises(A.Refused) as error:
            A.verified_accepted(str(manifest), str(request), str(accepted), self.config)
        self.assertEqual(str(error.exception), "aggregate-accepted-substitution:comparison-prior")
        refused_out = self.root / "substituted-pipeline-output"
        refused = subprocess.run([
            sys.executable, "-I", os.path.join(ROOT, "scripts", "pipeline.py"),
            "--request", str(request), "--config", str(config), "--workflow", os.path.join(ROOT, "workflow.json"),
            "--accepted-input-dir", str(accepted), "--receiver-manifest", str(manifest),
            "--out-dir", str(refused_out),
        ], capture_output=True, text=True, env={"PATH": os.environ["PATH"], "HOME": str(self.root)})
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("aggregate-accepted-substitution:comparison-prior", refused.stderr)
        self.assertFalse((refused_out / "request-validation.json").exists(),
                         "a substituted accepted component must refuse before ordinary gate effects")


if __name__ == "__main__":
    unittest.main()


class RecurringOccurrenceEnvelope(unittest.TestCase):
    """#1772 Code finding 4446324167: each nightly occurrence has new request bytes and a new campaign, so a v1 manifest pinned to one
    occurrence refuses the next (aggregate-request-binding). A v2 manifest pins only the historical components and the release; the
    request/campaign binding and the reconciliation come from an occurrence envelope derived from the verified journal snapshot."""
    setUp = AggregateReceiver.setUp  # the same pinned bundle fixture, without re-running the v1 receiver tests

    def occurrence(self, request_raw, campaign, head="c" * 40, events=None, reconciliation_head=None):
        own = {"type": "reserve", "campaignId": campaign, "runId": "101", "attempt": 1, "allocation": {},
               "provenance": "request-sha256:" + hashlib.sha256(request_raw).hexdigest(), "atUtc": "2026-11-02T03:00:30Z"}
        snapshot = {"schema": A.JOURNAL_SNAPSHOT_SCHEMA, "headSha": head, "events": [own] if events is None else events(own)}
        rc = dict(self.docs["reconciliation"], headSha=reconciliation_head or head)
        return {"journalSnapshot": json.dumps(snapshot, sort_keys=True).encode(), "reconciliation": json.dumps(rc, sort_keys=True).encode(),
                "releaseVerification": json.dumps(self.docs["release-verification"], sort_keys=True).encode()}

    def authenticated_as(self, occurrence, parent_head=None):
        """The approved state ref, as G11's boundary would authenticate it, is exactly the supplied snapshot (unit controls of the reserve and
        checkpoint logic; the real-ref controls below authenticate through an actual state ref)."""
        from unittest import mock
        snap = json.loads(occurrence["journalSnapshot"])
        def transition(parent, current, events):
            if parent_head is None or parent != parent_head or current != snap["headSha"] or events != snap["events"]:
                raise __import__("state_ref_writer").Refused("journal-parent-transition")
            return parent_head, events[:-1]
        return mock.patch.multiple(C, authenticated_chain=lambda: (snap["headSha"], snap["events"]),
                                   authenticated_parent_transition=transition)

    def nightly(self, campaign):
        request = dict(copy.deepcopy(self.request), priority="nightly-regression", runId=campaign)
        return request, json.dumps(request, sort_keys=True).encode()

    def v2(self):
        entries = {name: e for name, e in self.manifest["components"].items() if name not in A.RUNTIME_OCCURRENCE}
        manifest = {"schema": A.OCCURRENCE_SCHEMA, "workflowVersion": self.request["workflowVersion"],
                    "codeManifestSha256": self.request["harness"]["codeManifestSha256"], "components": entries,
                    "bundleRootSha256": A.component_root(entries)}
        raw = json.dumps(manifest, sort_keys=True).encode()
        return raw, {"activated": True, "manifestSha256": hashlib.sha256(raw).hexdigest(), "bundleRootSha256": manifest["bundleRootSha256"]}

    def test_one_pinned_manifest_serves_every_occurrence_through_its_verified_envelope(self):
        first, first_raw = self.nightly("nightly-2026-11-02")
        second, second_raw = self.nightly("nightly-2026-11-03")
        # broken before: the v1 manifest names one occurrence's request, so the next occurrence refuses
        v1 = dict(self.manifest, requestSha256=hashlib.sha256(first_raw).hexdigest(), runId=first["runId"])
        v1_raw = json.dumps(v1, sort_keys=True).encode()
        v1_pins = {"activated": True, "manifestSha256": hashlib.sha256(v1_raw).hexdigest(), "bundleRootSha256": v1["bundleRootSha256"]}
        with self.assertRaisesRegex(A.Refused, "aggregate-request-binding"):
            A.receive_bundle(v1_raw, str(self.root), second_raw, self.config, v1_pins)
        # fixed after: ONE pinned v2 manifest admits both occurrences, each bound by its own envelope
        raw, pins = self.v2()
        for request, request_raw in ((first, first_raw), (second, second_raw)):
            occurrence = self.occurrence(request_raw, request["runId"])
            with self.authenticated_as(occurrence):
                docs, accepted, envelope = A.receive_bundle(raw, str(self.root), request_raw, self.config, pins, occurrence)
            self.assertEqual((envelope["requestSha256"], envelope["campaignId"], envelope["journalHeadSha"], envelope["executionRunId"]),
                             (hashlib.sha256(request_raw).hexdigest(), request["runId"], "c" * 40, "101"))
            self.assertEqual(accepted["reconciliation"], occurrence["reconciliation"], "the occurrence's checkpoint, not a pinned one")
            receipt = A.receiver_receipt(raw, request_raw, accepted, pins, envelope)
            # the retained historical components are recorded apart from the occurrence envelope
            self.assertNotIn("reconciliation", receipt["retainedComponentSha256"])
            self.assertNotIn("release-verification", receipt["retainedComponentSha256"])
            self.assertEqual(receipt["occurrence"], envelope)

    def test_the_envelope_binds_only_this_requests_own_open_reserve_and_its_checkpoint(self):
        request, request_raw = self.nightly("nightly-2026-11-03")
        raw, pins = self.v2()
        other = self.nightly("nightly-2026-11-04")[1]
        cases = (
            ("no occurrence inputs", None, "aggregate-occurrence-missing"),
            ("release verification omitted", {k: v for k, v in self.occurrence(request_raw, request["runId"]).items()
                                               if k != "releaseVerification"}, "aggregate-occurrence-missing"),
            ("no own reserve", self.occurrence(request_raw, request["runId"], events=lambda own: []), "aggregate-occurrence-reserve"),
            ("another request's reserve", self.occurrence(other, request["runId"]), "aggregate-occurrence-reserve"),
            ("another campaign", self.occurrence(request_raw, "nightly-other"), "aggregate-occurrence-reserve"),
            ("own reserve already settled", self.occurrence(request_raw, request["runId"],
                                                            events=lambda own: [own, dict(own, type="settle")]), "aggregate-occurrence-reserve"),
            ("two own reserves", self.occurrence(request_raw, request["runId"], events=lambda own: [own, dict(own, runId="102")]),
             "aggregate-occurrence-reserve"),
            ("checkpoint at another head", self.occurrence(request_raw, request["runId"], reconciliation_head="d" * 40),
             "aggregate-occurrence-reconciliation"),
        )
        for label, occurrence, code in cases:
            with self.assertRaisesRegex(A.Refused, code, msg=label):
                if occurrence is None:
                    A.receive_bundle(raw, str(self.root), request_raw, self.config, pins, occurrence)
                else:
                    with self.authenticated_as(occurrence):
                        A.receive_bundle(raw, str(self.root), request_raw, self.config, pins, occurrence)
        # a manual request never uses the occurrence route, and v1 never accepts an envelope
        manual = dict(self.request, priority="full-coverage")
        manual_raw = json.dumps(manual, sort_keys=True).encode()
        parent = "d" * 40
        occurrence = self.occurrence(manual_raw, manual["runId"], reconciliation_head=parent)
        with self.authenticated_as(occurrence, parent):
            docs, accepted, envelope = A.receive_bundle(raw, str(self.root), manual_raw, self.config, pins, occurrence)
        self.assertEqual(envelope["testedSha"], manual["release"]["testedSha"])
        self.assertEqual(accepted["release-verification"], occurrence["releaseVerification"])
        with self.assertRaisesRegex(A.Refused, "aggregate-occurrence-priority"):
            unsupported = dict(manual, priority="prove-deployed-fix")
            unsupported_raw = json.dumps(unsupported, sort_keys=True).encode()
            A.receive_bundle(raw, str(self.root), unsupported_raw, self.config, pins,
                             self.occurrence(unsupported_raw, unsupported["runId"]))
        with self.assertRaisesRegex(A.Refused, "aggregate-occurrence-unexpected"):
            A.receive_bundle(self.manifest_raw, str(self.root), self.request_raw, self.config, self.pins,
                             self.occurrence(self.request_raw, self.request["runId"]))

    def test_manual_occurrence_requires_the_exact_parent_to_own_reserve_transition(self):
        manual = dict(copy.deepcopy(self.request), priority="full-coverage", runId="R10-manual")
        request_raw = json.dumps(manual, sort_keys=True).encode()
        raw, pins = self.v2()
        parent = "d" * 40
        good = self.occurrence(request_raw, manual["runId"], reconciliation_head=parent)
        with self.authenticated_as(good, parent):
            _docs, _accepted, envelope = A.receive_bundle(raw, str(self.root), request_raw, self.config, pins, good)
        self.assertEqual(envelope["journalHeadSha"], "c" * 40)

        later = self.occurrence(request_raw, manual["runId"], reconciliation_head=parent,
                                events=lambda own: [own, dict(own, campaignId="foreign", runId="999",
                                                               provenance="request-sha256:" + "0" * 64)])
        with self.authenticated_as(later, parent), self.assertRaisesRegex(A.Refused, "aggregate-occurrence-reserve-transition"):
            A.receive_bundle(raw, str(self.root), request_raw, self.config, pins, later)
        closed = self.occurrence(request_raw, manual["runId"], reconciliation_head=parent,
                                 events=lambda own: [own, dict(own, type="settle")])
        with self.authenticated_as(closed, parent), self.assertRaisesRegex(A.Refused, "aggregate-occurrence-reserve"):
            A.receive_bundle(raw, str(self.root), request_raw, self.config, pins, closed)
        duplicate = self.occurrence(request_raw, manual["runId"], reconciliation_head=parent,
                                    events=lambda own: [own, dict(own, runId="102")])
        with self.authenticated_as(duplicate, parent), self.assertRaisesRegex(A.Refused, "aggregate-occurrence-reserve"):
            A.receive_bundle(raw, str(self.root), request_raw, self.config, pins, duplicate)
        with self.authenticated_as(good, "e" * 40), self.assertRaisesRegex(A.Refused, "aggregate-occurrence-reconciliation"):
            A.receive_bundle(raw, str(self.root), request_raw, self.config, pins, good)

    def test_retained_preflight_pins_only_genuine_historical_components(self):
        raw, pins = self.v2()
        manifest, docs, accepted = A.receive_retained(raw, str(self.root), pins)
        self.assertEqual(set(accepted), set(A.RETAINED_OCCURRENCE))
        self.assertEqual(set(docs), set(A.RETAINED_OCCURRENCE))
        self.assertFalse(set(A.RUNTIME_OCCURRENCE) & set(manifest["components"]))
        for forbidden in ("requestSha256", "runId", "sourceSha"):
            self.assertNotIn(forbidden, manifest)

        future = dict(manifest, sourceSha="a" * 40)
        future_raw = json.dumps(future, sort_keys=True).encode()
        future_pins = dict(pins, manifestSha256=hashlib.sha256(future_raw).hexdigest())
        with self.assertRaisesRegex(A.Refused, "aggregate-manifest-shape"):
            A.receive_retained(future_raw, str(self.root), future_pins)

        gap = self.root / manifest["components"]["gap-ledger"]["file"]
        original = gap.read_bytes()
        gap.write_bytes(original + b" ")
        try:
            with self.assertRaisesRegex(A.Refused, "aggregate-component-digest:gap-ledger"):
                A.receive_retained(raw, str(self.root), pins)
        finally:
            gap.write_bytes(original)


class OccurrenceEnvelopeOnARealStateRef(unittest.TestCase):
    """the CLI developer RETURN : the receiver authenticates the occurrence snapshot itself, through G11's own boundary
    (check_gates.authenticated_chain: a fresh fetch of the approved ref and whole-chain validation), before any accepted bytes or receipt.
    A REAL state ref (the writer tests' local bare repository) carries two occurrences; well-shaped fabricated, reduced, stale and
    unauthenticated snapshots never produce a receipt."""
    nightly, v2 = RecurringOccurrenceEnvelope.nightly, RecurringOccurrenceEnvelope.v2

    def setUp(self):
        AggregateReceiver.setUp(self)
        from test_accounting_rollup import Journal
        self.journal = Journal("setUp")  # the state-ref fixture, composed (its attribute names differ from this bundle fixture's)
        self.journal.setUp()
        self.addCleanup(self.journal.doCleanups)

    def push(self, event):
        import state_ref_writer as W
        j = self.journal
        W.propose(j.repo, j.remote, W.fetch_head(j.repo, j.remote, j.remote), event, j.root, j.remote)

    def real_occurrence(self, request_raw, head_events=None, reconciliation_head=None):
        head, events, _ = self.journal.chain()[-1]
        snapshot = {"schema": A.JOURNAL_SNAPSHOT_SCHEMA, "headSha": head, "events": events if head_events is None else head_events}
        rc = dict(self.docs["reconciliation"], headSha=reconciliation_head or head)
        return {"journalSnapshot": json.dumps(snapshot, sort_keys=True).encode(), "reconciliation": json.dumps(rc, sort_keys=True).encode(),
                "releaseVerification": json.dumps(self.docs["release-verification"], sort_keys=True).encode()}

    def reserve(self, request, request_raw, run):
        from reservations import CATS
        return {"type": "reserve", "campaignId": request["runId"], "runId": run, "attempt": 1, "allocation": {k: 10 for k in CATS},
                "provenance": "request-sha256:" + hashlib.sha256(request_raw).hexdigest(), "atUtc": "2026-11-02T03:00:00Z"}

    def receive_real(self, request_raw, occurrence, pinned=True):
        from unittest import mock
        raw, pins = self.v2()
        with mock.patch.object(C, "JOURNAL_URL", self.journal.remote if pinned else None), \
                mock.patch.object(C, "JOURNAL_ROOT", self.journal.root if pinned else None):
            return A.receive_bundle(raw, str(self.root), request_raw, self.config, pins, occurrence)

    def test_two_real_occurrences_are_received_through_the_authenticated_ref(self):
        for campaign, run in (("nightly-2026-11-03", "101"), ("nightly-2026-11-04", "102")):
            request, request_raw = self.nightly(campaign)
            self.push(self.reserve(request, request_raw, run))
            _, accepted, envelope = self.receive_real(request_raw, self.real_occurrence(request_raw))
            self.assertEqual((envelope["campaignId"], envelope["executionRunId"], envelope["journalHeadSha"]),
                             (campaign, run, self.journal.chain()[-1][0]))

    def test_a_real_manual_occurrence_binds_the_pre_reserve_parent_to_its_own_reserve_head(self):
        request = dict(copy.deepcopy(self.request), priority="full-coverage", runId="R10-manual")
        request_raw = json.dumps(request, sort_keys=True).encode()
        parent = self.journal.chain()[-1][0]
        self.push(self.reserve(request, request_raw, "101"))
        occurrence = self.real_occurrence(request_raw, reconciliation_head=parent)
        _docs, _accepted, envelope = self.receive_real(request_raw, occurrence)
        self.assertEqual((envelope["campaignId"], envelope["executionRunId"]), ("R10-manual", "101"))

    def test_a_fabricated_reduced_stale_or_unauthenticated_snapshot_produces_no_receipt(self):
        # broken before: receive_occurrence parsed the supplied JSON alone, so a well-shaped fabrication was accepted
        request, request_raw = self.nightly("nightly-2026-11-03")
        self.push(self.reserve(request, request_raw, "101"))
        good = self.real_occurrence(request_raw)
        snap = json.loads(good["journalSnapshot"])
        self.push(self.reserve(dict(request, runId="nightly-other"), request_raw, "900"))  # the ref moves on
        stale = good
        current = self.real_occurrence(request_raw)
        cur = json.loads(current["journalSnapshot"])

        def variant(**over):
            doc = dict(cur, **over)
            rc = dict(self.docs["reconciliation"], headSha=doc["headSha"])
            return {"journalSnapshot": json.dumps(doc, sort_keys=True).encode(), "reconciliation": json.dumps(rc, sort_keys=True).encode(),
                    "releaseVerification": json.dumps(self.docs["release-verification"], sort_keys=True).encode()}
        cases = {
            "fabricated head": variant(headSha="c" * 40),
            "fabricated ledger": variant(events=[dict(e, allocation={k: 1 for k in e["allocation"]}) for e in cur["events"]]),
            "reduced ledger": variant(events=cur["events"][:1]),
            "stale (the ref moved on)": stale,
        }
        for label, occurrence in cases.items():
            with self.assertRaisesRegex(A.Refused, "aggregate-occurrence-journal-unauthenticated", msg=label):
                self.receive_real(request_raw, occurrence)
        with self.assertRaisesRegex(A.Refused, "aggregate-occurrence-journal-unauthenticated"):
            self.receive_real(request_raw, current, pinned=False)  # no reviewed root: nothing can be authenticated
        self.assertEqual(self.receive_real(request_raw, current)[2]["journalHeadSha"], cur["headSha"])  # the current ref still admits it
        self.assertNotEqual(snap["headSha"], cur["headSha"])

    def test_the_final_g7_gate_accepts_the_authenticated_v2_receipt_and_refuses_a_mismatched_one(self):
        # #1772 Code finding 4447009633 (broken before: G7 accepted only a v1 receipt with a top-level requestSha256, so a real nightly v2
        # occurrence receipt could never pass the final gate). The v2 receipt is bound through its authenticated occurrence envelope.
        request, request_raw = self.nightly("nightly-2026-11-03")
        self.push(self.reserve(request, request_raw, "101"))
        docs, accepted, envelope = self.receive_real(request_raw, self.real_occurrence(request_raw))
        raw, pins = self.v2()
        receipt = A.receiver_receipt(raw, request_raw, accepted, pins, envelope)
        sha = hashlib.sha256(request_raw).hexdigest()

        def g7(rr, req=request, digest=sha):
            gate = C.evaluate(req, self.config, docs["gap-ledger"], self.workflow, {"valid": True, "errors": []}, {"passed": True}, None,
                              str(self.root), rv=docs["release-verification"], rc=docs["reconciliation"],
                              prior_verification=docs["prior-run-verification"], prior_comparison=docs["comparison-prior"],
                              receiver_receipt=rr, request_sha256=digest, receiver_verified=True)
            return next(g["status"] for g in gate["gates"] if g["id"] == "G7")
        self.assertEqual(g7(receipt), "READY", "fixed after: the real authenticated v2 receipt passes the final gate")
        manual = dict(request, priority="full-coverage")
        self.assertEqual(g7(receipt, manual, sha), "READY", "the authenticated manual full-coverage occurrence uses the same boundary")
        other = dict(receipt, occurrence=dict(envelope, requestSha256="b" * 64))
        for label, rr, req, digest in (
                ("another request in the envelope", other, request, sha),
                ("another campaign in the envelope", dict(receipt, occurrence=dict(envelope, campaignId="nightly-other")), request, sha),
                ("the receipt of another request", receipt, request, "c" * 64),
                ("a v2 receipt for an unsupported priority", receipt, dict(request, priority="prove-deployed-fix"), sha),
                ("another tested release", dict(receipt, occurrence=dict(envelope, testedSha="d" * 40)), request, sha),
                ("a v2 receipt that also claims a top-level request", dict(receipt, requestSha256=sha), request, sha),
                ("a v1 receipt carrying an envelope", dict(receipt, schema="speaksharp.cloud-test.aggregate-receiver-receipt.v1",
                                                           requestSha256=sha), request, sha)):
            self.assertNotEqual(g7(rr, req, digest), "READY", label)
