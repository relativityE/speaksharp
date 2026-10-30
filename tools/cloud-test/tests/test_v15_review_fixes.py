"""Workflow 1.5.0 review fixes: (1) every recurring cap is enforced from history and reservations; (2) the headline verdict includes the safety checks;
(3) isolation evidence is account-bound, fresh and checks old-run residue; (4) reviewed features reach regression without a bug; plus the #1488/#1757 concern observations."""
import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from _fixtures import ROOT, J, run_py, sample, wjson
from _nightly import CATALOG, SHA, history, make_run, request, utc
BROKEN = ("AHT-07", CATALOG["cases"]["AHT-07"]["requiredAssertions"][1])
import check_gates as CG
import history_index as HI
import recurring_usage as RU
import reservations as RS


def approval(req, **caps):
    est = req["estimate"]
    ap = {"status": "APPROVED", "approvedBy": "owner", "approvalRef": "standing-1", "approvedAtUtc": "2026-10-31T00:00:00Z", "validFromUtc": "2026-10-31T00:00:00Z", "expiresUtc": "2026-12-31T00:00:00Z",
          "periodStartUtc": "2026-11-01T00:00:00Z", "cadence": {"runsPerPeriod": 30, "period": "30 days"},
          "perRunCaps": {"runCapRequests": est["requests"]["runCap"], "identityReads": est["identityReads"], "starts": est["starts"], "takes": est["takes"],
                         "coachingRequests": est["providerBillableRequests"]["coachingCap"], "windowMinutes": est["window"]["proposedMinutes"], "githubRunnerMinutes": 30, "paidActionsUsd": 0},
          "periodCaps": {"requests": 30 * est["requests"]["runCap"], "identityReads": 30 * est["identityReads"], "starts": 30 * est["starts"], "takes": 30 * est["takes"],
                         "coachingRequests": 30 * est["providerBillableRequests"]["coachingCap"], "githubRunnerMinutes": 30 * 30, "paidActionsUsd": 0}}
    ap["periodCaps"].update(caps)
    return ap


def nightly_request(run_id="R9-N9"):
    r = request(run_id)
    r["window"] = {"startUtc": "2026-11-05T03:00:00Z", "endUtc": "2026-11-05T08:00:00Z", "approvalRef": "standing-1"}
    return r


def index_of(root, cfg):
    return HI.wrap(HI.derive(cfg, root, 1))


class EveryRecurringCapIsEnforced(unittest.TestCase):
    NOW = utc("2026-11-05T03:00:00Z")

    def gate(self, ap, idx, led=None, req=None):
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, "config"))
        wjson(os.path.join(d, "config", "recurring-approval.json"), ap)
        return CG.recurring_gate(req or nightly_request(), sample()["cfg"], d, idx, self.NOW, led)

    def one_night(self, **kw):
        root, cfg = history(("N1", kw))
        return index_of(root, cfg)

    def test_the_history_index_now_records_starts_takes_and_coaching(self):
        s = self.one_night()["entries"][0]["summary"]
        self.assertEqual((s["starts"], s["takes"], s["coachingRequests"]), (40, 31, 12))

    def test_starts_that_start_at_zero_were_the_defect_they_now_accumulate(self):
        req = nightly_request()
        used_starts = 30 * req["estimate"]["starts"] - 20          # 20 Starts left in the period; this run needs 39
        idx = self.one_night(starts=used_starts, requests=100, identity_reads=1, takes=1, coaching=1)
        g = self.gate(approval(req), idx)
        self.assertEqual(g["status"], "NOT-READY")
        self.assertTrue(any(n.startswith("starts:") and "exceeds the period cap" in n for n in g["needs"]), g["needs"])
        self.assertFalse(any(n.startswith("requests:") for n in g["needs"]), "requests had plenty of room; only Starts is exhausted")

    def test_each_category_refuses_on_its_own_even_with_request_budget_remaining(self):
        req = nightly_request()
        est = req["estimate"]
        cases = (("takes", {"takes": 30 * est["takes"] - 5}), ("coachingRequests", {"coaching": 30 * est["providerBillableRequests"]["coachingCap"] - 3}),
                 ("identityReads", {"identity_reads": 30 * est["identityReads"] - 2}), ("requests", {"requests": 30 * est["requests"]["runCap"] - 100}))
        for cat, kw in cases:
            base = {"requests": 10, "identity_reads": 1, "starts": 1, "takes": 1, "coaching": 1}
            base.update(kw)
            g = self.gate(approval(req), self.one_night(**base))
            self.assertEqual(g["status"], "NOT-READY", cat)
            self.assertTrue(any(n.startswith(cat + ":") for n in g["needs"]), (cat, g["needs"]))
            exhausted = {n.split(":")[0] for n in g["needs"] if "exceeds the period cap" in n}
            self.assertEqual(exhausted, {cat}, "only the exhausted category refuses")

    def test_runner_minutes_are_counted_at_the_per_run_cap_when_not_recorded(self):
        req = nightly_request()
        ap = approval(req, githubRunnerMinutes=45)           # one recorded-at-cap run (30) + this run (30) = 60 > 45
        idx = self.one_night(starts=1, takes=1, coaching=1, requests=10, identity_reads=1)
        g = self.gate(ap, idx)
        self.assertEqual(g["status"], "NOT-READY")
        self.assertTrue(any(n.startswith("runnerMinutes:") for n in g["needs"]), g["needs"])
        u = RU.usage(ap, idx, None, self.NOW)
        self.assertEqual(u["used"]["runnerMinutes"], 30)
        self.assertTrue(any("not recorded" in x for x in u["unrecordedActuals"]["runnerMinutes"]))

    def test_an_actual_that_was_not_recorded_is_never_counted_as_zero(self):
        req = nightly_request()
        root, cfg = history(("N1", {"logs": False}))
        idx = index_of(root, cfg)
        self.assertIsNone(idx["entries"][0]["summary"]["starts"])
        u = RU.usage(approval(req), idx, None, self.NOW)
        self.assertEqual(u["used"]["starts"], req["estimate"]["starts"])       # the approved per-run cap
        self.assertEqual(u["used"]["takes"], req["estimate"]["takes"])

    def test_the_cadence_counts_runs_sealed_or_reserved(self):
        req = nightly_request()
        ap = approval(req); ap["cadence"]["runsPerPeriod"] = 1
        g = self.gate(ap, self.one_night(starts=1, takes=1, coaching=1, requests=10, identity_reads=1))
        self.assertTrue(any("the cadence allows 1" in n for n in g["needs"]), g["needs"])

    def test_a_run_inside_every_cap_proceeds_and_the_detail_names_the_usage(self):
        req = nightly_request()
        g = self.gate(approval(req), self.one_night(starts=39, takes=31, coaching=12, requests=3600, identity_reads=32))
        self.assertEqual((g["status"], g["needs"]), ("READY", []))
        self.assertIn("39 Starts", g["detail"])
        self.assertIn("1 run(s)", g["detail"])

    def test_runs_before_the_period_start_do_not_count(self):
        req = nightly_request()
        root, cfg = history(("N1", {"ended": "2026-10-20T03:40:00Z", "starts": 5000}))
        self.assertEqual(self.gate(approval(req), index_of(root, cfg))["status"], "READY")


