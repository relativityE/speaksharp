"""Full-coverage mode (workflow 1.3.0): per-case costs from the sealed guard logs, the assertion catalog, the derived budget, the separate mode limits, the
mode pass-through to the plan builder, the completeness check and the rule that a partial or carried-forward result is never the full live run."""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest

from _fixtures import ROOT, J, sample, reconciliation, request_path, fake_rv, wjson, needs_history
from _synthetic_history import shared as synthetic_history

import derive_case_costs as DC
import full_coverage_budget as FB
import check_coverage as CC
import validate_run_request as V
import check_gates as CG
import derive_assertion_catalog as CAT
from _common import sha256_file

# Costs and budgets come from the SYNTHETIC sealed history (tests/_synthetic_history.py over tests/fixtures/synthetic-history/inputs.v1.json).
# The retained campaigns are read only by the historical-audit suite (tests/legacy_audit/audit_full_coverage.py).
RECEIPTS = synthetic_history().receipts

# Independent expected budget for that history (Sam 1793402195: never taken from the function under test), written from inputs.v1.json and
# the config's budget model (allowance 125%, cleanup 10 per case, pooled slack 15%, uplift cap 3.0):
#   fixed overhead = max(R4C 20+30+10, R5 20+40+10) = 70; variable work = max(R4C 60+40+10, R5 50+40+10) = 110
#   R5 executed every row except AHT-05 (1 row of 10; R4C half = 5) and AHT-12 (6 of 8: rows 2 and 3 not run; R4C half = 4), so only those two
#   are scaled: AHT-05 min(3.0, 10/5) = 2.0, AHT-12 min(3.0, 8/6) = 1.33
#   estimate = ceil10(70 + 110) = 180 for 13 journeys; AHT-05 = ceil10(70 + 110 x 2) = 290; AHT-12 = ceil10(ceil(70 + 110 x 8/6)) = ceil10(217) = 220
#   planned 13 x 180 + 290 + 220 = 2850; cleanup 15 x 10 = 150; slack ceil10(ceil(2850 x 15%)) = ceil10(428) = 430; run cap 2850 + 150 + 430 = 3430
#   cumulative ceiling over the synthetic reconciliation (UsageHistory: 5529 used): 5529 + 3430 + 664 protected reserve + 32 identity reads = 9655
#   window: expected round(2 + (13 x 120 s + AHT-05 150 s x 2.0 + AHT-12 120 s x 8/6) / 60 + 10) = round(45.667) = 46 min; worst case
#   20 + 272 + 2 = 294; proposed 300 (next 30)
EST = {"AHT-%02d" % n: (290 if n == 5 else 220 if n == 12 else 180) for n in range(1, 16)}
EXPECTED = {"planned": 2850, "cleanupReserve": 150, "pooledSlack": 430, "runCap": 3430, "requiredCeiling": 9655,
            "window": {"expectedMinutes": 46, "worstCaseMinutes": 294, "proposedMinutes": 300}}


def costs():
    return {"runs": {lab: DC.derive_run(RECEIPTS, lab) for lab in ("R4C", "R5")}}


def catalog():
    return J("config", "assertion-catalog.json")


def r7():
    """The tracked SYNTHETIC, unapproved full-request fixture (tests/fixtures/full-request.json, resolved by J()); not the private R7 request."""
    return J("config", "runs", "R7-full-coverage-proposal.json")


def full_request():
    """r7() carrying the independently EXPECTED budget above: only the budget fields change; selection, gaps, caps and every other field stay."""
    req = r7()
    req["estimate"]["requests"].update({k: EXPECTED[k] for k in ("planned", "cleanupReserve", "pooledSlack", "runCap")})
    req["estimate"]["window"].update(EXPECTED["window"])
    for s in req["selection"]:
        s["plannedRequests"] = EST[s["case"]]
    req["proposedLimits"].update(cumulativeCeilingRequests=EXPECTED["requiredCeiling"], runCapRequests=EXPECTED["runCap"],
                                 ceilingIncreaseJustification="SYNTHETIC: 5529 used + 3430 run cap + 664 protected reserve + 32 identity reads = 9655.")
    return req


def validate(req, budget="derive", rv=None):
    s = sample()
    rc = reconciliation()
    b = V.derive_budget(s["cfg"], rc, RECEIPTS) if budget == "derive" else budget
    return V.validate(req, s["cfg"], s["ledger"], s["wf"], rv or fake_rv(), rc, b)


class CaseCostsFromGuardLogs(unittest.TestCase):
    """Per-case costs from the synthetic sealed guard logs. Each declared journey adds public + preflight + auth + signed-in + model + coaching:
    R4C 20+30+10+60+40+10 = 170 and R5 20+40+10+50+40+10 = 170, so each run's ledger is 15 x 170 = 2550."""
    @classmethod
    def setUpClass(cls):
        cls.c = costs()

    def test_per_case_costs_reconcile_to_each_runs_sealed_ledger(self):
        for lab, total in (("R4C", 15 * 170), ("R5", 15 * 170)):
            r = self.c["runs"][lab]
            self.assertTrue(r["reconciliation"]["ok"], r["reconciliation"])
            self.assertEqual(sum(x["requests"]["total"] for x in r["cases"]), total)
            self.assertEqual(len(r["cases"]), 15)

    def test_every_category_sums_to_the_ledger_and_the_total_is_fixed_plus_variable(self):
        for r in self.c["runs"].values():
            for x in r["cases"]:
                b = x["requests"]["byCategory"]
                # navigations are counted inside public as well, so the partition is public + preflight + auth + signed-in + model + coaching
                self.assertEqual(b["public"] + b["preflight"] + b["auth"] + b["signed-in"] + b["model"] + b["coaching"], x["requests"]["total"], x["case"])

    def test_known_cases_match_the_logs(self):
        # The declared synthetic figures (the retained-campaign figures are checked in tests/legacy_audit/audit_full_coverage.py).
        r4c = {x["case"]: x for x in self.c["runs"]["R4C"]["cases"]}
        r5 = {x["case"]: x for x in self.c["runs"]["R5"]["cases"]}
        self.assertEqual(r4c["AHT-01"]["requests"]["total"], 20 + 30 + 10 + 60 + 40 + 10)
        self.assertEqual(r5["AHT-01"]["requests"]["byCategory"]["preflight"], 40)
        self.assertTrue(r4c["AHT-03"]["lowerBound"])
        self.assertIn("stopped by its request allowance", " ".join(r4c["AHT-03"]["lowerBoundBecause"]))
        self.assertEqual((r5["AHT-05"]["rows"]["executed"], r5["AHT-05"]["rows"]["notRun"]), (1, 10 - 1))
        self.assertTrue(r5["AHT-05"]["lowerBound"])
        self.assertFalse(r5["AHT-04"]["lowerBound"])
        self.assertEqual((r4c["AHT-12"]["startsPressed"], r4c["AHT-12"]["takesSaved"]), (1, 1))

    def test_a_case_with_unexecuted_rows_is_marked_a_lower_bound(self):
        for r in self.c["runs"].values():
            for x in r["cases"]:
                self.assertEqual(x["lowerBound"], bool(x["rows"]["notRun"]) or "no guard stop summary" in x["lowerBoundBecause"] or any("allowance" in w for w in x["lowerBoundBecause"]), x["case"])

    def test_identity_reads_are_two_per_case(self):
        for r in self.c["runs"].values():
            self.assertTrue(all(x["identityReads"] == 2 for x in r["cases"]))
            self.assertEqual(r["totals"]["identityReadsLedger"], 32)

    def test_a_tampered_guard_log_is_a_reported_mismatch_not_a_silent_one(self):
        with tempfile.TemporaryDirectory() as d:
            import shutil
            shutil.copytree(os.path.join(RECEIPTS, "R5"), os.path.join(d, "R5"))
            led = os.path.join(d, "R5", "campaign-ledger.json")
            j = json.load(open(led)); j["used"]["total"] += 7; wjson(led, j)
            self.assertFalse(DC.derive_run(d, "R5")["reconciliation"]["ok"])


