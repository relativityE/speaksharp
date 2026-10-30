"""Nightly paid-user regression, independent of known bugs (workflow 1.4.0): previous-run and last-known-good comparison, clear alerts, deployed-version binding,
retained append-only history, additive-only catalog, isolation proof, standing approval of recurring cost, and the intentionally broken control."""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest

from _fixtures import ROOT, J, run_py, sample, wjson, needs_history
from _nightly import CATALOG, SHA, history, make_run, request, utc
import check_coverage as CC
import check_gates as CG
import derive_alerts as DA
import history_index as HI
import recurring_budget as RB
import validate_run_request as V
import verify_catalog_history as VC

BROKEN = ("AHT-07", CATALOG["cases"]["AHT-07"]["requiredAssertions"][1])
OTHER = ("AHT-12", CATALOG["cases"]["AHT-12"]["requiredAssertions"][2])


def alerts_for(root, cfg, label, **kw):
    req = request(label, SHA[label])
    cov = CC.assess(req, CATALOG, json.load(open(os.path.join(root, label, "case-results.json"))))
    return DA.derive(cfg, root, label, cov, **kw), cov


class IntentionallyBrokenControl(unittest.TestCase):
    """The acceptance control, offline: a clean full night, a night with one deliberately broken journey, the same defect persisting, and the recovery."""
    @classmethod
    def setUpClass(cls):
        cls.root, cls.cfg = history(("N1", {}), ("N2", {"fails": [BROKEN], "ended": "2026-11-02T03:41:00Z"}), ("N3", {"fails": [BROKEN], "ended": "2026-11-03T03:42:00Z"}), ("N4", {"ended": "2026-11-04T03:40:00Z"}))

    def test_a_clean_full_night_is_a_full_live_run_with_no_alerts(self):
        out, cov = alerts_for(self.root, self.cfg, "N1")
        self.assertTrue(cov["fullLiveRun"])
        self.assertEqual((cov["rowsExecuted"], cov["kind"]), (204, "FULL"))
        self.assertEqual((out["status"], out["alerts"]), ("OK", []))

    def test_the_broken_journey_produces_one_clear_regression_alert_naming_the_last_known_good_run(self):
        out, cov = alerts_for(self.root, self.cfg, "N2")
        self.assertTrue(cov["fullLiveRun"], "a FAIL is an executed row: the night completed, and found a defect")
        self.assertEqual(out["status"], "ALERT")
        reg = [a for a in out["alerts"] if a["kind"] == "REGRESSION"]
        self.assertEqual(len(reg), 1)
        a = reg[0]
        self.assertEqual((a["severity"], a["journey"], a["rows"]), ("high", "AHT-07", [BROKEN[1]]))
        self.assertEqual(a["lastKnownGood"], {"run": "N1", "servedSha": SHA["N1"]})
        self.assertEqual((a["firstFailedRun"], a["consecutiveFailingRuns"], a["comparedWith"] if "comparedWith" in a else "N1"), ("N2", 1, "N1"))
        self.assertTrue(a["evidence"] and a["evidence"][0]["sha256"], "the alert carries hashed evidence")
        self.assertIn("N1", a["action"])
        self.assertEqual([x["kind"] for x in out["alerts"]], ["REGRESSION"], "one defect, one alert: no row-by-row spam")

    def test_the_markdown_report_is_readable_and_names_everything_needed(self):
        out, _ = alerts_for(self.root, self.cfg, "N2")
        md = DA.markdown(out)
        for needle in ("ALERT", "[HIGH]", "AHT-07", "last known good: N1", SHA["N1"][:8], BROKEN[1], "action:", "id: `REGRESSION-"):
            self.assertIn(needle, md)

    def test_the_same_defect_the_next_night_is_still_failing_with_a_count_and_no_new_page(self):
        out, _ = alerts_for(self.root, self.cfg, "N3")
        a = next(x for x in out["alerts"] if x["journey"] == "AHT-07")
        self.assertEqual((a["kind"], a["severity"], a["consecutiveFailingRuns"], a["firstFailedRun"]), ("STILL-FAILING", "medium", 2, "N2"))
        self.assertEqual(a["lastKnownGood"]["run"], "N1")
        self.assertEqual(out["status"], "WATCH")

    def test_the_fix_is_reported_as_recovered(self):
        out, _ = alerts_for(self.root, self.cfg, "N4")
        self.assertEqual([(a["kind"], a["severity"], a["journey"]) for a in out["alerts"]], [("RECOVERED", "info", "AHT-07")])
        self.assertEqual(out["status"], "OK")

    def test_alerts_are_deterministic_so_a_channel_can_deduplicate(self):
        a, _ = alerts_for(self.root, self.cfg, "N2")
        b, _ = alerts_for(self.root, self.cfg, "N2")
        self.assertEqual([x["id"] for x in a["alerts"]], [x["id"] for x in b["alerts"]])

    def test_two_defects_are_two_alerts_and_the_status_is_still_one(self):
        root, cfg = history(("N1", {}), ("N2", {"fails": [BROKEN, OTHER]}))
        out, _ = alerts_for(root, cfg, "N2")
        self.assertEqual(sorted(a["journey"] for a in out["alerts"]), ["AHT-07", "AHT-12"])

    def test_the_summary_of_the_broken_night_is_not_ready(self):
        import test_pipeline_and_report as T
        T.SummaryRules.setUpClass()
        inst = T.SummaryRules("test_ready_only_when_everything_holds")
        v = inst.all_pass(); v["AHT-07"] = ("PASS", "FAIL")
        f = inst.derive(True, ["CLOSED"] * 6, latest=inst.latest(v, classes={"AHT-07": "regressed"}), coverage={"fullLiveRun": True, "kind": "FULL", "statement": "204 of 204 required rows executed"})
        self.assertEqual((f["status"], f["recommendation"]), ("BLOCKED", "FIX AND RETEST"))
        self.assertIn("AHT-07", f["customerImpact"])

    def test_the_command_line_fails_the_job_on_a_high_alert_and_not_on_a_clean_night(self):
        for label, code in (("N2", 6), ("N1", 0), ("N3", 0)):
            d = tempfile.mkdtemp()
            cfgp, covp, out = os.path.join(d, "c.json"), os.path.join(d, "cov.json"), os.path.join(d, "a.json")
            wjson(cfgp, self.cfg)
            wjson(covp, CC.assess(request(label, SHA[label]), CATALOG, json.load(open(os.path.join(self.root, label, "case-results.json")))))
            r = run_py("scripts/derive_alerts.py", "--config", cfgp, "--receipts-root", self.root, "--latest-label", label, "--coverage", covp, "--fail-on", "high", "--out", out, "--markdown", os.path.join(d, "a.md"))
            self.assertEqual(r.returncode, code, (label, r.stdout, r.stderr))


