#!/usr/bin/env python3
"""Evaluates the workflow's blocking gates G1-G11 for a run request and writes gate-status.json. Offline; reads files only.
Each gate is READY, NOT-READY, OWNER-INPUT-OPEN (the owner has not yet supplied what the gate needs) or DEFERRED-TO-RUNNER (G4 at the offline stage).
Overall GO only when every blocking gate is READY (or deferred). Runtime gates R1/R2 (live identity read, admission) belong to the harness.
G2 rejects UNVERIFIED DEPLOYMENT and UNREVIEWED customer-facing changes; it does not reject product changes: a customer-facing commit since the last
run passes when it is a verified deployed fix tied to a gap with expected-PASS criteria (scripts/verify_release.py).
Usage: check_gates.py --request R.json --config C.json --ledger L.json --workflow W.json --release-verification RV.json --reconciliation RC.json
                      [--validation V.json] [--offline-checks OC.json] [--stimulus-receipt S.json] [--stage preflight|final] [--now ISO] --base DIR --out gate-status.json"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import load, dump, parse_utc, now_utc, ep_requirements, mode_limits  # noqa: E402
from verify_receipts import verify_set  # noqa: E402
from recurring_usage import check_caps  # noqa: E402
from case_start_caps import reconcile_caps, request_caps

READY, NOTREADY, OWNER, DEFERRED = "READY", "NOT-READY", "OWNER-INPUT-OPEN", "DEFERRED-TO-RUNNER"


def gate(gid, status, detail, needs=None):
    return {"id": gid, "status": status, "detail": detail, "needs": needs or []}


def recurring_gate(req, cfg, base, index, now, reservations=None, approval_path=None):
    """G11: a nightly-regression request runs under the owner's STANDING approval of recurring cost. Not applicable to any other request."""
    if req.get("priority") != "nightly-regression":
        return gate("G11", READY, "not a recurring run: no standing approval is needed")
    ncfg = cfg.get("nightly") or {}
    path = approval_path or os.path.join(base, ncfg.get("approvalFile") or "config/recurring-approval.json")
    if not os.path.exists(path):
        return gate("G11", NOTREADY, "the recurring approval file is missing", ["config/recurring-approval.json is part of the package"])
    ap = load(path)
    est = req.get("estimate") or {}
    miss = ["recurring approval: %s not given" % k for k in ("approvedBy", "approvalRef", "approvedAtUtc", "validFromUtc", "expiresUtc", "periodStartUtc") if not ap.get(k)]
    runs = (ap.get("cadence") or {}).get("runsPerPeriod")
    if not isinstance(runs, int) or runs < 1:
        miss.append("recurring approval: cadence.runsPerPeriod not given")
    for grp in ("perRunCaps", "periodCaps"):
        for k, v in (ap.get(grp) or {}).items():
            if v is None:
                miss.append("recurring approval: %s.%s not given" % (grp, k))
    if miss:
        return gate("G11", OWNER, "no standing approval of recurring cost", miss)
    need = []
    t0, t1, ts = parse_utc(ap["validFromUtc"]), parse_utc(ap["expiresUtc"]), parse_utc(ap["periodStartUtc"])
    if not (t0 and t1 and ts):
        need.append("approval times are not valid UTC times")
    elif not (t0 <= now < t1):
        need.append("the standing approval is not in force now (valid %s to %s)" % (ap["validFromUtc"], ap["expiresUtc"]))
    pr = ap["perRunCaps"]
    if pr.get("paidActionsUsd") != 0 or (ap["periodCaps"].get("paidActionsUsd") != 0):
        need.append("paid actions must stay at $0 in a recurring approval")
    # every cap, from history: sealed runs (measured actuals) and open reservations count, not just requests and identity reads
    need += check_caps(req, ap, index, reservations, now)
    from recurring_usage import usage, PERRUN, PERIOD
    if runs and ts:
        for k in PERRUN:
            if runs * pr[PERRUN[k]] > ap["periodCaps"][PERIOD[k]]:
                need.append("the cadence (%d runs) at the per-run cap %s exceeds the period cap %s for %s: the approval contradicts itself" % (runs, pr[PERRUN[k]], ap["periodCaps"][PERIOD[k]], k))
    u = usage(ap, index, reservations, now, exclude_run=req.get("runId"))
    used = u["used"]
    return gate("G11", READY if not need else NOTREADY, "within the standing approval of recurring cost (period usage so far: %d run(s), %s requests, %s Starts, %s takes, %s coaching calls, %s runner minutes; %d open reservation(s))" % (u["runs"], used["requests"], used["starts"], used["takes"], used["coachingRequests"], used["runnerMinutes"], len(u["openReservations"])) if not need else "outside the standing approval of recurring cost", need)


