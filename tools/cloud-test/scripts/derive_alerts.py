#!/usr/bin/env python3
"""Clear alerts for a finished (nightly or any) run, derived from the sealed history. Offline; reads files only; nothing is sent anywhere (a delivery channel
is an owner decision, see NIGHTLY-REGRESSION.md). Alerts are per JOURNEY (not per row) and carry a stable id so a delivery channel can de-duplicate.

Kinds and severities:
  BINDING-MISMATCH   critical  the results are not bound to the deployed version that was tested (identity read differs, drifts or is missing)
  MISSED-RUN         critical  no sealed run within the allowed gap (nightly only)
  REGRESSION         high      a row FAILs now and PASSED in the last-known-good run (names that run, its served SHA and the first run that failed)
  NEW-FAILURE        high      a row FAILs and no earlier run ever had a verdict for it
  COVERAGE-INCOMPLETE high     the run is not a full live run (rows NOT RUN, journeys missing, omissions): the regression itself did not complete
  OVER-CAP           high      actual usage exceeded the approved cap
  ISOLATION-RESIDUE  high      marked test data or an owned page/process survived cleanup, or the clean-start check failed
  FEATURE-FAILING    high      a reviewed feature's covered row FAILs: its expected behaviour is not met
  CONCERN-PROBLEM    high      a #1488/#1757 concern was observed as a problem (sanitized evidence and reproduction steps are in the alert)
  UNRESERVED-RUN     high      a nightly run that never reserved its caps (a recurring run must reserve before it spends)
  FEATURE-UNCOVERED  medium    a reviewed feature's covered row was not run, so the feature was not shown to work
  STILL-FAILING      medium    a row failed in the previous verdict run too (consecutive count and first failing run given; it never passed, or regressed earlier)
  RECOVERED          info      a row PASSes now and FAILed in the previous verdict run
  CONCERN-NOT-OBSERVABLE info  concerns (or parts of them) the harness cannot observe: reported, never counted as safe or as a failure
Usage: derive_alerts.py --config C.json --receipts-root DIR --latest-label LABEL --coverage coverage.json [--spend spend.json] [--isolation isolation.json]
          [--request R.json] [--now ISO] [--max-hours-between-runs 36] [--fail-on critical|high|medium|none] --out alerts.json [--markdown alerts.md]
Exit 0; 6 when --fail-on is set and an alert at or above that severity exists."""
import argparse
import datetime
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, dump, parse_utc, sha256_file  # noqa: E402

SEV = {"critical": 4, "high": 3, "medium": 2, "info": 1}


def aid(kind, key):
    return "%s-%s" % (kind, hashlib.sha256((kind + "|" + key).encode()).hexdigest()[:10])


def rows_of(root, label):
    base = os.path.join(root, label)
    cr = load(os.path.join(base, "case-results.json"))
    out = {}
    for c in cr["cases"]:
        for a in c.get("assertions", []):
            out[(c["caseId"], a["id"])] = {"result": a["result"], "refs": a.get("evidenceRefs") or [], "base": base}
    return cr, out


def evidence(base, case, row, limit=3):
    ev = []
    for ref in row["refs"][:limit]:
        p = os.path.join(base, case, ref)
        ev.append({"file": "%s/%s/%s" % (os.path.basename(base), case, ref), "sha256": sha256_file(p) if os.path.isfile(p) else None})
    return ev


def run_time(root, label):
    p = os.path.join(root, label, "campaign-ledger.json")
    if os.path.isfile(p):
        return parse_utc(load(p).get("updated"))
    return None


