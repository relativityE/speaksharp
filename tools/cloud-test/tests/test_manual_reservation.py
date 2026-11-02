"""Manual-dispatch reservation integration (Sam 1793556225.890759, RETURN 1793556820.561729), offline, with EXPLICIT SYNTHETIC inputs only:
the synthetic full-coverage request fixture, a synthetic bootstrap and period scope accepted through test-only pins, synthetic run-record
bytes, and the real state-ref writer on a temporary bare repository. Reserve -> counted by the rollup as G5 would charge it -> settle from
verified record bytes; headroom boundary, staleness, admission, scope, period, identity and replay negatives."""
import hashlib
import json
import os
import subprocess
import sys
from unittest import mock

from _fixtures import ROOT, request_path
import accounting_rollup as R
import manual_reservation as M
import state_ref_writer as W
from test_accounting_rollup import Journal, scope

AT = "2026-11-02T04:00:00Z"
RUN = "41400000001"
EVIDENCE = "e" * 64
# R7-full-coverage: run cap 4310 + 32 identity reads = a G5 request charge of 4342.
ALLOCATION = {"requests": 4342, "identityReads": 32, "starts": 42, "takes": 31, "coachingRequests": 40, "runnerMinutes": 30}


def read(path):
    with open(path, "rb") as f:
        return f.read()


def scope_raw(**over):
    return json.dumps(scope(**over), sort_keys=True).encode()


