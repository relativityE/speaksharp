"""Sam 1793589877.215059: a scheduled (nightly) run on #1772's verified accepted-input route reaches its recurring and history gates. The
REAL aggregate receiver admits the pinned bundle; the REAL pipeline then hands check_gates the history index, the standing approval, the
journal snapshot as reservations and the carried prior state, and runs the carried-history comparison and its report section. Offline."""
import datetime
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest

import _fixtures  # noqa: F401  (puts the scripts directory on the import path)
from _fixtures import ROOT
import aggregate_receiver as A
import recurring_usage
import test_aggregate_receiver as R  # module references: importing the classes by name would rerun their tests here
import test_pipeline_and_report as P


class NightlyAcceptedRoute(unittest.TestCase):
    setUp = R.AggregateReceiver.setUp

    def nightly_bundle(self):
        """A valid full-coverage nightly request (the synthetic full-request fixture, owner-approved at its own proposed limits) through the
        receiver fixture's verified bundle: the manifest is re-pinned to exactly this request."""
        import copy
        import test_full_coverage as FC
        from _fixtures import approved, sample
        req, _ = approved(FC.full_request(), sample()["ledger"])
        prop = req["proposedLimits"]
        req["approvedLimits"].update(runCapRequests=prop["runCapRequests"], cumulativeCeilingRequests=prop["cumulativeCeilingRequests"],
                                     startPressCaps=copy.deepcopy(prop.get("startPressCaps")), approvalRef=self.request["approvedLimits"]["approvalRef"])
        req["release"]["testedSha"] = "a" * 40
        req["priority"] = "nightly-regression"
        self.request = req
        self.request_raw = json.dumps(self.request, sort_keys=True).encode()
        self.manifest.update(requestSha256=hashlib.sha256(self.request_raw).hexdigest(), runId=req["runId"],
                             workflowVersion=req["workflowVersion"], codeManifestSha256=req["harness"]["codeManifestSha256"])
        self.manifest_raw = json.dumps(self.manifest, sort_keys=True).encode()
        self.pins = {"activated": True, "manifestSha256": hashlib.sha256(self.manifest_raw).hexdigest(),
                     "bundleRootSha256": self.manifest["bundleRootSha256"]}
        self.config["aggregateReceiver"] = dict(self.pins)

    def run_route(self, with_recurring=True):
        self.nightly_bundle()
        root = self.root
        config = root / "active-config.json"; config.write_text(json.dumps(self.config))
        request = root / "request.json"; request.write_bytes(self.request_raw)
        manifest = root / "manifest.json"; manifest.write_bytes(self.manifest_raw)
        accepted, output = root / "accepted", root / "pipeline-output"
        env = {"PATH": os.environ["PATH"], "HOME": str(root)}
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "aggregate_receiver.py"), "--manifest", str(manifest),
                            "--request", str(request), "--config", str(config), "--out-dir", str(accepted)], capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        proof = root / "proof.json"
        proof.write_text(json.dumps({"codeManifestSha256": self.request["harness"]["codeManifestSha256"],
                                     "corrections": [{"id": "SYNTHETIC", "result": "PASS"}]}))
        checks = root / "checks.json"; checks.write_text('{"passed":true}\n')
        created = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        stimulus = root / "stimulus.json"
        stimulus.write_text(json.dumps({"createdAt": created, "productTraffic": 0, "codeManifestSha256": self.request["harness"]["codeManifestSha256"],
                                        "cases": {s["case"]: {"ready": True} for s in self.request["selection"] if s.get("needsCaptureDevice")}}))
        snapshot = root / "journal-snapshot.json"
        snapshot.write_text(json.dumps({"schema": recurring_usage.JOURNAL_SNAPSHOT_SCHEMA, "headSha": "c" * 40, "events": []}))
        prior = P.NightlyHistoryThroughTheRealPipeline.prior_state(self, tempfile.mkdtemp(dir=root), ["P", "F"])
        argv = [sys.executable, "-I", os.path.join(ROOT, "scripts", "pipeline.py"), "--request", str(request), "--config", str(config),
                "--workflow", os.path.join(ROOT, "workflow.json"), "--accepted-input-dir", str(accepted),
                "--receiver-receipt", str(accepted / "receiver-receipt.json"), "--receiver-manifest", str(manifest),
                "--offline-checks", str(checks), "--offline-proof", str(proof), "--stimulus-receipt", str(stimulus),
                "--prior-state", prior, "--stage", "final", "--out-dir", str(output), "--require-secret-free"]
        if with_recurring:
            argv += ["--reservations", str(snapshot)]
        return subprocess.run(argv, capture_output=True, text=True, env=env), output

    def test_a_nightly_accepted_run_reaches_g7_and_g11_and_the_carried_history_consumers(self):
        r, out = self.run_route()
        self.assertEqual(r.returncode, 0, r.stdout[-2000:] + r.stderr[-2000:])
        gates = {g["id"]: g for g in json.loads((out / "gate-status.json").read_text())["gates"]}
        self.assertIn("G11", gates)  # evaluated from the journal snapshot, the history index and the approval: not refused for missing inputs
        self.assertIn("G7", gates)
        baselines = json.loads((out / "nightly-baselines.json").read_text())
        self.assertEqual(len(baselines["rows"]), 204)
        nh = json.loads((out / "nightly-history.json").read_text())
        self.assertEqual(nh["schema"], "speaksharp.cloud-test.accepted-nightly-history.v1")
        self.assertIn("rowsTotal", nh["nightlyHistory"])
        self.assertIn("Nightly carried-forward history", (out / "nightly-history.html").read_text(encoding="utf-8"))
        self.assertTrue((out / "comparison-consumption.json").exists())  # #1772's accepted comparison consumer still runs

    def test_without_a_journal_snapshot_or_history_index_the_nightly_route_refuses_rather_than_skip_g11(self):
        # fail closed: no verified journal snapshot and no retained history index means the recurring gate cannot be evaluated
        r, out = self.run_route(with_recurring=False)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("recurring gates require explicit --reservations and --approval inputs", r.stderr)
        self.assertIn("accepted inputs failed ordinary gate evaluation", r.stdout + r.stderr)
        self.assertFalse((out / "gate-status.json").exists())


if __name__ == "__main__":
    unittest.main()
