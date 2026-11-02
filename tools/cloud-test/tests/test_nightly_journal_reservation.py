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
        c = {"requests": 132000, "protectedReserveRequests": 300, "identityReads": 960, "starts": 1260, "takes": 1200}
        c.update(ceilings)
        self.scope_raw = json.dumps(rollup_scope(periodStartUtc="2026-11-02T00:00:00Z", periodEndUtc="2026-12-02T00:00:00Z", ceilings=c),
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
                 "allocation": {k: 0 for k in W.CATS}, "provenance": "request-sha256:" + "c" * 64, "atUtc": "2026-11-02T00:01:00Z"}
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
                         ("settle", 920, reserved["allocation"]["coachingRequests"]))  # requests + identity reads; unmeasured stays reserved
        self.assertEqual(journal_usage(self.approval, self.chain())["used"]["requests"], 920)
        self.refused("reservation-not-held", RES.journal_require, self.chain(), self.req["runId"], "123", self.sha)

    def test_admission_discounts_the_held_reservation_once_in_all_four_dimensions(self):
        # #1772 Code finding 4447628949 (Sam 1793653087.495259): journal -> accepted rollup -> validator at an exact fit. The run's own reserve
        # is already counted, so admission subtracts its held requests (run cap + identity charge), identity reads, Starts and takes once;
        # another request's reservation and this run's own Case 10 observation reserve stay charged in full.
        import validate_run_request as V
        import case10_observation as O
        from _fixtures import fake_rv, sample
        est, lim = self.req["estimate"], self.req["approvedLimits"]
        run_cap, ids, protected = est["requests"]["runCap"], est["identityReads"], 300
        held_requests, held_ids = lim["runCapRequests"] + lim["identityCap"], lim["identityCap"]  # the reserve holds the approved caps
        period = self.approval["periodCaps"]
        observation = {"requests": 50, "identityReads": 2}
        # The finding's fixture: everything else occupies the period so the remaining headroom is exactly this run's held allocation.
        external = {"requests": period["requests"] - protected - held_requests - observation["requests"],
                    "identityReads": period["identityReads"] - held_ids - observation["identityReads"], "starts": 2, "takes": 1}
        self.append_event({"type": "reserve", "campaignId": "nightly-20261101T0000Z-20261101T0300Z", "runId": "100", "attempt": 1,
                           "allocation": dict({k: 0 for k in W.CATS}, **external), "provenance": "request-sha256:" + "c" * 64,
                           "atUtc": "2026-11-02T00:01:00Z"})
        self.append_event({"type": "reserve", "campaignId": self.req["runId"] + O.RESERVATION_SUFFIX, "runId": "123", "attempt": 1,
                           "allocation": dict({k: 0 for k in W.CATS}, **observation), "provenance": "request-sha256:" + self.sha,
                           "atUtc": "2026-11-02T03:00:00Z"})
        held = self.reserve()["allocation"]  # admitted: the remaining headroom exactly holds this run
        self.assertEqual((held["requests"], held["identityReads"]), (held_requests, held_ids))
        s = sample()

        def admission(chain=None, request_sha256=self.sha):
            rc = self.receive(sc=json.loads(self.scope_raw), chain=chain)
            errors, _ = V.validate(self.req, s["cfg"], s["ledger"], s["wf"], fake_rv(), rc, None, request_sha256)
            return [e for e in errors if "cumulative ceiling" in e or "identity cap" in e or "cumulative cap" in e or "input structure" in e]

        self.assertEqual(admission(), [], "fixed after: the held allocation is replaced by the plan, admitted at the exact fit")
        broken = admission(request_sha256=None)  # broken before: the held allocation charged a second time
        self.assertEqual(period["requests"] + run_cap + ids, 136342)  # the finding's 136,342 > 132,000 and 992 > 960
        self.assertTrue(any("is below the reconciled requirement 136342" in e for e in broken), broken)
        self.assertTrue(any("identity cap 960 is below the reconciled requirement 992" in e for e in broken), broken)
        self.assertTrue(admission(request_sha256="d" * 64), "an unrelated request's digest discounts nothing")
        slack = held_requests - (run_cap + ids)  # the plan is below the held caps; identity is an exact fit
        for run, extra in (("98", {"requests": slack + 1}), ("99", {"identityReads": 1})):  # one past the fit, held elsewhere, is charged
            self.append_event({"type": "reserve", "campaignId": "manual-other", "runId": run, "attempt": 1,
                               "allocation": dict({k: 0 for k in W.CATS}, **extra), "provenance": "request-sha256:" + "e" * 64,
                               "atUtc": "2026-11-02T03:02:00Z"})
            self.assertTrue(admission(), "a global charge is never discounted: %s" % extra)
            self.append_event({"type": "release", "campaignId": "manual-other", "runId": run, "attempt": 1,
                               "allocation": dict({k: 0 for k in W.CATS}, **extra), "provenance": "approval:slack-1793653087.495259",
                               "atUtc": "2026-11-02T03:03:00Z"})
        self.assertEqual(admission(), [])
        self.append_event({"type": "reserve", "campaignId": self.req["runId"], "runId": "124", "attempt": 1, "allocation": held,
                           "provenance": "request-sha256:" + self.sha, "atUtc": "2026-11-02T03:04:00Z"})
        self.assertEqual(admission(), ["invalid per-case Start allocation or input structure"],
                         "a duplicate own reservation is ambiguous (own-reservation-ambiguous) and refuses admission")

    def test_production_is_pinned_to_the_reviewed_r10_root(self):
        self.assertEqual(W.REVIEWED_ROOT, "92d6ebf902351750c368d7d513116c6b1f19f80c")
        self.refused("reservation-root-mismatch", RES.journal_execute, "reserve", {}, self.repo, self.remote, None,
                     os.path.join(self.d, "j"), os.path.join(self.d, "o"), self.pins_all, self.approval, self.remote)

    def cli(self, command, **over):
        import argparse
        args = {"command": command, "request": None, "request_sha256": self.sha, "execution_run_id": "123", "attempt": 1, "approval": None,
                "repo": None, "record": None, "out": None, "journal": os.path.join(self.d, "cli-journal-%s" % command)}
        args.update(over)
        return RES.journal_main(argparse.Namespace(**args), url=self.remote, root=self.root, pins=self.pins_all)

    def test_the_cli_snapshots_reserves_requires_and_settles_on_one_journal_and_g11_reads_the_snapshot(self):
        import check_gates as G
        from _fixtures import ROOT
        checkout = os.path.join(self.d, "checkout")
        import init_run_inputs as I
        os.makedirs(os.path.join(checkout, I.CONTINUITY_DIR))
        for name, raw in ((I.CONTINUITY_BOOTSTRAP, self.raw), (I.CONTINUITY_SCOPE, self.scope_raw)):
            with open(os.path.join(checkout, I.CONTINUITY_DIR, name), "wb") as f:
                f.write(raw)
        req_path, ap_path = os.path.join(self.d, "req.json"), os.path.join(self.d, "approval.json")
        with open(req_path, "wb") as f:
            f.write(self.req_raw)
        # A self-consistent synthetic approval as G11 requires: cadence x per-run caps within the period caps, paid actions $0 in both.
        consistent = approval(periodCaps={"starts": 1350, "githubRunnerMinutes": 10800, "paidActionsUsd": 0})
        with open(ap_path, "wb") as f:
            f.write(consistent)
        cfg = json.load(open(os.path.join(ROOT, "config", "test-config.v1.json")))
        from datetime import datetime, timezone
        at = datetime(2026, 11, 2, 3, 1, tzinfo=timezone.utc)
        early = os.path.join(self.d, "snapshot-before-reserve.json")
        self.assertEqual(self.cli("journal-snapshot", out=early), 0)
        # Sam 1793592133.133339: G11 admits only a snapshot that holds THIS run's open reserve for the admitted request digest
        from unittest import mock
        pinned = (mock.patch.object(G, "JOURNAL_URL", self.remote), mock.patch.object(G, "JOURNAL_ROOT", self.root))
        for m in pinned:
            m.start()
            self.addCleanup(m.stop)
        g11 = G.recurring_gate(self.req, cfg, ROOT, {"entries": []}, at, json.load(open(early)), ap_path, self.sha, "123")
        self.assertEqual(g11["status"], G.NOTREADY, json.dumps(g11)[:900])
        self.assertEqual(self.cli("journal-reserve", request=req_path, approval=ap_path, repo=checkout, out=os.path.join(self.d, "r.json")), 0)
        snap = os.path.join(self.d, "snapshot.json")
        self.assertEqual(self.cli("journal-snapshot", out=snap), 0)
        g11 = G.recurring_gate(self.req, cfg, ROOT, {"entries": []}, at, json.load(open(snap)), ap_path, self.sha, "123")
        self.assertEqual(g11["status"], G.READY, json.dumps(g11)[:900])
        self.assertEqual(self.cli("journal-require", request=req_path), 0)
        self.assertEqual(self.cli("journal-require", request=req_path, execution_run_id="124"), 78)
        record = os.path.join(self.d, "record.json")
        with open(record, "w") as f:
            json.dump({"schema": M.RUN_RECORD_SCHEMA, "runId": self.req["runId"],
                       "executionProvenance": {"campaignId": self.req["runId"], "runId": "123", "attempt": 1, "requestSha256": self.sha},
                       "spend": {"requests": 900, "identityReads": 20, "starts": 30, "takes": 25}}, f)
        self.assertEqual(self.cli("journal-settle", request=req_path, approval=ap_path, repo=checkout, record=record,
                                  out=os.path.join(self.d, "s.json")), 0)
        self.assertEqual(self.cli("journal-require", request=req_path), 78)  # settled: no longer an open reservation
        # G11 over a snapshot with the period cadence used up refuses before any run.
        snap2 = os.path.join(self.d, "snapshot2.json")
        self.cli("journal-snapshot", out=snap2)
        one = dict(json.loads(consistent), cadence={"runsPerPeriod": 1, "period": "30 days"})
        with open(ap_path, "w") as f:
            json.dump(one, f)
        other = dict(self.req, runId="nightly-20261101T0000Z-20261103T0300Z")
        self.assertNotEqual(G.recurring_gate(other, cfg, ROOT, {"entries": []}, at, json.load(open(snap2)), ap_path)["status"], G.READY)

    def test_production_cli_is_activated_but_mismatched_pins_refuse_before_any_read(self):
        import argparse
        bad = dict(self.pins_all, accepted_root="f" * 40)
        args = argparse.Namespace(command="journal-snapshot", request=None, request_sha256=self.sha, execution_run_id="123", attempt=1,
                                  approval=None, repo=None, record=None, out=os.path.join(self.d, "never.json"), journal=None)
        self.assertEqual(RES.journal_main(args, url=self.remote, root=W.REVIEWED_ROOT, pins=bad), 78)
        self.assertFalse(os.path.exists(os.path.join(self.d, "never.json")))

    def append_event(self, event):
        W.propose(self.repo, self.remote, W.fetch_head(self.repo, self.remote, self.remote), event, self.root, self.remote)