class ManualReservation(Journal):
    def setUp(self):
        super().setUp()
        self.req = read(request_path("R7-full-coverage-proposal.json"))
        self.sha = hashlib.sha256(self.req).hexdigest()
        self.scope = scope_raw()
        self.all_pins = dict(self.pins, accepted_scope_sha256=hashlib.sha256(self.scope).hexdigest())

    def head(self):
        return W.fetch_head(self.repo, self.remote, self.remote)

    def push(self, event):
        return W.propose(self.repo, self.remote, self.head(), event, self.root, self.remote)

    def reserved(self, run=RUN, sc=None):
        e = M.reserve(self.req, self.sha, run, self.receive(sc), self.head(), AT)
        self.push(e)
        return e

    def refused(self, code, fn, *a):
        with self.assertRaises(M.Refused) as e:
            fn(*a)
        self.assertEqual(str(e.exception), code)

    def record(self, run=RUN, **spend):
        s = {"requests": 2900, "identityReads": 30, "starts": 15, "takes": 14, "byCategory": {}, "source": "synthetic"}
        s.update(spend)
        return json.dumps({"schema": M.RUN_RECORD_SCHEMA, "runId": "R7-full-coverage", "spend": s,
                           "executionProvenance": {"campaignId": "R7-full-coverage", "runId": run, "attempt": 1, "requestSha256": self.sha}},
                          sort_keys=True).encode()

    def execute(self, command, inputs, name, root=None, pins=None):
        d = os.path.join(self.d, name)
        os.mkdir(d)
        return M.execute(command, inputs, self.repo, self.remote, root or self.root, os.path.join(d, "journal.json"),
                         os.path.join(d, "receipt.json"), pins or self.all_pins, self.remote)

    def reserve_inputs(self, **over):
        i = {"request": self.req, "admittedSha256": self.sha, "runId": RUN, "bootstrap": self.raw, "scope": self.scope, "atUtc": AT}
        i.update(over)
        return i

    def test_a_reservation_charges_requests_plus_identity_reads_as_g5_does(self):
        e = self.reserved()
        self.assertEqual((e["campaignId"], e["runId"], e["attempt"], e["provenance"]), ("R7-full-coverage", RUN, 1, "request-sha256:" + self.sha))
        self.assertEqual(e["allocation"], ALLOCATION)
        out = self.receive()
        self.assertEqual((out["outstandingReservations"], out["requests"]["conservativeUsed"], out["identityReads"]["conservativeUsed"]),
                         (1, 4342, 32), "an open reservation counts exactly G5's charge")

    def test_the_headroom_boundary_admits_4342_and_refuses_4341(self):
        # headroom = requests ceiling - protected reserve (300) - used (0). 4310 would fit 4341; G5's 4342 charge does not.
        for ceiling, fits in ((4300 + 300 + 41, False), (4300 + 300 + 42, True)):
            with self.subTest(headroom=ceiling - 300):
                rollup = self.receive(scope(ceilings=dict(scope()["ceilings"], requests=ceiling)))
                if fits:
                    self.assertEqual(M.reserve(self.req, self.sha, RUN, rollup, self.head(), AT)["allocation"]["requests"], 4342)
                else:
                    self.refused("manual-reservation-exceeds-headroom", M.reserve, self.req, self.sha, RUN, rollup, self.head(), AT)

    def test_a_measured_settlement_charges_campaign_requests_plus_identity_reads_once(self):
        e = self.reserved()
        usage, evidence = M.usage_from_record(self.record(), e)
        self.assertEqual((usage, evidence), ({"requests": 2930, "identityReads": 30, "starts": 15, "takes": 14, "coachingRequests": None,
                                              "runnerMinutes": None}, hashlib.sha256(self.record()).hexdigest()))
        s = M.settle(e, usage, evidence, "2026-11-02T06:00:00Z")
        self.assertEqual(s["allocation"], dict(ALLOCATION, requests=2930, identityReads=30, starts=15, takes=14),
                         "unmeasured coaching and runner minutes settle at the reserved cap, never 0")
        self.push(s)
        out = self.receive()
        self.assertEqual((out["outstandingReservations"], out["requests"]["conservativeUsed"], out["identityReads"]["conservativeUsed"]), (0, 2930, 30))
        for unknown in ({"requests": None}, {"identityReads": None}, {"requests": None, "identityReads": None}):
            unmeasured, _ = M.usage_from_record(self.record(**unknown), e)
            self.assertIsNone(unmeasured["requests"])
            self.assertEqual(M.settle(e, unmeasured, EVIDENCE, AT)["allocation"]["requests"], 4342,
                             "either unknown component keeps the full reserved G5 request charge")

    def test_headroom_is_recomputed_at_the_proposed_head(self):
        self.refused("manual-reservation-exceeds-headroom", M.reserve, self.req, self.sha, RUN, self.receive(scope(carryover="historical")), self.head(), AT)
        stale = self.receive()
        self.reserved("41400000002")
        self.refused("manual-reservation-rollup-stale", M.reserve, self.req, self.sha, "41400000003", stale, self.head(), AT)
        self.refused("manual-reservation-rollup", M.reserve, self.req, self.sha, "41400000003", dict(self.receive(), source="legacy"), self.head(), AT)
        self.reserved("41400000004")  # two outstanding full runs hold 62 of the 80 takes
        self.refused("manual-reservation-exceeds-headroom", M.reserve, self.req, self.sha, "41400000005", self.receive(), self.head(), AT)

    def test_only_the_admitted_manual_request_with_known_caps_is_reserved(self):
        args = (RUN, self.receive(), self.head(), AT)
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

    def test_settlement_is_bound_to_the_record_bytes_and_the_reservation(self):
        e = self.reserved()
        for raw, code in ((self.record(run="41400000009"), "manual-settle-record-identity"), (b"not json", "manual-settle-record"),
                          (self.record().replace(self.sha.encode(), b"f" * 64), "manual-settle-record-identity"),
                          (self.record(requests=-1), "manual-settle-usage"), (self.record(requests=True), "manual-settle-usage"),
                          (json.dumps(dict(json.loads(self.record()), runId="R8")).encode(), "manual-settle-record")):
            with self.subTest(code=code):
                self.refused(code, M.usage_from_record, raw, e)
        attempt2 = json.loads(self.record())
        attempt2["executionProvenance"]["attempt"] = True
        self.refused("manual-settle-record-identity", M.usage_from_record, json.dumps(attempt2).encode(), e)
        over, _ = M.usage_from_record(self.record(requests=4343), e)
        self.refused("manual-settle-exceeds-reservation", M.settle, e, over, EVIDENCE, AT)
        self.assertEqual(self.receive()["requests"]["conservativeUsed"], 4342, "a refused settle leaves the reservation open and counted")
        self.refused("manual-settle-evidence", M.settle, e, M.usage_from_record(self.record(), e)[0], "not-a-digest", AT)
        self.refused("manual-reservation-not-reserved", M.settle, dict(e, type="settle"), M.usage_from_record(self.record(), e)[0], EVIDENCE, AT)

    def test_the_integrated_path_reserves_then_settles_the_reservation_it_finds_on_the_chain(self):
        e = self.execute("reserve", self.reserve_inputs(), "r1")
        with open(os.path.join(self.d, "r1", "receipt.json"), encoding="utf-8") as f:
            self.assertTrue(W.verify(self.repo, self.remote, json.load(f), e, self.root, self.remote)["verified"])
        self.assertEqual((self.receive()["outstandingReservations"], self.receive()["requests"]["conservativeUsed"]), (1, 4342))
        settle = {"campaignId": "R7-full-coverage", "runId": RUN, "record": self.record(), "scope": self.scope, "atUtc": AT}
        s = self.execute("settle", settle, "s1")
        self.assertEqual((s["allocation"]["requests"], s["provenance"]), (2930, "evidence-sha256:" + hashlib.sha256(self.record()).hexdigest()))
        self.assertEqual((self.receive()["outstandingReservations"], self.receive()["requests"]["conservativeUsed"]), (0, 2930))
        self.refused("manual-reservation-transition-without-open-reservation", self.execute, "settle", settle, "s2")
        self.refused("manual-reservation-not-reserved", self.execute, "settle", dict(settle, runId="41400000009"), "s3")

    def test_phase_bound_journals_allow_exact_retries_and_refuse_cross_phase_reuse(self):
        directory = os.path.join(self.d, "phase-journals")
        os.mkdir(directory)
        reserve_journal = os.path.join(directory, "reserve-journal.json")
        reserve_receipt = os.path.join(directory, "reserve-receipt.json")
        settle_journal = os.path.join(directory, "settle-journal.json")
        settle_receipt = os.path.join(directory, "settle-receipt.json")

        first = M.execute("reserve", self.reserve_inputs(), self.repo, self.remote, self.root,
                          reserve_journal, reserve_receipt, self.all_pins, self.remote)
        receipt_bytes = read(reserve_receipt)
        retry = M.execute("reserve", self.reserve_inputs(), self.repo, self.remote, self.root,
                          reserve_journal, reserve_receipt, self.all_pins, self.remote)
        self.assertEqual(retry, first)
        self.assertEqual(read(reserve_receipt), receipt_bytes)
        self.assertEqual([event["type"] for event in self.chain()[-1][1]], ["reserve"],
                         "an exact transition retry must not append a duplicate reserve")

        settle = {"campaignId": "R7-full-coverage", "runId": RUN, "record": self.record(),
                  "scope": self.scope, "atUtc": AT}
        with self.assertRaises(M.Refused) as error:
            M.execute("settle", settle, self.repo, self.remote, self.root,
                      reserve_journal, settle_receipt, self.all_pins, self.remote)
        self.assertEqual(str(error.exception), "manual-reservation-journal-conflict")
        self.assertEqual(self.receive()["outstandingReservations"], 1,
                         "cross-phase journal reuse must refuse before settling the held reservation")

        settled = M.execute("settle", settle, self.repo, self.remote, self.root,
                            settle_journal, settle_receipt, self.all_pins, self.remote)
        settle_receipt_bytes = read(settle_receipt)
        settled_retry = M.execute("settle", settle, self.repo, self.remote, self.root,
                                  settle_journal, settle_receipt, self.all_pins, self.remote)
        self.assertEqual(settled_retry, settled)
        self.assertEqual(read(settle_receipt), settle_receipt_bytes)
        self.assertEqual([event["type"] for event in self.chain()[-1][1]], ["reserve", "settle"],
                         "an exact settle retry must not append a duplicate transition")

    def test_a_landed_transition_with_a_durable_journal_recovers_its_missing_receipt(self):
        directory = os.path.join(self.d, "interrupted-publication")
        os.mkdir(directory)
        journal = os.path.join(directory, "reserve-journal.json")
        receipt = os.path.join(directory, "reserve-receipt.json")
        original_publish = W.publish_atomic

        def interrupt_receipt(path, body, conflict):
            if path == receipt:
                raise RuntimeError("synthetic interruption after remote append")
            return original_publish(path, body, conflict)

        before = self.head()
        with mock.patch.object(W, "publish_atomic", side_effect=interrupt_receipt):
            with self.assertRaisesRegex(RuntimeError, "synthetic interruption"):
                M.execute("reserve", self.reserve_inputs(), self.repo, self.remote, self.root,
                          journal, receipt, self.all_pins, self.remote)
        landed = self.head()
        self.assertNotEqual(landed, before, "the interruption must occur after the append lands")
        self.assertTrue(os.path.isfile(journal))
        self.assertFalse(os.path.exists(receipt))
        journal_bytes = read(journal)

        os.unlink(journal)
        with self.assertRaises(M.Refused):
            M.execute("reserve", self.reserve_inputs(), self.repo, self.remote, self.root,
                      journal, receipt, self.all_pins, self.remote)
        self.assertEqual(self.head(), landed, "a missing journal cannot authorize recovery or append a duplicate")
        with open(journal, "wb") as f:
            f.write(journal_bytes)

        changed_event = dict(self.reserve_inputs(), atUtc="2026-11-02T04:00:01Z")
        with self.assertRaises(M.Refused):
            M.execute("reserve", changed_event, self.repo, self.remote, self.root,
                      journal, receipt, self.all_pins, self.remote)
        self.assertEqual(self.head(), landed, "a changed event cannot be recovered through the old journal")

        recovered = M.execute("reserve", self.reserve_inputs(), self.repo, self.remote, self.root,
                              journal, receipt, self.all_pins, self.remote)
        self.assertEqual(recovered, self.chain()[-1][1][-1])
        self.assertEqual(read(journal), journal_bytes)
        with open(receipt, encoding="utf-8") as f:
            self.assertTrue(W.verify(self.repo, self.remote, json.load(f), recovered, self.root, self.remote)["verified"])
        self.assertEqual(self.head(), landed, "receipt recovery must preserve the already-landed head")
        self.assertEqual([event["type"] for event in self.chain()[-1][1]], ["reserve"],
                         "receipt recovery must not append a duplicate transition")

        with open(receipt, "w", encoding="utf-8") as f:
            f.write("conflicting output\n")
        self.refused("manual-reservation-receipt-conflict", M.execute, "reserve", self.reserve_inputs(),
                     self.repo, self.remote, self.root, journal, receipt, self.all_pins, self.remote)
        self.assertEqual(self.head(), landed)

        os.unlink(receipt)
        changed = json.loads(journal_bytes)
        changed["newSha"] = "f" * 40
        with open(journal, "w", encoding="utf-8") as f:
            json.dump(changed, f)
        self.refused("manual-reservation-receipt-commit-not-on-state-ref", M.execute, "reserve", self.reserve_inputs(),
                     self.repo, self.remote, self.root, journal, receipt, self.all_pins, self.remote)
        self.assertFalse(os.path.exists(receipt), "a non-matching journal must not recreate a receipt")
        self.assertEqual([event["type"] for event in self.chain()[-1][1]], ["reserve"])

    def test_the_integrated_path_keeps_the_trust_boundaries(self):
        r = self.reserve_inputs()
        self.refused("manual-reservation-root-mismatch", self.execute, "reserve", r, "x1", "f" * 40)
        # scope: the accepted BYTES, not any parseable scope with a nonempty approvalRef
        self.refused("manual-reservation-scope-not-accepted", self.execute, "reserve", dict(r, scope=scope_raw(approvalRef="slack:1")), "x2")
        self.refused("manual-reservation-scope-not-accepted", self.execute, "reserve", r, "x3", None, dict(self.all_pins, accepted_scope_sha256=None))
        # period checked BEFORE the append: the chain stays empty
        self.refused("manual-reservation-outside-period", self.execute, "reserve", dict(r, atUtc="2026-11-01T23:59:59Z"), "x4")
        self.refused("manual-reservation-outside-period", self.execute, "reserve", dict(r, atUtc="2026-12-02T00:00:00Z"), "x5")
        self.assertEqual(self.chain()[-1][1], [])
        self.refused("manual-reservation-rollup-not-accepted", self.execute, "reserve", r, "x6", None, dict(self.all_pins, accepted_sha256=None))
        # release: refused on the integrated path until never-started evidence can be verified
        self.execute("reserve", r, "x7")
        self.refused("manual-release-never-started-unverified", self.execute, "release", {"campaignId": "R7-full-coverage", "runId": RUN}, "x8")
        self.assertEqual(self.receive()["outstandingReservations"], 1)

    def test_a_late_settle_is_refused_before_the_append_and_the_reservation_stays_held(self):
        self.execute("reserve", self.reserve_inputs(), "r1")
        head = self.head()
        late = {"campaignId": "R7-full-coverage", "runId": RUN, "record": self.record(), "scope": self.scope, "atUtc": "2026-12-02T00:00:00Z"}
        self.refused("manual-settle-outside-period", self.execute, "settle", late, "s1")
        self.refused("manual-settle-outside-period", self.execute, "settle", dict(late, atUtc="2026-11-01T23:59:59Z"), "s2")
        self.refused("manual-reservation-scope-not-accepted", self.execute, "settle", dict(late, scope=scope_raw(carryover="historical")), "s3")
        self.assertEqual(self.head(), head, "nothing was appended")
        out = self.receive()
        self.assertEqual((out["outstandingReservations"], out["requests"]["conservativeUsed"]), (1, 4342), "the reservation stays held at its caps")
        self.execute("settle", dict(late, atUtc="2026-12-01T23:59:59Z"), "s4")
        self.assertEqual(self.receive()["outstandingReservations"], 0)

    def test_the_release_event_needs_never_started_and_an_approval(self):
        e = self.reserved()
        self.refused("manual-release-run-started", M.release, e, True, "slack-1793556225.890759", AT)
        self.refused("manual-release-run-started", M.release, e, None, "slack-1793556225.890759", AT)
        self.refused("manual-release-approval", M.release, e, False, "free text", AT)
        self.assertEqual(M.release(e, False, "slack-1793556225.890759", AT)["allocation"], ALLOCATION)

    def test_the_cli_refuses_while_the_writer_is_not_activated(self):
        for command in ("reserve", "settle", "release"):
            p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "manual_reservation.py"), command, "--request", "/nonexistent"],
                               capture_output=True, text=True)
            self.assertEqual((p.returncode, p.stdout, p.stderr.strip()), (78, "", "BLOCKED_SETUP: manual-reservation-not-activated"))
        self.assertFalse(M.activated())
        self.assertEqual((W.REVIEWED_ROOT, R.ACCEPTED_BOOTSTRAP_SHA256, R.ACCEPTED_ROOT, M.ACCEPTED_SCOPE_SHA256), (None, None, None, None))


if __name__ == "__main__":
    import unittest
    unittest.main()
