"""Regression tests for cost reporting (owner item 2): four separate accounts, unknown stays unknown, no hard-coded $0, reconciled ceilings."""
import copy
import json
import os
import re
import tempfile
import unittest

from _fixtures import ROOT, reconciliation, request_path, run_py, sample, wjson
import spend_report as S
import reconcile_cumulative as RC
from _usage_fixtures import UsageHistory


class Spend(unittest.TestCase):
    def setUp(self):
        s = sample()
        self.req, self.cfg = s["req"], s["cfg"]
        self.rc = reconciliation()

    def build(self, rr=None, costs=None, req=None, timings=None):
        return S.build(req or self.req, self.cfg, self.rc, rr, costs, timings)

    def test_before_run_there_is_no_actual_and_every_cost_is_unknown(self):
        out = self.build()
        self.assertIsNone(out["requests"]["actual"])
        self.assertIn("NOT RUN", out["status"])
        for name, c in out["costs"].items():
            self.assertEqual(c["status"], "unknown", name)
            self.assertIsNone(c["usd"], name)

    def test_four_accounts_are_separate(self):
        out = self.build()
        self.assertEqual(set(out["costs"]), {"cloudAgent", "provider", "githubActions"})
        self.assertIn("requests", out)
        self.assertIn("billableRequests", out["costs"]["provider"])
        self.assertIn("observedRunnerMinutes", out["costs"]["githubActions"])
        self.assertIn("paidActions", out)

    def test_no_hard_coded_dollar_zero_anywhere_in_the_code(self):
        offenders = []
        for sub in ("scripts", "report"):
            for fn in os.listdir(os.path.join(ROOT, sub)):
                if fn.endswith(".py") and not fn.startswith("test_"):
                    text = open(os.path.join(ROOT, sub, fn), encoding="utf-8").read()
                    for m in re.finditer(r"""(costUsd|cost_usd|costCapUsd|actualCostUsd)["']?\s*[:=]\s*0\b""", text):
                        offenders.append("%s: %s" % (fn, m.group(0)))
        self.assertEqual(offenders, [])

    def test_a_reported_dollar_needs_a_source_and_time(self):
        with self.assertRaises(ValueError):
            self.build(costs={"provider": {"usd": 0.12}})
        out = self.build(costs={"provider": {"usd": 0.12, "source": "provider invoice 2026-10", "asOfUtc": "2026-10-29T00:00:00Z"}})
        self.assertEqual(out["costs"]["provider"]["status"], "reported")
        self.assertEqual(out["costs"]["provider"]["usd"], 0.12)
        self.assertEqual(out["costs"]["cloudAgent"]["status"], "unknown")

    def test_run_record_without_costs_still_reports_costs_unknown(self):
        rr = {"spend": {"requests": 96, "byCategory": {"signed-in": 40, "coaching": 0}, "identityReads": 4, "starts": 1, "takes": 0}, "paidActions": "none-executed"}
        out = self.build(rr=rr)
        self.assertEqual(out["status"], "WITHIN CAP")
        self.assertEqual(out["paidActions"]["executed"], "none-executed")
        self.assertEqual(out["costs"]["provider"]["status"], "unknown")
        self.assertEqual(out["costs"]["provider"]["billableRequests"]["coaching"]["actual"], 0)

    def test_actual_within_cap_and_remaining_balance(self):
        rr = {"spend": {"requests": 130, "byCategory": {}, "identityReads": 4, "starts": 1, "takes": 0}}
        out = self.build(rr=rr)
        self.assertEqual(out["status"], "WITHIN CAP")
        self.assertEqual(out["remainingAfterRun"]["requests"], 6700 - 5529 - 130 - 664)
        self.assertEqual(out["remainingAfterRun"]["identityReads"], 98 - 94 - 4)
        self.assertEqual(out["varianceVsEstimate"]["requests"], 130 - 96)

    def test_over_cap_is_flagged(self):
        out = self.build(rr={"spend": {"requests": 181, "byCategory": {}, "identityReads": 4, "starts": 1, "takes": 0}})
        self.assertFalse(out["withinCap"])
        self.assertIn("OVER CAP", out["status"])

    def test_a_coaching_request_above_its_cap_is_over_cap(self):
        out = self.build(rr={"spend": {"requests": 100, "byCategory": {"coaching": 1}, "identityReads": 4, "starts": 1, "takes": 0}})
        self.assertFalse(out["withinCap"])

    def test_unrecorded_counters_stay_null_not_zero(self):
        out = self.build(rr={"spend": {"requests": 100, "byCategory": {}, "identityReads": 4, "starts": None, "takes": None}})
        self.assertIsNone(out["remainingAfterRun"]["starts"])
        self.assertIsNone(out["remainingAfterRun"]["takes"])

    def test_missing_request_count_is_not_within_cap(self):
        out = self.build(rr={"spend": {"requests": None, "byCategory": {}, "identityReads": 4, "starts": 1, "takes": 0}})
        self.assertFalse(out["withinCap"])

    def test_github_minutes_are_observed_rounded_up_per_job_and_billed_cost_stays_unknown(self):
        d = tempfile.mkdtemp()
        wjson(os.path.join(d, "timing-control-plane.json"), {"job": "control-plane", "startedUtc": "2026-10-28T10:00:00Z", "endedUtc": "2026-10-28T10:02:01Z"})
        out = self.build(timings=d)
        self.assertEqual(out["costs"]["githubActions"]["observedRunnerMinutes"], 3)
        self.assertEqual(out["costs"]["githubActions"]["status"], "unknown")

    def test_cli_exit_codes(self):
        d = tempfile.mkdtemp(); rcp = os.path.join(d, "rc.json"); wjson(rcp, self.rc)
        rrp = os.path.join(d, "rr.json"); wjson(rrp, {"spend": {"requests": 999, "byCategory": {}, "identityReads": 4}})
        r = run_py("scripts/spend_report.py", "--request", request_path(), "--config", os.path.join(ROOT, "config/test-config.v1.json"), "--reconciliation", rcp, "--run-record", rrp, "--out", os.path.join(d, "o.json"))
        self.assertEqual(r.returncode, 3)
        bad = os.path.join(d, "c.json"); wjson(bad, {"cloudAgent": {"usd": 1}})
        r = run_py("scripts/spend_report.py", "--request", request_path(), "--config", os.path.join(ROOT, "config/test-config.v1.json"), "--reconciliation", rcp, "--costs", bad, "--out", os.path.join(d, "o2.json"))
        self.assertEqual(r.returncode, 4)