def historical_prior_gate(req, cfg, base, receipts_root):
    """G7 in historical mode: the compared runs' sealed receipts verified against their pinned hashes and bindings."""
    need = []
    root = receipts_root or os.path.join(base, "config", "history", "receipts")
    runs = {r["label"]: r for r in cfg["history"]["runs"]}
    for pr_ in req.get("priorRuns") or []:
        lab = pr_.get("label")
        if lab not in runs:
            need.append("%s is not in the config history" % lab)
            continue
        errs, n = verify_set(os.path.join(root, lab), runs[lab].get("receiptsManifestSha256"))
        if errs:
            need.append("%s receipts: %s" % (lab, "; ".join(errs[:2])))
        bf = os.path.join(base, pr_.get("bindingFile") or "")
        if not pr_.get("bindingFile") or not os.path.exists(bf):
            need.append("%s binding verification missing" % lab)
        else:
            b = load(bf)
            if b.get("failed") != 0 or not b.get("passed"):
                need.append("%s binding verification has %s failed checks" % (lab, b.get("failed")))
    return gate("G7", READY if not need else NOTREADY, "last two runs' sealed receipts verified against their pinned hashes and bindings" if not need else "prior-run receipts not verified", need)


def evaluate(req, cfg, ledger, wf, validation, offline_checks, receipt, base, stage="final", rv=None, rc=None, now=None, receipts_root=None, index=None, reservations=None, approval_path=None,
             run_inputs=None):
    G = []
    now = now or now_utc()
    try:
        request_caps(req)
    except (ValueError, TypeError, KeyError):
        return {"schema": "speaksharp.cloud-test.gate-status.v2", "decision": "NO-GO", "stage": stage,
                "gates": [gate("G5", NOTREADY, "invalid request binding structure")],
                "blockingOpen": ["G5"], "ownerInputsOpen": [], "deferred": []}
    lim = mode_limits(cfg, req)
    h = req.get("harness") or {}
    appr = req.get("approvedLimits") or {}
    est = req.get("estimate") or {}
    win = req.get("window") or {}
    gaps = {g["id"]: g for g in ledger["gaps"]}
    sel = req.get("selection") or []
    # G1
    pr = (req.get("ownerInputs") or {}).get("prDocsCloseout") or {}
    if pr.get("status") == "closed" and pr.get("evidence"):
        G.append(gate("G1", READY, "PR and docs closeout recorded as closed with evidence"))
    else:
        G.append(gate("G1", OWNER, "product PR and docs closeout is %s" % pr.get("status", "unrecorded"), ["owner: close out or explicitly defer the open product PRs and docs; record evidence in ownerInputs.prDocsCloseout"]))
    # G2: verified deployment, mechanically classified changes
    need = list((rv or {}).get("needs", [])) if rv else ["release verification not run"]
    if rv:
        be = rv.get("backend") or {}
        touches_backend = any(f.get("touchesBackend") for g in (req.get("targetedGaps") or []) for f in [rv["fixes"].get(g, {})])
        if touches_backend and not be.get("verified"):
            need.append("a targeted fix touches backend paths and the backend deployment is %s (needs cloud-verified source, time, evidence reference and the tested SHA)" % (be.get("source") or "undeclared"))
    G.append(gate("G2", READY if not need else NOTREADY,
                  "deployment of the tested SHA verified; %d change(s) since the last run, each allowed" % len((rv or {}).get("sinceLastRun") or []) if not need else "release or deployment not verified", need))
    # G3
    need = []
    op = os.path.join(base, h.get("offlineProofFile") or "")
    if not h.get("offlineProofFile") or not os.path.exists(op):
        need.append("offline proof file missing")
    else:
        proof = load(op)
        bad = [c.get("id") for c in proof.get("corrections", []) if c.get("result") != "PASS"]
        if not proof.get("corrections"):
            need.append("offline proof lists no corrections")
        if bad:
            need.append("offline proof not PASS for: " + ", ".join(map(str, bad)))
        if proof.get("codeManifestSha256") and proof["codeManifestSha256"] != h.get("codeManifestSha256"):
            need.append("offline proof was produced on a different harness hash")
    if h.get("codeManifestSha256") != cfg["harness"]["expectedCodeManifestSha256"]:
        need.append("request harness hash differs from the config")
    approval_missing = not h.get("ownerApprovalRef")
    if approval_missing:
        need.append("owner approval of the exact harness hash is not recorded")
    st = OWNER if (approval_missing and len(need) == 1) else (READY if not need else NOTREADY)
    G.append(gate("G3", st, "harness verified and approved" if st == READY else "harness proof or approval incomplete", need))
    # G4
    need = []
    if stage == "preflight" and receipt is None:
        G.append(gate("G4", DEFERRED, "produced in the run environment by the stimulus-preflight stage; evaluated again at stage final before any product request"))
    else:
        if receipt is None:
            need.append("stimulus preflight receipt not supplied")
        else:
            if receipt.get("productTraffic") != 0:
                need.append("receipt shows product traffic")
            t = parse_utc(receipt.get("createdAt"))
            if not t or (now - t).total_seconds() > lim["stimulusReceiptMaxAgeMinutes"] * 60:
                need.append("receipt is older than %d minutes or has no time" % lim["stimulusReceiptMaxAgeMinutes"])
            if receipt.get("codeManifestSha256") != h.get("codeManifestSha256"):
                need.append("receipt was produced for a different harness hash")
            for s in sel:
                if s.get("needsCaptureDevice") and not ((receipt.get("cases") or {}).get(s["case"]) or {}).get("ready"):
                    need.append("%s is not ready in the receipt" % s["case"])
        G.append(gate("G4", READY if not need else NOTREADY, "stimulus preflight ready" if not need else "stimulus preflight not ready", need))
    # G5: limits against the RECONCILED cumulative usage (a recurring nightly run is limited by the STANDING approval instead: gate G11)
    need, owner_missing = [], []
    try:
        reconcile_caps(req, rc)
    except (ValueError, TypeError, KeyError):
        need.append("exact per-case Start allocations are missing, invalid or unreconciled")
    if appr.get("startPressCaps") is None:
        owner_missing.append("approvedLimits.startPressCaps not approved")
    recurring = req.get("priority") == "nightly-regression"
    for k in ("cumulativeCeilingRequests", "identityCap", "runCapRequests"):
        if appr.get(k) is None and not recurring:
            owner_missing.append("approvedLimits.%s not approved" % k)
    prop = req.get("proposedLimits") or {}
    for k, cur_k in (("startsCap", "starts"), ("takesCap", "takes")):
        if rc and not recurring and prop.get(k) is not None and prop[k] > rc["ceilings"][cur_k] and appr.get(k) is None:
            owner_missing.append("approvedLimits.%s not approved (proposed %s above the current %s)" % (k, prop[k], rc["ceilings"][cur_k]))
    if not appr.get("approvalRef") and not recurring:
        owner_missing.append("approval reference missing")
    if not parse_utc(win.get("startUtc")) or not parse_utc(win.get("endUtc")) or not win.get("approvalRef"):
        owner_missing.append("run window (start, end, approval reference) not set")
    else:
        mins = (parse_utc(win["endUtc"]) - parse_utc(win["startUtc"])).total_seconds() / 60
        if mins <= 0 or mins > lim["maxWindowMinutes"]:
            need.append("window length %.0f min is outside 1..%d" % (mins, lim["maxWindowMinutes"]))
        if parse_utc(win["endUtc"]) <= now:
            need.append("window has ended")
        wm = (est.get("window") or {}).get("worstCaseMinutes")
        if req.get("coverageMode") == "full" and wm and mins < wm and not win.get("acceptedShortWindowRisk"):
            need.append("window %.0f min is shorter than the worst case %d min of the full-coverage budget; a case cut by the clock makes the run not a full live run (record window.acceptedShortWindowRisk with the owner's reference to accept that risk)" % (mins, wm))
    if rc and not owner_missing and not recurring:
        rq = (est.get("requests") or {})
        required = rc["requests"]["conservativeUsed"] + appr["runCapRequests"] + rc["ceilings"]["protectedReserveRequests"] + est["identityReads"]
        if required > appr["cumulativeCeilingRequests"]:
            need.append("reconciled used %s + run cap %s + protected reserve %s + identity reads %s = %s exceeds the approved ceiling %s" % (rc["requests"]["conservativeUsed"], appr["runCapRequests"], rc["ceilings"]["protectedReserveRequests"], est["identityReads"], required, appr["cumulativeCeilingRequests"]))
        if rc["identityReads"]["conservativeUsed"] + est["identityReads"] > appr["identityCap"]:
            need.append("reconciled identity used + reads exceeds the approved identity cap")
        for k, used_k, planned_k, label in (("startsCap", "starts", "starts", "Starts"), ("takesCap", "takes", "takes", "takes")):
            cap_ = appr.get(k) if appr.get(k) is not None else rc["ceilings"][used_k]
            if rc[used_k]["ownerCounted"] + est[planned_k] > cap_:
                need.append("%s used %d + planned %d exceeds the approved cap %s" % (label, rc[used_k]["ownerCounted"], est[planned_k], cap_))
        if appr["runCapRequests"] < rq.get("runCap", 0):
            need.append("approved run cap is below the estimated cap")
    if rc is None:
        need.append("cumulative reconciliation not supplied")
    st = READY if not need and not owner_missing else (NOTREADY if need else OWNER)
    G.append(gate("G5", st, ("window set; the run's limits come from the standing approval (G11)" if recurring else "limits reconciled and approved") if st == READY else "limits or window not approved", owner_missing + need))
    # G6
    need = []
    created = parse_utc(req.get("createdUtc"))
    wstart = parse_utc(win.get("startUtc"))
    for gid in req.get("targetedGaps") or []:
        ep = (gaps.get(gid) or {}).get("expectedPass") or {}
        d = parse_utc(ep.get("definedAtUtc"))
        if not d or not all(ep.get(k) for k in ("criteria", "stimulus", "observer", "requirements")):
            need.append("%s expected PASS incomplete" % gid)
        elif wstart and d >= wstart:
            need.append("%s expected PASS defined after the window start" % gid)
        elif created and d > created:
            need.append("%s expected PASS defined after the request" % gid)
        if not ep.get("confirmedByOwner"):
            need.append("%s expected PASS not yet confirmed by the owner" % gid)
    only_owner = need and all("confirmed by the owner" in n for n in need)
    G.append(gate("G6", READY if not need else (OWNER if only_owner else NOTREADY), "expected PASS defined before testing for every targeted gap" if not need else "expected PASS not final", need))
    # G7: sealed, hash-pinned receipts of the compared runs and their binding verification. In latest-run mode (Sam 1793472272.951949) the one
    # prior is the validated run inputs' first-run declaration or sanitized terminal record; historical prior runs in the request are a mixed mode.
    if run_inputs is not None:
        need = ["latest-run mode does not compare historical prior runs; the request names %s" % ", ".join(p.get("label", "?") for p in req["priorRuns"])] if req.get("priorRuns") else []
        prior = run_inputs["prior"]
        G.append(gate("G7", READY if not need else NOTREADY, ("latest-run mode: first run declared" if prior["mode"] == "first-run" else
                      "latest-run mode: prior terminal record of run %s (%s)" % (prior["record"]["runId"], prior["record"]["outcome"])) if not need else "mixed history modes", need))
    else:
        G.append(historical_prior_gate(req, cfg, base, receipts_root))
    # G8
    need = []
    if req.get("workflowVersion") != wf["version"]:
        need.append("request names workflow %s, package is %s" % (req.get("workflowVersion"), wf["version"]))
    if not isinstance(req.get("deviations"), list):
        need.append("deviations list missing")
    G.append(gate("G8", READY if not need else NOTREADY, "workflow version named and deviations declared (%d)" % len(req.get("deviations") or []) if not need else "workflow version or deviations missing", need))
    # G9
    v = validation or {}
    G.append(gate("G9", READY if v.get("valid") else NOTREADY, "purpose, targeted gaps and estimate accepted" if v.get("valid") else "run request validation failed", v.get("errors") or ([] if v else ["validation not run"])))
    # G10
    oc = offline_checks or {}
    ok = oc.get("passed") is True
    G.append(gate("G10", READY if ok else NOTREADY, "offline checks passed" if ok else "offline checks not recorded as passed", [] if ok else ["run the offline checks (package tests, report tests, offline-proof index)"]))
    # G11
    G.append(recurring_gate(req, cfg, base, index, now, reservations, approval_path))
    blocking = [g for g in G if g["status"] not in (READY, DEFERRED)]
    return {"schema": "speaksharp.cloud-test.gate-status.v2", "runId": req.get("runId"), "workflowVersion": wf["version"], "evaluatedUtc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "stage": stage, "decision": "GO" if not blocking else "NO-GO", "deferred": [g["id"] for g in G if g["status"] == DEFERRED], "gates": G,
            "blockingOpen": [g["id"] for g in blocking], "ownerInputsOpen": [g["id"] for g in G if g["status"] == OWNER]}