class ReservationsHoldCapsUntilSealed(unittest.TestCase):
    NOW = utc("2026-11-05T03:00:00Z")

    def setUp(self):
        self.req = nightly_request("R9-N2")
        self.ap = approval(self.req)
        self.led = RS.empty()

    def reserve(self, led, run_id, scale=1):
        caps = {k: (v or 0) * scale for k, v in RS.caps_of_request(self.req).items()}
        return RS.append(led, {"event": "reserve", "runId": run_id, "atUtc": "2026-11-04T03:00:00Z", "caps": caps, "ref": "standing-1"})

    def test_an_open_reservation_counts_at_its_reserved_caps(self):
        led = self.reserve(self.led, "R9-N1")
        u = RU.usage(self.ap, {"entries": []}, led, self.NOW)
        self.assertEqual(u["used"]["starts"], self.req["estimate"]["starts"])
        self.assertEqual((u["runs"], u["openReservations"]), (1, ["R9-N1"]))

    def test_a_reservation_that_was_never_sealed_keeps_counting_until_released(self):
        led = self.reserve(self.led, "R9-N1")
        self.assertEqual(RU.usage(self.ap, {"entries": []}, led, self.NOW)["runs"], 1)
        RS.append(led, {"event": "release", "runId": "R9-N1", "atUtc": "2026-11-05T01:00:00Z", "reason": "run never started", "ref": "owner-9"})
        self.assertEqual(RU.usage(self.ap, {"entries": []}, led, self.NOW)["runs"], 0)

    def test_sealing_replaces_the_reservation_it_is_not_counted_twice(self):
        root, cfg = history(("R9-N1", {"starts": 10, "takes": 5}))
        idx = index_of(root, cfg)
        led = self.reserve(self.led, "R9-N1")
        u = RU.usage(self.ap, idx, led, self.NOW)
        self.assertEqual((u["runs"], u["used"]["starts"], u["openReservations"]), (1, 10, []))

    def test_reserved_caps_can_exhaust_a_cap_with_nothing_sealed(self):
        led = self.reserve(self.led, "R9-A", scale=30)          # a reservation holding the whole period
        needs = RU.check_caps(self.req, self.ap, {"entries": []}, led, self.NOW)
        self.assertTrue(any(n.startswith("starts:") for n in needs), needs)
        self.assertTrue(any(n.startswith("requests:") for n in needs), needs)

    def test_a_runs_own_reservation_is_not_counted_against_itself(self):
        led = self.reserve(self.led, "R9-N2")
        self.assertEqual(RU.check_caps(self.req, self.ap, {"entries": []}, led, self.NOW), [])

    def test_the_gate_sees_reservations(self):
        led = self.reserve(self.led, "R9-A", scale=30)
        d = tempfile.mkdtemp(); os.makedirs(os.path.join(d, "config")); wjson(os.path.join(d, "config", "recurring-approval.json"), self.ap)
        g = CG.recurring_gate(self.req, sample()["cfg"], d, {"entries": []}, self.NOW, led)
        self.assertEqual(g["status"], "NOT-READY")

    def cli(self, *args, ledger=None):
        return subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "reservations.py")] + list(args), capture_output=True, text=True)

    def files(self, scale_used=None):
        d = tempfile.mkdtemp()
        rq, ap, ix, lg = (os.path.join(d, n) for n in ("req.json", "ap.json", "idx.json", "led.json"))
        wjson(rq, self.req); wjson(ap, self.ap); wjson(ix, {"entries": []}); wjson(lg, RS.empty())
        return rq, ap, ix, lg

    def test_the_command_line_reserves_then_refuses_a_replay_and_requires_the_reservation(self):
        rq, ap, ix, lg = self.files()
        common = ["--request", rq, "--approval", ap, "--index", ix, "--ledger", lg, "--now", "2026-11-05T03:00:00Z"]
        r = self.cli("reserve", *common)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.cli("require", "--run-id", "R9-N2", "--ledger", lg).returncode, 0)
        self.assertEqual(self.cli("reserve", *common).returncode, 1)         # no implicit replay
        self.assertEqual(self.cli("require", "--run-id", "R9-other", "--ledger", lg).returncode, 1)
        self.assertEqual(self.cli("verify", "--ledger", lg).returncode, 0)

    def test_the_command_line_refuses_with_blocked_setup_when_a_cap_is_exhausted(self):
        rq, ap, ix, lg = self.files()
        led = self.reserve(RS.empty(), "R9-A", scale=30); wjson(lg, led)
        r = self.cli("reserve", "--request", rq, "--approval", ap, "--index", ix, "--ledger", lg, "--now", "2026-11-05T03:00:00Z")
        self.assertEqual(r.returncode, 78)
        self.assertIn("starts:", r.stdout)
        self.assertEqual(len(json.load(open(lg))["events"]), 1, "a refused run reserves nothing")

    def test_a_tampered_ledger_is_refused(self):
        rq, ap, ix, lg = self.files()
        led = self.reserve(RS.empty(), "R9-A"); led["events"][0]["caps"]["starts"] = 0; wjson(lg, led)
        r = self.cli("verify", "--ledger", lg)
        self.assertNotEqual(r.returncode, 0)

    def test_release_needs_a_reason_and_a_reference_and_an_open_reservation(self):
        rq, ap, ix, lg = self.files()
        wjson(lg, self.reserve(RS.empty(), "R9-A"))
        self.assertNotEqual(self.cli("release", "--run-id", "R9-A", "--ledger", lg).returncode, 0)
        self.assertEqual(self.cli("release", "--run-id", "R9-A", "--reason", "never started", "--ref", "owner-1", "--ledger", lg).returncode, 0)
        self.assertNotEqual(self.cli("release", "--run-id", "R9-A", "--reason", "again", "--ref", "owner-1", "--ledger", lg).returncode, 0)

    def test_only_nightly_requests_can_reserve(self):
        rq, ap, ix, lg = self.files()
        r = sample()["req"]; wjson(rq, r)
        self.assertNotEqual(self.cli("reserve", "--request", rq, "--approval", ap, "--index", ix, "--ledger", lg).returncode, 0)

    def test_the_run_stage_requires_a_reservation_for_a_nightly_request(self):
        sh = open(os.path.join(ROOT, "scripts", "execute_run.sh"), encoding="utf-8").read()
        self.assertIn("reservations.py\" require", sh)
        self.assertIn("reserve)", sh)
        self.assertIn("reserve", J("config", "test-config.v1.json")["credentials"]["runEnvironment"]["stages"])