class AssertionCatalog(unittest.TestCase):
    def test_the_catalog_is_the_harness_contract_and_is_pinned(self):
        cat = catalog()
        self.assertEqual((cat["totalAssertions"], cat["minimumStarts"], cat["minimumTakes"]), (204, 42, 31))
        self.assertEqual(sample()["cfg"]["modes"]["full"]["assertionCatalog"]["sha256"], sha256_file(os.path.join(ROOT, "config", "assertion-catalog.json")))
        # Current contract derivation is hermetic. Retained-row cross-checking
        # remains a separate history-only assertion below.
        with tempfile.TemporaryDirectory() as d:
            import shutil
            os.makedirs(os.path.join(d, "harness", "draft-adapters"))
            os.makedirs(os.path.join(d, "config"))
            shutil.copyfile(os.path.join(ROOT, "harness", "draft-adapters", "contracts.json"), os.path.join(d, "harness", "draft-adapters", "contracts.json"))
            wjson(os.path.join(d, "config", "test-config.v1.json"), {"history": {"comparisonBaselines": []}})
            out, errs = CAT.derive(d)
        self.assertEqual(errs, [])
        self.assertEqual(json.dumps(out, indent=1) + "\n", open(os.path.join(ROOT, "config", "assertion-catalog.json"), encoding="utf-8").read())

    def test_a_tampered_catalog_makes_the_budget_underivable_and_the_request_invalid(self):
        s = sample()
        bad = copy.deepcopy(s["cfg"]); bad["modes"]["full"]["assertionCatalog"]["sha256"] = "0" * 64
        self.assertIsNone(V.derive_budget(bad, reconciliation(), RECEIPTS))
        errs, _ = V.validate(r7(), bad, s["ledger"], s["wf"], fake_rv(), reconciliation(), None)
        self.assertTrue(any("could not be derived" in e for e in errs), errs)

    def test_the_case_time_limits_in_the_config_equal_the_plan_builders(self):
        # Current source invariant: never hidden by retained-history admission.
        src = open(os.path.join(ROOT, "harness-adapter", "build_plan.py"), encoding="utf-8").read()
        import re
        m = re.search(r"MAXMS = \{([^}]*)\}", src, re.S)
        builder = {int(k): int(v) for k, v in re.findall(r"(\d+):\s*(\d+)", m.group(1))}
        cfg = sample()["cfg"]["modes"]["full"]["caseMaxMs"]
        self.assertEqual({int(k.split("-")[1]): v for k, v in cfg.items()}, builder)