def main():
    a = argparse.ArgumentParser()
    for k in ("request", "config", "ledger", "workflow", "release-verification", "reconciliation", "base", "out"):
        a.add_argument("--" + k, required=True)
    for k in ("validation", "offline-checks", "stimulus-receipt", "now", "history-index", "reservations", "receipts-root", "approval", "run-inputs"):
        a.add_argument("--" + k)
    a.add_argument("--stage", choices=["preflight", "final"], default="final")
    x = a.parse_args()
    req = load(x.request)
    if req.get("priority") == "nightly-regression" and not (x.history_index and x.reservations and x.approval):
        a.error("recurring gates require explicit --history-index, --reservations and --approval inputs")
    run_inputs = None
    if x.run_inputs:
        if x.history_index or x.reservations:
            a.error("latest-run inputs and historical --history-index/--reservations are mixed history modes")
        from init_run_inputs import load_run_inputs
        run_inputs = load_run_inputs(load(x.run_inputs), source_sha=(req.get("release") or {}).get("testedSha"))
    rec = load(x.stimulus_receipt) if x.stimulus_receipt and os.path.exists(x.stimulus_receipt) else None
    out = evaluate(req, load(x.config), load(x.ledger), load(x.workflow), load(x.validation) if x.validation else None,
                   load(x.offline_checks) if x.offline_checks else None, rec, x.base, x.stage, load(x.release_verification), load(x.reconciliation),
                   parse_utc(x.now) if x.now else None, x.receipts_root, load(x.history_index) if x.history_index else None,
                   load(x.reservations) if x.reservations else None, x.approval, run_inputs)
    dump(out, x.out)
    print("decision:", out["decision"], "| blocking open:", ",".join(out["blockingOpen"]) or "none")


if __name__ == "__main__":
    main()