class Reconciliation(unittest.TestCase):
    def setUp(self):
        self.history = UsageHistory(sample()["cfg"])
        self.addCleanup(self.history.close)

    def test_measured_owner_counted_and_unreconciled_are_all_reported(self):
        rc = reconciliation()
        self.assertEqual(rc["requests"]["measuredFromSealedLedgers"], 570 + 246 + 2520 + 2085)
        self.assertEqual(rc["requests"]["ownerCounted"], 3406 + 2085 + 38)
        self.assertEqual(rc["requests"]["unreconciled"], 108)
        self.assertEqual(rc["requests"]["unreconciledParts"], {"baselineAboveSealedLedgers": 70, "outsideRunEstimate": 38})
        self.assertEqual(rc["requests"]["conservativeUsed"], 5529)
        self.assertEqual((rc["identityReads"]["measuredFromSealedLedgers"], rc["identityReads"]["ownerCounted"], rc["identityReads"]["unreconciled"]), (92, 94, 2))

    def test_the_proposed_ceilings_are_checked_against_the_reconciled_usage(self):
        rc = reconciliation()
        full = RC.need(rc, 780, 12)
        self.assertEqual(full["requiredCeiling"], 6985)
        self.assertFalse(full["fitsRequestCeiling"])
        self.assertEqual(RC.need(rc, 780, 12, 6990)["fitsRequestCeiling"], True)
        a = RC.need(rc, 650, 10)
        self.assertEqual(a["requiredCeiling"], 6853)
        one = RC.need(rc, 180, 4)
        self.assertEqual((one["requiredCeiling"], one["fitsRequestCeiling"], one["fitsIdentityCap"], one["identityHeadroomAfter"]), (6377, True, True, 0))

    def test_ledger_tampering_changes_the_measured_figure(self):
        d = tempfile.mkdtemp()
        import shutil
        shutil.copytree(str(self.history.receipts / "R5"), os.path.join(d, "R5"))
        os.chmod(os.path.join(d, "R5", "campaign-ledger.json"), 0o644)
        led = json.load(open(os.path.join(d, "R5", "campaign-ledger.json")))
        led["used"]["total"] += 10
        wjson(os.path.join(d, "R5", "campaign-ledger.json"), led)
        cfg = copy.deepcopy(self.history.cfg); cfg["history"]["runs"] = [r for r in cfg["history"]["runs"] if r["label"] == "R5"]
        for lab in ("R4", "R4B", "R4C"):
            pass
        rc = RC.reconcile(cfg, self.history.counters, d)
        self.assertEqual(rc["requests"]["measuredFromSealedLedgers"], 2095)


