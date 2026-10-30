#!/usr/bin/env python3
"""The exact full-coverage calculation: per-case request estimates, ceilings, failure and cleanup allowances, pooled slack, run cap, the cumulative
ceiling and identity cap the run would need, Starts and takes against their cumulative caps, the coaching cap, the run window and the dollar picture.
Everything is computed from three derived inputs (no typed figures): the per-case costs of the sealed R4C/R5 guard logs (derive_case_costs.py), the
assertion catalog of the vendored harness contract (derive_assertion_catalog.py) and the reconciled cumulative usage (reconcile_cumulative.py), plus the
model parameters in config modes.full.budgetModel. The result is a PROPOSAL for the Product Owner: it never approves, raises or spends anything.

Model (stated so it can be challenged):
  A case's observed requests split into FIXED overhead (public + preflight + auth: app load, readiness and sign-in) and VARIABLE work (signed-in + model +
  coaching: the journey itself). Neither sealed run executed every assertion row, so each observed count is a LOWER BOUND for executing every row.
  estimate(case) = ceil10( max over basis runs of fixed  +  max over basis runs of variable * min(cap, rows_total / max rows executed in a basis run) )
  ceiling(case)  = the reviewed plan builder rule: estimate * allowancePct / 100, rounded up to the next 10 (this is the failure allowance for one case)
  cleanup reserve = cleanupReservePerCase * cases; pooled slack = ceil10(pooledSlackPct% of the sum of estimates); run cap = estimates + cleanup + slack.
Usage: full_coverage_budget.py --config C.json --costs costs.json --catalog assertion-catalog.json --reconciliation rc.json --out calc.json [--markdown calc.md]"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import load, dump  # noqa: E402


def ceil10(v):
    return int(-(-v // 10) * 10)


def harness_ceiling(est, pct):
    return ((est * pct + 99) // 100 + 9) // 10 * 10


def _case(costs, run, cid):
    return next(c for c in costs["runs"][run]["cases"] if c["case"] == cid)


def per_case(cfg, costs, catalog, cap_override=None):
    m = cfg["modes"]["full"]
    bm = m["budgetModel"]
    cap = bm["variableUpliftCap"] if cap_override is None else cap_override
    rows = []
    for n in range(1, 16):
        cid = "AHT-%02d" % n
        obs = [_case(costs, r, cid) for r in bm["basisRuns"]]
        fixed = max(o["requests"]["byCategory"]["public"] + o["requests"]["byCategory"]["preflight"] + o["requests"]["byCategory"]["auth"] for o in obs)
        var = max(o["requests"]["byCategory"]["signed-in"] + o["requests"]["byCategory"]["model"] + o["requests"]["byCategory"]["coaching"] for o in obs)
        total = len(catalog["cases"][cid]["requiredAssertions"])
        ex = max(o["rows"]["executed"] for o in obs)
        factor = 1.0 if ex >= total else min(cap, total / max(ex, 1))
        est = ceil10(math.ceil(fixed + var * factor))
        wall_obs = max(o["wallSeconds"] for o in obs)
        max_ms = m["caseMaxMs"][cid]
        rows.append({"case": cid, "fixedObserved": fixed, "variableObserved": var, "rowsRequired": total, "rowsExecutedBestObserved": ex, "uplift": round(factor, 3),
                     "upliftCapped": factor == cap and total / max(ex, 1) > cap, "estimate": est, "ceiling": harness_ceiling(est, bm["allowancePct"]),
                     "failureAllowance": harness_ceiling(est, bm["allowancePct"]) - est, "startsMin": catalog["cases"][cid]["minimumStarts"],
                     "takesMin": catalog["cases"][cid]["minimumTakes"], "wallObservedMaxSeconds": round(wall_obs),
                     "expectedWallSeconds": int(min(max_ms / 1000, wall_obs * factor)), "maxWallSeconds": max_ms // 1000})
    return rows


def compute(cfg, costs, catalog, rc, cap_override=None):
    m = cfg["modes"]["full"]
    bm = m["budgetModel"]
    rows = per_case(cfg, costs, catalog, cap_override)
    planned = sum(r["estimate"] for r in rows)
    cleanup = bm["cleanupReservePerCase"] * len(rows)
    slack = ceil10(math.ceil(planned * bm["pooledSlackPct"] / 100))
    run_cap = planned + cleanup + slack
    ids = 2 * len(rows) + 2
    cur = rc["ceilings"]
    used = rc["requests"]["conservativeUsed"]
    required = used + run_cap + cur["protectedReserveRequests"] + ids
    starts_used, takes_used = rc["starts"]["ownerCounted"], rc["takes"]["ownerCounted"]
    starts_min, takes_min = catalog["minimumStarts"], catalog["minimumTakes"]
    coaching_cap = ceil10(math.ceil(takes_min * (100 + bm["coachingRetryAllowancePct"]) / 100))
    adm = m["window"]
    expected_min = adm["admissionExpectedMinutes"] + sum(r["expectedWallSeconds"] for r in rows) / 60 + adm["interCaseAndReportMinutes"]
    worst_min = adm["admissionMaxMinutes"] + sum(r["maxWallSeconds"] for r in rows) / 60 + adm["cleanupReserveMinutes"]
    window = int(math.ceil(worst_min / 30.0) * 30)
    dollars = cfg["costModel"]
    cb = dollars["githubActions"]
    gh_max = cb["dispatches"] * cb["maxRunnerMinutesPerDispatch"]
    return {
        "schema": "speaksharp.cloud-test.full-coverage-budget.v1", "derived": True, "status": "PROPOSAL - NOT APPROVED",
        "approvalNote": "Every limit below is a proposal for the Product Owner's decision. Nothing here raises a ceiling, authorizes a run, window or spend.",
        "model": {"basisRuns": bm["basisRuns"], "parameters": bm, "uplift": "variable work scaled by min(cap, rows required / best rows executed in a basis run); fixed overhead unscaled",
                  "limitation": "R4C and R5 executed %d and %d of %d rows; every observed count is a lower bound for executing every row, so the estimate is an extrapolation that the first full run replaces with measurement." % (
                      costs["runs"]["R4C"]["totals"]["rowsExecuted"], costs["runs"]["R5"]["totals"]["rowsExecuted"], catalog["totalAssertions"])},
        "perCase": rows,
        "requests": {"plannedSumOfEstimates": planned, "cleanupReserve": cleanup, "pooledSlack": slack, "runCap": run_cap, "sumOfCaseCeilings": sum(r["ceiling"] for r in rows),
                     "perCaseFailureAllowanceTotal": sum(r["failureAllowance"] for r in rows), "allowancePct": bm["allowancePct"],
                     "arithmetic": "%d estimates + %d cleanup + %d slack = %d" % (planned, cleanup, slack, run_cap)},
        "cumulative": {"conservativeUsed": used, "runCap": run_cap, "protectedReserve": cur["protectedReserveRequests"], "identityReads": ids, "requiredCeiling": required,
                       "currentCeiling": cur["requests"], "increase": max(0, required - cur["requests"]),
                       "arithmetic": "%d used + %d run cap + %d protected reserve + %d identity reads = %d" % (used, run_cap, cur["protectedReserveRequests"], ids, required),
                       "ownerDecision": "required: the ceiling is %d today" % cur["requests"], "earlierProposal": 8795,
                       "earlierProposalNote": "8,795 assumed a run costs R4C's measured 2,520 requests; R4C executed only 104 of 204 rows, so that figure understated a full-coverage run"},
        "identity": {"readsThisRun": ids, "arithmetic": "2 x %d cases + 2 (admission, final)" % len(rows), "cumulativeUsed": rc["identityReads"]["conservativeUsed"],
                     "required": rc["identityReads"]["conservativeUsed"] + ids, "currentCap": cur["identityReads"], "perRunStructuralMax": m["limits"]["maxIdentityReadsPerRun"],
                     "ownerDecision": "required" if rc["identityReads"]["conservativeUsed"] + ids > cur["identityReads"] else "not required"},
        "actions": {"startsMinimum": starts_min, "startsUsed": starts_used, "startsRequired": starts_used + starts_min, "startsCap": cur["starts"],
                    "startsShortfall": max(0, starts_used + starts_min - cur["starts"]), "takesMinimum": takes_min, "takesUsed": takes_used,
                    "takesRequired": takes_used + takes_min, "takesCap": cur["takes"], "takesShortfall": max(0, takes_used + takes_min - cur["takes"]),
                    "source": "minimumAuthorizedStartPresses and minimumAuthorizedTakes of the harness contract (assertion catalog); a full-coverage run cannot execute every row with fewer",
                    "ownerDecision": "required" if (starts_used + starts_min > cur["starts"] or takes_used + takes_min > cur["takes"]) else "not required"},
        "coaching": {"cap": coaching_cap, "basis": "%d takes x %d%% retry allowance, rounded up to 10; the guard denies a coaching request beyond the cap" % (takes_min, 100 + bm["coachingRetryAllowancePct"]),
                     "measuredCoachingRequests": {"R4C": costs["runs"]["R4C"]["totals"]["byCategory"]["coaching"], "R5": costs["runs"]["R5"]["totals"]["byCategory"]["coaching"]}},
        "window": {"expectedMinutes": round(expected_min), "worstCaseMinutes": round(worst_min), "proposedWindowMinutes": window,
                   "expectedBasis": "admission %d + observed case wall time scaled by the same uplift (capped at each case's limit) + %d between cases and for the report" % (adm["admissionExpectedMinutes"], adm["interCaseAndReportMinutes"]),
                   "worstCaseBasis": "admission qualification limit %d + the sum of the %d per-case time limits (%d min) + %d cleanup reserve" % (adm["admissionMaxMinutes"], len(rows), sum(r["maxWallSeconds"] for r in rows) // 60, adm["cleanupReserveMinutes"]),
                   "measured": {"R4C": round(costs["runs"]["R4C"]["totals"]["runWallSeconds"] / 60, 1), "R5": round(costs["runs"]["R5"]["totals"]["runWallSeconds"] / 60, 1)},
                   "rule": "a case that reaches the window end is NOT RUN and the run is no longer full coverage, so the proposed window covers the worst case, not the expected case",
                   "structuralMax": m["limits"]["maxWindowMinutes"]},
        "dollars": {
            "paidActionsAuthorizedUsd": 0,
            "providerCoaching": {"billableRequestsMax": coaching_cap, "measured": "unknown", "unitCostUsd": dollars["provider"]["unitCostUsd"],
                                 "estimateUsd": None if dollars["provider"]["unitCostUsd"] is None else round(coaching_cap * dollars["provider"]["unitCostUsd"], 2),
                                 "illustrativeBounds": [{"perRequestUsd": p, "maxUsd": round(coaching_cap * p, 2)} for p in dollars["provider"]["illustrativeUnitCostsUsd"]],
                                 "statement": "provider cost per coaching request is not known to the package; at most %d requests can be billed (guard cap); the dollar figure is UNKNOWN until the owner supplies a unit cost" % coaching_cap},
            "githubActions": {"billedUsd": "unknown", "runnerMinutesMax": gh_max, "listPriceUsdPerMinute": cb["listPriceUsdPerMinute"],
                              "listPriceUpperBoundUsd": round(gh_max * cb["listPriceUsdPerMinute"], 2),
                              "statement": "%d dispatches x %d min = %d runner minutes at most; at the list price that is at most $%.2f; whether it is billed or inside included minutes is not known to the package" % (cb["dispatches"], cb["maxRunnerMinutesPerDispatch"], gh_max, gh_max * cb["listPriceUsdPerMinute"])},
            "cloudAgent": {"usd": "unknown", "statement": "the Cloud agent's own usage cost is not exposed to the package; the run window is %d min at most" % window},
            "totalStatement": "paid actions $0; provider, GitHub and Cloud-agent dollar costs are UNKNOWN (bounded counts above); no single dollar total is asserted"},
        "sensitivity": [{"upliftCap": c, "plannedSumOfEstimates": sum(r["estimate"] for r in per_case(cfg, costs, catalog, c)),
                         "runCap": None} for c in bm["sensitivityUpliftCaps"]],
    }


def with_sensitivity(cfg, costs, catalog, rc):
    out = compute(cfg, costs, catalog, rc)
    for s in out["sensitivity"]:
        sub = compute(cfg, costs, catalog, rc, s["upliftCap"])
        s["runCap"] = sub["requests"]["runCap"]
        s["requiredCeiling"] = sub["cumulative"]["requiredCeiling"]
    return out


def markdown(o):
    r, c, a, w = o["requests"], o["cumulative"], o["actions"], o["window"]
    L = ["# Full-coverage calculation (PROPOSAL - not approved)", "", o["approvalNote"], "",
         "Model: " + o["model"]["uplift"] + ". " + o["model"]["limitation"], "",
         "| Case | Fixed obs. | Variable obs. | Rows exec/required | Uplift | Estimate | Ceiling | Failure allowance | Starts min | Takes min | Expected min | Limit min |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for p in o["perCase"]:
        L.append("| %s | %d | %d | %d/%d | %.2f%s | %d | %d | %d | %d | %d | %.0f | %d |" % (p["case"], p["fixedObserved"], p["variableObserved"], p["rowsExecutedBestObserved"], p["rowsRequired"], p["uplift"], "*" if p["upliftCapped"] else "",
                                                                                         p["estimate"], p["ceiling"], p["failureAllowance"], p["startsMin"], p["takesMin"], p["expectedWallSeconds"] / 60, p["maxWallSeconds"] / 60))
    L += ["", "(* uplift limited by the cap)", "", "Requests: " + r["arithmetic"] + "; per-case ceilings sum to %d (failure allowance %d across cases, %d%% rule)." % (r["sumOfCaseCeilings"], r["perCaseFailureAllowanceTotal"], r["allowancePct"]), "",
          "Cumulative ceiling: " + c["arithmetic"] + " (current %d; increase %d; earlier proposal %d)." % (c["currentCeiling"], c["increase"], c["earlierProposal"]), "",
          "Identity reads: %d this run; cumulative %d against a cap of %d (%s)." % (o["identity"]["readsThisRun"], o["identity"]["required"], o["identity"]["currentCap"], o["identity"]["ownerDecision"]), "",
          "Starts: %d used + %d minimum = %d against a cap of %d. Takes: %d used + %d minimum = %d against a cap of %d." % (a["startsUsed"], a["startsMinimum"], a["startsRequired"], a["startsCap"], a["takesUsed"], a["takesMinimum"], a["takesRequired"], a["takesCap"]), "",
          "Coaching cap: %d (%s)." % (o["coaching"]["cap"], o["coaching"]["basis"]), "",
          "Window: expected about %d min, worst case %d min, proposed window %d min. %s" % (w["expectedMinutes"], w["worstCaseMinutes"], w["proposedWindowMinutes"], w["rule"]), "",
          "Dollars: " + o["dollars"]["totalStatement"], "- provider: " + o["dollars"]["providerCoaching"]["statement"], "- GitHub: " + o["dollars"]["githubActions"]["statement"], "- Cloud agent: " + o["dollars"]["cloudAgent"]["statement"], "",
          "| Uplift cap | Sum of estimates | Run cap | Required ceiling |", "|---|---|---|---|"]
    L += ["| %s | %d | %d | %d |" % (s["upliftCap"], s["plannedSumOfEstimates"], s["runCap"], s["requiredCeiling"]) for s in o["sensitivity"]]
    return "\n".join(L) + "\n"


def main():
    a = argparse.ArgumentParser()
    for k in ("config", "costs", "catalog", "reconciliation", "out"):
        a.add_argument("--" + k, required=True)
    a.add_argument("--markdown")
    x = a.parse_args()
    o = with_sensitivity(load(x.config), load(x.costs), load(x.catalog), load(x.reconciliation))
    dump(o, x.out)
    if x.markdown:
        with open(x.markdown, "w", encoding="utf-8") as f:
            f.write(markdown(o))
    print("full-coverage proposal: planned %d, run cap %d, required ceiling %d, window %d min (not approved)" % (o["requests"]["plannedSumOfEstimates"], o["requests"]["runCap"], o["cumulative"]["requiredCeiling"], o["window"]["proposedWindowMinutes"]))


if __name__ == "__main__":
    main()