class SealedUsageNeverHidesAReservation(unittest.TestCase):
    """Sam 1793574755.351569: an outstanding reservation is suppressed only by usable sealed usage; missing or invalid time stays counted."""
    CAPS = {"requests": 100, "identityReads": 2, "starts": 3, "takes": 4, "coachingRequests": 5, "runnerMinutes": 6}

    def fold(self, entries, approval_over=None):
        from recurring_usage import usage
        ledger = RES.append(RES.empty(), {"event": "reserve", "runId": "nightly-x", "atUtc": "2026-11-02T03:01:00Z", "caps": dict(self.CAPS),
                                          "requestConsumption": {}, "ref": "slack:1793553158.013909"})
        ap = dict(json.loads(approval()), **(approval_over or {}))
        return usage(ap, {"entries": entries}, ledger, None)

    def entry(self, kind="run", ended="2026-11-02T08:00:00Z"):
        return {"label": "nightly-x", "campaignId": "nightly-x", "summary": {"kind": kind, "endedUtc": ended, "requests": 40, "identityReads": 1,
                                                                             "starts": 1, "takes": 1, "coachingRequests": 1, "runnerMinutes": 1}}

    def test_only_a_run_with_a_valid_end_time_replaces_its_reservation(self):
        sealed = self.fold([self.entry()])
        self.assertEqual((sealed["openReservations"], sealed["used"]["requests"]), ([], 40))
        for label, entries in (("ledgers-only entry", [self.entry(kind="ledgers-only")]), ("missing endedUtc", [self.entry(ended=None)]),
                               ("invalid endedUtc", [self.entry(ended="yesterday")])):
            with self.subTest(label):
                u = self.fold(entries)
                self.assertEqual(u["openReservations"], ["nightly-x"])
                self.assertGreaterEqual(u["used"]["requests"], 100)

    def test_a_missing_period_start_counts_sealed_runs_instead_of_dropping_them(self):
        u = self.fold([self.entry()], {"periodStartUtc": None})
        self.assertEqual((u["runs"], u["used"]["requests"]), (1, 40))


