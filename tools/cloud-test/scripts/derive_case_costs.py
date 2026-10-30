#!/usr/bin/env python3
"""Derives per-case costs of a completed run from its SEALED guard logs. Offline; reads files only.
Every case runs behind its own guard process whose stop summary carries the cumulative campaign ledger, so a case's cost is the difference between its
stop summary and the previous case's (ordered by start time). Per case: guarded requests by category, refused connections, Starts and takes actually
pressed (action-reservations.jsonl), wall time, identity reads (from the case result's before/after receipts) and assertion rows executed versus NOT RUN.
The per-case sums are reconciled to the run's campaign-ledger totals (total and each category); a mismatch is reported, never hidden.
A case's request count is marked a LOWER BOUND when it was stopped by its allowance, when its guard log has no stop summary, or when rows stayed
NOT RUN (the steps behind unexecuted rows were not driven, so the observed count understates what executing every row costs).
Usage: derive_case_costs.py --receipts-root DIR --run R4C [--run R5 ...] --out costs.json [--markdown costs.md]"""
import argparse
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import load, dump, parse_utc  # noqa: E402

CATS = ("public", "navigations", "preflight", "auth", "signed-in", "model", "coaching")


def read_jsonl(path):
    out = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    out.append(json.loads(line))
    return out


def count_actions(run_dir):
    """Starts pressed and takes saved by a run, counted from each case's action-reservations.jsonl (the harness's own reservation log).
    Returns None when the run has no reservation logs at all, so a missing record is never reported as zero."""
    starts = takes = 0
    seen = False
    if os.path.isdir(run_dir):
        for cid in sorted(os.listdir(run_dir)):
            rows = read_jsonl(os.path.join(run_dir, cid, "action-reservations.jsonl")) if cid.startswith("AHT-") else []
            if rows:
                seen = True
                starts += sum(1 for r in rows if r.get("kind") == "start")
                takes += sum(1 for r in rows if r.get("kind") == "take")
    return {"starts": starts, "takes": takes} if seen else None


def case_number(cid):
    return int(cid.split("-")[1])


def derive_run(root, label):
    base = os.path.join(root, label)
    ledger = load(os.path.join(base, "campaign-ledger.json"))
    results = load(os.path.join(base, "case-results.json"))
    plan = load(os.path.join(base, "campaign-plan.json"))
    rows = {c["caseId"]: c for c in results["cases"]}
    raw = []
    for cid in sorted(rows, key=case_number):
        d = os.path.join(base, cid)
        summary = load(os.path.join(d, "summary.json"))
        events = read_jsonl(os.path.join(d, "guard.jsonl"))
        stops = [e for e in events if e.get("kind") == "stop"]
        reservations = read_jsonl(os.path.join(d, "action-reservations.jsonl"))
        raw.append((cid, summary, events, stops, reservations))
    raw.sort(key=lambda r: parse_utc(r[1]["startedAt"]))
    prev = collections.Counter()
    cases, tot = [], collections.Counter()
    by_cat = collections.Counter()
    for cid, summary, events, stops, reservations in raw:
        cum = collections.Counter((stops[-1]["summary"].get("ledgerUsed") if stops else None) or {})
        delta = {k: cum.get(k, 0) - prev.get(k, 0) for k in set(cum) | set(prev) | {"total"}}
        if stops:
            prev = cum
        counters = (summary.get("guard") or {}).get("counters") or {}
        limits = next((r["limits"] for r in reservations if r.get("kind") == "case-action-budget"), {})
        starts = sum(1 for r in reservations if r.get("kind") == "start")
        takes = sum(1 for r in reservations if r.get("kind") == "take")
        row = rows[cid]
        asr = collections.Counter(a["result"] for a in row["assertions"])
        ib, ia = (row.get("identityBefore") or {}).get("identityGetsUsed"), (row.get("identityAfter") or {}).get("identityGetsUsed")
        allowance = ((summary.get("guard") or {}).get("caseAllowance") or {})
        why = []
        if not stops:
            why.append("no guard stop summary")
        if summary.get("reason") == "allowance-exhausted" or allowance.get("exhausted"):
            why.append("stopped by its request allowance")
        if asr.get("NOT RUN"):
            why.append("%d of %d rows NOT RUN (their steps were not driven)" % (asr["NOT RUN"], len(row["assertions"])))
        wall = (parse_utc(summary["endedAt"]) - parse_utc(summary["startedAt"])).total_seconds() if summary.get("endedAt") else None
        c = {"case": cid, "startedAt": summary["startedAt"], "endedAt": summary.get("endedAt"), "wallSeconds": wall, "reason": summary.get("reason"),
             "requests": {"total": delta["total"], "byCategory": {k: delta.get(k, 0) for k in CATS}},
             "refusedConnections": counters.get("connectRefused"), "deniedRequests": sum((counters.get("denied") or {}).values()),
             "startsPressed": starts, "takesSaved": takes, "startLimit": limits.get("startPresses"), "takeLimit": limits.get("takeAttempts"),
             "identityReads": (ia - ib + 1) if isinstance(ia, int) and isinstance(ib, int) else None,
             "rows": {"total": len(row["assertions"]), "executed": asr.get("PASS", 0) + asr.get("FAIL", 0), "pass": asr.get("PASS", 0), "fail": asr.get("FAIL", 0), "notRun": asr.get("NOT RUN", 0)},
             "caseResult": row["result"], "plannedRequests": row.get("plannedRequests"), "requestAllowance": row.get("requestAllowance") or allowance.get("allowance"),
             "lowerBound": bool(why), "lowerBoundBecause": why}
        cases.append(c)
        tot["requests"] += delta["total"]
        for k in CATS:
            by_cat[k] += delta.get(k, 0)
        tot["starts"] += starts
        tot["takes"] += takes
    used = ledger["used"]
    rec = {"ledgerTotal": used["total"], "sumOfCases": tot["requests"], "totalMatches": used["total"] == tot["requests"],
           "categoriesMatch": all(used.get(k, 0) == by_cat[k] for k in CATS),
           "mismatches": {k: {"ledger": used.get(k, 0), "cases": by_cat[k]} for k in CATS if used.get(k, 0) != by_cat[k]}}
    first, last = min(parse_utc(c["startedAt"]) for c in cases), max(parse_utc(c["endedAt"]) for c in cases if c["endedAt"])
    rec["ok"] = rec["totalMatches"] and rec["categoriesMatch"]
    return {"label": label, "campaignId": results.get("campaignId"), "requestBudgetPlan": bool(plan.get("requestBudget")),
            "caseSampleMode": "budgeted-minimal-or-breadth" if plan.get("requestBudget") else "unbudgeted",
            "cases": cases, "totals": {"requests": tot["requests"], "byCategory": dict(by_cat), "startsPressed": tot["starts"], "takesSaved": tot["takes"],
                                         "casesWallSeconds": sum(c["wallSeconds"] or 0 for c in cases), "runWallSeconds": (last - first).total_seconds(),
                                         "rowsTotal": sum(c["rows"]["total"] for c in cases), "rowsExecuted": sum(c["rows"]["executed"] for c in cases),
                                         "identityReadsLedger": (load(os.path.join(base, "identity-ledger.json")) or {}).get("identityGets")},
            "reconciliation": rec}


