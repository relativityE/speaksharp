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
            "comparison-prior": {"schema": "speaksharp.run-comparison.v1", "previous": {"label": self.config["history"]["comparisonBaselines"][0]},
                                 "current": {"label": self.config["history"]["comparisonBaselines"][1]}},
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
        receipt = A.receiver_receipt(self.manifest_raw, self.request_raw, docs, self.pins)
        self.assertEqual((receipt["requestSha256"], receipt["sourceSha"]),
                         (hashlib.sha256(self.request_raw).hexdigest(), "a" * 40))
        self.assertEqual(receipt["acceptedSha256"]["reconciliation"], A.digest(A.canon(docs["reconciliation"])))
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
                          receiver_receipt=receipt, request_sha256=hashlib.sha256(self.request_raw).hexdigest())
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
        result = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "pipeline.py"),
                                 "--request", str(request), "--config", str(config), "--workflow", os.path.join(ROOT, "workflow.json"),
                                 "--accepted-input-dir", str(accepted), "--receiver-receipt", str(accepted / "receiver-receipt.json"),
                                 "--offline-checks", str(checks), "--offline-proof", str(proof), "--stimulus-receipt", str(stimulus),
                                 "--stage", "final", "--out-dir", str(output), "--require-secret-free"],
                                capture_output=True, text=True, env={"PATH": os.environ["PATH"], "HOME": str(self.root)})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(json.loads((output / "request-validation.json").read_text())["valid"])
        gates = json.loads((output / "gate-status.json").read_text())["gates"]
        self.assertEqual(next(g["status"] for g in gates if g["id"] == "G7"), "READY")


if __name__ == "__main__":
    unittest.main()