class DerivedBudget(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.b = FB.with_sensitivity(sample()["cfg"], costs(), catalog(), reconciliation())

    def test_the_derivation_equals_the_independently_expected_budget(self):
        self.assertEqual({p["case"]: p["estimate"] for p in self.b["perCase"]}, EST)
        r = self.b["requests"]
        self.assertEqual((r["plannedSumOfEstimates"], r["cleanupReserve"], r["pooledSlack"], r["runCap"]),
                         (EXPECTED["planned"], EXPECTED["cleanupReserve"], EXPECTED["pooledSlack"], EXPECTED["runCap"]))
        self.assertEqual(self.b["cumulative"]["requiredCeiling"], EXPECTED["requiredCeiling"])
        w = self.b["window"]
        self.assertEqual((w["expectedMinutes"], w["worstCaseMinutes"], w["proposedWindowMinutes"]), tuple(EXPECTED["window"].values()))
        self.assertEqual({p["case"]: p["ceiling"] for p in self.b["perCase"]}, {c: {290: 370, 220: 280, 180: 230}[e] for c, e in EST.items()})  # 125% rule

    def test_the_budget_carrying_request_is_still_an_unapproved_proposal(self):
        # Sam 1793403415: full_request() changes only budget fields; it stays a proposal with no approval and no omission.
        r = full_request()
        self.assertTrue(r["proposal"])
        self.assertTrue(all(v is None for v in r["approvedLimits"].values()))
        self.assertEqual(r["approvedOmissions"], [])

    def test_it_is_a_proposal_and_never_an_approval(self):
        self.assertIn("NOT APPROVED", self.b["status"])
        self.assertIn("proposal", self.b["approvalNote"].lower())

    def test_request_arithmetic(self):
        r = self.b["requests"]
        self.assertEqual(r["plannedSumOfEstimates"] + r["cleanupReserve"] + r["pooledSlack"], r["runCap"])
        self.assertEqual(r["plannedSumOfEstimates"], sum(p["estimate"] for p in self.b["perCase"]))
        self.assertEqual(r["cleanupReserve"], 10 * 15)
        for p in self.b["perCase"]:
            self.assertEqual(p["ceiling"], ((p["estimate"] * 125 + 99) // 100 + 9) // 10 * 10, p["case"])   # the harness rule
            self.assertEqual(p["estimate"] % 10, 0)
            self.assertGreaterEqual(p["estimate"], p["fixedObserved"] + p["variableObserved"], p["case"])  # never below what was observed

    def test_cumulative_ceiling_identity_and_action_caps(self):
        c = self.b["cumulative"]
        self.assertEqual(c["requiredCeiling"], 5529 + self.b["requests"]["runCap"] + 664 + 32)
        self.assertEqual(c["requiredCeiling"], 5529 + 3430 + 664 + 32)
        self.assertGreater(c["requiredCeiling"], 8795)           # the earlier proposal understated a full run
        self.assertEqual(self.b["identity"]["required"], 94 + 32)
        self.assertEqual(self.b["identity"]["required"], 126)
        a = self.b["actions"]
        # The explicitly synthetic UsageHistory starts at zero actions, not
        # the private owner's historical 45 Starts / 24 takes.
        self.assertEqual((a["startsRequired"], a["startsCap"], a["startsShortfall"]), (42, 50, 0))
        self.assertEqual((a["takesRequired"], a["takesCap"], a["takesShortfall"]), (31, 40, 0))
        self.assertEqual((a["ownerDecision"], self.b["identity"]["ownerDecision"]), ("not required", "required"))

    def test_window_covers_the_worst_case_not_just_the_expected_case(self):
        w = self.b["window"]
        self.assertLess(w["expectedMinutes"], w["worstCaseMinutes"])
        self.assertGreaterEqual(w["proposedWindowMinutes"], w["worstCaseMinutes"])
        self.assertEqual(w["worstCaseMinutes"], round(20 + 272 + 2))
        self.assertEqual(w["proposedWindowMinutes"] % 30, 0)

    def test_dollars_are_four_accounts_and_none_is_asserted_without_a_source(self):
        d = self.b["dollars"]
        self.assertEqual(d["paidActionsAuthorizedUsd"], 0)
        self.assertIsNone(d["providerCoaching"]["estimateUsd"])
        self.assertEqual(d["providerCoaching"]["measured"], "unknown")
        self.assertEqual(d["cloudAgent"]["usd"], "unknown")
        self.assertEqual(d["githubActions"]["billedUsd"], "unknown")
        self.assertNotIn("totalUsd", d)
        self.assertEqual(self.b["coaching"]["cap"], 40)

    def test_coaching_cap_comes_from_the_takes_and_the_sensitivity_is_monotone(self):
        caps = [s["runCap"] for s in self.b["sensitivity"]]
        self.assertEqual(caps, sorted(caps))
        self.assertEqual(len({s["upliftCap"] for s in self.b["sensitivity"]}), 3)


class SeparateModeLimits(unittest.TestCase):
    def test_the_partial_limits_are_not_raised_in_place(self):
        cfg = sample()["cfg"]
        self.assertEqual((cfg["limits"]["maxSelectedCases"], cfg["limits"]["maxRunCapRequests"], cfg["limits"]["maxIdentityReadsPerRun"]), (6, 800, 20))
        self.assertEqual(cfg["modes"]["partial"]["limits"]["maxSelectedCases"], 6)
        self.assertEqual(cfg["modes"]["full"]["limits"]["maxSelectedCases"], 15)

    def test_the_proposal_is_valid_and_flags_every_owner_decision(self):
        errs, warns = validate(full_request())
        self.assertEqual(errs, [])
        self.assertTrue(any("ceiling increase" in w for w in warns))
        self.assertTrue(any("Starts cap increase" in w for w in warns))
        self.assertTrue(any("takes cap increase" in w for w in warns))

    def test_the_partial_request_is_still_valid_under_its_own_limits(self):
        errs, _ = validate(sample()["req"])
        self.assertEqual(errs, [])

    def test_a_request_with_no_mode_is_invalid_there_is_no_default(self):
        req = full_request(); del req["coverageMode"]
        errs, _ = validate(req)
        self.assertTrue(any("coverageMode must be partial or full" in e for e in errs), errs)

    def test_the_sample_mode_must_match_the_mode(self):
        req = full_request(); req["sampleMode"] = "minimal"
        errs, _ = validate(req)
        self.assertTrue(any("sampleMode" in e for e in errs), errs)

    def test_a_partial_request_cannot_borrow_the_full_limits(self):
        req = sample()["req"]
        req["selection"] = full_request()["selection"][:7]
        errs, _ = validate(req)
        self.assertTrue(any("exceeds the configured maximum 6" in e for e in errs), errs)

    def test_a_full_request_must_select_all_fifteen_journeys(self):
        req = full_request(); req["selection"] = req["selection"][:14]
        for i, s in enumerate(req["selection"], 1): s["order"] = i
        errs, _ = validate(req)
        self.assertTrue(any("selects all 15 journeys" in e for e in errs), errs)

    def test_a_full_request_must_evaluate_every_tracked_gap(self):
        req = full_request(); req["targetedGaps"] = req["targetedGaps"][:3]
        errs, _ = validate(req)
        self.assertTrue(any("evaluates every tracked gap" in e for e in errs), errs)

    def test_planned_requests_must_equal_the_derived_estimate(self):
        req = full_request(); req["selection"][0]["plannedRequests"] += 10
        errs, _ = validate(req)
        self.assertTrue(any("plannedRequests" in e and "derived estimate" in e for e in errs), errs)

    def test_the_run_cap_cannot_be_trimmed_in_the_request(self):
        req = full_request(); req["estimate"]["requests"]["pooledSlack"] -= 100; req["estimate"]["requests"]["runCap"] -= 100; req["proposedLimits"]["runCapRequests"] -= 100
        errs, _ = validate(req)
        self.assertTrue(any("derived full-coverage budget" in e for e in errs), errs)

    def test_a_ceiling_below_the_requirement_is_invalid(self):
        req = full_request(); req["proposedLimits"]["cumulativeCeilingRequests"] = 8795
        errs, _ = validate(req)
        self.assertTrue(any("below the reconciled requirement" in e for e in errs), errs)

    def test_starts_and_takes_need_a_proposed_cap_with_a_justification(self):
        req = full_request(); del req["proposedLimits"]["startsCap"]
        s, rc = sample(), reconciliation()
        # A negative control must actually cross its synthetic cap.
        rc["ceilings"]["starts"] = 39
        budget = V.derive_budget(s["cfg"], rc, RECEIPTS)
        errs, _ = V.validate(req, s["cfg"], s["ledger"], s["wf"], fake_rv(), rc, budget)
        self.assertTrue(any("Starts would exceed the cumulative cap" in e for e in errs), errs)
        req = full_request(); req["proposedLimits"].pop("takesIncreaseJustification")
        errs, _ = validate(req)
        self.assertTrue(any("takesIncreaseJustification" in e for e in errs), errs)

    def test_full_priority_is_only_for_full_mode(self):
        req = full_request(); req["priority"] = "prove-deployed-fix"
        self.assertTrue(any("priority full-coverage" in e for e in validate(req)[0]))
        req = sample()["req"]; req["priority"] = "full-coverage"
        self.assertTrue(any("only for coverageMode full" in e for e in validate(req)[0]))

    def test_an_omission_needs_a_reason_an_approval_and_a_real_row(self):
        req = full_request(); req["approvedOmissions"] = [{"case": "AHT-02", "assertion": "no-such-row", "reason": "x", "approvalRef": "owner-1"}]
        self.assertTrue(any("not an assertion in the catalog" in e for e in validate(req)[0]))
        req["approvedOmissions"] = [{"case": "AHT-02", "assertion": "owner-bound", "reason": "x"}]
        self.assertTrue(any("needs case, assertion, reason and approvalRef" in e for e in validate(req)[0]))
        req["approvedOmissions"] = [{"case": "AHT-02", "assertion": "owner-bound", "reason": "named", "approvalRef": "owner-1"}]
        errs, warns = validate(req)
        self.assertEqual(errs, [])
        self.assertTrue(any("approved omission" in w for w in warns))


class GatesForFullMode(unittest.TestCase):
    def gates(self, req, now="2026-10-29T01:00:00Z"):
        from _common import parse_utc
        s = sample()
        rc = reconciliation()
        b = V.derive_budget(s["cfg"], rc, RECEIPTS)
        errs, _ = V.validate(req, s["cfg"], s["ledger"], s["wf"], fake_rv(), rc, b)
        out = CG.evaluate(req, s["cfg"], s["ledger"], s["wf"], {"valid": not errs, "errors": errs}, {"passed": True}, None, ROOT, "preflight", fake_rv(), rc, parse_utc(now), RECEIPTS)
        return {g["id"]: g for g in out["gates"]}

    def approved(self, **w):
        req = full_request()
        req["approvedLimits"] = {"cumulativeCeilingRequests": EXPECTED["requiredCeiling"], "identityCap": 126, "startsCap": 85, "takesCap": 55,
                                 "runCapRequests": EXPECTED["runCap"],
                                 "startPressCaps": copy.deepcopy(req["proposedLimits"]["startPressCaps"]),
                                 "approvalRef": "owner-test", "approvedBy": "owner"}
        req["window"] = {"startUtc": "2026-10-29T02:00:00Z", "endUtc": "2026-10-29T07:00:00Z", "approvalRef": "owner-test"}
        req["window"].update(w)
        return req

    def test_a_fully_approved_full_request_clears_the_limits_gate(self):
        g = self.gates(self.approved())["G5"]
        self.assertEqual((g["status"], g["needs"]), ("READY", []))

    def test_starts_and_takes_caps_are_owner_inputs_until_approved(self):
        req = self.approved(); del req["approvedLimits"]["startsCap"]
        g = self.gates(req)["G5"]
        self.assertEqual(g["status"], "OWNER-INPUT-OPEN")
        self.assertTrue(any("startsCap" in n for n in g["needs"]))

    def test_a_window_shorter_than_the_worst_case_is_not_ready_unless_the_risk_is_accepted(self):
        req = self.approved(endUtc="2026-10-29T05:00:00Z")
        g = self.gates(req)["G5"]
        self.assertEqual(g["status"], "NOT-READY")
        self.assertTrue(any("worst case" in n for n in g["needs"]))
        req = self.approved(endUtc="2026-10-29T05:00:00Z", acceptedShortWindowRisk="owner-ref-123")
        self.assertEqual(self.gates(req)["G5"]["status"], "READY")

    def test_a_window_beyond_the_full_mode_maximum_is_refused(self):
        g = self.gates(self.approved(endUtc="2026-10-29T09:00:00Z"))["G5"]
        self.assertEqual(g["status"], "NOT-READY")

    def test_a_smaller_approved_ceiling_than_required_is_not_ready(self):
        req = self.approved(); req["approvedLimits"]["cumulativeCeilingRequests"] = 8795
        g = self.gates(req)["G5"]
        self.assertEqual(g["status"], "NOT-READY")


class ModePassThrough(unittest.TestCase):
    def env(self, req):
        with tempfile.TemporaryDirectory() as d:
            d = os.path.realpath(d)
            p, rc, o = os.path.join(d, "r.json"), os.path.join(d, "reconciliation.json"), os.path.join(d, "env.txt")
            wjson(p, req)
            wjson(rc, reconciliation())
            r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "run_env.py"), "--request", p,
                                "--request-sha256", sha256_file(p), "--reconciliation", rc, "--out", o], capture_output=True, text=True)
            return r, (dict(l.split("=", 1) for l in open(o).read().splitlines()) if os.path.exists(o) else {})

    def full_request(self):
        req = r7()
        req["approvedLimits"] = {"cumulativeCeilingRequests": 10535, "identityCap": 126, "startsCap": 85, "takesCap": 55,
                                 "runCapRequests": 4310, "startPressCaps": copy.deepcopy(req["proposedLimits"]["startPressCaps"]),
                                 "approvalRef": "o", "approvedBy": "o"}
        req["window"] = {"startUtc": "2026-10-29T02:00:00Z", "endUtc": "2026-10-29T07:00:00Z", "approvalRef": "o"}
        req["selectionApprovalRef"] = "o"
        req["release"]["backend"]["verifiedAtUtc"] = "2026-10-29T00:00:00Z"
        return req

    def test_full_and_partial_requests_pass_their_own_mode_to_the_builder(self):
        r, env = self.env(self.full_request())
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(env["BP_MODE"], "full")
        self.assertEqual(env["BP_SELECT"], ",".join(str(i) for i in range(1, 16)))
        self.assertEqual(env["BP_TOTAL"], "4310")
        self.assertEqual(len(env["BP_EST"].split(",")), 15)
        part = sample()["req"]
        part["approvedLimits"] = {"runCapRequests": 180,
                                  "startPressCaps": copy.deepcopy(part["proposedLimits"]["startPressCaps"])}
        part["window"] = {"startUtc": "2026-10-29T02:00:00Z", "endUtc": "2026-10-29T04:00:00Z", "approvalRef": "o"}
        part["selectionApprovalRef"] = "o"; part["release"]["backend"]["verifiedAtUtc"] = "2026-10-29T00:00:00Z"
        r, env = self.env(part)
        self.assertEqual((r.returncode, env["BP_MODE"]), (0, "minimal"))

    def test_there_is_no_default_mode(self):
        req = self.full_request(); del req["coverageMode"]
        r, _ = self.env(req)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("invalid Start allocation", r.stdout + r.stderr)
        self.assertNotIn("get(\"coverageMode\",", open(os.path.join(ROOT, "scripts", "run_env.py"), encoding="utf-8").read())

    def test_a_mismatched_sample_mode_is_refused(self):
        req = self.full_request(); req["sampleMode"] = "minimal"
        r, _ = self.env(req)
        self.assertNotEqual(r.returncode, 0)

    def test_a_admitted_b_read_by_environment_then_a_restored_is_refused_before_builder(self):
        with tempfile.TemporaryDirectory() as d:
            request_file, output = os.path.realpath(os.path.join(d, "request.json")), os.path.join(d, "env.txt")
            reconciliation_file = os.path.realpath(os.path.join(d, "reconciliation.json"))
            admitted = self.full_request(); wjson(request_file, admitted)
            wjson(reconciliation_file, reconciliation())
            admitted_sha = sha256_file(request_file)
            substituted = copy.deepcopy(admitted); substituted["approvedLimits"]["runCapRequests"] += 1
            wjson(request_file, substituted)
            result = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "run_env.py"),
                                     "--request", request_file, "--request-sha256", admitted_sha,
                                     "--reconciliation", reconciliation_file, "--out", output],
                                    capture_output=True, text=True)
            wjson(request_file, admitted)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("request changed since admission", result.stdout + result.stderr)
            self.assertFalse(os.path.exists(output), "the substituted request must not produce builder inputs")

    def test_the_builder_refuses_to_run_without_a_mode_and_has_a_full_branch(self):
        path = os.path.join(ROOT, "harness-adapter", "build_plan.py")
        r = subprocess.run([sys.executable, "-I", path, "phase1"], capture_output=True, text=True, env={"PATH": os.environ["PATH"], "BP_PACKET": "x", "BP_CHECKOUT": "x", "BP_PRIVATE": "x", "BP_SOURCE_SHA": "0" * 40})
        self.assertEqual(r.returncode, 78)
        self.assertIn("INVALID_BINDING_INPUT", r.stderr)
        src = open(path, encoding="utf-8").read()
        # The full branch is shared with selected-full since 76457a64 (selected full-depth execution); it still refuses fewer than 15 cases.
        self.assertIn("if FULL or SELECTED_FULL:", src)
        self.assertIn("if FULL and (sorted(BP_EST) != list(range(1, 16)) or SELECTED != list(range(1, 16)))", src)
        self.assertNotIn("sampleMode'] = 'minimal'\n        if FULL", src)
        self.assertNotIn("\"BP_MODE\": \"minimal\"", open(os.path.join(ROOT, "scripts", "run_env.py"), encoding="utf-8").read())


