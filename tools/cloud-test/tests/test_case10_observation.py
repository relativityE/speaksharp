"""Case 10 nightly current-state observation (Sam 1793570217.800529, design A), offline only. Every reader here is SYNTHETIC and trusted only
through the test-only override; production trusts no reader, so every record refuses."""
import copy
import hashlib
import unittest
from datetime import datetime, timedelta, timezone

import _fixtures  # noqa: F401  (puts the scripts directory on the import path)
import case10_observation as O
from case10_request_bound import INPUTS
from test_case10_request_bound import projection

READER = "synthetic:case10-current-state@1"
ACCOUNT = "00000000-0000-4000-8000-000000000001"
REQUEST_SHA = "a" * 64
START = datetime(2026, 11, 2, 3, 0, tzinfo=timezone.utc)
NOW = START + timedelta(minutes=2)


def request(**contract_over):
    contract = {"schema": O.CONTRACT_SCHEMA, "reader": READER, "recordSchema": O.RECORD_SCHEMA, "projectionKeys": sorted(INPUTS),
                "maxAgeSeconds": 600, "readBudget": {"requests": 12, "identityReads": 1}}
    contract.update(contract_over)
    return {"runId": "nightly-20261101T0000Z-20261102T0300Z", "release": {"testedSha": "4" * 40},
            "window": {"startUtc": "2026-11-02T03:00:00Z", "endUtc": "2026-11-02T08:30:00Z"},
            "selection": [{"case": "AHT-09", "plannedRequests": 100},
                          {"case": "AHT-10", "plannedRequests": 190, "observationContract": contract}]}


def reader(keys, **over):
    p = projection(**over)
    return {k: p[k] for k in keys}


def settle_raw(req, observation=None, attempt=1, run_id="101", sha=REQUEST_SHA):
    """The closed settle input projected from a synthetic run record for this request (settle_input.project)."""
    import json
    import settle_input as S
    rec = {"schema": S.RUN_RECORD_SCHEMA, "runId": req["runId"], "cases": [{"case": "AHT-10", "verdict": "PASS"}],
           "executionProvenance": {"campaignId": req["runId"], "runId": run_id, "attempt": attempt, "requestSha256": sha, "sourceSha": "4" * 40},
           "spend": {"requests": 120, "identityReads": 2, "starts": 3, "takes": 3, "coachingRequests": 1}}
    return S.project(json.dumps(rec).encode(), observation)


def refused(test, code, fn, *a, **k):
    with test.assertRaises(O.Refused) as e:
        fn(*a, **k)
    test.assertEqual(str(e.exception), code)