class OtherAlertKinds(unittest.TestCase):
    def test_a_version_that_changed_mid_run_is_a_critical_binding_alert_and_not_a_full_run(self):
        root, cfg = history(("N1", {}), ("N2", {"identity_bad": ("AHT-09", "identityAfter", "9" * 40)}))
        out, cov = alerts_for(root, cfg, "N2")
        self.assertFalse(cov["fullLiveRun"])
        a = next(x for x in out["alerts"] if x["kind"] == "BINDING-MISMATCH")
        self.assertEqual(a["severity"], "critical")
        self.assertIn("AHT-09", a["problems"][0])

    def test_rows_that_were_not_run_make_the_regression_itself_incomplete(self):
        rows = [(c, a) for c, v in CATALOG["cases"].items() for a in v["requiredAssertions"]][:5]
        root, cfg = history(("N1", {}), ("N2", {"notrun": rows}))
        out, cov = alerts_for(root, cfg, "N2")
        a = next(x for x in out["alerts"] if x["kind"] == "COVERAGE-INCOMPLETE")
        self.assertEqual((a["severity"], a["notExecutedCount"], len(a["notExecuted"])), ("high", 5, 5))
        self.assertIn("199 of 204", a["title"])
        self.assertFalse(cov["fullLiveRun"])

    def test_a_missed_night_is_critical(self):
        root, cfg = history(("N1", {"ended": "2026-11-01T03:40:00Z"}))
        late, _ = alerts_for(root, cfg, "N1", now=utc("2026-11-03T12:00:00Z"))
        self.assertEqual([a["kind"] for a in late["alerts"]], ["MISSED-RUN"])
        self.assertEqual(late["alerts"][0]["severity"], "critical")
        ok, _ = alerts_for(root, cfg, "N1", now=utc("2026-11-02T06:00:00Z"))
        self.assertEqual(ok["alerts"], [])

    def test_unproven_isolation_and_an_overspend_each_alert(self):
        root, cfg = history(("N1", {}))
        out, _ = alerts_for(root, cfg, "N1", isolation={"proven": False, "problems": ["the post-cleanup query found 2 marked record(s) remaining"]}, spend={"withinCap": False, "status": "OVER CAP (stop rule S5)"})
        self.assertEqual(sorted(a["kind"] for a in out["alerts"]), ["ISOLATION-RESIDUE", "OVER-CAP"])
        self.assertTrue(all(a["severity"] == "high" for a in out["alerts"]))

    def test_a_row_that_never_passed_and_fails_is_a_new_failure_not_a_regression(self):
        root, cfg = history(("N1", {"notrun": [BROKEN]}), ("N2", {"fails": [BROKEN]}))
        out, _ = alerts_for(root, cfg, "N2")
        a = next(x for x in out["alerts"] if x["journey"] == "AHT-07")
        self.assertEqual(a["kind"], "NEW-FAILURE")
        self.assertIsNone(a["lastKnownGood"])