class Completeness(unittest.TestCase):
    def results(self, req, ex=None, drop=()):
        cat = catalog()
        cases = []
        for cid, spec in cat["cases"].items():
            if cid in drop:
                continue
            cases.append({"caseId": cid, "assertions": [{"id": a, "result": (ex or {}).get((cid, a), "PASS")} for a in spec["requiredAssertions"]]})
        sha = req["release"]["testedSha"]
        ident = {"result": "MATCH", "servedSha": sha, "expectedSha": sha}
        for c in cases:
            c["identityBefore"], c["identityAfter"] = dict(ident), dict(ident)
        return {"campaignId": req["runId"], "sourceSha": sha, "servedSha": sha, "finalIdentity": "MATCH", "safetyStopped": False, "cases": cases}

    def test_every_row_executed_in_full_mode_is_a_full_live_run(self):
        req = r7()
        out = CC.assess(req, catalog(), self.results(req))
        self.assertTrue(out["fullLiveRun"])
        self.assertEqual((out["kind"], out["rowsExecuted"]), ("FULL", 204))

    def test_a_fail_is_executed_a_not_run_is_not(self):
        req = r7()
        out = CC.assess(req, catalog(), self.results(req, {("AHT-02", "owner-bound"): "FAIL"}))
        self.assertTrue(out["fullLiveRun"])
        out = CC.assess(req, catalog(), self.results(req, {("AHT-02", "owner-bound"): "NOT RUN"}))
        self.assertFalse(out["fullLiveRun"])
        self.assertEqual(out["kind"], "FULL-INCOMPLETE")
        self.assertEqual(out["missing"][0]["case"], "AHT-02")

    def test_an_approved_omission_stays_visible_as_incomplete_coverage_never_a_full_pass(self):
        req = r7(); req["approvedOmissions"] = [{"case": "AHT-02", "assertion": "owner-bound", "reason": "named", "approvalRef": "owner-1"}]
        out = CC.assess(req, catalog(), self.results(req, {("AHT-02", "owner-bound"): "NOT RUN"}))
        self.assertFalse(out["fullLiveRun"])
        self.assertFalse(out["coverageComplete"])
        self.assertEqual(out["kind"], "FULL-INCOMPLETE (approved omissions)")
        self.assertEqual(out["rowsExecuted"], 203)
        self.assertEqual(out["approvedOmissionsApplied"][0]["approvalRef"], "owner-1")
        self.assertIn("1 approved omission", out["statement"])
        self.assertIn("203 of 204", out["statement"])
        self.assertTrue(any("not a full 204-row pass" in r for r in out["reasons"]))

    def test_an_omission_without_an_approval_does_not_count(self):
        req = r7(); req["approvedOmissions"] = [{"case": "AHT-02", "assertion": "owner-bound", "reason": "named"}]
        self.assertFalse(CC.assess(req, catalog(), self.results(req, {("AHT-02", "owner-bound"): "NOT RUN"}))["fullLiveRun"])

    def test_a_missing_journey_a_safety_stop_or_foreign_results_are_never_full(self):
        req = r7()
        self.assertFalse(CC.assess(req, catalog(), self.results(req, drop=("AHT-15",)))["fullLiveRun"])
        res = self.results(req); res["safetyStopped"] = True
        self.assertFalse(CC.assess(req, catalog(), res)["fullLiveRun"])
        res = self.results(req); res["campaignId"] = "R5-other"
        self.assertTrue(any("not to this request" in r for r in CC.assess(req, catalog(), res)["reasons"]))
        res = self.results(req); res["sourceSha"] = "1" * 40
        self.assertFalse(CC.assess(req, catalog(), res)["fullLiveRun"])

        # The retained binding verifier is an independent boundary: artifacts from a
        # different campaign or served release must fail even when sourceSha matches.
        with tempfile.TemporaryDirectory(prefix="run-binding-") as td:
            root = os.path.realpath(td)
            plan_path = os.path.join(root, "plan.json")
            result_path = os.path.join(root, "results.json")
            approval_path = os.path.join(root, "approval.json")
            manifest_path = os.path.join(root, "CODE.sha256")
            cases_dir = os.path.join(root, "cases")
            os.mkdir(cases_dir)
            open(manifest_path, "w", encoding="utf-8").close()
            plan = {"campaignId": "R7", "sourceSha": "a" * 40, "servedSha": "b" * 40, "cases": []}
            approval = {"reviewedCodeManifestSha256": sha256_file(manifest_path)}
            wjson(plan_path, plan); wjson(approval_path, approval)

            def verify(result, selected_plan=None):
                wjson(plan_path, selected_plan or plan)
                wjson(result_path, result)
                out = os.path.join(root, "binding.json")
                proc = subprocess.run([
                    sys.executable, "-I", os.path.join(ROOT, "scripts", "verify_run_binding.py"),
                    "--plan", plan_path, "--case-results", result_path,
                    "--approval", approval_path, "--code-manifest", manifest_path,
                    "--packet-root", root, "--cases-dir", cases_dir, "--out", out,
                ], capture_output=True, text=True, timeout=15)
                return proc, json.load(open(out, encoding="utf-8"))

            matching = {"campaignId": "R7", "sourceSha": "a" * 40, "servedSha": "b" * 40, "cases": []}
            proc, receipt = verify(matching)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertEqual(next(c for c in receipt["checks"] if c["id"] == "campaign")["result"], "PASS")
            for field, value in (("campaignId", "R7-other"), ("sourceSha", "c" * 40), ("servedSha", "c" * 40)):
                foreign = dict(matching); foreign[field] = value
                proc, receipt = verify(foreign)
                self.assertNotEqual(proc.returncode, 0)
                self.assertEqual(next(c for c in receipt["checks"] if c["id"] == "campaign")["result"], "FAIL")

            invalid_values = {
                "campaignId": (None, "", "\n", 7),
                "sourceSha": (None, "", "g" * 40, 7),
                "servedSha": (None, "", "b" * 39, 7),
            }
            for side in ("plan", "result"):
                for field, values in invalid_values.items():
                    for value in values:
                        candidate_plan, candidate_result = dict(plan), dict(matching)
                        (candidate_plan if side == "plan" else candidate_result)[field] = value
                        proc, receipt = verify(candidate_result, candidate_plan)
                        self.assertNotEqual(proc.returncode, 0, f"{side} {field} accepted {value!r}")
                        self.assertEqual(next(c for c in receipt["checks"] if c["id"] == "campaign")["result"], "FAIL")
                    candidate_plan, candidate_result = dict(plan), dict(matching)
                    del (candidate_plan if side == "plan" else candidate_result)[field]
                    proc, receipt = verify(candidate_result, candidate_plan)
                    self.assertNotEqual(proc.returncode, 0, f"{side} {field} accepted missing identity")
                    self.assertEqual(next(c for c in receipt["checks"] if c["id"] == "campaign")["result"], "FAIL")
            # Direct regression for the equality-only defect: the same invalid
            # value (including absence) on both sides must not become a match.
            for field, values in invalid_values.items():
                for value in values:
                    candidate_plan, candidate_result = dict(plan), dict(matching)
                    candidate_plan[field] = value; candidate_result[field] = value
                    proc, receipt = verify(candidate_result, candidate_plan)
                    self.assertNotEqual(proc.returncode, 0, f"paired {field} accepted {value!r}")
                    self.assertEqual(next(c for c in receipt["checks"] if c["id"] == "campaign")["result"], "FAIL")
                candidate_plan, candidate_result = dict(plan), dict(matching)
                del candidate_plan[field]; del candidate_result[field]
                proc, receipt = verify(candidate_result, candidate_plan)
                self.assertNotEqual(proc.returncode, 0, f"paired {field} accepted missing identities")
                self.assertEqual(next(c for c in receipt["checks"] if c["id"] == "campaign")["result"], "FAIL")

    def test_each_case_receipt_binds_case_source_and_served_identities_to_the_plan(self):
        with tempfile.TemporaryDirectory(prefix="case-binding-") as td:
            root = os.path.realpath(td)
            source_sha, served_sha = "a" * 40, "b" * 40
            plan_path = os.path.join(root, "plan.json")
            result_path = os.path.join(root, "results.json")
            approval_path = os.path.join(root, "approval.json")
            manifest_path = os.path.join(root, "CODE.sha256")
            cases_dir = os.path.join(root, "cases")
            case_dir = os.path.join(cases_dir, "AHT-01")
            driver_path = os.path.join(root, "driver.cjs")
            config_path = os.path.join(root, "AHT-01.json")
            os.makedirs(case_dir)
            open(manifest_path, "w", encoding="utf-8").close()
            open(driver_path, "w", encoding="utf-8").write("module.exports = {}\n")
            wjson(config_path, {"caseId": "AHT-01"})
            plan = {
                "campaignId": "R7",
                "sourceSha": source_sha,
                "servedSha": served_sha,
                "cases": [{
                    "id": "AHT-01",
                    "driverFile": driver_path,
                    "driverSha256": sha256_file(driver_path),
                    "configFile": config_path,
                    "configSha256": sha256_file(config_path),
                }],
            }
            campaign = {
                "campaignId": "R7",
                "sourceSha": source_sha,
                "servedSha": served_sha,
                "cases": [{"caseId": "AHT-01"}],
            }
            approval = {"reviewedCodeManifestSha256": sha256_file(manifest_path)}
            matching = {"caseId": "AHT-01", "sourceSha": source_sha, "servedSha": served_sha, "evidenceDigests": {}}
            wjson(plan_path, plan); wjson(result_path, campaign); wjson(approval_path, approval)

            def verify(case_receipt):
                wjson(os.path.join(case_dir, "case-result.json"), case_receipt)
                out = os.path.join(root, "binding.json")
                proc = subprocess.run([
                    sys.executable, "-I", os.path.join(ROOT, "scripts", "verify_run_binding.py"),
                    "--plan", plan_path, "--case-results", result_path,
                    "--approval", approval_path, "--code-manifest", manifest_path,
                    "--packet-root", root, "--cases-dir", cases_dir, "--out", out,
                ], capture_output=True, text=True, timeout=15)
                return proc, json.load(open(out, encoding="utf-8"))

            proc, receipt = verify(matching)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertEqual(next(c for c in receipt["checks"] if c["id"] == "case.AHT-01.identity")["result"], "PASS")

            invalid = [
                {**matching, "caseId": "AHT-02"},
                {**matching, "sourceSha": served_sha, "servedSha": source_sha},
            ]
            for field in ("caseId", "sourceSha", "servedSha"):
                for value in (None, "", "g" * 40, 7):
                    candidate = dict(matching); candidate[field] = value
                    invalid.append(candidate)
                candidate = dict(matching); del candidate[field]
                invalid.append(candidate)
            for candidate in invalid:
                proc, receipt = verify(candidate)
                self.assertNotEqual(proc.returncode, 0, candidate)
                self.assertEqual(next(c for c in receipt["checks"] if c["id"] == "case.AHT-01.identity")["result"], "FAIL")

    def test_missing_case_directory_requires_explicit_prestart_state_and_no_execution_receipt(self):
        with tempfile.TemporaryDirectory(prefix="case-dispatch-binding-") as td:
            root = os.path.realpath(td)
            plan_path = os.path.join(root, "plan.json")
            result_path = os.path.join(root, "results.json")
            approval_path = os.path.join(root, "approval.json")
            manifest_path = os.path.join(root, "CODE.sha256")
            cases_dir = os.path.join(root, "cases"); os.mkdir(cases_dir)
            open(manifest_path, "w", encoding="utf-8").close()
            source_sha, served_sha = "a" * 40, "b" * 40
            wjson(plan_path, {"campaignId": "R7", "sourceSha": source_sha, "servedSha": served_sha,
                              "cases": [{"id": "AHT-%02d" % n} for n in range(1, 10)]})
            wjson(result_path, {"campaignId": "R7", "sourceSha": source_sha, "servedSha": served_sha, "cases": [
                {"caseId": "AHT-01", "result": "FAIL", "reason": "driver failed", "executionReceipt": {}, "assertions": []},
                {"caseId": "AHT-02", "result": "NOT RUN", "reason": "invalidated after execution",
                 "executionInvalid": True, "executionReceipt": {"summarySha256": "1" * 64}, "assertions": []},
                {"caseId": "AHT-03", "result": "NOT RUN", "reason": "not selected", "notSelected": True,
                 "requestsUsed": 0, "assertions": []},
                {"caseId": "AHT-04", "result": "NOT RUN", "reason": "gate blocked", "gateBlocked": True,
                 "requestsUsed": 0, "assertions": []},
                {"caseId": "AHT-05", "result": "NOT RUN", "reason": "budget skipped", "requestBudgetSkipped": True,
                 "assertions": []},
                {"caseId": "AHT-06", "result": "NOT RUN", "notSelected": True, "gateBlocked": "true",
                 "requestsUsed": 0, "assertions": []},
                {"caseId": "AHT-07", "result": "NOT RUN", "notSelected": True, "requestsUsed": False,
                 "assertions": []},
                {"caseId": "AHT-08", "result": "NOT RUN", "notSelected": True, "requestsUsed": 0,
                 "executionInvalid": True, "assertions": []},
                {"caseId": "AHT-09", "result": "NOT RUN", "notSelected": True, "requestsUsed": 0,
                 "assertions": [{"id": "executed", "result": "PASS"}]},
            ]})
            wjson(approval_path, {"reviewedCodeManifestSha256": sha256_file(manifest_path)})
            out = os.path.join(root, "binding.json")
            proc = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "verify_run_binding.py"),
                "--plan", plan_path, "--case-results", result_path, "--approval", approval_path,
                "--code-manifest", manifest_path, "--packet-root", root, "--cases-dir", cases_dir, "--out", out],
                capture_output=True, text=True, timeout=15)
            self.assertNotEqual(proc.returncode, 0)
            checks = {row["id"]: row["result"] for row in json.load(open(out, encoding="utf-8"))["checks"]}
            self.assertEqual(checks["case.AHT-01.dir"], "FAIL", "a reason plus even an empty execution receipt cannot bypass evidence")
            self.assertEqual(checks["case.AHT-02.dir"], "FAIL", "an invalidated dispatched case still needs its original evidence")
            self.assertEqual(checks["case.AHT-03.dir"], "PASS", "a selected-plan row explicitly marked pre-start and undispatched remains exempt")
            self.assertEqual(checks["case.AHT-04.dir"], "PASS", "a genuine gate-blocked row remains exempt")
            self.assertEqual(checks["case.AHT-05.dir"], "PASS", "a genuine budget-skipped row may omit requestsUsed")
            for case_id in ("AHT-06", "AHT-07", "AHT-08", "AHT-09"):
                self.assertEqual(checks["case." + case_id + ".dir"], "FAIL", case_id)

    def test_a_partial_run_is_never_the_full_live_run_even_with_every_row_executed(self):
        req = sample()["req"]
        out = CC.assess(req, catalog(), self.results(req))
        self.assertFalse(out["fullLiveRun"])
        self.assertEqual(out["kind"], "PARTIAL")

    def test_the_sealed_synthetic_r5_results_are_reported_as_partial(self):
        # Declared: R5 executed every row except 9 of AHT-05's 10 and AHT-12 rows 2 and 3, so 204 - 9 - 2 = 193 executed and 11 missing.
        with open(os.path.join(RECEIPTS, "R5", "case-results.json"), encoding="utf-8") as f:
            out = CC.assess(r7(), catalog(), json.load(f))
        self.assertFalse(out["fullLiveRun"])
        self.assertEqual(out["rowsExecuted"], 204 - 9 - 2)
        self.assertEqual(len(out["missing"]), 9 + 2)

    def test_no_results_is_no_run(self):
        self.assertEqual(CC.assess(r7(), catalog(), None)["kind"], "NO RUN")

    def test_an_unexpected_row_is_reported(self):
        req = r7(); res = self.results(req); res["cases"][0]["assertions"].append({"id": "surprise", "result": "PASS"})
        out = CC.assess(req, catalog(), res)
        self.assertEqual(out["unexpectedRows"], [{"case": "AHT-01", "assertion": "surprise"}])


