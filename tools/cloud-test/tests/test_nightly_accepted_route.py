"""a scheduled (nightly) run on #1772's verified accepted-input route reaches its recurring and history gates. The
REAL aggregate receiver admits the pinned bundle; the REAL pipeline then hands check_gates the history index, the standing approval, the
journal snapshot as reservations and the carried prior state, and runs the carried-history comparison and its report section. Offline."""
import datetime
import contextlib
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import _fixtures  # noqa: F401  (puts the scripts directory on the import path)
from _fixtures import ROOT
import aggregate_receiver as A
import recurring_usage
import test_aggregate_receiver as R  # module references: importing the classes by name would rerun their tests here
import test_pipeline_and_report as P
import test_accounting_rollup as J


class NightlyAcceptedRoute(unittest.TestCase):
    setUp = R.AggregateReceiver.setUp

    def nightly_bundle(self):
        """A valid full-coverage nightly request (the synthetic full-request fixture, owner-approved at its own proposed limits) through the
        receiver fixture's verified bundle: the manifest is re-pinned to exactly this request."""
        import copy
        import test_full_coverage as FC
        from _fixtures import approved, sample
        # the receiver fixture's release verification, completed to the real verify_release.py shape the report renders, and re-pinned
        rv = self.docs["release-verification"]
        rv["frontend"] = dict(rv["frontend"], evidence="synthetic identity ledger", ageHours=1.0)
        rv.setdefault("commitVerdicts", [])
        data = json.dumps(rv, sort_keys=True).encode()
        (self.root / "release-verification.json").write_bytes(data)
        self.manifest["components"]["release-verification"]["sha256"] = hashlib.sha256(data).hexdigest()
        self.manifest["bundleRootSha256"] = A.component_root(self.manifest["components"])
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

    def reserve(self, sha=None, campaign=None, **over):
        from reservations import CATS
        e = {"type": "reserve", "campaignId": campaign or self.request["runId"], "runId": "101", "attempt": 1,
             "allocation": {k: 10 for k in CATS}, "provenance": "request-sha256:" + (sha or hashlib.sha256(self.request_raw).hexdigest()),
             "atUtc": "2026-11-02T03:00:00Z"}
        e.update(over)
        return e

    def occurrence_manifest(self):
        """ONE pinned v2 manifest contains historical components only; all current identity is occurrence evidence."""
        entries = {n: e for n, e in self.manifest["components"].items() if n in A.RETAINED_OCCURRENCE}
        manifest = {"schema": A.OCCURRENCE_SCHEMA, "workflowVersion": self.manifest["workflowVersion"],
                    "codeManifestSha256": self.manifest["codeManifestSha256"], "components": entries, "bundleRootSha256": A.component_root(entries)}
        self.manifest_raw = json.dumps(manifest, sort_keys=True).encode()
        self.pins = {"activated": True, "manifestSha256": hashlib.sha256(self.manifest_raw).hexdigest(), "bundleRootSha256": manifest["bundleRootSha256"]}
        self.config["aggregateReceiver"] = dict(self.pins)

    @staticmethod
    def run_pipeline_with_journal(argv, env, journal_url, journal_root):
        """Run the real pipeline while wiring its check_gates child to a local journal.

        pipeline normally starts check_gates as a separate Python process.  The
        in-process adapter below preserves that consumer and its arguments, but
        makes the existing test-only JOURNAL_URL/JOURNAL_ROOT controls visible
        to it without adding a production environment override.
        """
        import check_gates as C
        import pipeline
        original_run = pipeline.run

        def run(script, *args, check=False):
            if script != "check_gates.py":
                return original_run(script, *args, check=check)
            stdout, stderr = io.StringIO(), io.StringIO()
            code = 0
            with mock.patch.object(C, "JOURNAL_URL", journal_url), mock.patch.object(C, "JOURNAL_ROOT", journal_root), \
                    mock.patch.object(sys, "argv", ["check_gates.py", *args]), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                try:
                    C.main()
                except SystemExit as exc:
                    code = exc.code if isinstance(exc.code, int) else 1
            return subprocess.CompletedProcess([sys.executable, "-I", "check_gates.py", *args], code, stdout.getvalue(), stderr.getvalue())

        stdout, stderr = io.StringIO(), io.StringIO()
        code = 0
        pipeline_argv = ["pipeline.py", *argv[3:]]
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(pipeline, "run", run), \
                mock.patch.object(sys, "argv", pipeline_argv), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            try:
                pipeline.main()
            except SystemExit as exc:
                code = exc.code if isinstance(exc.code, int) else 1
        return subprocess.CompletedProcess(argv, code, stdout.getvalue(), stderr.getvalue())

    def run_route(self, with_recurring=True, events=None, env_over=None, nights=("P", "F"), occurrence=None, journal=None):
        self.nightly_bundle()
        if occurrence is not None:  # (campaign id, manifest mode): a later occurrence's own request bytes and campaign
            campaign, mode = occurrence
            self.request = dict(self.request, runId=campaign)
            self.request_raw = json.dumps(self.request, sort_keys=True).encode()
            if mode == "v2":
                self.occurrence_manifest()
        root = self.root
        config = root / "active-config.json"; config.write_text(json.dumps(self.config))
        request = root / "request.json"; request.write_bytes(self.request_raw)
        manifest = root / "manifest.json"; manifest.write_bytes(self.manifest_raw)
        accepted, output = root / "accepted", root / "pipeline-output"
        env = {"PATH": os.environ["PATH"], "HOME": str(root), "GITHUB_ACTIONS": "true", "GITHUB_RUN_ID": "101", "CT_EXECUTION_RUN_ID": "999",
               **(env_over or {})}
        snapshot = root / "journal-snapshot.json"
        snapshot.write_text(json.dumps({"schema": recurring_usage.JOURNAL_SNAPSHOT_SCHEMA, "headSha": "c" * 40,
                                        "events": [self.reserve()] if events is None else events}))
        v2 = occurrence is not None and occurrence[1] == "v2"
        occ = ["--journal-snapshot", str(snapshot), "--occurrence-reconciliation", str(root / "reconciliation.json"),
               "--occurrence-release-verification", str(root / "release-verification.json")] if v2 else []
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "aggregate_receiver.py"), "--manifest", str(manifest),
                            "--request", str(request), "--config", str(config), "--out-dir", str(accepted)] + occ, capture_output=True, text=True, env=env)
        if occurrence is not None and occurrence[1] in ("v1-of-another-occurrence", "v2"):
            return r, accepted
        self.assertEqual(r.returncode, 0, r.stderr)
        proof = root / "proof.json"
        proof.write_text(json.dumps({"result": "PASS", "codeManifestSha256": self.request["harness"]["codeManifestSha256"], "testsPassed": 1, "testsFailed": 0,
                                     "planControls": {"negative": 1, "negativeRefused": 1, "positive": 1, "positiveAccepted": 1},
                                     "corrections": [{"id": "SYNTHETIC", "correction": "synthetic offline proof", "result": "PASS",
                                                      "tests": [], "mutationControls": []}]}))
        checks = root / "checks.json"; checks.write_text('{"passed":true}\n')
        created = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        stimulus = root / "stimulus.json"
        stimulus.write_text(json.dumps({"createdAt": created, "productTraffic": 0, "codeManifestSha256": self.request["harness"]["codeManifestSha256"],
                                        "cases": {s["case"]: {"ready": True} for s in self.request["selection"] if s.get("needsCaptureDevice")}}))
        prior = P.NightlyHistoryThroughTheRealPipeline.prior_state(self, tempfile.mkdtemp(dir=root), list(nights))
        argv = [sys.executable, "-I", os.path.join(ROOT, "scripts", "pipeline.py"), "--request", str(request), "--config", str(config),
                "--workflow", os.path.join(ROOT, "workflow.json"), "--accepted-input-dir", str(accepted),
                "--receiver-receipt", str(accepted / "receiver-receipt.json"), "--receiver-manifest", str(manifest),
                "--offline-checks", str(checks), "--offline-proof", str(proof), "--stimulus-receipt", str(stimulus),
                "--prior-state", prior, "--stage", "final", "--out-dir", str(output), "--require-secret-free"]
        if with_recurring:
            argv += ["--reservations", str(snapshot)]
        argv += occ
        if journal is not None:
            return self.run_pipeline_with_journal(argv, env, *journal), output
        return subprocess.run(argv, capture_output=True, text=True, env=env), output

    def test_a_manifest_pinned_to_one_occurrence_refuses_the_next_and_the_real_cli_authenticates_the_envelope(self):
        # #1772 Code finding 4446324167. Broken before: a v1 manifest pinned to one occurrence refuses the next occurrence's request.
        self.nightly_bundle()
        first = self.request["runId"]
        r, _ = self.run_route(occurrence=(first + "-next", "v1-of-another-occurrence"))
        self.assertEqual(r.returncode, 78)
        self.assertIn("aggregate-request-binding", r.stderr)
        # the CLI developer RETURN : the REAL receiver CLI authenticates the occurrence snapshot itself (G11's boundary). Production pins
        # no reviewed root, so this well-shaped synthetic snapshot is refused and NO accepted bytes or receipt are written. The positive, two
        # occurrences received through an actually authenticated state ref, is test_aggregate_receiver.OccurrenceEnvelopeOnARealStateRef.
        self.setUp()
        r, accepted = self.run_route(occurrence=("nightly-2026-11-03", "v2"))
        self.assertEqual(r.returncode, 78)
        self.assertIn("aggregate-occurrence-journal-unauthenticated", r.stderr)
        self.assertFalse(accepted.exists(), "no accepted directory or receiver receipt for an unauthenticated occurrence")

    def test_a_nightly_accepted_run_reaches_g7_and_g11_and_the_carried_history_consumers(self):
        # the reviewer RETURN #1: the valid authenticated-snapshot route with NO history index file reaches the real check_gates
        self.assertFalse(os.path.exists(os.path.join(ROOT, "config", "history", "index.json")))
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


    def g11(self, events, env_over=None):
        r, out = self.run_route(events=events, env_over=env_over)
        self.assertEqual(r.returncode, 0, r.stdout[-2000:] + r.stderr[-2000:])
        return next(g for g in json.loads((out / "gate-status.json").read_text())["gates"] if g["id"] == "G11")

    def test_on_the_real_route_an_unauthenticated_snapshot_never_counts(self):
        # A hermetic authenticated state ref exists, but the supplied c*40
        # snapshot is not that ref.  The actual pipeline/G11 consumer must
        # classify it as fabricated/reduced/stale rather than credit its reserve.
        journal = J.Journal(methodName="runTest")
        journal.setUp()
        self.addCleanup(journal.doCleanups)
        r, out = self.run_route(events=None, journal=(journal.remote, journal.root))
        self.assertEqual(r.returncode, 0, r.stdout[-2000:] + r.stderr[-2000:])
        g = next(g for g in json.loads((out / "gate-status.json").read_text())["gates"] if g["id"] == "G11")
        self.assertEqual(g["status"], __import__("check_gates").NOTREADY)
        self.assertIn("not the authenticated state ref (fabricated, reduced or stale)", json.dumps(g))

    def test_on_the_real_route_a_fabricated_empty_snapshot_is_refused(self):
        forged = self.g11([])
        self.assertEqual(forged["status"], __import__("check_gates").NOTREADY)
        self.assertIn("not admissible", json.dumps(forged))