def markdown(out):
    L = ["# Per-case costs derived from sealed guard logs", ""]
    for label, r in out["runs"].items():
        L += ["## %s (%s)" % (label, r["campaignId"]), "",
              "Reconciliation to the campaign ledger: %s (ledger %s, sum of cases %s)." % ("OK" if r["reconciliation"]["ok"] else "MISMATCH", r["reconciliation"]["ledgerTotal"], r["reconciliation"]["sumOfCases"]), "",
              "| Case | Requests | public | nav | preflight | auth | signed-in | model | coaching | Starts | takes | Wall s | Rows exec/total | Lower bound |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for c in r["cases"]:
            b = c["requests"]["byCategory"]
            L.append("| %s | %d | %d | %d | %d | %d | %d | %d | %d | %s | %s | %s | %d/%d | %s |" % (
                c["case"], c["requests"]["total"], b["public"], b["navigations"], b["preflight"], b["auth"], b["signed-in"], b["model"], b["coaching"],
                c["startsPressed"], c["takesSaved"], "%.0f" % c["wallSeconds"] if c["wallSeconds"] is not None else "n/a", c["rows"]["executed"], c["rows"]["total"], "yes" if c["lowerBound"] else "no"))
        t = r["totals"]
        L += ["", "Categories overlap (navigations are also counted inside public); the request total is authoritative.", "", "Totals: %d requests, %d Starts, %d takes, %d of %d rows executed, run wall time %.1f min." % (t["requests"], t["startsPressed"], t["takesSaved"], t["rowsExecuted"], t["rowsTotal"], t["runWallSeconds"] / 60), ""]
    return "\n".join(L)


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--receipts-root", required=True)
    a.add_argument("--run", action="append", required=True)
    a.add_argument("--out", required=True)
    a.add_argument("--markdown")
    x = a.parse_args()
    out = {"schema": "speaksharp.cloud-test.case-costs.v1", "derived": True, "source": "sealed guard logs, action reservations and case results",
           "runs": {lab: derive_run(x.receipts_root, lab) for lab in x.run}}
    dump(out, x.out)
    if x.markdown:
        with open(x.markdown, "w", encoding="utf-8") as f:
            f.write(markdown(out))
    bad = [lab for lab, r in out["runs"].items() if not r["reconciliation"]["ok"]]
    for lab, r in out["runs"].items():
        print("%s: %d requests across %d cases, reconciliation %s" % (lab, r["totals"]["requests"], len(r["cases"]), "OK" if r["reconciliation"]["ok"] else "MISMATCH"))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