class ReadyNeedsAFullLiveRun(unittest.TestCase):
    def test_carried_forward_or_partial_results_never_make_ready(self):
        import test_pipeline_and_report as T
        t = T.SummaryRules
        t.setUpClass()
        inst = t("test_ready_only_when_everything_holds")
        latest = inst.latest(inst.all_pass())
        import derive_summary as DS
        req = copy.deepcopy(inst.req); req["targetedGaps"] = ["GAP-03"]; req["selection"] = [{"case": "AHT-12"}]
        partial = {"fullLiveRun": False, "kind": "PARTIAL", "statement": "92 of 204 required rows executed"}
        full = {"fullLiveRun": True, "kind": "FULL", "statement": "204 of 204 required rows executed"}
        args = (inst.cmp, latest, inst.ld(["CLOSED"] * 6), inst.rv(), inst.gates(True), inst.sp(), inst.wf, req, 180)
        safe = {"alerts": inst.SAFE_ALERTS, "isolation": inst.SAFE_ISO}
        f = DS.derive(*args, coverage=partial, **safe)
        self.assertEqual(f["status"], "LIMITED")
        self.assertIn("not a full live run", f["readiness"])
        f = DS.derive(*args, coverage=None, **safe)
        self.assertEqual(f["status"], "LIMITED")
        f = DS.derive(*args, coverage=full, **safe)
        self.assertEqual((f["status"], f["recommendation"]), ("READY", "PROCEED"))
        self.assertIn("204 of 204", f["readiness"])


