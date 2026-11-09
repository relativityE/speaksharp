"""R10 post-A7 chain (PO: no more discoveries; the reviewer: prove the whole path). A composed offline rehearsal of the manual run stage after admission
A7, on the real manifest, configuration, R10 occurrence and journal, found three defects no run had reached:
  1. the occurrence receiver (and the manual parent-transition rule and G7's v2 binding) admitted only nightly/full-coverage priorities, so the
     R10 journey-smoke occurrence refused with aggregate-occurrence-priority right after A7;
  2. spend_report.py read legacy sealed-ledger fields the accepted-rollup checkpoint does not carry (KeyError 'measuredFromSealedLedgers');
  3. workflow_report.py rendered the legacy reconciliation table on that checkpoint (KeyError 'runs').
Each control below drives the REAL module with the REAL R10 template and committed configuration; the journal is synthetic and in-process."""
import copy
import hashlib
import json
import os
import unittest
from unittest import mock

from _fixtures import ROOT, sample
import aggregate_receiver as A
import check_gates as C
import init_run_inputs as I
import spend_report as S

# the active one-off: the AHT-01 selected smoke occurrence of the R10 campaign
with open(os.path.join(ROOT, "config", "runs", "R10-3b040043-aht01.json"), encoding="utf-8") as _f:
    TEMPLATE = json.load(_f)
with open(os.path.join(ROOT, "config", "test-config.v1.json"), encoding="utf-8") as _f:
    CONFIG = json.load(_f)
MANIFEST = os.path.join(ROOT, "config", "aggregate", "manifest.json")
PARENT, HEAD = "a" * 40, "b" * 40


def occurrence(template=TEMPLATE):
    occ = I.materialize_smoke_occurrence(template, "2026-11-07T21:00:00Z", "slack:1000000004.000004", "slack:1000000005.000005", "product-owner",
                                         template["release"]["testedSha"], template["release"]["backend"]["sha"], ["AHT-01"])
    return occ, json.dumps(occ, sort_keys=True, separators=(",", ":")).encode()


def accepted_rollup():
    """The accepted-rollup checkpoint shape (accounting_rollup.checkpoint_bytes), as the occurrence route places it."""
    return {"source": "accepted-rollup", "headSha": PARENT, "root": "92d6ebf902351750c368d7d513116c6b1f19f80c",
            "scopeApprovalRef": "slack:1000000005.000005",
            "requests": {"conservativeUsed": 6136, "ownerCounted": 6136}, "identityReads": {"conservativeUsed": 96, "ownerCounted": 96},
            "starts": {"ownerCounted": 48}, "takes": {"ownerCounted": 48},
            "period": {"requests": 6136, "identityReads": 96, "starts": 48, "takes": 48, "coachingRequests": 60, "runnerMinutes": 153},
            "ceilings": {"requests": 9518, "protectedReserveRequests": 0, "identityReads": 128, "starts": 74, "takes": 64},
            "currentHeadroom": {"requests": 3382, "identityReads": 32, "starts": 26, "takes": 16}, "outstandingReservations": 0,
            "openReservationsByRequest": {}, "unknown": {"coachingRequests": False, "runnerMinutes": False}}


class ManualOccurrence(unittest.TestCase):
    def test_only_full_coverage_or_exactly_the_r10_smoke_occurrence(self):
        occ, _ = occurrence()
        self.assertTrue(C.manual_occurrence(occ))
        self.assertTrue(C.manual_occurrence({"priority": "full-coverage"}))
        for over in ({"runId": "R11-other-smoke"}, {"coverageMode": "full"}, {"sampleMode": "full"}, {"priority": "nightly-regression"},
                     {"priority": "journey-smoke-x"}):
            self.assertFalse(C.manual_occurrence(dict(occ, **over)), over)
        self.assertFalse(C.manual_occurrence(None))

    def test_g6_deferral_applies_to_exactly_the_r10_smoke_occurrence(self):
        occ, _ = occurrence()
        self.assertTrue(C.r10_smoke_g6_deferral(occ))
        self.assertFalse(C.r10_smoke_g6_deferral({"priority": "full-coverage"}))       # full coverage keeps G6 blocking
        for over in ({"runId": "R11-other-smoke"}, {"coverageMode": "full"}, {"priority": "nightly-regression"}):
            self.assertFalse(C.r10_smoke_g6_deferral(dict(occ, **over)), over)

    def test_g7_binds_a_v2_receipt_through_the_same_predicate(self):
        src = open(os.path.join(ROOT, "scripts", "check_gates.py"), encoding="utf-8").read()
        self.assertIn('(req.get("priority") == "nightly-regression" or manual_occurrence(req))', src)
        self.assertNotIn('req.get("priority") in ("nightly-regression", "full-coverage")', src)