# ------------------------------------------------------------------------------------------------------ 2. the headline verdict includes the safety checks
class VerdictIncludesSafetyChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import test_pipeline_and_report as T
        T.SummaryRules.setUpClass()
        cls.inst = T.SummaryRules("test_ready_only_when_everything_holds")

    def derive(self, **kw):
        i = self.inst
        return i.derive(True, ["CLOSED"] * 6, latest=i.latest(i.all_pass()), **kw)

    def alerts(self, *kinds, stale=False, age=3.0):
        return {"alerts": [{"kind": k, "severity": s} for k, s in kinds], "evidenceStale": stale, "evidenceAgeHours": age}

    def test_every_check_passing_is_ready_and_the_text_says_why(self):
        f = self.derive()
        self.assertEqual(f["status"], "READY")
        self.assertIn("isolation proven", f["readiness"])
        self.assertIn("usage within caps", f["readiness"])
        self.assertIn("evidence fresh", f["readiness"])
        self.assertFalse(f["readinessBasis"]["safety"]["blocksReady"])

    def test_204_passing_rows_are_not_ready_when_isolation_failed(self):
        f = self.derive(isolation={"status": "failed", "proven": False, "problems": ["the post-cleanup query found 2 marked record(s) remaining"]})
        self.assertEqual((f["status"], f["recommendation"]), ("BLOCKED", "HOLD"))
        self.assertIn("isolation FAILED", f["readiness"])
        self.assertIn("safety check failed", f["customerImpact"])

    def test_isolation_that_is_only_not_proven_is_limited_never_ready(self):
        f = self.derive(isolation={"status": "not-proven", "proven": False, "problems": ["no isolation.json"]})
        self.assertEqual(f["status"], "LIMITED")
        self.assertIn("isolation not proven", f["readiness"])
        self.assertEqual(self.derive(isolation=None)["status"], "LIMITED")

    def test_stale_evidence_blocks(self):
        f = self.derive(alerts=self.alerts(("MISSED-RUN", "critical"), stale=True, age=61.0))
        self.assertEqual(f["status"], "BLOCKED")
        self.assertIn("STALE (61.0h)", f["readiness"])
        f = self.derive(alerts=self.alerts(stale=True, age=61.0))
        self.assertEqual(f["status"], "BLOCKED")

    def test_unknown_freshness_is_not_ready_for_a_nightly_run(self):
        i = self.inst
        req = copy.deepcopy(i.req); req["priority"] = "nightly-regression"; req["targetedGaps"] = ["GAP-03"]; req["selection"] = [{"case": "AHT-12"}]
        import derive_summary as DS
        args = (i.cmp, i.latest(i.all_pass()), i.ld(["CLOSED"] * 6), i.rv(), i.gates(True), i.sp(), i.wf, req, 180)
        unknown = {"alerts": [], "evidenceStale": None, "evidenceAgeHours": None}
        self.assertEqual(DS.derive(*args, coverage=i.FULL, alerts=unknown, isolation=i.SAFE_ISO)["status"], "LIMITED")
        self.assertEqual(DS.derive(*args, coverage=i.FULL, alerts=i.SAFE_ALERTS, isolation=i.SAFE_ISO)["status"], "READY")

    def test_usage_over_a_cap_blocks(self):
        sp = self.inst.sp(); sp["withinCap"] = False
        f = self.derive(spend=sp)
        self.assertEqual(f["status"], "BLOCKED")
        self.assertIn("OVER A CAP", f["readiness"])

    def test_alerts_decide_the_status(self):
        self.assertEqual(self.derive(alerts=self.alerts(("BINDING-MISMATCH", "critical")))["status"], "BLOCKED")
        self.assertEqual(self.derive(alerts=self.alerts(("CONCERN-PROBLEM", "high")))["status"], "BLOCKED")
        self.assertEqual(self.derive(alerts=self.alerts(("ISOLATION-RESIDUE", "high")))["status"], "BLOCKED")
        f = self.derive(alerts=self.alerts(("COVERAGE-INCOMPLETE", "high")))
        self.assertEqual(f["status"], "LIMITED", "an incomplete run is limited, not blocked, but never READY")
        self.assertEqual(self.derive(alerts=self.alerts(("CONCERN-NOT-OBSERVABLE", "info"), ("RECOVERED", "info"), ("STILL-FAILING", "medium")))["status"], "READY",
                         "info and medium alerts do not decide READY (a row that is still failing already blocks through the journey verdicts)")

    def test_not_observable_concerns_never_block_ready(self):
        self.assertEqual(self.derive(alerts=self.alerts(("CONCERN-NOT-OBSERVABLE", "info")))["status"], "READY")

    def test_the_pre_run_summary_is_unchanged(self):
        self.assertEqual(self.inst.derive(False, ["OPEN"] * 6)["status"], "BLOCKED")

    def test_the_report_refuses_a_ready_that_contradicts_a_safety_check(self):
        import test_pipeline_and_report as T
        import workflow_report as W
        if not hasattr(T.ReportRefusals, "rep_cache"):
            T.ReportRefusals.setUpClass()
        base = copy.deepcopy(T.ReportRefusals.rep_cache)
        f = self.derive()
        base["executiveSummary"]["fields"].update(status="READY", readinessBasis=f["readinessBasis"])
        base["latestPending"] = False
        wf = sample()["wf"]
        def errs(**over):
            r = copy.deepcopy(base)
            r.update(over)
            return [e for e in W.validate(r, wf) if "READY" in e]
        ok_alerts = {"alerts": [], "evidenceStale": False, "evidenceAgeHours": 2}
        proven = {"status": "proven", "proven": True, "problems": []}
        self.assertFalse([e for e in errs(alerts=ok_alerts, isolation=proven) if "safety" in e or "isolation" in e or "alert" in e or "fresh" in e or "cap" in e])
        self.assertTrue(any("isolation" in e for e in errs(alerts=ok_alerts, isolation={"status": "failed", "proven": False, "problems": ["x"]})))
        self.assertTrue(any("isolation" in e for e in errs(alerts=ok_alerts)))
        self.assertTrue(any("alert" in e for e in errs(alerts={"alerts": [{"severity": "high", "kind": "REGRESSION"}], "evidenceStale": False}, isolation=proven)))
        self.assertTrue(any("fresh" in e for e in errs(alerts={"alerts": [], "evidenceStale": True, "evidenceAgeHours": 90}, isolation=proven)))
        sp = copy.deepcopy(base["purposeAndCost"]); sp["spend"]["withinCap"] = False
        self.assertTrue(any("cap" in e for e in errs(alerts=ok_alerts, isolation=proven, purposeAndCost=sp)))

    def test_the_pipeline_builds_the_summary_after_isolation_and_alerts(self):
        src = open(os.path.join(ROOT, "scripts", "pipeline.py"), encoding="utf-8").read()
        order = [src.index(x) for x in ('run("check_isolation.py"', 'run("derive_alerts.py"', 'run("derive_summary.py"', "workflow_report.py")]
        self.assertEqual(order, sorted(order), "isolation, then alerts, then the summary, then the report")
        self.assertIn('"--alerts", alerts', src)

    def test_alerts_carry_the_age_of_the_evidence(self):
        import derive_alerts as DA
        root, cfg = history(("N1", {"ended": "2026-11-01T03:40:00Z"}))
        req = request("N1", SHA["N1"])
        import check_coverage as CC
        cov = CC.assess(req, CATALOG, json.load(open(os.path.join(root, "N1", "case-results.json"))))
        fresh = DA.derive(cfg, root, "N1", cov, now=utc("2026-11-01T09:40:00Z"))
        self.assertEqual((fresh["evidenceAgeHours"], fresh["evidenceStale"]), (6.0, False))
        old = DA.derive(cfg, root, "N1", cov, now=utc("2026-11-04T03:40:00Z"))
        self.assertEqual((old["evidenceAgeHours"], old["evidenceStale"]), (72.0, True))
        self.assertIsNone(DA.derive(cfg, root, "N1", cov)["evidenceStale"])


# ------------------------------------------------------------------------------------------------------ 3. isolation evidence
import hashlib
import check_isolation as CI
import isolation_assemble as IA

ACCT = hashlib.sha256(b"dedicated-nightly-account-id").hexdigest()


def rid(n):
    return hashlib.sha256(("rec%d" % n).encode()).hexdigest()


def probe(records=(), queried="2026-11-02T02:55:00Z", acct=ACCT, pages=0, procs=0):
    return {"accountIdSha256": acct, "queriedUtc": queried, "source": "account-scoped read, guarded", "records": list(records), "ownedPagesOpen": pages, "ownedProcessesRunning": procs}


def good_evidence(run_id="R9-N2", before=(), created=3, **over):
    req = nightly_request(run_id)
    req["nightly"] = dict(req.get("nightly") or {}, accountIdSha256=ACCT)
    marker = "nightly-%s-7f3a" % run_id
    recs = [{"kind": "session", "idSha256": rid(100 + i), "marker": marker} for i in range(created)]
    b = probe(before, "2026-11-02T02:55:00Z")
    m = probe(list(before) + recs, "2026-11-02T03:48:00Z")
    a = probe(before, "2026-11-02T03:55:00Z")
    rr = {"startedUtc": "2026-11-02T03:00:00Z", "endedUtc": "2026-11-02T03:50:00Z"}
    ev = IA.assemble(req, rr, b, m, a, marker, "2026-11-02T03:56:00Z")
    return req, ev


WINDOW = (utc("2026-11-02T03:00:00Z"), utc("2026-11-02T03:50:00Z"))