class SnapshotAdmission(J.Journal):
    """check_gates.admitted_snapshot against a REAL state ref (a local bare repository, the writer tests' fixture): authenticated through the
    producer's own boundary, bound to this execution, and refused when fabricated, reduced, stale, foreign or unauthenticated."""
    SHA = "a" * 64
    REQ = {"runId": "nightly-20261101T0000Z-20261102T0300Z", "priority": "nightly-regression"}

    def ev(self, kind="reserve", run="101", **over):
        from reservations import CATS
        e = {"type": kind, "campaignId": self.REQ["runId"], "runId": run, "attempt": 1, "allocation": {k: 10 for k in CATS},
             "provenance": "request-sha256:" + self.SHA, "atUtc": "2026-11-02T03:00:00Z"}
        e.update(over)
        return e

    def push(self, event):
        import state_ref_writer as W
        W.propose(self.repo, self.remote, W.fetch_head(self.repo, self.remote, self.remote), event, self.root, self.remote)

    def snapshot(self):
        head, events, _ = self.chain()[-1]
        return {"schema": recurring_usage.JOURNAL_SNAPSHOT_SCHEMA, "headSha": head, "events": events}

    def admit(self, doc, run="101", sha=SHA, pinned=True):
        import check_gates as C
        from unittest import mock
        with mock.patch.object(C, "JOURNAL_URL", self.remote if pinned else None), mock.patch.object(C, "JOURNAL_ROOT", self.root if pinned else None):
            return C.admitted_snapshot(doc, self.REQ, sha, run)

    def test_the_authenticated_ledger_with_this_executions_reserve_is_admitted(self):
        self.push(self.ev())
        chain, refused = self.admit(self.snapshot())
        self.assertEqual((refused, chain[0][0]), ([], self.chain()[-1][0]))

    def test_fabricated_reduced_stale_foreign_and_unauthenticated_ledgers_refuse(self):
        before = self.snapshot()  # the ledger before this execution's reserve
        self.push(self.ev())
        good = self.snapshot()
        fabricated_head = dict(good, headSha="c" * 40)  # well-formed events, a head that is not the approved ref
        fabricated_ledger = dict(good, events=[self.ev(allocation={k: 1 for k in good["events"][0]["allocation"]})])
        self.push(self.ev(run="900", campaignId="nightly-other"))
        stale = good  # the ref moved on: an older, reduced view no longer matches
        current = self.snapshot()
        cases = {
            "valid but fabricated head": self.admit(fabricated_head),
            "valid but fabricated ledger": self.admit(fabricated_ledger),
            "reduced (before the reserve)": self.admit(before),
            "stale (the ref moved on)": self.admit(stale),
            "foreign execution (another run id)": self.admit(current, run="102"),
            "another request digest": self.admit(current, sha="b" * 64),
            "not activated (no reviewed root)": self.admit(current, pinned=False),
            "execution run id unknown": self.admit(current, run=None),
            "tampered event (extra key)": self.admit(dict(current, events=[dict(current["events"][0], note="x")])),
            "malformed shape": self.admit({"schema": recurring_usage.JOURNAL_SNAPSHOT_SCHEMA, "headSha": "c" * 40, "events": "x"}),
            "head is not a commit": self.admit(dict(current, headSha="not-a-sha")),
        }
        for name, (chain, refused) in cases.items():
            self.assertTrue(refused, name)
            self.assertFalse(chain, name)
        self.assertEqual(self.admit(current)[1], [])  # the current authenticated ledger still admits this execution
        self.assertEqual(self.admit({"reservations": []}), (None, []))  # a legacy reservation file is not a snapshot