class RetainedHistory(unittest.TestCase):

    def build(self, *specs):
        root, cfg = history(*specs)
        idx = HI.wrap(HI.derive(cfg, root, 1))
        return root, cfg, idx

    def test_a_new_night_is_appended_and_every_old_entry_is_unchanged(self):
        root, cfg, idx = self.build(("N1", {}), ("N2", {"fails": [BROKEN]}))
        cfg["history"]["runs"].append(make_run(root, "N3", fails=[BROKEN], ended="2026-11-03T03:40:00Z"))
        new = HI.append(idx, cfg, root, 1)
        self.assertEqual(new["entries"][:2], idx["entries"])
        self.assertEqual(len(new["entries"]), 3)
        self.assertEqual(new["entries"][2]["prevHash"], idx["entries"][1]["entryHash"])
        self.assertEqual(HI.verify(new, cfg, root), [])

    def test_an_unrecorded_run_is_reported_until_it_is_appended(self):
        root, cfg, idx = self.build(("N1", {}))
        cfg["history"]["runs"].append(make_run(root, "N2"))
        errs = HI.verify(idx, cfg, root)
        self.assertTrue(any("does not record yet" in e for e in errs), errs)

    def test_rewriting_an_old_result_is_detected(self):
        root, cfg, idx = self.build(("N1", {}), ("N2", {}))
        p = os.path.join(root, "N1", "case-results.json")
        cr = json.load(open(p)); cr["cases"][0]["assertions"][0]["result"] = "FAIL"; wjson(p, cr)
        errs = HI.verify(idx, cfg, root)
        self.assertTrue(any("history was rewritten" in e for e in errs), errs)

    def test_editing_the_index_breaks_the_chain(self):
        root, cfg, idx = self.build(("N1", {}), ("N2", {}), ("N3", {}))
        bad = copy.deepcopy(idx); bad["entries"][1]["summary"]["rows"]["PASS"] -= 1
        self.assertTrue(HI.verify(bad, cfg, root))
        bad = copy.deepcopy(idx); bad["entries"][0], bad["entries"][1] = bad["entries"][1], bad["entries"][0]
        self.assertTrue(HI.verify(bad, cfg, root))
        bad = copy.deepcopy(idx); bad["entries"].pop(1)
        self.assertTrue(HI.verify(bad, cfg, root))

    def test_append_refuses_when_an_old_entry_no_longer_verifies(self):
        root, cfg, idx = self.build(("N1", {}))
        p = os.path.join(root, "N1", "campaign-ledger.json"); wjson(p, {"used": {"total": 1}, "created": "x", "updated": "2026-11-01T03:40:00Z"})
        cfg["history"]["runs"].append(make_run(root, "N2"))
        with self.assertRaises(ValueError):
            HI.append(idx, cfg, root, 1)

    def test_a_pinned_head_that_differs_is_a_failure(self):
        root, cfg, idx = self.build(("N1", {}))
        cfg["history"]["index"] = {"headHash": "f" * 64}
        self.assertTrue(any("pinned" in e for e in HI.verify(idx, cfg, root)))

    def test_the_command_line_appends_and_verifies(self):
        root, cfg, idx = self.build(("N1", {}))
        d = tempfile.mkdtemp()
        cp, ip = os.path.join(d, "c.json"), os.path.join(d, "i.json")
        wjson(cp, cfg); wjson(ip, idx)
        cfg["history"]["runs"].append(make_run(root, "N2")); wjson(cp, cfg)
        r = run_py("scripts/history_index.py", "append", "--config", cp, "--receipts-root", root, "--index", ip)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(run_py("scripts/history_index.py", "verify", "--config", cp, "--receipts-root", root, "--index", ip).returncode, 0)
        r = run_py("scripts/history_index.py", "build", "--config", cp, "--receipts-root", root, "--index", ip)
        self.assertNotEqual(r.returncode, 0, "build must not overwrite an existing index")