class Observation(unittest.TestCase):
    def setUp(self):
        self.req = request()
        self.record = O.observe(reader, self.req, REQUEST_SHA, "101", 1, ACCOUNT, NOW - timedelta(minutes=1))

    def admit(self, record=None, req=None, now=NOW, trusted=frozenset({READER}), run_id="101", attempt=1, account=ACCOUNT, sha=REQUEST_SHA):
        return O.admit(self.record if record is None else record, req or self.req, sha, run_id, attempt, account, now, trusted=trusted)

    def changed(self, **over):
        r = copy.deepcopy(self.record)
        r.update(over)
        return r

    def test_a_fresh_read_bound_to_this_request_and_attempt_is_admitted(self):
        report = self.admit()
        self.assertEqual(report["recordSha256"], hashlib.sha256(O.canon(self.record)).hexdigest())
        self.assertLessEqual(report["transmittedBound"], 190)
        self.assertEqual(report["allowance"], 240)
        self.assertEqual((self.record["campaignId"], self.record["runId"], self.record["attempt"], self.record["reader"]),
                         (self.req["runId"], "101", 1, READER))

    def test_production_trusts_no_reader_so_every_record_refuses(self):
        self.assertEqual(O.TRUSTED_READERS, frozenset())
        refused(self, "case10-observation-reader-not-trusted", self.admit, trusted=None)
        refused(self, "case10-observation-reader-not-trusted", self.admit, trusted=frozenset({"synthetic:other@1"}))

    def test_the_request_must_pin_the_exact_contract(self):
        for over in ({"schema": "x"}, {"recordSchema": "x"}, {"reader": "Bad Reader"}, {"projectionKeys": sorted(INPUTS)[:-1]},
                     {"projectionKeys": sorted(INPUTS) + ["extra"]}, {"maxAgeSeconds": 0}, {"maxAgeSeconds": 3601}, {"maxAgeSeconds": True},
                     {"readBudget": {"requests": 0, "identityReads": 1}}, {"readBudget": {"requests": 51, "identityReads": 1}},
                     {"readBudget": {"requests": 12}}, {"readBudget": {"requests": 12, "identityReads": 1, "starts": 1}}):
            with self.subTest(over=over):
                refused(self, "case10-observation-contract", self.admit, req=request(**over))
        no_row = copy.deepcopy(self.req)
        no_row["selection"] = no_row["selection"][:1]
        refused(self, "case10-observation-not-selected", self.admit, req=no_row)

    def test_another_request_run_attempt_campaign_source_account_or_reader_refuses(self):
        refused(self, "case10-observation-not-this-request", self.admit, sha="b" * 64)
        refused(self, "case10-observation-replayed", self.admit, run_id="100")  # an earlier run's record, relabelled
        refused(self, "case10-observation-replayed", self.admit, record=self.changed(attempt=2), attempt=2)
        refused(self, "case10-observation-replayed", self.admit, record=self.changed(attempt=True))
        refused(self, "case10-observation-replayed", self.admit, record=self.changed(campaignId="nightly-20261101T0000Z-20261101T0300Z"))
        refused(self, "case10-observation-foreign", self.admit, record=self.changed(sourceSha="5" * 40))
        refused(self, "case10-observation-foreign", self.admit, account="00000000-0000-4000-8000-000000000002")
        refused(self, "case10-observation-foreign", self.admit, record=self.changed(reader="synthetic:other@1"))
        refused(self, "case10-observation-shape", self.admit, record=self.changed(extra=1))
        refused(self, "case10-observation-shape", self.admit, record=self.changed(schema="speaksharp.cloud-test.case10-projection.v1"))

    def test_a_historical_or_stale_observation_refuses(self):
        refused(self, "case10-observation-stale", self.admit, record=self.changed(observedAtUtc="2026-11-02T02:59:59Z"))  # before the window
        refused(self, "case10-observation-stale", self.admit, now=NOW + timedelta(minutes=10))  # older than the 600 s freshness
        refused(self, "case10-observation-stale", self.admit, record=self.changed(observedAtUtc="2026-11-02T03:05:00Z"))  # after now
        refused(self, "case10-observation-time", self.admit, record=self.changed(observedAtUtc="2026-11-02 03:01:00"))

    def test_the_projection_must_be_exactly_the_allowed_inputs_and_fit_the_row_and_allowance(self):
        extra = dict(self.record["projection"], unexpected=1)
        refused(self, "case10-observation-projection", self.admit, record=self.changed(projection=extra))
        missing = {k: v for k, v in self.record["projection"].items() if k != "bootstrap"}
        refused(self, "case10-observation-projection", self.admit, record=self.changed(projection=missing))
        refused(self, "case10-observation-projection", self.admit, record=self.changed(projection=dict(self.record["projection"], auth=-1)))
        heavy = O.observe(lambda keys: reader(keys, successorSave=200), self.req, REQUEST_SHA, "101", 1, ACCOUNT, NOW)  # bound 281 > 240
        refused(self, "case10-observation-over-allowance", self.admit, record=heavy)
        tight = copy.deepcopy(self.req)
        tight["selection"][1]["plannedRequests"] = 80  # the fresh bound (84) exceeds this row's plan, though it fits 240
        refused(self, "case10-observation-over-allowance", self.admit, req=tight)


from test_accounting_rollup import Journal  # noqa: E402
import accounting_rollup as R  # noqa: E402
from test_accounting_rollup import scope as rollup_scope  # noqa: E402
import state_ref_writer as W  # noqa: E402