class IsolationEvidenceIsAccountBoundFreshAndChecksOldResidue(unittest.TestCase):
    NOW = utc("2026-11-02T04:30:00Z")

    def check(self, req, ev, **kw):
        kw.setdefault("run_window", WINDOW)
        kw.setdefault("now", self.NOW)
        return CI.check(req, ev, **kw)

    def test_complete_account_bound_evidence_is_proven(self):
        req, ev = good_evidence()
        out = self.check(req, ev)
        self.assertEqual((out["status"], out["problems"]), ("proven", []))

    def test_no_evidence_is_not_proven_and_bad_evidence_is_failed(self):
        req, ev = good_evidence()
        self.assertEqual(CI.check(req, None)["status"], "not-proven")
        ev["after"]["totalRecords"] = 2
        self.assertEqual(self.check(req, ev)["status"], "failed")

    def test_a_mismatched_account_is_rejected(self):
        req, ev = good_evidence()
        other = hashlib.sha256(b"a-shared-fixture-account").hexdigest()
        ev["account"]["idSha256"] = other
        out = self.check(req, ev)
        self.assertTrue(any("mismatched account" in p for p in out["problems"]), out["problems"])
        req2, ev2 = good_evidence()
        ev2["before"]["accountIdSha256"] = other          # the before query was made for another account
        self.assertTrue(any("before query was made for account" in p for p in self.check(req2, ev2)["problems"]))
        ev3 = good_evidence()[1]
        ev3["after"]["accountIdSha256"] = other
        self.assertTrue(any("after query was made for account" in p for p in self.check(req2, ev3)["problems"]))

    def test_an_undeclared_account_cannot_be_proven(self):
        req, ev = good_evidence()
        req["nightly"].pop("accountIdSha256")
        self.assertTrue(any("no account binding is declared" in p for p in self.check(req, ev)["problems"]))
        self.assertEqual(self.check(req, ev, expected_account=ACCT)["status"], "proven", "the plan's own account hash can supply the binding")

    def test_a_shared_fixture_account_is_rejected(self):
        req, ev = good_evidence()
        ev["account"].update(kind="maintained-pro", dedicated=False)
        self.assertTrue(any("dedicated nightly" in p for p in self.check(req, ev)["problems"]))

    def test_the_before_timestamp_must_be_valid_and_precede_execution(self):
        req, ev = good_evidence()
        ev["before"]["queriedUtc"] = "yesterday"
        self.assertTrue(any("no valid UTC time" in p for p in self.check(req, ev)["problems"]))
        req, ev = good_evidence()
        ev["before"]["queriedUtc"] = "2026-11-02T03:10:00Z"             # after the run began
        self.assertTrue(any("after execution began" in p for p in self.check(req, ev)["problems"]))
        req, ev = good_evidence()
        ev["before"]["queriedUtc"] = "2026-11-02T00:30:00Z"             # 150 minutes before the run: stale
        self.assertTrue(any("older than the run" in p and "stale" in p for p in self.check(req, ev)["problems"]))
        req, ev = good_evidence()
        del ev["before"]["queriedUtc"]
        self.assertFalse(self.check(req, ev)["proven"])

    def test_old_run_residue_is_checked_not_just_an_empty_new_marker(self):
        """The reviewed defect: a new run marker with nothing under it proved nothing about what earlier runs left in the account."""
        leftover = [{"kind": "session", "idSha256": rid(1), "marker": "nightly-R9-N1-1111"}, {"kind": "recording", "idSha256": rid(2), "marker": None}]
        req, ev = good_evidence(before=leftover)
        self.assertEqual(ev["before"]["totalRecords"], 2)
        self.assertEqual(ev["before"]["recordsWithOtherMarkers"], 1)
        out = self.check(req, ev)
        self.assertFalse(out["proven"])
        self.assertTrue(any("found 2 record(s) in the account" in p for p in out["problems"]), out["problems"])
        self.assertTrue(any("left by earlier runs" in p for p in out["problems"]))
        self.assertTrue(any("another run's marker" in p for p in out["problems"]))
        self.assertEqual(ev["after"]["markedRecordsRemaining"], 0, "this run's own marker is clean; only the whole-scope query exposes the residue")

    def test_a_marker_only_query_is_not_accepted_as_the_whole_scope(self):
        req, ev = good_evidence()
        ev["before"]["scope"] = "run-marker-only"
        self.assertTrue(any("whole scope" in p for p in self.check(req, ev)["problems"]))
        req, ev = good_evidence()
        del ev["before"]["recordsFromEarlierRuns"]
        self.assertTrue(any("does not report records left by earlier runs" in p for p in self.check(req, ev)["problems"]))

    def test_stale_or_foreign_evidence_is_rejected(self):
        req, ev = good_evidence()
        self.assertTrue(any("stale" in p for p in self.check(req, ev, now=utc("2026-11-05T04:30:00Z"))["problems"]))
        req, ev = good_evidence()
        ev["runId"] = "R9-N1"
        self.assertTrue(any("belongs to run" in p for p in self.check(req, ev)["problems"]))
        req, ev = good_evidence()
        self.assertTrue(any("run end" in p for p in self.check(req, ev, run_window=(utc("2026-11-01T03:00:00Z"), utc("2026-11-01T03:50:00Z")))["problems"]), "evidence copied from another night does not match the sealed run's window")
        req, ev = good_evidence()
        ev["generatedUtc"] = "2026-11-02T03:40:00Z"
        self.assertTrue(any("generated before its own post-cleanup query" in p for p in self.check(req, ev)["problems"]))
        req, ev = good_evidence()
        ev["after"]["queriedUtc"] = "2026-11-02T03:40:00Z"
        self.assertTrue(any("before the run ended" in p for p in self.check(req, ev)["problems"]))
        req, ev = good_evidence()
        ev["schema"] = "speaksharp.cloud-test.isolation.v1"
        self.assertTrue(any("isolation.v2" in p for p in self.check(req, ev)["problems"]))

    def test_survivors_pages_processes_and_unbalanced_deletes_fail(self):
        req, ev = good_evidence(); ev["after"]["markedRecordsRemaining"] = 1
        self.assertTrue(any("marked record(s) remaining" in p for p in self.check(req, ev)["problems"]))
        req, ev = good_evidence(); ev["after"]["ownedPagesOpen"] = 1
        self.assertTrue(any("owned page or process" in p for p in self.check(req, ev)["problems"]))
        req, ev = good_evidence(); ev["deleted"] = {"session": 2}
        self.assertTrue(any("created" in p and "deleted" in p for p in self.check(req, ev)["problems"]))

    def test_continuity_between_runs(self):
        req1, prev = good_evidence("R9-N1")
        req2, ev = good_evidence("R9-N2")
        self.assertEqual(self.check(req2, ev, prev=prev)["status"], "proven")
        ev["before"]["stateDigest"] = hashlib.sha256(b"something changed in between").hexdigest()
        self.assertTrue(any("state digest differs" in p for p in self.check(req2, ev, prev=prev)["problems"]))
        req3, ev3 = good_evidence("R9-N2")
        ev3["marker"] = prev["marker"]
        self.assertTrue(any("marker is the same" in p for p in self.check(req3, ev3, prev=prev)["problems"]))
        ev4 = good_evidence("R9-N2")[1]; del ev4["before"]["stateDigest"]
        self.assertTrue(any("continuity" in p for p in self.check(req2, ev4, prev=prev)["problems"]))


