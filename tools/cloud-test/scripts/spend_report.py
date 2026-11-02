#!/usr/bin/env python3
"""Spend and balance (v2). Four SEPARATE accounts, none merged into another and none defaulted to zero:
  1. guarded request counts (the harness guard's ledgers: requests by category, identity reads, Starts, takes),
  2. provider cost: only the provider-billable request COUNT (coaching) is measured; dollars are UNKNOWN unless a cost record supplies them,
  3. GitHub Actions usage: observed runner minutes (job wall clock rounded up per job); billed dollars UNKNOWN unless supplied,
  4. Cloud-agent cost: UNKNOWN unless supplied.
Paid actions (payments, checkout) are authorized at $0 and reported as executed / not executed from the run record, never as a cost.
A dollar figure is accepted only from a costs file that names its source and as-of time.
Usage: spend_report.py --request R.json --config C.json --reconciliation RC.json [--run-record RR.json] [--costs costs.json] [--timings DIR] [--latest-label L] --out spend.json
Counters are FROZEN before the run (reconciliation.freeze); the latest run's actual usage is added once. With --latest-label the actual is cross-checked against the run's sealed ledger.
Exit 0 when within the cap (or nothing spent); 3 when actual spending exceeds the approved or proposed cap (stop rule S5); 4 on a malformed costs file."""
import argparse
import glob
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import load, dump, now_utc, parse_utc  # noqa: E402
from derive_case_costs import count_actions  # noqa: E402

COST_KEYS = ("cloudAgent", "provider", "githubActions")


def unknown(note):
    return {"status": "unknown", "usd": None, "note": note}


def cost_account(name, rec, usd_key):
    if not rec:
        return None
    if rec.get(usd_key) is None or not rec.get("source") or not parse_utc(rec.get("asOfUtc")):
        raise ValueError("%s: a dollar figure needs usd, source and asOfUtc" % name)
    return {"status": "reported", "usd": rec[usd_key], "source": rec["source"], "asOfUtc": rec["asOfUtc"]}


def github_minutes(timings_dir):
    if not timings_dir or not os.path.isdir(timings_dir):
        return None, []
    jobs, total = [], 0
    for f in sorted(glob.glob(os.path.join(timings_dir, "timing-*.json"))):
        t = load(f)
        s, e = parse_utc(t.get("startedUtc")), parse_utc(t.get("endedUtc"))
        if s and e and e >= s:
            m = max(1, math.ceil((e - s).total_seconds() / 60))
            jobs.append({"job": t.get("job"), "minutes": m})
            total += m
    return (total if jobs else None), jobs