class StartsAndTakesAreRecordedForAFinishedRun(unittest.TestCase):
    """Self-review defect: collect_run_record read startPresses/takes from case results that never carry them, so Starts and takes were always null and no run
    ever consumed the cumulative Starts/takes caps. They are now counted from each case's action-reservations.jsonl.
    Synthetic history: every journey logs 1 Start and 1 take, so each full run has 15 and 15; owner counters 30/30 through R5, Starts cap 50."""
    def test_sealed_runs_are_counted_from_their_reservation_logs(self):
        self.assertEqual(DC.count_actions(os.path.join(RECEIPTS, "R4C")), {"starts": 15, "takes": 15})
        self.assertEqual(DC.count_actions(os.path.join(RECEIPTS, "R5")), {"starts": 15, "takes": 15})

    def test_no_reservation_log_is_null_never_zero(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "AHT-01"))
            self.assertIsNone(DC.count_actions(d))
            self.assertIsNone(DC.count_actions(os.path.join(d, "missing")))

    def test_the_spend_report_uses_them_for_a_sealed_latest_run(self):
        import shutil
        import reconcile_cumulative as RC
        import spend_report as S
        with tempfile.TemporaryDirectory() as d:
            for lab in ("R4", "R4B", "R4C", "R5"):
                shutil.copytree(os.path.join(RECEIPTS, lab), os.path.join(d, lab))
            shutil.copytree(os.path.join(d, "R5"), os.path.join(d, "R6T"))
            cfg = copy.deepcopy(synthetic_history().cfg); cfg["history"]["runs"].append({"label": "R6T", "campaignId": "R6T", "servedSha": "x", "ledgersOnly": False})
            rc = RC.reconcile(cfg, copy.deepcopy(synthetic_history().counters_doc), d)
            req = r7()
            out = S.build(req, cfg, rc, None, None, None, "R6T", d)
            self.assertEqual((out["starts"]["actual"], out["takes"]["actual"]), (15, 15))
            self.assertEqual(out["remainingAfterRun"]["starts"], 50 - 30 - 15)
            self.assertIn("afterRunWithIdentityReadsAsRequests", out["countedOnce"])

    def test_more_starts_than_estimated_is_over_cap(self):
        import shutil
        import reconcile_cumulative as RC
        import spend_report as S
        with tempfile.TemporaryDirectory() as d:
            for lab in ("R4", "R4B", "R4C", "R5"):
                shutil.copytree(os.path.join(RECEIPTS, lab), os.path.join(d, lab))
            cfg = copy.deepcopy(synthetic_history().cfg)
            rc = RC.reconcile(cfg, copy.deepcopy(synthetic_history().counters_doc), d)
            req = r7(); req["estimate"]["starts"] = 10
            rr = {"spend": {"requests": 15 * 170, "byCategory": {"signed-in": 15 * 50, "coaching": 15 * 10}, "identityReads": 32, "starts": 15, "takes": 15}}
            out = S.build(req, cfg, rc, rr, None, None, None, d)
            self.assertFalse(out["withinCap"])

    def test_the_collector_counts_them_from_the_cases_directory(self):
        import shutil
        with tempfile.TemporaryDirectory() as d:
            d = os.path.realpath(d)
            led = os.path.join(d, "ledgers"); os.makedirs(led)
            shutil.copy(os.path.join(RECEIPTS, "R5", "campaign-ledger.json"), led); shutil.copy(os.path.join(RECEIPTS, "R5", "identity-ledger.json"), led)
            gs = os.path.join(d, "g.json"); wjson(gs, {"decision": "GO"})
            rj = os.path.join(d, "runner.json"); wjson(rj, {})
            request_doc = r7(); request_doc["runId"] = "R5"
            req = os.path.join(d, "req.json"); wjson(req, request_doc)
            request_sha256 = sha256_file(req)
            case_results_doc = json.load(open(os.path.join(RECEIPTS, "R5", "case-results.json")))
            for case in case_results_doc["cases"]:
                case["executionReceipt"] = {
                    "schema": "speaksharp.cloud-test.case-execution-receipt.v1",
                    "campaignId": "R5", "runId": "41325698722", "attempt": 1,
                    "caseId": case["caseId"], "requestSha256": request_sha256,
                    "planSha256": "1" * 64, "configSha256": "2" * 64,
                    "sourceSha": case_results_doc["sourceSha"], "servedSha": case_results_doc["servedSha"],
                    "runtimeStartReceiptSha256": "3" * 64,
                    "summarySha256": case["executionReceipt"]["summarySha256"],
                }
            case_results = os.path.join(d, "case-results.json"); wjson(case_results, case_results_doc)
            out = os.path.join(d, "rr.json")
            r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "collect_run_record.py"), "--request", req,
                                "--request-sha256", request_sha256, "--execution-run-id", "41325698722", "--attempt", "1",
                                "--case-results", case_results, "--cases-dir", os.path.join(RECEIPTS, "R5"),
                                "--ledger-dir", led, "--gate-status", gs, "--workflow", os.path.join(ROOT, "workflow.json"), "--runner-json", rj, "--out", out], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            rec = json.load(open(out))
            self.assertEqual((rec["spend"]["starts"], rec["spend"]["takes"]), (15, 15))