if __name__ == "__main__":
    unittest.main()


class NightlySettleEvidence(NightlyJournalReservation):
    """#1772 Code finding 4447377718 (broken before: the scheduled journal-settle recorded the closed settle input's own digest)."""

    def test_the_closed_settle_input_settles_with_the_original_record_digest(self):
        import settle_input
        self.reserve()
        record = json.dumps({"schema": M.RUN_RECORD_SCHEMA, "runId": self.req["runId"],
                             "executionProvenance": {"campaignId": self.req["runId"], "runId": "123", "attempt": 1, "requestSha256": self.sha},
                             "spend": {"requests": 900, "identityReads": 20, "starts": 30, "takes": 25}}).encode()
        projection = settle_input.project(record)
        settled = self.execute("settle", campaignId=self.req["runId"], runId="123", record=projection)
        self.assertEqual(settled["provenance"], "evidence-sha256:" + hashlib.sha256(record).hexdigest())
        self.assertNotEqual(settled["provenance"], "evidence-sha256:" + hashlib.sha256(projection).hexdigest())
        self.assertEqual(settled["allocation"]["requests"], 920)  # the same measured usage as from the full record
        # a collector record (not a closed settle input) keeps its own digest
        self.assertEqual(RES.original_record_digest(record, "f" * 64), "f" * 64)
        # a tampered closed settle input refuses rather than settling under an unvalidated digest
        doc = json.loads(projection)
        doc["recordSha256"] = "not-a-digest"
        with self.assertRaises(RES.JournalRefused):
            RES.original_record_digest(json.dumps(doc).encode(), "f" * 64)