class ExecutionRunIdOnTheRoute(unittest.TestCase):
    """The strict selector on the real route: in GitHub context an empty GitHub run id never falls back to the valid offline override.
    Reuses the route fixture without rerunning its tests."""
    setUp = NightlyAcceptedRoute.setUp
    nightly_bundle, run_route, g11, reserve = (NightlyAcceptedRoute.nightly_bundle, NightlyAcceptedRoute.run_route,
                                               NightlyAcceptedRoute.g11, NightlyAcceptedRoute.reserve)
    def test_an_empty_github_run_id_with_a_valid_override_leaves_g11_without_a_run(self):
        g = self.g11(None, env_over={"GITHUB_RUN_ID": "", "CT_EXECUTION_RUN_ID": "101"})
        self.assertEqual(g["status"], __import__("check_gates").NOTREADY)
        self.assertIn("the current execution run id is unknown", json.dumps(g))


class ExecutionRunId(unittest.TestCase):
    """one strict run-id selector for both routes; the offline override never stands in for GitHub's own id."""
    def pick(self, **env):
        import pipeline
        return pipeline.execution_run_id(env)

    def test_github_context_requires_its_own_valid_run_id_and_ignores_the_override(self):
        self.assertEqual(self.pick(GITHUB_ACTIONS="true", GITHUB_RUN_ID="41400000101", CT_EXECUTION_RUN_ID="999"), "41400000101")
        for bad in ({}, {"GITHUB_RUN_ID": ""}, {"GITHUB_RUN_ID": "0123"}, {"GITHUB_RUN_ID": "12a"}, {"GITHUB_RUN_ID": "1" * 21},
                    {"GITHUB_RUN_ID": " 101"}, {"GITHUB_RUN_ID": "101\n"}):
            self.assertIsNone(self.pick(GITHUB_ACTIONS="true", CT_EXECUTION_RUN_ID="999", **bad), bad)

    def test_outside_github_only_a_valid_offline_override_counts(self):
        self.assertEqual(self.pick(CT_EXECUTION_RUN_ID="999", GITHUB_RUN_ID="101"), "999")  # not GitHub: GITHUB_RUN_ID is never read
        self.assertEqual(self.pick(GITHUB_ACTIONS="false", CT_EXECUTION_RUN_ID="999"), "999")
        for bad in ({}, {"CT_EXECUTION_RUN_ID": ""}, {"CT_EXECUTION_RUN_ID": "x"}, {"CT_EXECUTION_RUN_ID": "-1"}):
            self.assertIsNone(self.pick(GITHUB_RUN_ID="101", **bad), bad)