class AdditiveCatalog(unittest.TestCase):
    def snaps(self):
        return {1: copy.deepcopy(CATALOG)}

    def v2(self, mutate):
        c = copy.deepcopy(CATALOG); mutate(c)
        return c

    def test_the_shipped_history_is_additive_and_current(self):
        version = J("config", "test-config.v1.json")["modes"]["full"]["assertionCatalog"]["version"]
        index = {"entries": [{"label": "SYNTHETIC", "catalogVersion": 1}]}
        self.assertEqual(VC.verify(VC.load_snapshots(os.path.join(ROOT, "config", "history", "catalogs")), CATALOG, version, index), [])

    def test_a_new_row_a_new_journey_and_a_higher_minimum_are_allowed(self):
        c2 = self.v2(lambda c: (c["cases"]["AHT-01"]["requiredAssertions"].append("new-check"), c["cases"].__setitem__("AHT-16", {"requiredAssertions": ["x"], "minimumTakes": 0, "minimumStarts": 0}),
                                c["cases"]["AHT-02"].__setitem__("minimumTakes", 8)))
        s = self.snaps(); s[2] = c2
        self.assertEqual(VC.verify(s, c2, 2), [])

    def test_removing_renaming_or_relaxing_is_refused(self):
        for label, mut in (("remove row", lambda c: c["cases"]["AHT-01"]["requiredAssertions"].pop()),
                           ("rename row", lambda c: c["cases"]["AHT-01"]["requiredAssertions"].__setitem__(0, "renamed")),
                           ("drop journey", lambda c: c["cases"].pop("AHT-15")),
                           ("lower minimum", lambda c: c["cases"]["AHT-02"].__setitem__("minimumStarts", 1))):
            c2 = self.v2(mut)
            s = self.snaps(); s[2] = c2
            self.assertTrue(VC.verify(s, c2, 2), label)

    def test_editing_the_current_catalog_without_a_new_version_is_refused(self):
        c2 = self.v2(lambda c: c["cases"]["AHT-01"]["requiredAssertions"].append("new-check"))
        errs = VC.verify(self.snaps(), c2, 1)
        self.assertTrue(any("freeze a new version" in e for e in errs), errs)


    def test_an_indexed_run_with_an_unknown_catalog_version_is_refused(self):
        idx = {"entries": [{"label": "SYNTHETIC", "catalogVersion": 7}]}
        self.assertTrue(VC.verify(self.snaps(), CATALOG, 1, idx))