def build(req, cfg, rc, rr=None, costs=None, timings_dir=None, latest_label=None, receipts_root=None):
    est = req["estimate"]
    rq = est["requests"]
    appr, prop = req.get("approvedLimits") or {}, req.get("proposedLimits") or {}
    basis = "approved" if appr.get("cumulativeCeilingRequests") is not None else "proposed (not yet approved)"
    cap = {k: (appr.get(k) if appr.get(k) is not None else prop.get(k)) for k in ("cumulativeCeilingRequests", "identityCap", "runCapRequests")}
    cur = rc["ceilings"]
    used_r, used_i = rc["requests"]["conservativeUsed"], rc["identityReads"]["conservativeUsed"]
    reserve = cur["protectedReserveRequests"]
    sp = (rr or {}).get("spend") or {}
    sealed = next((x for x in rc.get("afterFreeze", []) if x["label"] == latest_label), None) if latest_label else None
    if not sp and sealed:  # no run record: the sealed ledger is the actual (counted once)
        acts = count_actions(os.path.join(receipts_root, latest_label)) if receipts_root else None
        sp = {"requests": sealed["requests"], "byCategory": sealed["byCategory"], "identityReads": sealed["identityReads"], "starts": acts["starts"] if acts else None, "takes": acts["takes"] if acts else None}
    ran = bool(sp)
    gm, gjobs = github_minutes(timings_dir)
    costs = costs or {}
    c = {"cloudAgent": cost_account("cloudAgent", costs.get("cloudAgent"), "usd") or unknown("not measured by this package; the Cloud agent's own usage is reported by the owner from the session, not inferred"),
         "provider": cost_account("provider", costs.get("provider"), "usd") or unknown("not measured; only the provider-billable request count is known"),
         "githubActions": cost_account("githubActions", costs.get("githubActions"), "billedUsd") or unknown("billing depends on the repository's plan and is not visible to the package")}
    c["provider"]["billableRequests"] = {"coaching": {"cap": est["providerBillableRequests"]["coachingCap"], "actual": (sp.get("byCategory") or {}).get("coaching") if ran else None}}
    c["githubActions"]["observedRunnerMinutes"] = gm
    c["githubActions"]["estimateMaxRunnerMinutes"] = est.get("githubRunnerMinutesMax")
    c["githubActions"]["jobs"] = gjobs
    paid = (rr or {}).get("paidActions") if ran else None
    out = {
        "schema": "speaksharp.cloud-test.spend.v2", "runId": req["runId"], "generatedUtc": now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "purpose": req["purpose"], "priority": req["priority"], "targetedGaps": req["targetedGaps"], "capBasis": basis,
        "requests": {"estimate": {"planned": rq["planned"], "runCap": rq["runCap"]}, "cap": cap,
                     "actual": ({"total": sp.get("requests"), "byCategory": sp.get("byCategory")} if ran else None), "source": "guard campaign ledger" if ran else None,
                     "categoryNote": "categories overlap: navigations are also counted inside public, so the category figures do not sum to the total; the total is authoritative"},
        "identityReads": {"estimate": est["identityReads"], "actual": sp.get("identityReads") if ran else None},
        "starts": {"estimate": est["starts"], "actual": sp.get("starts") if ran else None},
        "takes": {"estimate": est["takes"], "actual": sp.get("takes") if ran else None},
        "paidActions": {"authorizedUsd": est["paidActionsAuthorizedUsd"], "executed": paid if ran else None,
                        "note": "payments and checkout are authorized at $0; this line says whether any was executed, and is not a cost"},
        "costs": c,
        "before": {"requestsUsedConservative": used_r, "requestsUsedMeasured": rc["requests"]["measuredFromSealedLedgers"], "unreconciledRequests": rc["requests"]["unreconciled"], "protectedReserve": reserve,
                   "identityReadsUsedConservative": used_i, "startsUsed": rc["starts"]["ownerCounted"], "takesUsed": rc["takes"]["ownerCounted"]},
        "remainingBeforeRun": {"requests": (cap["cumulativeCeilingRequests"] or cur["requests"]) - used_r - reserve, "identityReads": (cap["identityCap"] or cur["identityReads"]) - used_i,
                               "starts": cur["starts"] - rc["starts"]["ownerCounted"], "takes": cur["takes"] - rc["takes"]["ownerCounted"]},
        "remainingAfterRun": None, "withinCap": None, "status": "NOT RUN: no actual spend exists",
    }
    if ran:
        a = out["requests"]["actual"]["total"]
        ia = sp.get("identityReads")
        within = a is not None and a <= (cap["runCapRequests"] or 0) and (ia is None or ia <= est["identityReads"])
        cc = (sp.get("byCategory") or {}).get("coaching")
        if cc is not None and cc > est["providerBillableRequests"]["coachingCap"]:
            within = False
        for k_ in ("starts", "takes"):
            if isinstance(sp.get(k_), int) and sp[k_] > est[k_]:
                within = False
        out["withinCap"] = within
        rem = lambda cap_, used, spent: None if spent is None else cap_ - used - spent
        out["remainingAfterRun"] = {"requests": rem((cap["cumulativeCeilingRequests"] or cur["requests"]) - reserve, used_r, a),
                                    "identityReads": rem(cap["identityCap"] or cur["identityReads"], used_i, ia),
                                    "starts": rem(cur["starts"], rc["starts"]["ownerCounted"], sp.get("starts")), "takes": rem(cur["takes"], rc["takes"]["ownerCounted"], sp.get("takes")),
                                    "note": "null means the harness did not record that counter; it is not zero"}
        out["varianceVsEstimate"] = {"requests": None if a is None else a - rq["planned"]}
        out["status"] = "WITHIN CAP" if within else "OVER CAP (stop rule S5)"
        out["countedOnce"] = {"frozenBefore": {"requests": used_r, "identityReads": used_i}, "thisRunActual": {"requests": a, "identityReads": ia},
                              "afterRun": {"requests": None if a is None else used_r + a, "identityReads": None if ia is None else used_i + ia},
                              "rule": "the frozen figure excludes this run; this run's actual is added exactly once",
                              "identityReadsNote": "identity reads are counted in their own cap and are also added to the request ceiling requirement before a run (used + run cap + protected reserve + identity reads); afterRun.requests counts guarded requests only, as reviewed in 1.2.1",
                              "afterRunWithIdentityReadsAsRequests": None if (a is None or ia is None) else used_r + a + ia}
        if sealed:
            agree = sealed["requests"] == a and sealed["identityReads"] == ia
            out["sealedLedgerCheck"] = {"label": latest_label, "sealedRequests": sealed["requests"], "sealedIdentityReads": sealed["identityReads"], "agrees": agree}
            if not agree:
                out["withinCap"] = False
                out["status"] = "ACTUALS DISAGREE WITH THE SEALED LEDGER (stop rule S5)"
    return out


def main():
    a = argparse.ArgumentParser()
    for k in ("request", "config", "reconciliation", "out"):
        a.add_argument("--" + k, required=True)
    for k in ("run-record", "costs", "timings", "latest-label", "receipts-root"):
        a.add_argument("--" + k)
    x = a.parse_args()
    rr = load(x.run_record) if x.run_record and os.path.exists(x.run_record) else None
    costs = load(x.costs) if x.costs and os.path.exists(x.costs) else None
    try:
        out = build(load(x.request), load(x.config), load(x.reconciliation), rr, costs, x.timings, x.latest_label, x.receipts_root)
    except ValueError as e:
        print("ERROR:", e)
        sys.exit(4)
    dump(out, x.out)
    print("spend:", out["status"])
    sys.exit(3 if out["withinCap"] is False else 0)


if __name__ == "__main__":
    main()