class AcceptedSummaryAndReport(unittest.TestCase):
    """Option A (owner-approved): the REAL executive summary and report are built on the nightly
    accepted route from a receipt-free gap ledger. Historical verdicts come only from the verified accepted comparison; raw evidence and
    signals stay UNOBSERVABLE or NOT RUN, latest stays PENDING, no gap closes, and the safety HOLD is unchanged."""
    setUp = NightlyAcceptedRoute.setUp
    nightly_bundle, run_route, reserve = NightlyAcceptedRoute.nightly_bundle, NightlyAcceptedRoute.run_route, NightlyAcceptedRoute.reserve

    def outputs(self, nights=("P", "F")):
        self.setUp()  # a fresh receiver root per route run (the accepted output directory must not exist)
        r, out = self.run_route(nights=nights)
        self.assertEqual(r.returncode, 0, r.stdout[-2000:] + r.stderr[-2000:])
        load = lambda n: json.loads((out / n).read_text())
        return load("summary.json")["fields"], (out / "report" / "REPORT.html").read_text(encoding="utf-8"), load, out

    def test_the_real_summary_and_report_are_built_and_missing_evidence_never_passes(self):
        summary, html, load, out = self.outputs()
        ledger, gates = load("ledger-derived.json"), load("gate-status.json")
        self.assertIn("receipt-free", ledger["evidenceBasis"])
        cmp = json.loads((Path(ROOT) / "tests/fixtures/accepted-comparison-R5-vs-R4C.json").read_text())
        rows = {r["key"]: r for r in cmp["rows"]}
        seen = {"PASS": 0, "FAIL": 0, "NOT RUN": 0, "UNOBSERVABLE": 0}
        for g in ledger["gaps"]:
            self.assertEqual(g["latest"]["result"], "PENDING", g["id"])  # no latest run on this route
            self.assertNotEqual(g["status"], "CLOSED", g["id"])
            for label, side in (("R4C", "prev"), ("R5", "cur")):
                for o in g["history"][label]["observations"]:
                    self.assertEqual(o["evidence"], [], g["id"])  # raw evidence is never carried, so never referenced
                    seen[o["verdict"]] += 1
                    if "unobservable" in o:
                        self.assertEqual(o["verdict"], "UNOBSERVABLE")  # a signal is never PASS and never a count
                        self.assertNotIn("count", o)
                    else:
                        row = rows.get("%s/%s" % (o["case"], o["assertion"]))
                        expected = row[side] if row and row[side] in ("PASS", "FAIL") else "NOT RUN"
                        self.assertEqual(o["verdict"], expected, (g["id"], label, o["case"], o["assertion"]))  # the historical verdict
                if any("unobservable" in o for o in g["history"][label]["observations"]):
                    self.assertIn(g["history"][label]["rollup"], ("FAIL", "UNOBSERVABLE"))  # an unobservable part never rolls up to PASS
        self.assertTrue(seen["UNOBSERVABLE"] and seen["FAIL"])  # both semantics exercised on the real ledger
        self.assertEqual(summary["provenGapsClosed"], [])
        self.assertNotEqual(summary["status"], "READY")
        self.assertFalse(load("coverage.json")["fullLiveRun"])  # no case results: never a full live run
        self.assertEqual(gates["decision"], "NO-GO")
        # the carried nightly FAIL (P→F) decides the headline exactly as on the ordinary route; the receipt-free ledger adds nothing to it
        self.assertEqual((summary["status"], summary["recommendation"]), ("BLOCKED", "FIX AND RETEST"))
        self.assertIn("UNOBSERVABLE", html)
        self.assertIn("Gap-closure ledger", html)
        self.assertIn("Nightly carried-forward history", html)
        # the receipt-free provenance reaches the rendering; no caption claims sealed-receipt evidence
        self.assertEqual(json.loads((out / "report" / "report.json").read_text())["evidenceMode"]["mode"], "receipt-free")
        for claim in ("derived from sealed receipts", "sealed receipts: R4C", "evidence from the sealed receipts"):
            self.assertNotIn(claim, html)
        for honest in ("raw receipts are not carried", "accepted comparison (receipts unobservable): R4C, R5", "evidence from the verified accepted comparison"):
            self.assertIn(honest, html)

    def resummarize(self, out, decision="GO", isolation=None, within_cap=None):
        """The REAL summary and report re-derived from the route's own outputs, with only the gate decision, the isolation result or the
        spend cap verdict changed: the inputs a run with every gate GO would hand them."""
        d = Path(tempfile.mkdtemp(dir=self.root))
        gates = json.loads((out / "gate-status.json").read_text())
        gates.update(decision=decision, blockingOpen=[] if decision == "GO" else gates["blockingOpen"])
        if decision == "GO":
            for g in gates["gates"]:
                g["status"] = "READY"
        (d / "gates.json").write_text(json.dumps(gates))
        iso = json.loads((out / "isolation-result.json").read_text())
        if isolation:
            iso["status"] = isolation
        (d / "isolation.json").write_text(json.dumps(iso))
        spend = json.loads((out / "spend.json").read_text())
        if within_cap is not None:
            spend["withinCap"] = within_cap
        (d / "spend.json").write_text(json.dumps(spend))
        acc = out / "accepted-snapshot"
        sm = [sys.executable, "-I", os.path.join(ROOT, "scripts", "derive_summary.py"), "--comparison", str(acc / "comparison-prior.json"),
              "--ledger-derived", str(out / "ledger-derived.json"), "--release-verification", str(acc / "release-verification.json"),
              "--gates", str(d / "gates.json"), "--spend", str(d / "spend.json"), "--workflow", os.path.join(ROOT, "workflow.json"),
              "--request", str(self.root / "request.json"), "--coverage", str(out / "coverage.json"), "--isolation", str(d / "isolation.json"),
              "--nightly-baselines", str(out / "nightly-baselines.json"), "--out", str(d / "summary.json")]
        r = subprocess.run(sm, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return json.loads((d / "summary.json").read_text())["fields"]

    def test_a_known_safety_failure_holds_even_with_every_gate_go_and_latest_pending(self):
        _, _, _, out = self.outputs(("P", "F", "P"))  # no carried FAIL, so the gate decision and safety decide the headline
        clean = self.resummarize(out)
        self.assertEqual((clean["status"], clean["recommendation"]), ("LIMITED", "PROCEED"))  # the control: GO alone does proceed
        for name, kw in (("isolation failed", {"isolation": "failed"}), ("usage over a cap", {"within_cap": False})):
            held = self.resummarize(out, **kw)
            self.assertEqual((held["status"], held["recommendation"]), ("BLOCKED", "HOLD"), name)
            self.assertTrue(held["readinessBasis"]["safety"]["blocks"], name)
            self.assertIn("known failure", held["readiness"], name)  # the nightly headline restates impact from history; readiness keeps it

    def test_a_later_pass_changes_the_real_accepted_summary_and_report(self):
        failing, html_f, _, _ = self.outputs(("P", "F"))
        self.assertEqual((failing["nightlyHistory"]["carriedFailRows"], failing["nightlyHistory"]["carriedFailCases"]), (1, ["AHT-05"]))
        self.assertIn("1 comparable row(s) still FAIL", html_f)
        fixed, html_p, _, _ = self.outputs(("P", "F", "P"))
        self.assertEqual((fixed["nightlyHistory"]["carriedFailRows"], fixed["nightlyHistory"]["carriedFailCases"]), (0, []))
        self.assertIn("0 comparable row(s) still FAIL", html_p)
        self.assertNotEqual(failing["nightlyHistory"], fixed["nightlyHistory"])
        self.assertEqual((failing["status"], failing["recommendation"]), ("BLOCKED", "FIX AND RETEST"))
        # P→F→P: no carried FAIL, gates NO-GO: the safety HOLD stands; the later PASS never promotes the headline
        self.assertEqual((fixed["status"], fixed["recommendation"]), ("BLOCKED", "HOLD"))


class ReceiptFreeLedgerMode(unittest.TestCase):
    """derive_ledger.py --accepted-comparison: refuses a latest run, a foreign pair and malformed rows; the receipt mode emits neither the
    receipt-free basis nor UNOBSERVABLE (its observations come from the sealed receipts exactly as before)."""
    def run_ledger(self, cmp, *extra):
        d = tempfile.mkdtemp()
        cp, rv, out = os.path.join(d, "c.json"), os.path.join(d, "rv.json"), os.path.join(d, "o.json")
        with open(cp, "w") as f:
            json.dump(cmp, f)
        from _fixtures import fake_rv
        with open(rv, "w") as f:
            json.dump(fake_rv(), f)
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "derive_ledger.py"), "--ledger", os.path.join(ROOT, "config", "gap-ledger.json"),
                            "--release-verification", rv, "--accepted-comparison", cp, "--out", out, *extra], capture_output=True, text=True)
        return r, out

    def fixture(self):
        return json.loads((Path(ROOT) / "tests/fixtures/accepted-comparison-R5-vs-R4C.json").read_text())

    def test_refusals(self):
        good = self.fixture()
        swapped = dict(good, previous=good["current"], current=good["previous"])
        duplicated = dict(good, rows=good["rows"] + good["rows"][:1])
        for name, cmp, extra in (("latest run", good, ("--latest-label", "R5")), ("foreign pair", swapped, ()),
                                 ("duplicated rows", duplicated, ()), ("no rows", dict(good, rows=None), ())):
            r, out = self.run_ledger(cmp, *extra)
            self.assertNotEqual(r.returncode, 0, name)
            self.assertFalse(os.path.exists(out), name)
        r, _ = self.run_ledger(good)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_receipt_mode_carries_no_receipt_free_semantics(self):
        from _fixtures import fake_rv
        from _synthetic_history import shared as synthetic_history
        d = tempfile.mkdtemp()
        rv, out = os.path.join(d, "rv.json"), os.path.join(d, "o.json")
        with open(rv, "w") as f:
            json.dump(fake_rv(), f)
        h = synthetic_history()
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "derive_ledger.py"), "--ledger", os.path.join(ROOT, "config", "gap-ledger.json"),
                            "--release-verification", rv, "--out", out, "--config", h.config, "--receipts-root", h.receipts], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = json.loads(open(out).read())
        self.assertNotIn("evidenceBasis", doc)
        self.assertNotIn("UNOBSERVABLE", json.dumps(doc))
        self.assertTrue(any(e.get("sha256") for g in doc["gaps"] for h_ in g["history"].values() for o in h_["observations"] for e in o["evidence"]))


if __name__ == "__main__":
    unittest.main()
