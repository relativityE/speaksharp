"""The nightly campaign's reserve and settle on the state-ref journal the continuity rollup reads, with G11 over that same journal (RETURN
1793572741.370569). Offline: a synthetic bare-repository journal, synthetic approvals and records; no reservation file, no network."""
import hashlib
import json
import os
import unittest

import _fixtures  # noqa: F401  (puts the scripts directory on the import path)
import manual_reservation as M
import reservations as RES
import state_ref_writer as W
from recurring_usage import journal_usage
from test_accounting_rollup import Journal, scope as rollup_scope
from test_nightly_request import approval, derive

AT = "2026-11-02T03:01:00Z"


class NightlyJournalReservation(Journal):
    def setUp(self):
        super().setUp()
        self.req_raw = derive(run_id="101")
        self.req = json.loads(self.req_raw)
        self.sha = hashlib.sha256(self.req_raw).hexdigest()
        self.approval = json.loads(approval())
        self.use_scope()
        self.n = 0

    def use_scope(self, **ceilings):
        c = {"requests": 132000, "protectedReserveRequests": 300, "identityReads": 960, "starts": 1200, "takes": 1200}
        c.update(ceilings)
        self.scope_raw = json.dumps(rollup_scope(periodStartUtc="2026-11-01T00:00:00Z", periodEndUtc="2026-12-01T00:00:00Z", ceilings=c),
                                    sort_keys=True).encode()
        self.pins_all = dict(self.pins, accepted_scope_sha256=hashlib.sha256(self.scope_raw).hexdigest())

    def execute(self, command, approval=None, **inputs):
        self.n += 1
        base = {"scope": self.scope_raw, "bootstrap": self.raw, "atUtc": AT}
        base.update(inputs)
        return RES.journal_execute(command, base, self.repo, self.remote, self.root, os.path.join(self.d, "journal-%d" % self.n),
                                   os.path.join(self.d, "receipt-%d.json" % self.n), self.pins_all, approval or self.approval, self.remote)

    def reserve(self, approval=None, attempt=1, raw=None):
        return self.execute("reserve", approval, request=raw or self.req_raw, admittedSha256=self.sha if raw is None else
                            hashlib.sha256(raw).hexdigest(), runId="123", attempt=attempt)

    def refused(self, code, fn, *a, **k):
        with self.assertRaises(RES.JournalRefused) as e:
            fn(*a, **k)
        self.assertEqual(str(e.exception), code)

    def test_the_reserve_lands_on_the_journal_and_the_run_stage_requires_exactly_it(self):
        event = self.reserve()
        self.assertEqual((event["campaignId"], event["runId"], event["provenance"]), (self.req["runId"], "123", "request-sha256:" + self.sha))
        self.assertEqual(event["allocation"]["requests"], self.req["approvedLimits"]["runCapRequests"] + self.req["approvedLimits"]["identityCap"])
        self.assertEqual(self.chain()[-1][1][-1], event)
        self.assertEqual(RES.journal_require(self.chain(), self.req["runId"], "123", self.sha), event)
        self.refused("reservation-not-held", RES.journal_require, self.chain(), self.req["runId"], "124", self.sha)
        self.refused("reservation-not-held", RES.journal_require, self.chain(), self.req["runId"], "123", "0" * 64)
        # G11 now reads this run from the same journal.
        u = journal_usage(self.approval, self.chain())
        self.assertEqual((u["runs"], u["used"]["requests"]), (1, event["allocation"]["requests"]))

    def test_a_replay_a_rerun_or_a_manual_request_never_reserves(self):
        self.reserve()
        self.refused("reservation-duplicate-transition", self.reserve)
        self.refused("reservation-attempt", self.reserve, attempt=2)
        manual = json.dumps(dict(self.req, priority="full-coverage")).encode()
        self.refused("reservation-not-nightly", self.reserve, raw=manual)

    def test_g5_headroom_and_g11_standing_limits_hold_over_the_same_journal(self):
        self.use_scope(requests=4000)
        self.refused("reservation-exceeds-headroom", self.reserve)
        self.use_scope()
        other = {"type": "reserve", "campaignId": "nightly-20261101T0000Z-20261101T0300Z", "runId": "100", "attempt": 1,
                 "allocation": {k: 0 for k in W.CATS}, "provenance": "request-sha256:" + "c" * 64, "atUtc": "2026-11-01T03:01:00Z"}
        self.append_event(other)
        one_run = dict(self.approval, cadence=dict(self.approval["cadence"], runsPerPeriod=1))
        self.refused("reservation-standing-limit", self.reserve, approval=one_run)
        self.assertTrue(self.reserve())  # the default cadence (30) still holds two runs
        self.assertEqual(journal_usage(self.approval, self.chain())["runs"], 2)

    def test_the_settle_replaces_the_reservation_with_measured_usage_from_the_collector_record(self):
        reserved = self.reserve()
        record = json.dumps({"schema": M.RUN_RECORD_SCHEMA, "runId": self.req["runId"],
                             "executionProvenance": {"campaignId": self.req["runId"], "runId": "123", "attempt": 1, "requestSha256": self.sha},
                             "spend": {"requests": 900, "identityReads": 20, "starts": 30, "takes": 25}}).encode()
        settled = self.execute("settle", campaignId=self.req["runId"], runId="123", record=record)
        self.assertEqual((settled["type"], settled["allocation"]["requests"], settled["allocation"]["coachingRequests"]),
                         ("settle", 900, reserved["allocation"]["coachingRequests"]))  # unmeasured: settled at the reserved cap
        self.assertEqual(journal_usage(self.approval, self.chain())["used"]["requests"], 900)
        self.refused("reservation-not-held", RES.journal_require, self.chain(), self.req["runId"], "123", self.sha)

    def test_production_is_not_activated(self):
        self.assertIsNone(W.REVIEWED_ROOT)
        self.refused("reservation-root-mismatch", RES.journal_execute, "reserve", {}, self.repo, self.remote, None,
                     os.path.join(self.d, "j"), os.path.join(self.d, "o"), self.pins_all, self.approval, self.remote)

    def append_event(self, event):
        W.propose(self.repo, self.remote, W.fetch_head(self.repo, self.remote, self.remote), event, self.root, self.remote)


if __name__ == "__main__":
    unittest.main()
