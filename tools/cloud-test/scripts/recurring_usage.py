#!/usr/bin/env python3
"""Period usage and cap enforcement for the standing approval of recurring cost. EVERY cap is enforced from history, not just requests:
requests, identity reads, Starts, takes, coaching calls and GitHub runner minutes, plus the number of runs. Usage so far in the period is
  sealed runs in the history index (their measured actuals; an actual that was not recorded counts at the approved per-run cap, never zero)
+ OPEN RESERVATIONS (runs that reserved their caps and are not sealed yet or were never sealed: counted at the reserved caps until sealed or released)
+ this run's ask.
A cap is exhausted when usage + ask exceeds it in ANY category: the run is refused even if every other category has room.
check_caps() returns the list of reasons (empty means the run may proceed); usage() returns the figures."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import parse_utc  # noqa: E402

PERRUN = {"requests": "runCapRequests", "identityReads": "identityReads", "starts": "starts", "takes": "takes", "coachingRequests": "coachingRequests", "runnerMinutes": "githubRunnerMinutes"}
PERIOD = {"requests": "requests", "identityReads": "identityReads", "starts": "starts", "takes": "takes", "coachingRequests": "coachingRequests", "runnerMinutes": "githubRunnerMinutes"}
ENTRY = {"requests": "requests", "identityReads": "identityReads", "starts": "starts", "takes": "takes", "coachingRequests": "coachingRequests", "runnerMinutes": "runnerMinutes"}


def usage(approval, index, ledger, now, exclude_run=None):
    ts = parse_utc(approval.get("periodStartUtc"))
    used = {k: 0 for k in PERRUN}
    sources = {k: [] for k in PERRUN}
    runs = 0
    sealed = set()
    for e in (index or {}).get("entries", []):
        s = e.get("summary") or {}
        te = parse_utc(s.get("endedUtc"))
        sealed.add(e.get("label"))
        sealed.add(e.get("campaignId"))
        if s.get("kind") != "run" or not te or not ts or te < ts:
            continue
        runs += 1
        for k in PERRUN:
            v = s.get(ENTRY[k])
            if v is None:
                v = (approval.get("perRunCaps") or {}).get(PERRUN[k]) or 0     # not recorded: the approved cap, never zero
                sources[k].append("%s (not recorded: counted at the per-run cap)" % e.get("label"))
            used[k] += v
    from reservations import state
    open_res = []
    for rid, st in state(ledger or {"events": []}).items():
        if st["status"] != "reserved" or rid in sealed or rid == exclude_run:
            continue
        tr = parse_utc(st["reservedUtc"])
        if ts and tr and tr < ts:
            continue
        open_res.append(rid)
        runs += 1
        for k in PERRUN:
            used[k] += st["caps"].get(k) or 0
    return {"used": used, "runs": runs, "openReservations": open_res, "unrecordedActuals": sources}


def check_caps(req, approval, index, ledger, now):
    """Reasons the run must be refused (empty list: it may proceed)."""
    need = []
    est = req.get("estimate") or {}
    rq = est.get("requests") or {}
    asked = {"requests": rq.get("runCap"), "identityReads": est.get("identityReads"), "starts": est.get("starts"), "takes": est.get("takes"),
             "coachingRequests": (est.get("providerBillableRequests") or {}).get("coachingCap"), "runnerMinutes": est.get("githubRunnerMinutesMax")}
    pr, pc = approval.get("perRunCaps") or {}, approval.get("periodCaps") or {}
    for k in PERRUN:
        v = asked[k]
        if v is None:
            need.append("this run does not state its %s" % k)
        elif pr.get(PERRUN[k]) is None or v > pr[PERRUN[k]]:
            need.append("this run asks for %s %s but the standing approval allows %s per run" % (k, v, pr.get(PERRUN[k])))
    wm, wcap = (est.get("window") or {}).get("proposedMinutes"), pr.get("windowMinutes")
    if wm is None or wcap is None or wm > wcap:
        need.append("this run's window of %s minutes exceeds the standing approval's %s per run" % (wm, wcap))
    u = usage(approval, index, ledger, now, exclude_run=req.get("runId"))
    cadence = (approval.get("cadence") or {}).get("runsPerPeriod")
    if isinstance(cadence, int) and u["runs"] + 1 > cadence:
        need.append("the period already has %d run(s) (sealed or reserved) and the cadence allows %d" % (u["runs"], cadence))
    for k in PERRUN:
        cap = pc.get(PERIOD[k])
        if cap is None:
            need.append("the standing approval has no period cap for %s" % k)
            continue
        projected = u["used"][k] + (asked[k] or 0)
        if projected > cap:
            need.append("%s: period usage so far %s (sealed runs and open reservations) + this run %s = %s exceeds the period cap %s" % (k, u["used"][k], asked[k], projected, cap))
    return need