class CountersAreFrozenAndTheLatestRunIsCountedOnce(unittest.TestCase):
    """Owner review fix 1: freeze counters before the run, then add the run's actual usage once. A sealed latest run must not be counted inside the frozen
    figure AND again as the run's actual (the old identity accounting double-counted it)."""
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="ct-freeze-")
        self.history = UsageHistory(sample()["cfg"])
        self.addCleanup(self.history.close)
        import shutil
        for lab in ("R4", "R4B", "R4C", "R5"):
            shutil.copytree(str(self.history.receipts / lab), os.path.join(self.d, lab))
        shutil.copytree(os.path.join(self.d, "R5"), os.path.join(self.d, "R6T"))
        for r, _, fs in os.walk(self.d):
            for f in fs:
                os.chmod(os.path.join(r, f), 0o644)
        wjson(os.path.join(self.d, "R6T", "campaign-ledger.json"), {"used": {"total": 130, "signed-in": 100, "coaching": 0}})
        wjson(os.path.join(self.d, "R6T", "identity-ledger.json"), {"identityGets": 4, "receipts": []})
        self.cfg = copy.deepcopy(self.history.cfg)
        self.cfg["history"]["runs"].append({"label": "R6T", "campaignId": "R6T", "servedSha": "x", "ledgersOnly": False})
        self.counters = copy.deepcopy(self.history.counters)
        self.req = sample()["req"]
        self.rr = {"spend": {"requests": 130, "byCategory": {"signed-in": 100, "coaching": 0}, "identityReads": 4, "starts": 1, "takes": 0}}

    def test_a_sealed_later_run_is_not_inside_the_frozen_figure(self):
        rc = RC.reconcile(self.cfg, self.counters, self.d)
        self.assertEqual(rc["requests"]["measuredFromSealedLedgers"], 5421)
        self.assertEqual(rc["requests"]["conservativeUsed"], 5529)
        self.assertEqual((rc["identityReads"]["measuredFromSealedLedgers"], rc["identityReads"]["conservativeUsed"]), (92, 94))
        self.assertEqual([x["label"] for x in rc["afterFreeze"]], ["R6T"])
        self.assertEqual(rc["freeze"]["throughRun"], "R5")

    def test_identity_is_counted_once_after_the_run(self):
        rc = RC.reconcile(self.cfg, self.counters, self.d)
        out = S.build(self.req, self.cfg, rc, self.rr, None, None, "R6T")
        self.assertEqual(out["countedOnce"]["afterRun"], {"requests": 5529 + 130, "identityReads": 94 + 4})
        self.assertEqual(out["remainingAfterRun"]["identityReads"], 98 - 94 - 4)
        self.assertEqual(out["remainingAfterRun"]["requests"], 6700 - 664 - (5529 + 130))
        self.assertEqual(out["status"], "WITHIN CAP")
        # the defect: counting the sealed run inside the used figure as well would have given 98 + 4 = 102 identity reads
        double = rc["identityReads"]["conservativeUsed"] + sum(x["identityReads"] for x in rc["afterFreeze"]) + 4
        self.assertEqual(double, 102)
        self.assertNotEqual(out["countedOnce"]["afterRun"]["identityReads"], double)

    def test_the_frozen_requirement_is_unchanged_by_sealing_the_latest_run(self):
        before = RC.need(RC.reconcile(self.history.cfg, self.counters, str(self.history.receipts)), 180, 4)
        after = RC.need(RC.reconcile(self.cfg, self.counters, self.d), 180, 4)
        self.assertEqual(before, after)

    def test_the_run_record_is_cross_checked_against_the_sealed_ledger(self):
        rc = RC.reconcile(self.cfg, self.counters, self.d)
        self.assertTrue(S.build(self.req, self.cfg, rc, self.rr, None, None, "R6T")["sealedLedgerCheck"]["agrees"])
        bad = {"spend": dict(self.rr["spend"], requests=120)}
        out = S.build(self.req, self.cfg, rc, bad, None, None, "R6T")
        self.assertFalse(out["sealedLedgerCheck"]["agrees"])
        self.assertIn("DISAGREE", out["status"])
        self.assertFalse(out["withinCap"])

    def test_without_a_run_record_the_sealed_ledger_is_the_actual_counted_once(self):
        rc = RC.reconcile(self.cfg, self.counters, self.d)
        out = S.build(self.req, self.cfg, rc, None, None, None, "R6T")
        self.assertEqual(out["requests"]["actual"]["total"], 130)
        self.assertEqual(out["countedOnce"]["afterRun"]["requests"], 5529 + 130)
        self.assertIsNone(out["starts"]["actual"])

    def test_the_freeze_must_name_a_run_in_the_history(self):
        bad = copy.deepcopy(self.counters); bad["frozen"]["throughRun"] = "R9"
        with self.assertRaises(ValueError):
            RC.reconcile(self.cfg, bad, self.d)

    def test_re_freezing_after_the_run_moves_the_boundary_without_double_counting(self):
        moved = copy.deepcopy(self.counters); moved["frozen"]["throughRun"] = "R6T"
        rc = RC.reconcile(self.cfg, moved, self.d)
        self.assertEqual(rc["afterFreeze"], [])
        self.assertEqual(rc["requests"]["measuredFromSealedLedgers"], 5421 + 130)
        # the owner-counted basis adds the same run's ledger once, in the frozen figure
        self.assertEqual(rc["requests"]["ownerCounted"], 3406 + 2085 + 130 + 38)

    def test_re_freezing_without_the_new_runs_action_log_is_refused(self):
        os.remove(os.path.join(self.d, "R6T", "AHT-01", "action-reservations.jsonl"))
        moved = copy.deepcopy(self.counters); moved["frozen"]["throughRun"] = "R6T"
        with self.assertRaisesRegex(ValueError, "has no reservation log"):
            RC.reconcile(self.cfg, moved, self.d)

    def test_the_report_states_the_freeze_and_the_once_only_addition(self):
        import workflow_report as W
        rc = RC.reconcile(self.cfg, self.counters, self.d)
        sp = S.build(self.req, self.cfg, rc, self.rr, None, None, "R6T")
        self.assertIn("added exactly once", sp["countedOnce"]["rule"])
        self.assertIn("frozen", rc["freeze"]["rule"])


if __name__ == "__main__":
    unittest.main()