class StandingApprovalOfRecurringCost(unittest.TestCase):
    def setUp(self):
        self.s = sample()
        self.req = request("R9-N2")
        self.req["window"] = {"startUtc": "2026-11-02T03:00:00Z", "endUtc": "2026-11-02T08:00:00Z", "approvalRef": "standing-1"}
        est = self.req["estimate"]
        self.ap = {"status": "APPROVED", "approvedBy": "owner", "approvalRef": "standing-1", "approvedAtUtc": "2026-11-01T00:00:00Z", "validFromUtc": "2026-11-01T00:00:00Z", "expiresUtc": "2026-12-01T00:00:00Z",
                   "periodStartUtc": "2026-11-01T00:00:00Z", "cadence": {"runsPerPeriod": 30, "period": "30 days"},
                   "perRunCaps": {"runCapRequests": est["requests"]["runCap"], "identityReads": est["identityReads"], "starts": est["starts"], "takes": est["takes"],
                                  "coachingRequests": est["providerBillableRequests"]["coachingCap"], "windowMinutes": est["window"]["proposedMinutes"], "githubRunnerMinutes": 30, "paidActionsUsd": 0},
                   "periodCaps": {"requests": 30 * est["requests"]["runCap"], "identityReads": 30 * est["identityReads"], "starts": 30 * est["starts"], "takes": 30 * est["takes"],
                                  "coachingRequests": 30 * est["providerBillableRequests"]["coachingCap"], "githubRunnerMinutes": 30 * 30, "paidActionsUsd": 0}}

    def gate(self, ap=None, req=None, index=None, now="2026-11-02T03:00:00Z"):
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, "config"))
        wjson(os.path.join(d, "config", "recurring-approval.json"), ap if ap is not None else self.ap)
        return CG.recurring_gate(req or self.req, self.s["cfg"], d, index, utc(now))

    def test_not_applicable_to_other_requests(self):
        g = CG.recurring_gate(sample()["req"], self.s["cfg"], ROOT, None, utc("2026-11-02T03:00:00Z"))
        self.assertEqual(g["status"], "READY")

    def test_the_shipped_approval_is_empty_so_a_nightly_request_is_an_owner_input(self):
        g = CG.recurring_gate(request("R9-N2"), self.s["cfg"], ROOT, None, utc("2026-11-02T03:00:00Z"))
        self.assertEqual(g["status"], "OWNER-INPUT-OPEN")
        self.assertTrue(any("approvedBy" in n for n in g["needs"]))
        self.assertEqual(J("config", "recurring-approval.json")["status"], "NOT APPROVED")

    def test_a_complete_approval_covers_the_run(self):
        self.assertEqual(self.gate()["status"], "READY")

    def test_each_limit_is_enforced(self):
        for label, mut, needle in (("per run requests", lambda a: a["perRunCaps"].__setitem__("runCapRequests", 100), "asks for requests"),
                                   ("window", lambda a: a["perRunCaps"].__setitem__("windowMinutes", 60), "window of"),
                                   ("expired", lambda a: a.__setitem__("expiresUtc", "2026-11-02T00:00:00Z"), "not in force"),
                                   ("not yet valid", lambda a: a.__setitem__("validFromUtc", "2026-11-03T00:00:00Z"), "not in force"),
                                   ("paid actions", lambda a: a["perRunCaps"].__setitem__("paidActionsUsd", 5), "$0"),
                                   ("self contradicting", lambda a: a["periodCaps"].__setitem__("requests", 1000), "contradicts itself")):
            ap = copy.deepcopy(self.ap); mut(ap)
            g = self.gate(ap)
            self.assertEqual(g["status"], "NOT-READY", label)
            self.assertTrue(any(needle in n for n in g["needs"]), (label, g["needs"]))

    def test_usage_so_far_in_the_period_counts_from_the_retained_history(self):
        used = 30 * self.req["estimate"]["requests"]["runCap"] - 1000
        idx = {"entries": [{"summary": {"kind": "run", "requests": used, "identityReads": 5, "endedUtc": "2026-11-01T03:40:00Z"}}]}
        g = self.gate(index=idx)
        self.assertEqual(g["status"], "NOT-READY")
        self.assertTrue(any("period usage so far" in n for n in g["needs"]), g["needs"])
        old = {"entries": [{"summary": {"kind": "run", "requests": used, "identityReads": 5, "endedUtc": "2026-10-20T03:40:00Z"}}]}
        self.assertEqual(self.gate(index=old)["status"], "READY", "usage before the period start does not count")


    def test_a_nightly_run_is_limited_by_the_standing_approval_not_the_one_time_ceiling(self):
        from _fixtures import fake_rv, reconciliation
        s = self.s
        out = CG.evaluate(self.req, s["cfg"], s["ledger"], s["wf"], {"valid": True}, {"passed": True}, None, ROOT, "preflight", fake_rv(), reconciliation(), utc("2026-11-02T02:00:00Z"))
        st = {g["id"]: g["status"] for g in out["gates"]}
        self.assertEqual(st["G5"], "READY")
        self.assertEqual(st["G11"], "OWNER-INPUT-OPEN")
        self.assertEqual(out["decision"], "NO-GO")


    def test_after_a_measured_full_run_the_proposal_is_based_on_that_run(self):
        root, cfg = history(("N1", {"requests": 3500}))
        idx = HI.wrap(HI.derive(cfg, root, 1))
        m = RB.per_run_measured(idx)
        self.assertEqual(m["runCapRequests"], 4380)
        self.assertIn("measured full live run N1", m["basis"])
        partial = HI.wrap(HI.derive(history(("N1", {"notrun": [BROKEN]}))[1], history(("N1", {"notrun": [BROKEN]}))[0], 1))
        self.assertIsNone(RB.per_run_measured(partial))