class ReserveBeforeRead(Journal):
    """Sam 1793570557.244339: no read until the SAME journal accepted the reserve; a failed or partial read stays counted. A synthetic bare
    repository journal stands in for the state ref; nothing remote is written and no real reader exists."""
    HEADROOM = {"requests": 1000, "identityReads": 10}

    def setUp(self):
        super().setUp()
        self.req = request()
        self.calls = []

    def reader(self, keys):
        self.calls.append(list(keys))
        return reader(keys)

    def journal(self, headroom=None, **over):
        test = self

        class Fixed:
            """The real writer and chain on the synthetic bare journal; only the headroom is a fixed test value here (the composed control
            in test_init_run_inputs drives StateJournal with the real checkpoint headroom)."""
            def head(self):
                return W.fetch_head(test.repo, test.remote, test.remote)

            def chain_at(self, head):
                return W.validate_chain(test.repo, head, test.root)

            def headroom(self, head):
                return test.HEADROOM if headroom is None else headroom

            def propose(self, event, head):
                return W.propose(test.repo, test.remote, head, event, test.root, test.remote)
        j = Fixed()
        for name, fn in over.items():
            setattr(j, name, fn)
        return j

    def run_it(self, reader_fn=None, journal=None, now=NOW):
        return O.reserve_then_read(reader_fn or self.reader, journal or self.journal(), self.req, REQUEST_SHA, "101", 1, ACCOUNT, now)

    def propose(self, event):
        return W.propose(self.repo, self.remote, W.fetch_head(self.repo, self.remote, self.remote), event, self.root, self.remote)

    def counted(self):
        # This is the fresh synthetic period, so its boundary must follow the
        # retained bootstrap cutoff (2026-11-01T17:00Z). Starting it before
        # that cutoff correctly triggers the production overlap refusal and
        # prevents these controls from observing their accepted reservation.
        sc = rollup_scope(periodStartUtc="2026-11-02T00:00:00Z", periodEndUtc="2026-12-02T00:00:00Z")
        return R.receive(self.raw, sc, self.chain(), **self.pins)

    def test_the_read_happens_only_after_the_journal_accepted_exactly_this_reserve(self):
        before = self.chain()[-1][0]
        record, event, receipt = self.run_it()
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(receipt["previousSha"], before)
        head = self.chain()[-1]
        self.assertEqual((head[0], head[1][-1]), (receipt["newSha"], event))
        self.assertEqual(event["campaignId"], self.req["runId"] + O.RESERVATION_SUFFIX)
        self.assertEqual((event["allocation"]["requests"], event["allocation"]["identityReads"], event["provenance"]),
                         (12, 1, "request-sha256:" + REQUEST_SHA))
        self.assertEqual(O.admit(record, self.req, REQUEST_SHA, "101", 1, ACCOUNT, NOW, trusted=frozenset({READER}))["allowance"], 240)
        self.assertEqual(self.counted()["outstandingReservations"], 1)

    def test_a_missing_failed_moved_unconfirmed_or_unpersisted_reserve_never_invokes_the_reader(self):
        def failing(event, head):
            raise W.Refused("state-ref-push-rejected")
        refused(self, "case10-observation-reserve-failed", self.run_it, journal=self.journal(propose=failing))
        foreign = {"type": "reserve", "campaignId": "R10-manual", "runId": "41400000009", "attempt": 1,
                   "allocation": {k: 0 for k in W.CATS}, "provenance": "request-sha256:" + "c" * 64, "atUtc": "2026-11-02T03:00:30Z"}
        base = self.journal()

        def moved(event, head):  # the head moves between the headroom read and the append: the lease on `head` refuses
            self.propose(foreign)
            return base.propose(event, head)
        refused(self, "case10-observation-reserve-failed", self.run_it, journal=self.journal(propose=moved))
        appended = len(self.chain()[-1][1])
        refused(self, "case10-observation-reserve-not-accepted", self.run_it, journal=self.journal(propose=lambda e, h: None))
        other = {"ref": W.STATE_REF, "previousSha": self.root, "newSha": "e" * 40, "ledgerBlobSha256": "0" * 64, "proposalSha256": "0" * 64}
        refused(self, "case10-observation-reserve-not-accepted", self.run_it, journal=self.journal(propose=lambda e, h: other))
        def unpersisted(event, head):  # a receipt for exactly this event that never landed (a local proposal)
            return {"ref": W.STATE_REF, "previousSha": head, "newSha": "e" * 40, "ledgerBlobSha256": "0" * 64,
                    "proposalSha256": W.sha256(W.canon(event))}
        refused(self, "case10-observation-reserve-not-persisted", self.run_it, journal=self.journal(propose=unpersisted))
        refused(self, "case10-observation-no-headroom", self.run_it, journal=self.journal(headroom={"requests": 11, "identityReads": 1}))
        refused(self, "case10-observation-no-headroom", self.run_it, journal=self.journal(headroom={"requests": 12}))
        self.assertEqual(self.calls, [])
        self.assertEqual(len(self.chain()[-1][1]), appended)  # only the foreign event was appended by any refused attempt

    def test_a_failed_or_partial_read_leaves_the_reservation_counted(self):
        def broken(keys):
            self.calls.append(list(keys))
            raise OSError("synthetic transport failure")
        refused(self, "case10-observation-read-failed", self.run_it, reader_fn=broken)
        self.assertEqual(len(self.calls), 1)
        rc = self.counted()
        self.assertEqual((rc["outstandingReservations"], rc["period"]["requests"], rc["period"]["identityReads"]), (1, 12, 1))

    def test_a_partial_read_is_refused_at_admission_and_its_reservation_stays_counted(self):
        partial = lambda keys: {k: v for k, v in reader(keys).items() if k != "bootstrap"}
        record, _, _ = self.run_it(reader_fn=partial)
        refused(self, "case10-observation-projection", O.admit, record, self.req, REQUEST_SHA, "101", 1, ACCOUNT, NOW, frozenset({READER}))
        rc = self.counted()
        self.assertEqual((rc["outstandingReservations"], rc["period"]["requests"]), (1, 12))

    def test_a_completed_read_settles_at_its_reserved_budget_with_the_record_as_evidence(self):
        record, event, _ = self.run_it()
        settle = O.settlement_event(event, record, NOW + timedelta(minutes=1))
        self.assertEqual((settle["type"], settle["allocation"], settle["provenance"]),
                         ("settle", event["allocation"], "evidence-sha256:" + hashlib.sha256(O.canon(record)).hexdigest()))
        self.propose(settle)
        rc = self.counted()
        self.assertEqual((rc["outstandingReservations"], rc["period"]["requests"], rc["period"]["identityReads"]), (0, 12, 1))
        with self.assertRaises(W.Refused):
            self.propose(settle)  # a settle is never replayed

    def test_the_read_only_half_reads_only_against_an_open_reserve_of_exactly_this_request(self):
        """Sam 1793580806.654369: the live job holds no write access. It reads only when the verified chain already holds this observation's
        open reserve at exactly the contract budget; it never appends."""
        read = lambda events: O.read_reserved(self.reader, events, self.req, REQUEST_SHA, "101", 1, ACCOUNT, NOW)
        refused(self, "case10-observation-reserve-not-held", read, self.chain()[-1][1])
        mine = O.reservation_event(self.req, REQUEST_SHA, "101", 1, NOW)
        for wrong in (O.reservation_event(request(readBudget={"requests": 11, "identityReads": 1}), REQUEST_SHA, "101", 1, NOW),
                      O.reservation_event(self.req, "b" * 64, "101", 1, NOW), O.reservation_event(self.req, REQUEST_SHA, "102", 1, NOW)):
            refused(self, "case10-observation-reserve-not-held", read, [wrong])
        self.assertEqual(self.calls, [])
        event, _, events = O.reserve_observation(self.journal(), self.req, REQUEST_SHA, "101", 1, NOW)
        self.assertEqual((event, self.calls), (mine, []))  # the write half never reads
        before = self.chain()[-1][0]
        record, reserved = read(self.chain()[-1][1])
        self.assertEqual((reserved, len(self.calls), self.chain()[-1][0]), (mine, 1, before))  # read, and nothing appended
        self.propose(O.settlement_event(reserved, record, NOW))
        refused(self, "case10-observation-reserve-not-held", read, self.chain()[-1][1])  # a settled reserve is no longer held
        self.assertEqual(len(self.calls), 1)

    def test_a_lost_push_response_reconciles_from_the_persisted_chain_and_never_reappends(self):
        """Recovery (Sam 1793575063.458039): the writer's response is lost. One fresh chain read decides: landed on exactly the leased head ->
        the read proceeds with no receipt; not landed -> refuse, nothing re-appended, the reader never invoked."""
        base = self.journal()

        def landed_then_lost(event, head):
            base.propose(event, head)
            raise OSError("connection reset after the push")
        before = len(self.chain()[-1][1])
        record, event, receipt = self.run_it(journal=self.journal(propose=landed_then_lost))
        self.assertIsNone(receipt)
        self.assertEqual((len(self.calls), self.chain()[-1][1][-1], len(self.chain()[-1][1])), (1, event, before + 1))
        self.assertEqual(O.admit(record, self.req, REQUEST_SHA, "101", 1, ACCOUNT, NOW, trusted=frozenset({READER}))["allowance"], 240)

    def test_a_lost_response_without_a_landing_or_on_another_head_refuses_without_reading(self):
        def lost(event, head):
            raise OSError("timeout before any push")
        appended = len(self.chain()[-1][1])
        refused(self, "case10-observation-reserve-unconfirmed", self.run_it, journal=self.journal(propose=lost))
        foreign = {"type": "reserve", "campaignId": "R10-manual", "runId": "41400000009", "attempt": 1,
                   "allocation": {k: 0 for k in W.CATS}, "provenance": "request-sha256:" + "c" * 64, "atUtc": "2026-11-02T03:00:30Z"}

        def other_landed(event, head):  # someone else's append took the head: this reserve did not land
            self.propose(foreign)
            raise OSError("connection reset")
        refused(self, "case10-observation-reserve-unconfirmed", self.run_it, journal=self.journal(propose=other_landed))

        def unreadable(event, head):
            raise OSError("reset")
        broken = self.journal(propose=unreadable)
        broken.chain_at = lambda head: (_ for _ in ()).throw(OSError("fetch failed"))
        refused(self, "case10-observation-reserve-unconfirmed", O.reserve_observation, broken, self.req, REQUEST_SHA, "101", 1, NOW)
        self.assertEqual(self.calls, [])
        self.assertEqual(len(self.chain()[-1][1]), appended + 1)  # only the foreign event

    def test_the_settle_step_takes_only_this_runs_digest_from_the_closed_settle_input(self):
        import settle_input as S
        record, event, _ = self.run_it()
        digest = hashlib.sha256(O.canon(record)).hexdigest()
        raw = settle_raw(self.req, observation=O.canon(record))
        self.assertEqual(O.settled_digest(raw, self.req, REQUEST_SHA, "101"), digest)
        self.assertEqual(O.settlement_for(event, digest, NOW), O.settlement_event(event, record, NOW))
        self.assertIsNone(O.settled_digest(settle_raw(self.req), self.req, REQUEST_SHA, "101"))
        refused(self, "case10-observation-settle-input", O.settled_digest, raw, self.req, REQUEST_SHA, "102")
        refused(self, "case10-observation-settle-input", O.settled_digest, raw, self.req, "b" * 64, "101")
        refused(self, "case10-observation-settle-input", O.settled_digest, settle_raw(self.req, attempt=2), self.req, REQUEST_SHA, "101")
        refused(self, "case10-observation-settle-input", O.settled_digest, raw + b" ", self.req, REQUEST_SHA, "101")
        self.assertRaises(S.Refused, S.validate, raw.replace(b'"spend":{', b'"projection":{},"spend":{'))

    def test_the_same_occurrence_cannot_reserve_its_observation_twice(self):
        self.run_it()
        refused(self, "case10-observation-reserve-failed", self.run_it)  # the writer refuses a duplicate reserve key
        self.assertEqual(len(self.calls), 1)