class GeneratedProposalRendering(unittest.TestCase):
    """Renderer controls use synthetic inputs, not absent private operational docs.

    These do not certify an archived FULL-COVERAGE-PROPOSAL or authorize a run.
    The request-versus-current-derivation check remains separate below.
    """
    @classmethod
    def setUpClass(cls):
        cls.cat = catalog()
        rows = []
        for cid, spec in cls.cat["cases"].items():
            rows.append({"case": cid, "requests": {"total": 160, "byCategory": {
                "public": 10, "navigations": 5, "preflight": 20, "auth": 30,
                "signed-in": 40, "model": 50, "coaching": 10}},
                "rows": {"executed": len(spec["requiredAssertions"]), "total": len(spec["requiredAssertions"])},
                "startsPressed": spec["minimumStarts"], "takesSaved": spec["minimumTakes"],
                "wallSeconds": 60, "lowerBound": False})
        run = {"campaignId": "SYNTHETIC-OFFLINE-NO-AUTHORITY", "cases": rows,
               "reconciliation": {"ok": True, "ledgerTotal": 2400, "sumOfCases": 2400},
               "totals": {"requests": 2400, "startsPressed": 42, "takesSaved": 31,
                          "rowsExecuted": 204, "rowsTotal": 204, "runWallSeconds": 900,
                          "byCategory": {"coaching": 150}}}
        cls.synthetic_costs = {"runs": {"R4C": copy.deepcopy(run), "R5": copy.deepcopy(run)}}
        cls.b = FB.with_sensitivity(sample()["cfg"], cls.synthetic_costs, cls.cat, reconciliation())

    def test_budget_renderer_keeps_independent_synthetic_arithmetic(self):
        # 15 x 160 + 150 cleanup + 15% pooled slack = 2910.
        self.assertEqual(self.b["requests"]["runCap"], 2910)
        self.assertEqual(self.b["cumulative"]["requiredCeiling"], 9135)
        text = FB.markdown(self.b)
        self.assertIn("2400 estimates + 150 cleanup + 360 slack = 2910", text)
        self.assertIn("5529 used + 2910 run cap + 664 protected reserve + 32 identity reads = 9135", text)
        self.assertEqual(sum(line.startswith("| AHT-") for line in text.splitlines()), 15)
        for cid, spec in self.cat["cases"].items():
            n = len(spec["requiredAssertions"])
            self.assertIn("| %s | 60 | 100 | %d/%d | 1.00 | 160 | 200 | 40 |" % (cid, n, n), text)

    def test_cost_renderer_preserves_categories_and_mismatch_warning(self):
        text = DC.markdown(self.synthetic_costs)
        self.assertIn("SYNTHETIC-OFFLINE-NO-AUTHORITY", text)
        self.assertIn("| AHT-01 | 160 | 10 | 5 | 20 | 30 | 40 | 50 | 10 |", text)
        self.assertIn("Totals: 2400 requests, 42 Starts, 31 takes, 204 of 204 rows executed", text)
        changed = copy.deepcopy(self.synthetic_costs)
        changed["runs"]["R5"]["reconciliation"]["ok"] = False
        self.assertIn("Reconciliation to the campaign ledger: MISMATCH", DC.markdown(changed))

    def test_renderer_retains_non_authority_and_unknown_costs(self):
        text = FB.markdown(self.b)
        for needle in ("PROPOSAL - not approved", "Nothing here raises a ceiling, authorizes a run", "UNKNOWN", "paid actions $0"):
            self.assertIn(needle, text)
        changed = copy.deepcopy(self.b)
        changed["requests"]["arithmetic"] = "SYNTHETIC CHANGED ARITHMETIC"
        self.assertNotIn("2400 estimates + 150 cleanup + 360 slack = 2910", FB.markdown(changed))

    def test_action_shortfalls_are_reported_when_synthetic_usage_exceeds_caps(self):
        rc = reconciliation()
        rc["starts"]["ownerCounted"], rc["takes"]["ownerCounted"] = 11, 10
        b = FB.compute(sample()["cfg"], self.synthetic_costs, self.cat, rc)
        self.assertEqual((b["actions"]["startsRequired"], b["actions"]["startsShortfall"]), (53, 3))
        self.assertEqual((b["actions"]["takesRequired"], b["actions"]["takesShortfall"]), (41, 1))
        self.assertEqual(b["actions"]["ownerDecision"], "required")