def derive(cfg, root, latest, coverage, spend=None, isolation=None, req=None, now=None, max_hours=36, features=None, concerns=None, reservations=None):
    order = [r["label"] for r in cfg["history"]["runs"] if not r.get("ledgersOnly")]
    prior = order[:order.index(latest)]
    served = {r["label"]: r.get("servedSha") for r in cfg["history"]["runs"]}
    cur_cr, cur = rows_of(root, latest)
    hist = {lab: rows_of(root, lab)[1] for lab in prior}
    alerts = []

    def add(kind, sev, title, key, **kw):
        alerts.append({"id": aid(kind, key), "kind": kind, "severity": sev, "title": title, **kw})

    by_journey = {}
    for (case, a), row in cur.items():
        by_journey.setdefault(case, []).append((a, row))
    for case in sorted(by_journey):
        reg, new, still, rec = [], [], [], []
        for a, row in sorted(by_journey[case]):
            past = [(lab, hist[lab].get((case, a), {}).get("result")) for lab in prior]
            verdicts = [(lab, v) for lab, v in past if v in ("PASS", "FAIL")]
            if row["result"] == "FAIL":
                lkg = next((lab for lab, v in reversed(verdicts) if v == "PASS"), None)
                chain = []
                for lab, v in reversed(verdicts):
                    if v != "FAIL":
                        break
                    chain.append(lab)
                if not verdicts:
                    new.append((a, row, None, 1, latest))
                elif verdicts[-1][1] == "FAIL":
                    still.append((a, row, lkg, len(chain) + 1, chain[-1]))
                else:
                    reg.append((a, row, lkg, 1, latest))
            elif row["result"] == "PASS" and verdicts and verdicts[-1][1] == "FAIL":
                rec.append((a, row, verdicts[-1][0]))
        for kind, sev, items, title in (("REGRESSION", "high", reg, "%s regressed since the last known good run"), ("NEW-FAILURE", "high", new, "%s fails and has never been tested before"),
                                        ("STILL-FAILING", "medium", still, "%s is still failing")):
            if not items:
                continue
            a0, row0, lkg, count, since = items[0]
            first = min(items, key=lambda i: i[3])
            add(kind, sev, title % case, "%s|%s|%s" % (case, ",".join(i[0] for i in items), lkg), journey=case, rows=[i[0] for i in items],
                lastKnownGood={"run": lkg, "servedSha": served.get(lkg)} if lkg else None, firstFailedRun=since, consecutiveFailingRuns=max(i[3] for i in items), latestRun=latest, latestServedSha=served.get(latest),
                evidence=[e for i in items[:3] for e in evidence(i[1]["base"], case, i[1])][:6],
                action=("Compare %s with %s (served %s); the change between those releases is the first place to look." % (latest, lkg, str(served.get(lkg))[:8]) if lkg else "No run has ever passed these rows: treat as a product defect or a new check, and decide whether to track it as a gap."))
        if rec:
            add("RECOVERED", "info", "%s recovered" % case, "%s|%s|%s" % (case, ",".join(i[0] for i in rec), latest), journey=case, rows=[i[0] for i in rec], recoveredFrom=rec[0][2], latestRun=latest, evidence=[])
    cov = coverage or {}
    bind = cov.get("deployedVersionBinding") or {}
    if bind and not bind.get("ok", True):
        add("BINDING-MISMATCH", "critical", "Results are not bound to the deployed version that was tested", "%s|%s" % (latest, bind.get("testedSha")), latestRun=latest, problems=bind.get("problems"),
            action="Do not trust this run: the served version differed from the tested SHA or was never read. Re-run after the deploy settles.")
    if cov and not cov.get("fullLiveRun"):
        miss = cov.get("missing") or []
        add("COVERAGE-INCOMPLETE", "high", "The regression did not complete: %s" % (cov.get("statement") or cov.get("kind")), "%s|%s" % (latest, cov.get("kind")), latestRun=latest, kind_of_run=cov.get("kind"),
            reasons=cov.get("reasons"), notExecuted=[{"case": m["case"], "assertion": m["assertion"]} for m in miss[:30]], notExecutedCount=len(miss) + len(cov.get("approvedOmissionsApplied") or []),
            action="A run that does not execute every row cannot show that nothing regressed. Find why rows were NOT RUN (gate, allowance, window, stimulus) before the next night.")
    if spend and spend.get("withinCap") is False:
        add("OVER-CAP", "high", "Actual usage exceeded the approved cap", latest, latestRun=latest, status=spend.get("status"), action="Stop the schedule until the owner reviews the cap (stop rule S5).")
    if isolation is not None and not isolation.get("proven"):
        add("ISOLATION-RESIDUE", "high", "Isolation or cleanup is %s" % ("FAILED" if isolation.get("status") == "failed" else "not proven"), latest, latestRun=latest, problems=isolation.get("problems"),
            action="Do not start the next run until the residue is removed, the evidence is complete and bound to the dedicated account, and the clean-start check passes.")
    for f in (features or {}).get("features", []):
        if f["status"] == "FAILING":
            add("FEATURE-FAILING", "high", "Feature %s does not meet its expected behaviour" % f["id"], "%s|%s" % (f["id"], latest), journey=",".join(sorted({k.split("/")[0] for k in f["rowResults"]})),
                rows=[k for k, v in f["rowResults"].items() if v == "FAIL"], latestRun=latest, feature={"id": f["id"], "title": f["title"], "pr": f["pr"], "expectedBehaviour": f["expectedBehaviour"]}, evidence=f["evidence"][:4],
                action="The reviewed feature's expected behaviour is not met on the deployed version; compare with the review and the criteria.")
        elif f["status"] == "UNCOVERED":
            add("FEATURE-UNCOVERED", "medium", "Feature %s was not shown to work" % f["id"], "%s|%s" % (f["id"], latest), rows=[k for k, v in f["rowResults"].items() if v not in ("PASS", "FAIL")], latestRun=latest,
                feature={"id": f["id"], "title": f["title"], "pr": f["pr"]}, action="Its covered rows were not run; the feature has no result tonight.")
    nobs = []
    for c in (concerns or {}).get("concerns", []):
        probs = [s for s in c["subObservations"] if s["counts"] and s["verdict"] == "OBSERVED PROBLEM"]
        if probs:
            add("CONCERN-PROBLEM", "high", "%s observed a problem: %s" % (c["id"], c["title"]), "%s|%s" % (c["id"], latest), concern=c["id"], sourceRefs=c["sourceRefs"], journey=",".join(sorted({j for s in probs for j in s["journeys"]})),
                problems=[s["detail"] for s in probs], evidence=[e for s in probs for e in s["evidence"]][:6], observedUtc=[t for s in probs for t in s["observedUtc"]][:2], reproduction=c["reproduction"], latestRun=latest,
                action="Follow the reproduction steps on the journey named; the evidence is sanitized (file, hash, event numbers, counts).")
        nobs += ["%s: %s" % (c["id"], s["name"]) for s in c["subObservations"] if s["counts"] and s["verdict"] == "NOT OBSERVABLE"]
    if nobs:
        add("CONCERN-NOT-OBSERVABLE", "info", "%d concern observation(s) are not observable from this harness" % len(nobs), "%s|%d" % (latest, len(nobs)), notObservable=nobs[:12], latestRun=latest,
            action="Not observable is neither safe nor a failure. Ask for the visibility (a reviewed harness change) if the concern matters.")
    if reservations is not None and req and req.get("priority") == "nightly-regression":
        from reservations import state
        if req.get("runId") not in state(reservations):
            add("UNRESERVED-RUN", "high", "A nightly run spent without reserving its caps", "%s|%s" % (latest, req.get("runId")), latestRun=latest, runId=req.get("runId"),
                action="A recurring run must reserve its caps before it spends (stage reserve); until it is accounted for, treat the period usage as unknown.")
    t = run_time(root, latest)
    age = None if (now is None or t is None) else round((now - t).total_seconds() / 3600, 1)
    stale = None if age is None else age > max_hours
    if now is not None:
        if t is not None and (now - t).total_seconds() > max_hours * 3600:
            add("MISSED-RUN", "critical", "No run in the last %d hours" % max_hours, "%s|%d" % (latest, max_hours), latestRun=latest, lastRunUtc=t.strftime("%Y-%m-%dT%H:%M:%SZ"),
                action="The nightly run did not happen or was not sealed. Check the schedule and the run environment.")
    alerts.sort(key=lambda a: (-SEV[a["severity"]], a["kind"], a.get("journey") or ""))
    counts = {k: sum(1 for a in alerts if a["severity"] == k) for k in SEV}
    status = "ALERT" if any(a["severity"] in ("critical", "high") for a in alerts) else ("WATCH" if any(a["severity"] == "medium" for a in alerts) else "OK")
    return {"schema": "speaksharp.cloud-test.alerts.v1", "derived": True, "runLabel": latest, "servedSha": served.get(latest), "comparedWith": prior[-1] if prior else None,
            "status": status, "counts": counts, "alerts": alerts,
            "latestRunEndedUtc": t.strftime("%Y-%m-%dT%H:%M:%SZ") if t else None, "evidenceAgeHours": age, "evidenceStale": stale, "maxEvidenceAgeHours": max_hours, "delivery": "none: no channel is approved or configured; the alerts are in this file, the job summary and the job's exit code"}