class IsolationEvidenceIsProducedFromProbes(unittest.TestCase):
    def test_created_deleted_and_survivors_are_computed_from_three_probes(self):
        mark = "nightly-R9-N2-7f3a"
        mk = lambda i, m=mark: {"kind": "session", "idSha256": rid(i), "marker": m}
        req = nightly_request("R9-N2")
        ev = IA.assemble(req, {"startedUtc": "2026-11-02T03:00:00Z", "endedUtc": "2026-11-02T03:50:00Z"}, probe([]), probe([mk(1), mk(2), mk(3)], "2026-11-02T03:48:00Z"), probe([mk(3)], "2026-11-02T03:55:00Z"), mark)
        self.assertEqual((ev["created"], ev["deleted"]), ({"session": 3}, {"session": 2}))
        self.assertEqual((ev["after"]["totalRecords"], ev["after"]["markedRecordsRemaining"]), (1, 1))
        self.assertEqual(ev["after"]["stateDigest"], IA.digest([mk(3)]))
        self.assertEqual(IA.digest([]), "empty")
        self.assertEqual(ev["schema"], "speaksharp.cloud-test.isolation.v2")

    def test_no_raw_ids_or_content_are_retained(self):
        req, ev = good_evidence()
        text = json.dumps(ev)
        self.assertNotIn("dedicated-nightly-account-id", text)
        self.assertNotIn("rec100", text)

    def test_probes_for_different_accounts_or_malformed_probes_are_refused(self):
        req = nightly_request("R9-N2")
        rr = {"startedUtc": "2026-11-02T03:00:00Z", "endedUtc": "2026-11-02T03:50:00Z"}
        with self.assertRaises(ValueError):
            IA.assemble(req, rr, probe(), probe(), probe(acct=hashlib.sha256(b"other").hexdigest()), "m")
        with self.assertRaises(ValueError):
            IA.assemble(req, rr, probe(), {"accountIdSha256": ACCT}, probe(), "m")
        with self.assertRaises(ValueError):
            IA.assemble(req, rr, probe(), probe([{"kind": "session", "idSha256": "raw-id"}]), probe(), "m")

    def test_the_assembled_evidence_of_a_clean_night_validates_and_residue_makes_it_fail(self):
        req, ev = good_evidence()
        self.assertTrue(CI.check(req, ev, run_window=WINDOW, now=utc("2026-11-02T04:30:00Z"))["proven"])
        mark = ev["marker"]
        survivors = [{"kind": "session", "idSha256": rid(100), "marker": mark}]
        ev2 = IA.assemble(req, {"startedUtc": "2026-11-02T03:00:00Z", "endedUtc": "2026-11-02T03:50:00Z"}, probe([]), probe(survivors, "2026-11-02T03:48:00Z"), probe(survivors, "2026-11-02T03:55:00Z"), mark, "2026-11-02T03:56:00Z")
        out = CI.check(req, ev2, run_window=WINDOW, now=utc("2026-11-02T04:30:00Z"))
        self.assertEqual(out["status"], "failed")

    def test_the_command_line_assembles_and_exits_78_on_a_bad_probe(self):
        d = tempfile.mkdtemp()
        files = {n: os.path.join(d, n + ".json") for n in ("req", "rr", "b", "m", "a", "out")}
        wjson(files["req"], nightly_request("R9-N2")); wjson(files["rr"], {"startedUtc": "2026-11-02T03:00:00Z", "endedUtc": "2026-11-02T03:50:00Z"})
        wjson(files["b"], probe()); wjson(files["m"], probe([], "2026-11-02T03:48:00Z")); wjson(files["a"], probe([], "2026-11-02T03:55:00Z"))
        args = [sys.executable, "-I", os.path.join(ROOT, "scripts", "isolation_assemble.py"), "--request", files["req"], "--run-record", files["rr"], "--before", files["b"], "--mid", files["m"], "--after", files["a"], "--marker", "nightly-R9-N2-x", "--out", files["out"]]
        self.assertEqual(subprocess.run(args, capture_output=True, text=True).returncode, 0)
        ev = json.load(open(files["out"]))
        self.assertEqual(CI.check(nightly_request("R9-N2"), ev)["status"], "failed", "a run that created nothing is flagged by the checker (created must equal deleted and not be empty)")
        wjson(files["b"], {"accountIdSha256": "nope"})
        self.assertEqual(subprocess.run(args, capture_output=True, text=True).returncode, 78)

    def test_the_command_line_checker_uses_the_sealed_run_window(self):
        req, ev = good_evidence()
        d = tempfile.mkdtemp()
        rp, ip, op = (os.path.join(d, n) for n in ("r.json", "i.json", "o.json"))
        wjson(rp, req); wjson(ip, ev)
        r = run_py("scripts/check_isolation.py", "--request", rp, "--isolation", ip, "--run-start", "2026-11-02T03:00:00Z", "--run-end", "2026-11-02T03:50:00Z", "--now", "2026-11-02T04:30:00Z", "--out", op)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(json.load(open(op))["status"], "proven")
        r = run_py("scripts/check_isolation.py", "--request", rp, "--isolation", ip, "--run-start", "2026-11-01T03:00:00Z", "--run-end", "2026-11-01T03:50:00Z", "--now", "2026-11-02T04:30:00Z", "--out", op)
        self.assertEqual(json.load(open(op))["status"], "failed")


# ------------------------------------------------------------------------------------------------------ 4. reviewed features reach regression without a bug
from test_release_gate import Fixture, ledger_with, verdict
import derive_features as DF
import derive_alerts as DA

ROWS_OK = [{"case": "AHT-07", "assertions": [CATALOG["cases"]["AHT-07"]["requiredAssertions"][0]]}]


def feature(fid="FEAT-001", pr="201", **over):
    f = {"id": fid, "title": "Saved-session export", "area": "PG03", "pr": "#" + pr, "commit": None,
         "review": {"outcome": "approved", "reviewedBy": "reviewer-1", "reviewRef": "review-201", "reviewedAtUtc": "2026-10-28T10:00:00Z"},
         "expectedBehaviour": {"summary": "a user can export a saved session", "userVisible": True, "criteria": "the export link downloads a file for the saved session", "definedAtUtc": "2026-10-28T10:30:00Z", "confirmedByOwner": True},
         "coverage": {"route": "existing-rows", "requirements": ROWS_OK, "newRows": []}}
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(f.get(k), dict):
            f[k] = {**f[k], **v}
        else:
            f[k] = v
    return f


def verify_with(fx, feats, ledger=None, catalog=None, **kw):
    req = {"release": {"testedSha": fx.tested, "lastRunTestedSha": fx.base, "backend": kw.get("backend") or {"sha": fx.tested, "source": "owner-stated", "verifiedAtUtc": None, "evidenceRef": None}}}
    d = tempfile.mkdtemp()
    paths = {n: os.path.join(d, n + ".json") for n in ("req", "led", "cfg", "feat", "cat", "out")}
    wjson(paths["req"], req); wjson(paths["led"], ledger or ledger_with(["101"])); wjson(paths["cfg"], fx.cfg); wjson(paths["feat"], {"features": feats}); wjson(paths["cat"], catalog or CATALOG)
    from _fixtures import NOW
    r = run_py("scripts/verify_release.py", "--request", paths["req"], "--ledger", paths["led"], "--config", paths["cfg"], "--features", paths["feat"], "--catalog", paths["cat"], "--repo", fx.repo, "--receipts-root", fx.root, "--now", NOW, "--out", paths["out"])
    assert r.returncode == 0, r.stderr
    return json.load(open(paths["out"]))


