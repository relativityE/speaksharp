#!/usr/bin/env python3
"""Recurring (nightly) cost: what an ordinary paid-user regression every night would consume, per run and per period, so the Product Owner can approve a
STANDING budget instead of one run at a time. Derived, never typed: per-run figures come from the full-coverage budget (full_coverage_budget.py) until a full live
run has been measured, and from that measured run (history index) afterwards. Nothing here approves anything: config/recurring-approval.json carries the owner's
approval (null until given) and gate G11 compares the request and the usage so far with it.
Usage: recurring_budget.py --config C.json --budget full-coverage-budget.json [--history-index index.json] [--runs-per-period 30] [--out proposal.json]"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, dump  # noqa: E402


def per_run_from_budget(b):
    return {"runCapRequests": b["requests"]["runCap"], "identityReads": b["identity"]["readsThisRun"], "starts": b["actions"]["startsMinimum"], "takes": b["actions"]["takesMinimum"],
            "coachingRequests": b["coaching"]["cap"], "windowMinutes": b["window"]["proposedWindowMinutes"], "githubRunnerMinutes": 30, "paidActionsUsd": 0,
            "basis": "derived full-coverage budget (an extrapolation until a full live run is measured)"}


def per_run_measured(index, margin_pct=25):
    """From the most recent FULL live run in the history index: measured requests and identity reads plus a margin. None until one exists."""
    for e in reversed((index or {}).get("entries", [])):
        s = e.get("summary") or {}
        if s.get("kind") == "run" and s.get("rowsExecuted") == s.get("rowsTotal") and s.get("rowsTotal"):
            up = lambda v: int(math.ceil(v * (100 + margin_pct) / 100.0 / 10.0) * 10)
            return {"runCapRequests": up(s["requests"]), "identityReads": s["identityReads"], "basis": "measured full live run %s (%d requests, %d identity reads) plus %d%%" % (e["label"], s["requests"], s["identityReads"], margin_pct)}
    return None


def proposal(cfg, budget, index, runs_per_period=30):
    base = per_run_from_budget(budget)
    meas = per_run_measured(index)
    per = dict(base)
    if meas:
        per.update(meas)
    n = runs_per_period
    return {"schema": "speaksharp.cloud-test.recurring-proposal.v1", "derived": True, "status": "PROPOSAL - NOT APPROVED", "runsPerPeriod": n, "period": "30 days",
            "perRun": per, "measuredFullRunAvailable": bool(meas),
            "periodTotals": {"requests": per["runCapRequests"] * n, "identityReads": per["identityReads"] * n, "starts": per["starts"] * n, "takes": per["takes"] * n,
                             "coachingRequests": per["coachingRequests"] * n, "githubRunnerMinutes": per["githubRunnerMinutes"] * n, "paidActionsUsd": 0},
            "unknownCosts": {"providerUsd": "unknown until the owner supplies a unit cost", "cloudAgentUsd": "unknown", "githubBilledUsd": "unknown (plan-dependent); at most %d runner minutes a period" % (per["githubRunnerMinutes"] * n)},
            "note": "These are the worst case a standing approval would allow, not a forecast of spend. The request ceilings of the campaign (6,700 requests in total) are one-time allowances and do not cover a recurring schedule: a nightly run needs its own periodic caps."}


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
    a.add_argument("--budget", required=True)
    a.add_argument("--history-index")
    a.add_argument("--runs-per-period", type=int, default=30)
    a.add_argument("--out")
    x = a.parse_args()
    p = proposal(load(x.config), load(x.budget), load(x.history_index) if x.history_index else None, x.runs_per_period)
    if x.out:
        dump(p, x.out)
    print("recurring proposal (not approved): %d requests per run, %d per %s" % (p["perRun"]["runCapRequests"], p["periodTotals"]["requests"], p["period"]))


if __name__ == "__main__":
    main()
