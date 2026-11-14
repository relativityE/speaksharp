#!/usr/bin/env python3
"""Period usage and cap enforcement for the standing approval of recurring cost. EVERY cap is enforced from history, not just requests:
requests, identity reads, Starts, takes, coaching calls and GitHub runner minutes, plus the number of runs. Usage so far in the period is
  sealed runs in the history index (their measured actuals; an actual that was not recorded counts at the approved per-run cap, never zero)
+ OPEN RESERVATIONS (runs that reserved their caps and are not sealed yet or were never sealed: counted at the reserved caps until sealed or released)
+ this run's ask.
A cap is exhausted when usage + ask exceeds it in ANY category: the run is refused even if every other category has room.
check_caps returns the list of reasons (empty means the run may proceed); usage returns the figures."""
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
        if s.get("kind") != "run":
            continue  # non-run entries never replace an outstanding reservation
        te = parse_utc(s.get("endedUtc"))
        if te is not None:
            # Only usable sealed usage replaces that run's reservation.
            sealed.add(e.get("label"))
            sealed.add(e.get("campaignId"))
            if ts is not None and te < ts:
                continue
        # Missing/invalid end time or period start never makes usage disappear:
        # conservatively count the run in the active period.
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


JOURNAL_SNAPSHOT_SCHEMA = "speaksharp.cloud-test.journal-snapshot.v1"


def snapshot_chain(doc):
    """The verified state-ref journal snapshot reservations.py journal-snapshot wrote (its head and that head's full ledger), as the
    one-element chain journal_usage folds; None for the legacy reservation-file input."""
    if isinstance(doc, dict) and doc.get("schema") == JOURNAL_SNAPSHOT_SCHEMA:
        if not (isinstance(doc.get("headSha"), str) and isinstance(doc.get("events"), list)):
            raise ValueError("journal-snapshot-shape")
        return [(doc["headSha"], doc["events"], None)]
    return None


def journal_usage(approval, chain, exclude_run=None):
    """G11 period usage from the VERIFIED state-ref journal (RETURN : one journal for reservation, G11 and continuity):
    every event inside the approval period folds per (campaign, run, attempt); a settle replaces its reservation with the settled allocation,
    a release removes it, and an open reservation counts at its reserved caps. Runs are the distinct nightly campaigns reserved in the period
    (the Case 10 observation's own `<campaign>.case10-observation` reservations count as usage, never as runs)."""
    start = parse_utc(approval.get("periodStartUtc"))
    held, runs = {}, set()
    for e in chain[-1][1]:
        at = parse_utc(e["atUtc"])
        if start is None or at is None or at < start:
            continue
        key = (e["campaignId"], e["runId"], e["attempt"])
        if e["type"] == "release":
            held.pop(key, None)
            continue
        held[key] = e["allocation"]
        campaign = e["campaignId"]
        if e["type"] == "reserve" and campaign.startswith("nightly-") and "." not in campaign and campaign != exclude_run:
            runs.add(campaign)
    used = {k: sum(a[k] for (campaign, _, _), a in held.items() if campaign != exclude_run) for k in PERRUN}
    return {"used": used, "runs": len(runs), "openReservations": sorted(c for (c, _, _), a in held.items()), "sources": {k: [] for k in PERRUN}}


def check_caps(req, approval, index, ledger, now, journal_chain=None):
    """Reasons the run must be refused (empty list: it may proceed)."""
    need = []
    est = req.get("estimate") or {}
    from reservations import caps_of_request
    asked = caps_of_request(req)
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
    u = (journal_usage(approval, journal_chain, exclude_run=req.get("runId")) if journal_chain is not None
         else usage(approval, index, ledger, now, exclude_run=req.get("runId")))
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