class ReviewedFeaturesReachRegressionWithoutABug(unittest.TestCase):
    COMMIT = [("feat(export): export a saved session (#201)", ["frontend/src/export.ts", "frontend/src/__tests__/export.test.ts"])]

    def test_an_unlinked_customer_facing_change_is_still_rejected(self):
        fx = Fixture(self.COMMIT)
        out = verify_with(fx, [])
        v = out["commitVerdicts"][0]
        self.assertEqual(v["decision"], "rejected")
        self.assertIn("reviewed feature", v["reason"])
        self.assertEqual(out["g2"]["status"], "NOT-READY")

    def test_a_reviewed_feature_with_expected_behaviour_and_coverage_is_allowed_without_a_gap(self):
        fx = Fixture(self.COMMIT)
        out = verify_with(fx, [feature()])
        v = out["commitVerdicts"][0]
        self.assertEqual((v["customerFacing"], v["decision"], v["gaps"], v["features"]), (True, "allowed", [], ["FEAT-001"]), v)
        self.assertIn("reviewed feature with expected behaviour and test coverage", v["reason"])
        self.assertEqual(out["features"]["FEAT-001"]["inclusion"], "cloud-verified")
        self.assertTrue(out["features"]["FEAT-001"]["ready"])
        self.assertEqual(out["needs"], [])
        self.assertEqual(out["g2"]["status"], "READY")

    def test_each_missing_piece_rejects_the_feature_with_its_reason(self):
        fx = Fixture(self.COMMIT)
        for label, f, needle in (("no reviewer", feature(review={"reviewedBy": None}), "approved review by a named reviewer"),
                                 ("no review reference", feature(review={"reviewRef": None}), "approved review"),
                                 ("review not approved", feature(review={"outcome": "changes-requested"}), "approved review"),
                                 ("no expected behaviour", feature(expectedBehaviour={"criteria": None}), "expected behaviour"),
                                 ("no definition time", feature(expectedBehaviour={"definedAtUtc": None}), "expected behaviour"),
                                 ("no coverage", feature(coverage={"requirements": [], "newRows": []}), "no test coverage"),
                                 ("coverage row not in the catalog", feature(coverage={"requirements": [{"case": "AHT-07", "assertions": ["no-such-row"]}]}), "not in the assertion catalog"),
                                 ("promised rows not built yet", feature(coverage={"requirements": [], "newRows": [{"case": "AHT-07", "assertion": "export-works", "catalogVersion": 2}]}), "not in the catalog yet")):
            out = verify_with(fx, [f])
            v = out["commitVerdicts"][0]
            self.assertEqual(v["decision"], "rejected", label)
            self.assertIn(needle, v["reason"], label)
            self.assertEqual(out["g2"]["status"], "NOT-READY", label)

    def test_an_unverified_deployment_still_rejects_a_reviewed_feature(self):
        fx = Fixture(self.COMMIT, identity_for_tested=False)
        out = verify_with(fx, [feature()])
        self.assertEqual(out["commitVerdicts"][0]["decision"], "rejected")
        self.assertIn("deployment unverified-deployment", out["commitVerdicts"][0]["reason"])

    def test_a_feature_that_touches_the_backend_needs_the_backend_verified(self):
        fx = Fixture([("feat(api): export endpoint (#201)", ["backend/supabase/functions/export/index.ts"])])
        self.assertEqual(verify_with(fx, [feature()])["commitVerdicts"][0]["decision"], "rejected")
        be = {"sha": fx.tested, "source": "cloud-verified", "verifiedAtUtc": "2026-10-28T20:00:00Z", "evidenceRef": "evidence-9"}
        self.assertEqual(verify_with(fx, [feature()], backend=be)["commitVerdicts"][0]["decision"], "allowed")

    def test_a_gap_fix_and_a_feature_can_ship_together_and_non_product_changes_need_nothing(self):
        fx = Fixture([("fix(a): retain guidance (#101)", ["frontend/src/a.ts"]), COMMIT_ := self.COMMIT[0], ("docs: notes (#300)", ["docs/n.md"])])
        out = verify_with(fx, [feature()])
        self.assertEqual([v["decision"] for v in out["commitVerdicts"]], ["allowed", "allowed", "allowed"])
        self.assertEqual(out["commitVerdicts"][0]["gaps"], ["GAP-01"])
        self.assertEqual(out["commitVerdicts"][1]["features"], ["FEAT-001"])

    def test_the_shipped_feature_ledger_is_empty_and_invents_no_feature(self):
        self.assertEqual(J("config", "feature-ledger.json")["features"], [])
        t = J("templates", "feature-entry.template.json")
        for k in ("review", "expectedBehaviour", "coverage"):
            self.assertIn(k, t)


class FeatureStatusIsDerivedFromTheLatestRun(unittest.TestCase):
    def rv(self, **kw):
        base = {"inclusion": "cloud-verified", "reviewOk": True, "problems": [], "pr": "201", "commit": "a" * 40, "ready": True}
        base.update(kw)
        return {"features": {"FEAT-001": base}}

    def results_root(self, verdict):
        root, cfg = history(("N1", {"fails": [("AHT-07", ROWS_OK[0]["assertions"][0])] if verdict == "FAIL" else [], "notrun": [("AHT-07", ROWS_OK[0]["assertions"][0])] if verdict == "NOT RUN" else []}))
        return root

    def derive(self, verdict=None, rv=None, feat=None):
        root = self.results_root(verdict) if verdict else tempfile.mkdtemp()
        return DF.derive({"features": [feat or feature()]}, CATALOG, rv or self.rv(), root, "N1" if verdict else None)["features"][0]

    def test_pass_fail_and_not_run(self):
        self.assertEqual(self.derive("PASS")["status"], "VERIFIED")
        f = self.derive("FAIL")
        self.assertEqual(f["status"], "FAILING")
        self.assertTrue(f["evidence"][0]["sha256"])
        self.assertEqual(self.derive("NOT RUN")["status"], "UNCOVERED")

    def test_before_a_run_and_when_not_deployed_reviewed_or_covered(self):
        self.assertEqual(self.derive()["status"], "DEPLOYED-AWAITING-TEST")
        self.assertEqual(self.derive(rv=self.rv(inclusion="unverified-deployment"))["status"], "NOT-IN-RELEASE")
        self.assertEqual(self.derive(rv=self.rv(reviewOk=False, problems=["no approved review by a named reviewer with a reference and a time"]))["status"], "NEEDS-REVIEW")
        pend = feature(coverage={"requirements": [], "newRows": [{"case": "AHT-07", "assertion": "export-works", "catalogVersion": 2}]})
        self.assertEqual(self.derive(rv=self.rv(problems=["x"]), feat=pend)["status"], "COVERAGE-PENDING")

    def test_alerts_for_failing_and_uncovered_features(self):
        out = DF.derive({"features": [feature()]}, CATALOG, self.rv(), self.results_root("FAIL"), "N1")
        root, cfg = history(("N1", {"fails": [("AHT-07", ROWS_OK[0]["assertions"][0])]}))
        import check_coverage as CC
        cov = CC.assess(request("N1", SHA["N1"]), CATALOG, json.load(open(os.path.join(root, "N1", "case-results.json"))))
        al = DA.derive(cfg, root, "N1", cov, features=out)
        a = next(x for x in al["alerts"] if x["kind"] == "FEATURE-FAILING")
        self.assertEqual((a["severity"], a["feature"]["id"]), ("high", "FEAT-001"))
        self.assertIn("a user can export a saved session", DA.markdown(al))
        un = DF.derive({"features": [feature()]}, CATALOG, self.rv(), self.results_root("NOT RUN"), "N1")
        self.assertEqual([x["kind"] for x in DA.derive(cfg, root, "N1", cov, features=un)["alerts"] if x["kind"].startswith("FEATURE")], ["FEATURE-UNCOVERED"])

    def test_the_pipeline_derives_features_and_the_report_lists_them(self):
        import workflow_report as W
        rep = {"features": DF.derive({"features": [feature()]}, CATALOG, self.rv(), tempfile.mkdtemp(), None)}
        html = W.render_features(rep)
        self.assertIn("FEAT-001", html)
        self.assertIn("DEPLOYED-AWAITING-TEST", html)
        self.assertIn("No reviewed feature is registered", W.render_features({"features": {"features": []}}))


# ------------------------------------------------------------------------------------------------------ addendum: the #1488 / #1757 concern observations
import derive_concerns as DCN

CCFG = J("config", "concerns.json")
SENTINEL = "A shared board assigns an owner and deadline."


def write_run_logs(root, label, case_overrides=None):
    """Guard logs and step logs for every journey of a synthetic run. case_overrides: case id -> {"events": [...extra guard events], "step": [...lines], "nostop": bool}."""
    base = os.path.join(root, label)
    for cid in CATALOG["cases"]:
        ov = (case_overrides or {}).get(cid, {})
        ev = [{"kind": "start", "t": "2026-11-02T03:00:00.000Z", "seq": 1},
              {"kind": "request", "host": "app.example", "method": "GET", "dest": "document", "nav": True, "rule": "web-read", "decision": "forwarded", "status": 200, "ms": 40, "bytes": 10, "t": "2026-11-02T03:00:01.000Z", "seq": 2},
              {"kind": "request", "host": "db.example", "method": "POST", "dest": "empty", "nav": False, "rule": "rpc", "decision": "forwarded", "status": 200, "ms": 30, "bytes": 5, "t": "2026-11-02T03:00:02.000Z", "seq": 3},
              {"kind": "connect", "host": "o1.ingest.us.sentry.io", "port": 443, "decision": "denied", "reason": "host", "t": "2026-11-02T03:00:02.500Z", "seq": 4},
              {"kind": "request", "host": "app.example", "method": "GET", "dest": "worker", "nav": False, "rule": "web-read", "decision": "forwarded", "status": 200, "ms": 20, "bytes": 5, "t": "2026-11-02T03:00:03.000Z", "seq": 5}]
        ev += ov.get("events", [])
        with open(os.path.join(base, cid, "guard.jsonl"), "w") as f:
            for e in ev:
                f.write(json.dumps(e) + "\n")
        step = ov.get("step") or ["2026-11-02T03:00:00.100Z sandbox ok: 8 chrome processes", "2026-11-02T03:00:10.000Z step completed"] + ([] if ov.get("nostop") else ["2026-11-02T03:00:10.100Z stop completed exit 0 remaining 0"])
        open(os.path.join(base, cid, "step.log"), "w").write("\n".join(step) + "\n")