class FullModePipeline(unittest.TestCase):
    def test_the_control_plane_reports_the_full_proposal_without_approving_it(self):
        repo = os.environ.get("CT_TEST_REPO") or os.path.abspath(os.path.join(ROOT, "..", ".."))
        from _fixtures import prerequisite
        prerequisite(subprocess.run(["git", "-C", repo, "rev-parse", "--is-inside-work-tree"], capture_output=True, text=True).stdout.strip() == "true", "git history")
        with tempfile.TemporaryDirectory() as d:
            # A synthetic, unapproved proposal over the synthetic history and owner counters (inputs.v1.json): conservative used 5840 (5800 measured
            # + 40 unexplained), so the ceiling is 5840 + 3430 + 664 + 32 = 9966; Starts 30 owned + 42 planned = 72 and takes 30 + 31 = 61 exceed
            # the synthetic caps 50/40, so both increases are proposed with their justification. NO LIVE APPROVAL.
            h = synthetic_history()
            proposal = full_request()
            proposal["proposedLimits"].update(cumulativeCeilingRequests=5840 + 3430 + 664 + 32, startsCap=30 + 42, takesCap=30 + 31,
                                              ceilingIncreaseJustification="SYNTHETIC TEST ONLY: 5840 + 3430 + 664 + 32 = 9966; NO LIVE APPROVAL",
                                              startsIncreaseJustification="SYNTHETIC TEST ONLY: 30 owned + 42 planned; NO LIVE APPROVAL",
                                              takesIncreaseJustification="SYNTHETIC TEST ONLY: 30 owned + 31 planned; NO LIVE APPROVAL")
            source = os.path.join(d, "proposal.json"); wjson(source, proposal)
            request = h.request(source)
            out = os.path.join(d, "out")
            r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "pipeline.py"), "--request", request, "--out-dir", out,
                                "--repo", repo, "--generated-at", "2026-10-29T01:00:00Z", *h.args()], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout[-800:] + r.stderr[-800:])
            gates = json.load(open(os.path.join(out, "gate-status.json")))
            self.assertEqual(gates["decision"], "NO-GO")
            self.assertIn("G5", gates["blockingOpen"])
            self.assertEqual(json.load(open(os.path.join(out, "coverage.json")))["kind"], "NO RUN")
            self.assertTrue(json.load(open(os.path.join(out, "request-validation.json")))["valid"])
            self.assertTrue(json.load(open(os.path.join(out, "report/validation.json")))["valid"])
            report = json.load(open(os.path.join(out, "report/report.json")))
            self.assertEqual(report["status"], "BLOCKED")
            self.assertEqual(report["executiveSummary"]["fields"]["recommendation"], "HOLD")
            attestation = json.load(open(os.path.join(out, "preflight-attestation.json")))
            self.assertEqual(attestation["productHostsContacted"], 0)
            self.assertEqual(attestation["networkAttempts"], 0)
            html = open(os.path.join(out, "report", "REPORT.html"), encoding="utf-8").read()
            self.assertIn("Full-coverage budget (proposal, not approved)", html)
            self.assertIn("Run kind and assertion coverage", html)
            self.assertTrue(json.load(open(os.path.join(out, "report", "validation.json")))["valid"])
            self.assertEqual(json.load(open(os.path.join(out, "summary.json")))["fields"]["status"], "BLOCKED")


if __name__ == "__main__":
    unittest.main()