class OccurrenceReceiver(unittest.TestCase):
    """The REAL receive_bundle on the committed manifest, bundle and pins, with the R10 occurrence and an in-process journal whose last
    event is this request's one open reserve on top of the reconciliation's parent head."""

    def receive(self, req, raw):
        reserve = {"type": "reserve", "campaignId": req["runId"], "runId": "42500000001", "attempt": 1,
                   "allocation": {"requests": 3382, "identityReads": 32, "starts": 16, "takes": 16, "coachingRequests": 20, "runnerMinutes": 60},
                   "provenance": "request-sha256:" + hashlib.sha256(raw).hexdigest(), "atUtc": "2026-11-07T21:01:00Z"}
        chain = [(PARENT, []), (HEAD, [reserve])]
        snapshot = {"schema": A.JOURNAL_SNAPSHOT_SCHEMA, "headSha": HEAD, "events": [reserve]}
        release = {"needs": [], "testedSha": req["release"]["testedSha"]}
        occ = {"journalSnapshot": json.dumps(snapshot).encode(), "reconciliation": json.dumps(accepted_rollup()).encode(),
               "releaseVerification": json.dumps(release).encode()}
        with mock.patch.object(C, "authenticated_state_chain", lambda: chain):
            return A.receive_bundle(open(MANIFEST, "rb").read(), os.path.dirname(MANIFEST), raw, CONFIG, CONFIG["aggregateReceiver"], occ)

    def test_the_r10_smoke_occurrence_is_admitted_and_bound_to_its_own_reserve(self):
        occ, raw = occurrence()
        docs, accepted, envelope = self.receive(occ, raw)
        self.assertEqual((envelope["campaignId"], envelope["executionRunId"], envelope["journalHeadSha"], envelope["testedSha"]),
                         ("R10-3b040043-smoke15", "42500000001", HEAD, occ["release"]["testedSha"]))
        self.assertEqual(envelope["requestSha256"], hashlib.sha256(raw).hexdigest())

    def test_any_other_journey_smoke_request_still_refuses(self):
        occ, _ = occurrence()
        other = dict(occ, runId="R11-other-smoke")
        raw = json.dumps(other, sort_keys=True, separators=(",", ":")).encode()
        with self.assertRaises(A.Refused) as e:
            self.receive(other, raw)
        self.assertEqual(str(e.exception), "aggregate-occurrence-priority")


class AcceptedRollupReporting(unittest.TestCase):
    def test_spend_report_reads_the_accepted_rollup_without_inventing_legacy_fields(self):
        s = sample()
        out = S.build(s["req"], s["cfg"], accepted_rollup())
        self.assertEqual(out["before"]["requestsUsedConservative"], 6136)
        self.assertIsNone(out["before"]["requestsUsedMeasured"])
        self.assertIsNone(out["before"]["unreconciledRequests"])
        self.assertIn("NOT RUN", out["status"])

    def test_workflow_report_renders_the_accepted_rollup_and_the_legacy_table_unchanged(self):
        import test_pipeline_and_report as P
        import workflow_report as W
        r, out = P.pipeline(["--require-secret-free"])
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        rep = json.load(open(os.path.join(out, "report", "report.json")))
        wf = json.load(open(os.path.join(ROOT, "workflow.json")))
        legacy = W.render(rep, wf)
        self.assertIn("Run (frozen before the run)", legacy)
        acc = copy.deepcopy(rep)
        acc["purposeAndCost"]["reconciliation"] = accepted_rollup()
        html = W.render(acc, wf)
        self.assertIn("Period usage, verified journal", html)
        self.assertIn("6136", html)
        self.assertNotIn("Run (frozen before the run)", html)
        self.assertIn("Headroom now: 3382 requests, 32 identity reads", html)


if __name__ == "__main__":
    unittest.main()
