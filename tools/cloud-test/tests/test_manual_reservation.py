"""Manual-dispatch reservation integration (Sam 1793556225.890759), offline, with EXPLICIT SYNTHETIC inputs only: the synthetic full-coverage
request fixture, a synthetic bootstrap and period scope accepted through test-only pins, and the real state-ref writer on a temporary bare
repository. Reserve -> counted by the rollup as outstanding -> settle or release; headroom, staleness, admission and replay negatives."""
import hashlib
import json
import os
import subprocess
import sys

from _fixtures import ROOT, request_path
import accounting_rollup as R
import manual_reservation as M
import state_ref_writer as W
from test_accounting_rollup import Journal, scope

AT = "2026-11-02T04:00:00Z"
EVIDENCE = "e" * 64


def read(path):
    with open(path, "rb") as f:
        return f.read()


class ManualReservation(Journal):
    def setUp(self):
        super().setUp()
        self.req = read(request_path("R7-full-coverage-proposal.json"))
        self.sha = hashlib.sha256(self.req).hexdigest()

    def head(self):
        return W.fetch_head(self.repo, self.remote, self.remote)

    def rollup(self, sc=None):
        return self.receive(sc)

    def push(self, event):
        return W.propose(self.repo, self.remote, self.head(), event, self.root, self.remote)

    def reserved(self, run="41400000001", sc=None):
        e = M.reserve(self.req, self.sha, run, self.rollup(sc), self.head(), AT)
        self.push(e)
        return e

    def refused(self, code, fn, *a):
        with self.assertRaises(M.Refused) as e:
            fn(*a)
        self.assertEqual(str(e.exception), code)

    def test_reserve_is_counted_as_outstanding_then_settled_at_measured_usage(self):
        e = self.reserved()
        self.assertEqual((e["campaignId"], e["runId"], e["attempt"], e["provenance"]), ("R7-full-coverage", "41400000001", 1, "request-sha256:" + self.sha))
        self.assertEqual(e["allocation"], {"requests": 4310, "identityReads": 32, "starts": 40, "takes": 31, "coachingRequests": 40, "runnerMinutes": 30})
        out = self.rollup()
        self.assertEqual((out["outstandingReservations"], out["requests"]["conservativeUsed"], out["takes"]["ownerCounted"]), (1, 4310, 31))
        usage = {"requests": 2900, "identityReads": None, "starts": 15, "takes": 14, "coachingRequests": 9, "runnerMinutes": None}
        s = M.settle(e, usage, EVIDENCE, "2026-11-02T06:00:00Z")
        self.assertEqual(s["allocation"], {"requests": 2900, "identityReads": 32, "starts": 15, "takes": 14, "coachingRequests": 9, "runnerMinutes": 30},
                         "an unmeasured dimension settles at its reserved cap, never 0")
        self.push(s)
        out = self.rollup()
        self.assertEqual((out["outstandingReservations"], out["requests"]["conservativeUsed"], out["identityReads"]["conservativeUsed"]), (0, 2900, 32))

    def test_a_never_started_run_is_released_under_an_approval_and_stops_counting(self):
        e = self.reserved()
        self.refused("manual-release-run-started", M.release, e, True, "slack-1793556225.890759", AT)
        self.refused("manual-release-run-started", M.release, e, None, "slack-1793556225.890759", AT)
        self.refused("manual-release-approval", M.release, e, False, "free text", AT)
        r = M.release(e, False, "slack-1793556225.890759", AT)
        self.assertEqual((r["allocation"], r["provenance"]), (e["allocation"], "approval:slack-1793556225.890759"))
        self.push(r)
        self.assertEqual((self.rollup()["outstandingReservations"], self.rollup()["requests"]["conservativeUsed"]), (0, 0))

    def test_headroom_is_checked_against_the_rollup_at_the_proposed_head(self):
        # Under an approved "historical" carryover the R9-sized bootstrap (7996 requests) leaves 12000 - 300 - 7996 = 3704 < 4310.
        self.refused("manual-reservation-exceeds-headroom", M.reserve, self.req, self.sha, "41400000001",
                     self.rollup(scope(carryover="historical")), self.head(), AT)
        tight = dict(scope()["ceilings"], takes=30)
        self.refused("manual-reservation-exceeds-headroom", M.reserve, self.req, self.sha, "41400000001", self.rollup(scope(ceilings=tight)), self.head(), AT)
        stale = self.rollup()
        self.reserved("41400000002")
        self.refused("manual-reservation-rollup-stale", M.reserve, self.req, self.sha, "41400000003", stale, self.head(), AT)
        self.refused("manual-reservation-rollup", M.reserve, self.req, self.sha, "41400000003", dict(self.rollup(), source="legacy"), self.head(), AT)
        # An outstanding reservation consumes headroom: two full runs no longer fit the 80-take ceiling (31 + 31 + 31 > 80).
        self.reserved("41400000004")
        self.refused("manual-reservation-exceeds-headroom", M.reserve, self.req, self.sha, "41400000005", self.rollup(), self.head(), AT)

    def test_only_the_admitted_manual_request_with_known_caps_is_reserved(self):
        args = ("41400000001", self.rollup(), self.head(), AT)
        self.refused("manual-reservation-request-not-admitted", M.reserve, self.req + b" ", self.sha, *args)
        self.refused("manual-reservation-request-not-admitted", M.reserve, self.req, self.sha.upper(), *args)
        nightly = read(request_path("R8-nightly-regression-proposal.json"))
        self.refused("manual-reservation-nightly", M.reserve, nightly, hashlib.sha256(nightly).hexdigest(), *args)
        doc = json.loads(self.req)
        del doc["estimate"]["providerBillableRequests"]["coachingCap"]
        unknown = json.dumps(doc).encode()
        self.refused("manual-reservation-caps-unknown", M.reserve, unknown, hashlib.sha256(unknown).hexdigest(), *args)
        self.refused("manual-reservation-event-run-id", M.reserve, self.req, self.sha, "0123", *args[1:])
        self.refused("manual-reservation-event-run-id", M.reserve, self.req, self.sha, 41400000001, *args[1:])

    def test_settle_never_exceeds_or_replays_and_a_rejected_settle_leaves_the_caps_counted(self):
        e = self.reserved()
        over = {"requests": 4311, "identityReads": 1, "starts": 1, "takes": 1, "coachingRequests": 0, "runnerMinutes": 1}
        self.refused("manual-settle-exceeds-reservation", M.settle, e, over, EVIDENCE, AT)
        self.assertEqual(self.rollup()["requests"]["conservativeUsed"], 4310, "a refused settle leaves the reservation open and counted")
        for bad, code in ((dict(over, requests=-1), "manual-settle-usage"), (dict(over, requests=True), "manual-settle-usage"),
                          ({"requests": 1}, "manual-settle-usage")):
            with self.subTest(code=code, bad=bad):
                self.refused(code, M.settle, e, bad, EVIDENCE, AT)
        ok = dict(over, requests=10)
        self.refused("manual-settle-evidence", M.settle, e, ok, "not-a-digest", AT)
        self.refused("manual-reservation-not-reserved", M.settle, dict(e, type="settle"), ok, EVIDENCE, AT)
        self.push(M.settle(e, ok, EVIDENCE, AT))
        with self.assertRaises(W.Refused):  # the writer refuses a second settle of the same key
            self.push(M.settle(e, ok, EVIDENCE, "2026-11-02T05:00:00Z"))
        with self.assertRaises(W.Refused):  # and a second reserve of the same identity
            self.push(M.reserve(self.req, self.sha, "41400000001", self.rollup(), self.head(), AT))

    def test_the_cli_refuses_while_the_writer_is_not_activated(self):
        p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "manual_reservation.py"), "reserve"], capture_output=True, text=True)
        self.assertEqual((p.returncode, p.stdout, p.stderr.strip()), (78, "", "BLOCKED_SETUP: manual-reservation-not-activated"))
        self.assertIsNone(W.REVIEWED_ROOT)
        self.assertEqual((R.ACCEPTED_BOOTSTRAP_SHA256, R.ACCEPTED_ROOT), (None, None))


if __name__ == "__main__":
    import unittest
    unittest.main()