def concerns_for(root, cfg, label, sha=None, extra=()):
    req = request(label, sha or SHA.get(label, "f0" * 20))
    return DCN.derive(cfg, CCFG, root, label, req, extra)


def sub_of(out, cid, name):
    c = next(c for c in out["concerns"] if c["id"] == cid)
    return c, next(s for s in c["subObservations"] if s["name"] == name)


class ConcernObservations(unittest.TestCase):
    def setUp(self):
        self.root, self.cfg = history(("N1", {}), ("N2", {}))
        write_run_logs(self.root, "N1"); write_run_logs(self.root, "N2")

    def test_a_clean_run_reports_each_concern_with_the_three_states_and_the_limits(self):
        out = concerns_for(self.root, self.cfg, "N2")
        self.assertEqual([c["id"] for c in out["concerns"]], ["CON-1", "CON-2", "CON-3", "CON-4", "CON-5"])
        verdicts = {c["id"]: c["verdict"] for c in out["concerns"]}
        self.assertEqual(verdicts, {"CON-1": "OBSERVED CLEAN", "CON-2": "NOT OBSERVABLE", "CON-3": "NOT OBSERVABLE", "CON-4": "OBSERVED CLEAN", "CON-5": "NOT OBSERVABLE"})
        for c in out["concerns"]:
            self.assertTrue(c["reproduction"] and c["runUtc"][0] and c["subObservations"], c["id"])
            self.assertEqual(c["sourceRefs"], ["#1488", "#1757"])
        self.assertEqual(out["plan"], "free / $0: no new traffic, stimulus or campaign")
        _, s = sub_of(out, "CON-2", "outbound requests started after termination")
        self.assertEqual(s["verdict"], "OBSERVED CLEAN")
        _, w = sub_of(out, "CON-2", "service-worker and web-worker cleanup")
        self.assertEqual(w["verdict"], "NOT OBSERVABLE")
        self.assertIn("worker or audioworklet script load", w["detail"])

    def test_missing_visibility_is_not_a_failure(self):
        out = concerns_for(self.root, self.cfg, "N2")
        self.assertEqual(out["counts"].get("OBSERVED PROBLEM", 0), 0)
        al = DA.derive(self.cfg, self.root, "N2", {"fullLiveRun": True, "kind": "FULL", "deployedVersionBinding": {"ok": True}}, concerns=out)
        a = [x for x in al["alerts"] if x["kind"] == "CONCERN-NOT-OBSERVABLE"]
        self.assertEqual((len(a), a[0]["severity"]), (1, "info"))
        self.assertFalse([x for x in al["alerts"] if x["kind"] == "CONCERN-PROBLEM"])

    def test_con1_binding_mismatch_is_a_problem_and_no_receipts_is_not_observable(self):
        r2, c2 = history(("N1", {"identity_bad": ("AHT-04", "identityBefore", "9" * 40)}))
        write_run_logs(r2, "N1")
        out = concerns_for(r2, c2, "N1")
        self.assertEqual(out["concerns"][0]["verdict"], "OBSERVED PROBLEM")
        self.assertIn("AHT-04", out["concerns"][0]["subObservations"][0]["detail"])
        r3, c3 = history(("N1", {}))
        write_run_logs(r3, "N1")
        cr = json.load(open(os.path.join(r3, "N1", "case-results.json")))
        for c in cr["cases"]:
            c.pop("identityBefore"); c.pop("identityAfter")
        wjson(os.path.join(r3, "N1", "case-results.json"), cr)
        self.assertEqual(concerns_for(r3, c3, "N1")["concerns"][0]["verdict"], "NOT OBSERVABLE")

    def test_con2_a_request_started_after_termination_is_a_problem_with_sanitized_evidence(self):
        late = {"kind": "request", "host": "db.example", "method": "POST", "dest": "empty", "nav": False, "rule": "fn-coaching", "decision": "forwarded", "status": 200, "ms": 50, "bytes": 5, "t": "2026-11-02T03:00:10.500Z", "seq": 90}
        write_run_logs(self.root, "N2", {"AHT-07": {"events": [late]}})
        out = concerns_for(self.root, self.cfg, "N2")
        c, s = sub_of(out, "CON-2", "outbound requests started after termination")
        self.assertEqual((c["verdict"], s["verdict"], s["journeys"]), ("OBSERVED PROBLEM", "OBSERVED PROBLEM", ["AHT-07"]))
        self.assertEqual(s["evidence"][0]["eventSeq"], [90])
        self.assertTrue(s["evidence"][0]["sha256"])
        self.assertEqual(s["observedUtc"][0], "2026-11-02T03:00:10.000Z")

    def test_con2_a_request_in_flight_at_termination_is_a_note_not_a_problem(self):
        inflight = {"kind": "request", "host": "db.example", "method": "POST", "dest": "empty", "nav": False, "rule": "fn-coaching", "decision": "forwarded", "status": 200, "ms": 400, "bytes": 5, "t": "2026-11-02T03:00:10.200Z", "seq": 91}
        write_run_logs(self.root, "N2", {"AHT-05": {"events": [inflight]}})
        out = concerns_for(self.root, self.cfg, "N2")
        _, s = sub_of(out, "CON-2", "requests in flight at termination")
        self.assertEqual((s["verdict"], s["counts"]), ("NOTE", False))
        self.assertIn("a coaching call", s["detail"])
        self.assertEqual(sub_of(out, "CON-2", "outbound requests started after termination")[1]["verdict"], "OBSERVED CLEAN")

    def test_con2_processes_remaining_or_a_non_normal_exit_is_a_problem_but_the_harness_allowance_stop_is_not(self):
        write_run_logs(self.root, "N2", {"AHT-03": {"step": ["2026-11-02T03:00:10.000Z step completed", "2026-11-02T03:00:10.100Z stop completed exit 0 remaining 2"]}})
        _, s = sub_of(concerns_for(self.root, self.cfg, "N2"), "CON-2", "owned processes after termination")
        self.assertEqual((s["verdict"], s["journeys"]), ("OBSERVED PROBLEM", ["AHT-03"]))
        write_run_logs(self.root, "N2", {"AHT-03": {"step": ["2026-11-02T03:00:10.000Z step completed", "2026-11-02T03:00:10.100Z stop allowance-exhausted exit 6 remaining 0"]}})
        _, s = sub_of(concerns_for(self.root, self.cfg, "N2"), "CON-2", "owned processes after termination")
        self.assertEqual(s["verdict"], "OBSERVED CLEAN")
        write_run_logs(self.root, "N2", {c: {"nostop": True} for c in CATALOG["cases"]})
        _, s = sub_of(concerns_for(self.root, self.cfg, "N2"), "CON-2", "owned processes after termination")
        self.assertEqual(s["verdict"], "NOT OBSERVABLE")

    def test_con3_a_native_form_submission_is_a_problem_and_the_rest_stays_not_observable(self):
        form = {"kind": "request", "host": "app.example", "method": "POST", "dest": "document", "nav": True, "rule": "web-read", "decision": "forwarded", "status": 200, "ms": 20, "bytes": 5, "t": "2026-11-02T03:00:05.000Z", "seq": 77}
        write_run_logs(self.root, "N2", {"AHT-09": {"events": [form]}})
        out = concerns_for(self.root, self.cfg, "N2")
        c, s = sub_of(out, "CON-3", "native form submissions")
        self.assertEqual((c["verdict"], s["verdict"], s["journeys"]), ("OBSERVED PROBLEM", "OBSERVED PROBLEM", ["AHT-09"]))
        self.assertIn("payload itself is not recorded", s["detail"])
        for n in ("EventSource streams", "telemetry traffic", "unexpected payloads in forwarded requests"):
            self.assertEqual(sub_of(out, "CON-3", n)[1]["verdict"], "NOT OBSERVABLE", n)
        _, t = sub_of(out, "CON-3", "telemetry traffic")
        self.assertIn("15 connection attempt(s) to telemetry hosts", t["detail"])
        self.assertIn("refused by the guard policy before any TLS exchange", t["detail"])

    def test_con4_a_retained_sentinel_is_a_problem_and_the_matched_text_is_never_reproduced(self):
        base = os.path.join(self.root, "N2", "AHT-02")
        wjson(os.path.join(base, "aht-02-leak.json"), {"note": "the page showed: " + SENTINEL + " and more"})
        wjson(os.path.join(base, "aht-02-jwt.json"), {"h": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0"})
        wjson(os.path.join(base, "aht-02-mail.json"), {"user": "someone@example.org"})
        wjson(os.path.join(base, "aht-02-tr.json"), {"transcript": "we should really meet every week to make the status of each handoff visible"})
        out = concerns_for(self.root, self.cfg, "N2")
        c, s = sub_of(out, "CON-4", "retained logs and receipts")
        self.assertEqual((c["verdict"], s["verdict"]), ("OBSERVED PROBLEM", "OBSERVED PROBLEM"))
        patterns = {e["pattern"] for e in s["evidence"]}
        self.assertTrue(any(p.startswith("sentinel#") for p in patterns), patterns)
        self.assertTrue({"jwt", "email", "text-field:transcript"} <= patterns, patterns)
        blob = json.dumps(out)
        for secret in (SENTINEL, "eyJhbGciOiJIUzI1NiIs", "someone@example.org", "make the status of each handoff"):
            self.assertNotIn(secret, blob, "matched text must never be written to the output")
        al = DA.derive(self.cfg, self.root, "N2", {"fullLiveRun": True, "kind": "FULL", "deployedVersionBinding": {"ok": True}}, concerns=out)
        a = next(x for x in al["alerts"] if x["kind"] == "CONCERN-PROBLEM")
        self.assertEqual((a["severity"], a["concern"]), ("high", "CON-4"))
        self.assertTrue(a["reproduction"])
        self.assertNotIn(SENTINEL, json.dumps(al) + DA.markdown(al))

    def test_con4_the_scan_covers_extra_output_directories_and_skips_copied_receipts(self):
        out_dir = tempfile.mkdtemp()
        os.makedirs(os.path.join(out_dir, "report")); os.makedirs(os.path.join(out_dir, "comparisons", "R5", "receipts"))
        open(os.path.join(out_dir, "report", "REPORT.html"), "w").write("<p>%s</p>" % SENTINEL)
        open(os.path.join(out_dir, "comparisons", "R5", "receipts", "copy.json"), "w").write(SENTINEL)
        _, s = sub_of(concerns_for(self.root, self.cfg, "N2", extra=[out_dir]), "CON-4", "retained logs and receipts")
        self.assertEqual({e["file"] for e in s["evidence"]}, {"report/REPORT.html"})

    def test_con4_the_sentinels_come_from_the_reviewed_fixture_manifest(self):
        sents = DCN.load_sentinels(CCFG)
        self.assertIn(SENTINEL, sents)
        self.assertIn("A better weekly team handoff", sents)
        self.assertEqual(len(sents), 5)

    def test_con5_a_row_that_passed_and_now_fails_is_a_problem_without_claiming_a_cause(self):
        root, cfg = history(("N1", {}), ("N2", {"fails": [BROKEN]}))
        write_run_logs(root, "N1"); write_run_logs(root, "N2")
        out = concerns_for(root, cfg, "N2")
        c, s = sub_of(out, "CON-5", "normal journeys against the last known good run")
        self.assertEqual((c["verdict"], s["verdict"], s["journeys"]), ("OBSERVED PROBLEM", "OBSERVED PROBLEM", ["AHT-07"]))
        self.assertIn("NOT established", s["detail"])
        self.assertEqual(sub_of(concerns_for(self.root, self.cfg, "N2"), "CON-5", "normal journeys against the last known good run")[1]["verdict"], "OBSERVED CLEAN")
        self.assertEqual(sub_of(concerns_for(self.root, self.cfg, "N1"), "CON-5", "normal journeys against the last known good run")[1]["verdict"], "NOT OBSERVABLE")
        _, t = sub_of(out, "CON-5", "legitimate telemetry")
        self.assertEqual(t["verdict"], "NOT OBSERVABLE")
        self.assertIn("15 in N2, 15 in N1", t["detail"])

    def test_a_concern_problem_blocks_ready_and_not_observable_does_not(self):
        import test_pipeline_and_report as T
        T.SummaryRules.setUpClass()
        inst = T.SummaryRules("test_ready_only_when_everything_holds")
        al = {"alerts": [{"kind": "CONCERN-PROBLEM", "severity": "high"}], "evidenceStale": False, "evidenceAgeHours": 1}
        self.assertEqual(inst.derive(True, ["CLOSED"] * 6, latest=inst.latest(inst.all_pass()), alerts=al)["status"], "BLOCKED")

    def test_the_report_table_names_journey_utc_evidence_and_reproduction(self):
        import workflow_report as W
        out = concerns_for(self.root, self.cfg, "N2")
        html = W.render_concerns({"concerns": out})
        for needle in ("#1488 and #1757", "CON-1", "OBSERVED CLEAN", "NOT OBSERVABLE", "Reproduction steps", "2026-11-02T03:00:10", "AHT-", "Missing visibility is not proof of safety"):
            self.assertIn(needle, html, needle)
        self.assertNotIn(SENTINEL, html)

    def test_the_real_sealed_runs_are_observed_the_same_way(self):
        cfg = J("config", "test-config.v1.json")
        root = os.path.join(ROOT, "config", "history", "receipts")
        r5 = J("config", "history", "receipts", "R5", "case-results.json")
        req = request("R5-x", r5["sourceSha"])
        out = DCN.derive(cfg, CCFG, root, "R5", req)
        v = {c["id"]: c["verdict"] for c in out["concerns"]}
        self.assertEqual((v["CON-1"], v["CON-4"]), ("OBSERVED CLEAN", "OBSERVED CLEAN"))
        _, s = sub_of(out, "CON-2", "outbound requests started after termination")
        self.assertEqual(s["verdict"], "OBSERVED CLEAN")
        _, p = sub_of(out, "CON-2", "owned processes after termination")
        self.assertEqual(p["verdict"], "OBSERVED CLEAN", "AHT-10 and AHT-11 stopped on their allowance (exit 6) with 0 processes remaining: the harness's own controlled stop")
        _, n = sub_of(out, "CON-2", "requests in flight at termination")
        self.assertIn("24 forwarded request(s)", n["detail"])
        self.assertEqual(v["CON-3"], "NOT OBSERVABLE")

    def test_the_command_line_writes_concerns_and_the_scan_only_mode_fails_on_a_finding(self):
        d = tempfile.mkdtemp()
        cp, rp, covp, op = (os.path.join(d, n) for n in ("c.json", "r.json", "cov.json", "o.json"))
        wjson(cp, self.cfg); wjson(rp, request("N2", SHA["N2"]))
        r = run_py("scripts/derive_concerns.py", "--config", cp, "--receipts-root", self.root, "--latest-label", "N2", "--request", rp, "--out", op)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(len(json.load(open(op))["concerns"]), 5)
        out_dir = os.path.join(d, "outs"); os.makedirs(out_dir)
        open(os.path.join(out_dir, "x.md"), "w").write(SENTINEL)
        sp = os.path.join(d, "scan.json")
        r = run_py("scripts/derive_concerns.py", "--scan-dir", out_dir, "--out", sp)
        self.assertEqual(r.returncode, 7)
        self.assertNotIn(SENTINEL, open(sp).read())


if __name__ == "__main__":
    unittest.main()