def markdown(out):
    L = ["## Cloud test alerts for %s: **%s**" % (out["runLabel"], out["status"]), "",
         "Served version %s; compared with %s. Critical %d, high %d, medium %d, info %d." % (str(out["servedSha"])[:8], out["comparedWith"], out["counts"]["critical"], out["counts"]["high"], out["counts"]["medium"], out["counts"]["info"]), ""]
    for a in out["alerts"]:
        L.append("### [%s] %s" % (a["severity"].upper(), a["title"]))
        if a.get("rows"):
            L.append("- rows: %s" % ", ".join(a["rows"][:8]) + (" +%d more" % (len(a["rows"]) - 8) if len(a["rows"]) > 8 else ""))
        if a.get("lastKnownGood"):
            L.append("- last known good: %s (served %s); first failed in %s; failing for %d run(s) including %s" % (a["lastKnownGood"]["run"], str(a["lastKnownGood"]["servedSha"])[:8], a.get("firstFailedRun"), a.get("consecutiveFailingRuns", 1), a["latestRun"]))
        if a.get("reasons"):
            L.append("- why: %s" % "; ".join(a["reasons"][:3]))
        if a.get("problems"):
            L.append("- problems: %s" % "; ".join(a["problems"][:3]))
        if a.get("journey") and not a.get("rows"):
            L.append("- journey(s): %s" % a["journey"])
        if a.get("observedUtc"):
            L.append("- observed (UTC): %s" % " to ".join(a["observedUtc"]))
        if a.get("feature"):
            L.append("- feature: %s %s (%s); expected: %s" % (a["feature"]["id"], a["feature"].get("title") or "", a["feature"].get("pr") or "no PR", a["feature"].get("expectedBehaviour") or "not stated"))
        if a.get("notObservable"):
            L.append("- not observable: %s" % "; ".join(a["notObservable"][:6]))
        if a.get("reproduction"):
            L.append("- reproduce: %s" % " ".join("(%d) %s" % (i + 1, s) for i, s in enumerate(a["reproduction"])))
        if a.get("evidence"):
            L.append("- evidence: %s" % "; ".join("%s %s" % (e["file"], (e["sha256"] or "missing")[:8]) for e in a["evidence"][:3]))
        if a.get("action"):
            L.append("- action: %s" % a["action"])
        L.append("- id: `%s`" % a["id"])
        L.append("")
    if not out["alerts"]:
        L.append("No alerts.")
    L.append("_Delivery: %s_" % out["delivery"])
    return "\n".join(L) + "\n"


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
    a.add_argument("--receipts-root", default=os.path.join(ROOT, "config", "history", "receipts"))
    for k in ("latest-label", "coverage", "out"):
        a.add_argument("--" + k, required=True)
    for k in ("spend", "isolation", "request", "now", "markdown", "features", "concerns", "reservations"):
        a.add_argument("--" + k)
    a.add_argument("--max-hours-between-runs", type=int, default=36)
    a.add_argument("--fail-on", choices=["critical", "high", "medium", "none"], default="none")
    x = a.parse_args()
    out = derive(load(x.config), x.receipts_root, x.latest_label, load(x.coverage), load(x.spend) if x.spend else None, load(x.isolation) if x.isolation else None,
                 load(x.request) if x.request else None, parse_utc(x.now) if x.now else None, x.max_hours_between_runs,
                 load(x.features) if x.features else None, load(x.concerns) if x.concerns else None, load(x.reservations) if x.reservations and os.path.exists(x.reservations) else None)
    dump(out, x.out)
    if x.markdown:
        with open(x.markdown, "w", encoding="utf-8") as f:
            f.write(markdown(out))
    print("alerts for %s: %s (critical %d, high %d, medium %d, info %d)" % (x.latest_label, out["status"], out["counts"]["critical"], out["counts"]["high"], out["counts"]["medium"], out["counts"]["info"]))
    if x.fail_on != "none" and any(SEV[al["severity"]] >= SEV[x.fail_on] for al in out["alerts"]):
        sys.exit(6)


if __name__ == "__main__":
    main()