class NothingIsScheduledOrSent(unittest.TestCase):
    def test_no_schedule_trigger_is_installed_and_no_alert_channel_is_configured(self):
        yml = open(os.environ.get("CLOUD_TEST_YML") or os.path.join(ROOT, "tests", "fixtures", "cloud-test.yml"), encoding="utf-8").read()
        self.assertNotIn("schedule:", yml)
        cfg = J("config", "test-config.v1.json")
        self.assertFalse(cfg["nightly"]["schedule"]["installed"])
        self.assertEqual(cfg["nightly"]["alertChannels"], [])

    def test_the_proposed_schedule_lives_outside_the_workflows_directory(self):
        # A source policy fixture, not an unpublished operational proposal.
        p = os.path.join(ROOT, "tests", "fixtures", "nightly-control-plane.yml.proposed")
        self.assertTrue(os.path.isfile(p))
        txt = open(p, encoding="utf-8").read()
        self.assertIn("schedule:", txt)
        self.assertNotIn("secrets.", txt)
        self.assertIn("permissions:\n  contents: read", txt)
        self.assertFalse(os.path.exists(os.path.join(ROOT, "..", "..", ".github", "workflows", "nightly-control-plane.yml")))


class SyntheticHistoryRules(unittest.TestCase):
    """The nightly rules on the SYNTHETIC sealed history (tests/_synthetic_history.py); the retained-campaign versions are kept unchanged in
    tests/legacy_audit/audit_nightly_regression.py. Synthetic R5 executed every row except 9 of AHT-05's 10 and AHT-12 rows 2-3 (204 - 11 = 193),
    failed none, and passes AHT-02 row 1, which failed in R4C."""
    @classmethod
    def setUpClass(cls):
        from _synthetic_history import shared as synthetic_history
        cls.h = synthetic_history()
        cls.s = sample()

    def test_the_index_verifies_and_is_pinned(self):
        with open(self.h.index, encoding="utf-8") as f:
            idx = json.load(f)
        self.assertEqual(HI.verify(idx, self.h.cfg, self.h.receipts), [])
        self.assertEqual(self.h.cfg["history"]["index"]["headHash"], idx["headHash"])
        self.assertEqual([e["label"] for e in idx["entries"]], ["R4", "R4B", "R4C", "R5"])
        r5 = idx["entries"][3]["summary"]
        self.assertEqual((r5["rows"], r5["rowsExecuted"]), ({"PASS": 193, "FAIL": 0, "NOT RUN": 11}, 193))

    def test_the_sealed_history_gives_alerts_for_r5(self):
        out = DA.derive(self.h.cfg, self.h.receipts, "R5", {"fullLiveRun": False, "kind": "PARTIAL", "statement": "193 of 204 required rows executed", "reasons": ["partial"], "missing": []})
        kinds = sorted(a["kind"] for a in out["alerts"])
        self.assertIn("COVERAGE-INCOMPLETE", kinds)
        self.assertIn("RECOVERED", kinds)                     # AHT-02 row 1: FAIL in R4C, PASS in R5
        self.assertEqual(kinds.count("STILL-FAILING"), 0)     # R5 failed no row

    def test_the_nightly_request_is_valid_and_a_partial_nightly_is_not(self):
        # The tracked synthetic nightly proposal carrying the independently expected budget of the synthetic history (test_full_coverage.EXPECTED).
        from _fixtures import fake_rv, reconciliation
        from test_full_coverage import full_request
        s = self.s
        req = J("config", "runs", "R8-nightly-regression-proposal.json")
        budgeted = full_request()
        req["estimate"]["requests"].update(budgeted["estimate"]["requests"])
        req["estimate"]["window"].update(budgeted["estimate"]["window"])
        plan = {x["case"]: x["plannedRequests"] for x in budgeted["selection"]}
        for x in req["selection"]:
            x["plannedRequests"] = plan[x["case"]]
        for k in ("cumulativeCeilingRequests", "runCapRequests", "ceilingIncreaseJustification"):
            req["proposedLimits"][k] = budgeted["proposedLimits"][k]
        b = V.derive_budget(s["cfg"], reconciliation(), self.h.receipts)
        errs, _ = V.validate(req, s["cfg"], s["ledger"], s["wf"], fake_rv(), reconciliation(), b)
        self.assertEqual(errs, [])
        bad = J("config", "runs", "R8-nightly-regression-proposal.json"); bad["coverageMode"] = "partial"; bad["sampleMode"] = "minimal"
        errs, _ = V.validate(bad, s["cfg"], s["ledger"], s["wf"], fake_rv(), reconciliation(), None)
        self.assertTrue(any("only for coverageMode full" in e for e in errs), errs)

    def test_the_proposal_is_derived_flagged_and_keeps_unknown_costs_unknown(self):
        from _fixtures import reconciliation
        import full_coverage_budget as FB
        import derive_case_costs as DC
        costs = {"runs": {lab: DC.derive_run(self.h.receipts, lab) for lab in ("R4C", "R5")}}
        budget = FB.compute(self.s["cfg"], costs, CATALOG, reconciliation())
        with open(self.h.index, encoding="utf-8") as f:
            p = RB.proposal(self.s["cfg"], budget, json.load(f), 30)
        self.assertIn("NOT APPROVED", p["status"])
        self.assertEqual(p["periodTotals"]["requests"], 30 * 3430)        # 30 runs x the synthetic run cap (test_full_coverage.EXPECTED)
        self.assertFalse(p["measuredFullRunAvailable"])
        self.assertEqual(p["unknownCosts"]["cloudAgentUsd"], "unknown")
        self.assertEqual(p["periodTotals"]["paidActionsUsd"], 0)


if __name__ == "__main__":
    unittest.main()