class ObserveCli(unittest.TestCase):
    """The nightly job's step before prepare: inactive in production (no trusted reader, no activated writer); refuses before any read."""
    def setUp(self):
        import json
        import os
        import shutil
        import subprocess
        import sys
        import tempfile
        from _fixtures import ROOT
        self.json, self.os, self.subprocess, self.sys = json, os, subprocess, sys
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d)
        self.script = os.path.join(ROOT, "scripts", "case10_observation.py")

    def run_cli(self, req, sha=None, attempt="1", command="observe", extra=()):
        raw = self.json.dumps(req).encode()
        path = self.os.path.join(self.d, "request-%d.json" % len(self.os.listdir(self.d)))
        with open(path, "wb") as f:
            f.write(raw)
        out = self.os.path.join(self.d, "observation.json")
        p = self.subprocess.run([self.sys.executable, "-I", self.script, command, "--request", path, "--request-sha256",
                                 sha or hashlib.sha256(raw).hexdigest(), "--run-id", "101", "--attempt", attempt, "--out", out, *extra],
                                capture_output=True, text=True)
        return p.returncode, p.stderr.strip(), self.os.path.exists(out)

    def test_the_reserve_and_settle_steps_refuse_in_production_and_a_missing_record_stays_counted(self):
        self.assertEqual(self.run_cli(request(), command="reserve"), (78, "BLOCKED_SETUP: case10-observation-not-activated", False))
        settle = self.os.path.join(self.d, "settle-input.json")
        with open(settle, "wb") as f:
            f.write(settle_raw(request(), observation=b"{}"))
        self.assertEqual(self.run_cli(request(), command="settle", extra=("--settle-input", settle)),
                         (78, "BLOCKED_SETUP: case10-observation-not-activated", False))
        missing = self.os.path.join(self.d, "absent.json")
        self.assertEqual(self.run_cli(request(), command="settle", extra=("--settle-input", missing)), (0, "", False))

    def test_production_refuses_before_any_read_and_writes_nothing(self):
        self.assertEqual((sorted(O.READERS), O.TRUSTED_READERS), (["speaksharp:case10-owner-state@1"], frozenset()))
        self.assertFalse(O.activated())
        self.assertEqual(self.run_cli(request()), (78, "BLOCKED_SETUP: case10-observation-not-activated", False))

    def test_once_activated_the_account_comes_from_the_private_bundle_through_prepares_validators(self):
        from unittest import mock
        from test_init_run_inputs import SUPABASE_URL_OK, bundle_with
        with mock.patch.dict(self.os.environ, {"CLOUD_TEST_LIVE_ACCOUNTS": bundle_with(ACCOUNT), "SUPABASE_URL": SUPABASE_URL_OK}):
            self.assertEqual(O._bundle_account(), ACCOUNT)
        with mock.patch.dict(self.os.environ, {"CLOUD_TEST_LIVE_ACCOUNTS": "{}", "SUPABASE_URL": SUPABASE_URL_OK}):
            refused(self, "case10-observation-account", O._bundle_account)

    def test_no_contract_means_no_observation_step_effect(self):
        req = request()
        req["selection"][1].pop("observationContract")
        self.assertEqual(self.run_cli(req), (0, "", False))

    def test_other_bytes_a_rerun_or_a_bad_contract_refuse(self):
        self.assertEqual(self.run_cli(request(), sha="0" * 64), (78, "BLOCKED_SETUP: case10-observation-request", False))
        self.assertEqual(self.run_cli(request(), attempt="2"), (78, "BLOCKED_SETUP: case10-observation-replayed", False))
        self.assertEqual(self.run_cli(request(maxAgeSeconds=0)), (78, "BLOCKED_SETUP: case10-observation-contract", False))


if __name__ == "__main__":
    unittest.main()
