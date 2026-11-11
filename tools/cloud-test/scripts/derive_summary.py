#!/usr/bin/env python3
"""Derives the executive-summary fields from evidence. Nothing is authored: status, customer impact, what deployed, good / bad / unknown against both
prior runs (and Latest when it exists), proven gap closures, spend, blockers and the recommendation are computed from the comparison, the derived
gap ledger, the release verification, the gate status and the spend report. The words stay within the workflow limit by listing at most N items per
field and saying how many more exist.
Usage: derive_summary.py --comparison C_prior.json [--latest-comparison C_latest.json] --ledger-derived LD.json --release-verification RV.json
          --gates G.json --spend S.json --workflow W.json --request R.json --out summary.json
Rules: pre-run status is BLOCKED while any blocking gate is open, else LIMITED (nothing new tested). Post-run: BLOCKED if a blocking gate is open, a targeted
product fix FAILED its retest or a journey regressed. READY only when ALL hold: the safety checks pass (isolation proven, no open critical or blocking alert, evidence fresh, usage within every cap); the latest run is a FULL LIVE RUN (check_coverage.py: full mode, all 15 journeys, every required row executed or an approved omission; partial and carried-forward results never qualify); no blocking gate; every one of the 15 journeys PASSES on this release
(the latest verdict for a selected case; a carried-forward previous verdict for an unselected case only when both runs served the same release); no journey
FAILS anywhere, including unchanged failures outside the selected test; no incomplete coverage; no inconclusive selected journey; every TRACKED gap CLOSED.
Otherwise LIMITED.
Recommendation: READY -> PROCEED; BLOCKED -> FIX AND RETEST; LIMITED -> HOLD while gates are open, else FIX AND RETEST; pre-run NO-GO -> HOLD, pre-run GO -> PROCEED."""
import argparse
import collections
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import load, dump, words, comparison_errors  # noqa: E402

REASON_TEXT = {"stimulus-not-established": "stimulus not established", "media-binding-differs": "capture-device binding differed", "coverage-lost": "coverage lost",
               "omitted-by-design": "omitted by design", "allowance-interrupted": "stopped by the request allowance", "observer-changed": "observer changed",
               "observer-unproven": "observer not shown unchanged", "no-prior-verdict": "no prior verdict", "driver-changed": "driver changed"}


PRIORITY = ("media-binding-differs", "allowance-interrupted", "omitted-by-design", "observer-changed", "stimulus-not-established", "driver-changed", "no-prior-verdict")
REASON_TEXT["prior-incomplete"] = "prior run incomplete, observer not shown unchanged"


def reason_group(j):
    rs = j.get("reasons", [])
    for code in PRIORITY:
        for r in rs:
            if r["code"] != code:
                continue
            if code == "stimulus-not-established" and not r["text"].startswith("stimulus not established in current") and "and current" not in r["text"]:
                continue
            return code
    return "prior-incomplete"


def cap(items, n, more="more"):
    items = list(items)
    if len(items) <= n:
        return items
    return items[:n] + ["+%d %s" % (len(items) - n, more)]


def current_state(cmp_prior, cmp_latest, req):
    """The verdict of every journey on the release under test: the latest run's verdict for a selected case; for a case that was not selected, the previous
    run's verdict ONLY when both runs served the same release (carried forward, labelled), otherwise NOT RUN. Unchanged failures outside the selected
    test are therefore never hidden, and incomplete coverage is visible."""
    selected = {x["case"] for x in req.get("selection", [])}
    if cmp_latest is None:
        return [{"id": j["id"], "verdict": j["cur"], "carried": False, "cls": j["class"]} for j in cmp_prior["journeys"]]
    same = cmp_latest["previous"].get("servedSha") == cmp_latest["current"].get("servedSha")
    out = []
    for j in cmp_latest["journeys"]:
        v, carried = j["cur"], False
        if j["id"] not in selected:
            if same and j["prev"] != "NOT RUN":
                v, carried = j["prev"], True
            else:
                v = "NOT RUN"
        out.append({"id": j["id"], "verdict": v, "carried": carried, "cls": j["class"] if j["id"] in selected else "not-selected"})
    return out


def derive(cmp_prior, cmp_latest, ld, rv, gates, spend, wf, req, limit=None, coverage=None, alerts=None, isolation=None):
    latest = cmp_latest is not None
    cmpx = cmp_latest if latest else cmp_prior
    labels = (cmpx["previous"]["label"], cmpx["current"]["label"])
    J = cmpx["journeys"]
    pre = not latest
    blocking = [g for g in gates["gates"] if g["status"] not in ("READY", "DEFERRED-TO-RUNNER")]
    names = {g["id"]: g["name"] for g in wf["gates"]}
    # good / bad / unknown
    good, bad, unknown = [], [], []
    runs = ("R4C", "R5") + ((cmp_latest["current"]["label"],) if latest else ())
    if latest:
        for j in J:
            if j["class"] == "improved":
                good.append("%s improved" % j["id"])
    stable = [j["id"] for j in J if j["prev"] == "PASS" and j["cur"] == "PASS" and j["class"] == "unchanged"]
    if stable:
        good.append("%s PASS in %s" % (", ".join(cap(stable, 3)), " and ".join(labels)))
    fails = collections.defaultdict(list)
    for j in J:
        if j["cur"] == "FAIL" or (j["class"] == "regressed"):
            fails[j["class"]].append(j["id"])
    disputed = [j["id"] for j in J if j.get("disputed_rows")]
    if disputed:
        bad.append("%s FAIL in both runs on a disputed oracle (not scored)" % ", ".join(cap(disputed, 3)))
    for j in J:
        if j["cur"] == "FAIL" and j["id"] not in disputed:
            bad.append("%s FAIL (%s)" % (j["id"], "regressed" if j["class"] == "regressed" else j["class"]))
    for g in ld["gaps"]:
        sig = [(r, o) for r, h in g["history"].items() for o in h["observations"] if "signal" in o and o["count"] > 0]
        if sig:
            bad.append("%s observed in %s" % (sig[0][1]["signal"], ", ".join("%s (%d)" % (r, o["count"]) for r, o in sig)))
    groups = collections.defaultdict(list)
    for j in J:
        if j["class"] == "inconclusive":
            groups[reason_group(j)].append(j["id"])
    for code, ids in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        unknown.append("%s: %s" % (", ".join(cap(ids, 4)), REASON_TEXT[code]))
    # deployed
    sl, sb = rv.get("sinceLastRun"), rv.get("sinceBaseline")
    if sl is None:
        deployed = "Cannot verify: git history for the tested release is not available."
    elif not sl:
        deployed = "Nothing since the last run (tested SHA %s unchanged)." % rv["testedSha"][:8]
    else:
        deployed = "%d commit(s): %s." % (len(sl), "; ".join("#%s %s" % (c["pr"], "customer-facing" if c["customerFacing"] else "no product code") for c in sl[:4]))
    if sb:
        cf = [c for c in sb if c["customerFacing"]]
        linked = {f["pr"]: gid for gid, f in rv["fixes"].items() if f.get("pr")}
        deployed += " Since %s: %d commits, %d customer-facing (%s)." % (rv.get("baselineLabel", "R4C"), len(sb), len(cf), ", ".join("#%s%s" % (c["pr"], "/" + linked[c["pr"]] if c["pr"] in linked else "") for c in cf[:6]))
    verified = [gid for gid, f in rv["fixes"].items() if f["inclusion"] == "cloud-verified" and not f.get("candidate")]
    if verified:
        deployed += " Verified deployed: %s." % ", ".join("%s (#%s)" % (g, rv["fixes"][g]["pr"]) for g in verified)
    closed = [g["id"] for g in ld["gaps"] if g["status"] == "CLOSED"]
    targeted = req["targetedGaps"]
    failed = [g["id"] for g in ld["gaps"] if g["id"] in targeted and g["status"] == "FAILED-RETEST"]
    regressed = [j["id"] for j in J if j["class"] == "regressed"]
    state = current_state(cmp_prior, cmp_latest, req)
    selected = {x["case"] for x in req.get("selection", [])}
    inconc = [j["id"] for j in J if j["class"] == "inconclusive" and (not latest or j["id"] in selected)]
    st_fail = [x["id"] for x in state if x["verdict"] == "FAIL"]
    st_pass = [x["id"] for x in state if x["verdict"] == "PASS"]
    st_inc = [x["id"] for x in state if x["verdict"] == "NOT RUN"]
    gaps_open = [g["id"] for g in ld["gaps"] if g["status"] != "CLOSED"]
    gates_open = [g["id"] for g in blocking]
    basis = {"journeysPass": len(st_pass), "journeysFail": st_fail, "journeysNotShownPass": st_inc, "carriedForward": [x["id"] for x in state if x["carried"]],
             "inconclusiveSelected": inconc, "gapsNotClosed": gaps_open, "gatesOpen": gates_open, "targetedNotClosed": [g for g in targeted if g not in closed]}
    full_ok = bool(coverage and coverage.get("fullLiveRun"))
    basis["runKind"] = (coverage or {}).get("kind", "NO RUN")
    basis["fullLiveRun"] = full_ok
    # SAFETY CHECKS belong to the headline verdict: 204 passing rows are not READY when isolation failed, the evidence is stale, an alert is open or usage exceeded a cap
    safety = safety_state(latest, spend, alerts, isolation, req)
    basis["safety"] = safety
    ready = (not gates_open and not st_fail and not st_inc and not inconc and not gaps_open and not failed and not regressed and latest and full_ok and not safety["blocksReady"])
    readiness = "%d of 15 journeys PASS on this release%s; failing: %s; not shown PASS: %s; tracked gaps not closed: %s; gates open: %s" % (
        len(st_pass), " (%d carried forward from the previous run on the same release)" % len(basis["carriedForward"]) if basis["carriedForward"] else "",
        ", ".join(cap(st_fail, 4)) or "none", len(st_inc) if len(st_inc) > 4 else (", ".join(st_inc) or "none"), len(gaps_open), ", ".join(gates_open) or "none")
    readiness += "; run kind: %s%s" % (basis["runKind"], " (%s)" % coverage["statement"] if coverage and coverage.get("statement") else "")
    if latest and not full_ok:
        readiness += "; not a full live run, so READY is not available (partial and carried-forward results do not count)"
    if latest:
        readiness += "; safety: " + safety["text"]
    if pre:
        held = gates["decision"] != "GO" or safety["blocks"]  # a known safety failure holds even when every gate is GO
        status = "BLOCKED" if held else "LIMITED"
        impact = "No run result exists since %s; customers have the release %s tested, and no change since then is customer-facing." % (labels[1], labels[1]) if not (sl or []) else "No run result exists yet for the %d change(s) since the last run." % len(sl)
        rec = "HOLD" if held else "PROCEED"
        if safety["blocks"]:
            impact = "A safety check failed: %s." % safety["text"]
            readiness += "; safety: " + safety["text"]
    else:
        status = "BLOCKED" if (failed or regressed or gates_open or safety["blocks"]) else ("READY" if ready else "LIMITED")
        impact = ("%d journey(s) FAIL or regressed in %s: %s." % (len(failed) + len(regressed), labels[1], ", ".join(cap(regressed + failed, 4))) if (failed or regressed)
                  else ("Known failures remain on this release outside the selected test: %s." % ", ".join(cap(st_fail, 4)) if st_fail else "No regression found in the journeys that were comparable; %d journey(s) are not shown PASS." % len(st_inc)))
        rec = {"READY": "PROCEED", "BLOCKED": "FIX AND RETEST" if (failed or regressed) else "HOLD"}.get(status) or "FIX AND RETEST"
        if safety["blocks"] and not (failed or regressed):
            impact = "A safety check failed: %s." % safety["text"]
    sp = spend
    if sp.get("requests", {}).get("actual"):
        a = sp["requests"]["actual"]["total"]
        spend_txt = "%s requests of cap %s (%s); remaining %s above the protected reserve; provider, GitHub and Cloud-agent costs: %s" % (a, sp["requests"]["cap"]["runCapRequests"], sp["status"], (sp.get("remainingAfterRun") or {}).get("requests"),
                                                                                                                           ", ".join("%s %s" % (k, v["status"]) for k, v in sp["costs"].items()))
    else:
        spend_txt = "none spent; estimate %s requests (cap %s); costs unknown: provider, GitHub, Cloud agent" % (sp["requests"]["estimate"]["planned"], sp["requests"]["estimate"]["runCap"])
    blockers = ["%s %s%s" % (g["id"], names.get(g["id"], ""), " (owner)" if g["status"] == "OWNER-INPUT-OPEN" else "") for g in blocking] or ["none"]
    fields = {"status": status, "purpose": req["purpose"], "customerImpact": impact, "deployedSinceLastRun": deployed,
              "good": good or ["none established"], "bad": bad or ["none observed"], "unknown": unknown or ["none"], "provenGapsClosed": closed, "readiness": readiness, "readinessBasis": basis, "runKind": basis["runKind"], "spend": spend_txt, "blockers": blockers, "recommendation": rec}
    if limit:
        for n in (3, 2, 1):
            f2 = dict(fields)
            for k in ("good", "bad", "unknown", "blockers"):
                f2[k] = cap(fields[k], n)
            if total_words(f2) <= limit:
                return f2
        return f2
    return fields


def safety_state(latest, spend, alerts, isolation, req):
    """The safety verdict of the latest run. blocks: a failed safety check (isolation failed, usage over a cap, a critical alert, a blocking high alert, stale evidence).
    blocksReady: anything that stops READY, including isolation that is merely not proven and evidence whose freshness is unknown for a nightly run."""
    if not latest:
        # Sam 1793618201.181979: a KNOWN failure stays authoritative while latest is PENDING (failed isolation, usage over a cap); freshness
        # and alerts belong to a latest run and stay unassessed. Without a known failure the result is exactly as before.
        iso_failed = (isolation or {}).get("status") == "failed"
        over = (spend or {}).get("withinCap") is False
        known = (["isolation FAILED"] if iso_failed else []) + (["usage OVER A CAP"] if over else [])
        return {"isolation": "failed" if iso_failed else None, "overCap": True if over else None, "alertsBlocking": [], "evidenceStale": None,
                "evidenceAgeHours": None, "blocks": bool(known), "blocksReady": bool(known),
                "text": "no latest run" + ("; known failure: " + ", ".join(known) if known else "")}
    iso = (isolation or {}).get("status") or ("proven" if (isolation or {}).get("proven") else ("not-proven" if isolation is not None else "not-proven"))
    over = (spend or {}).get("withinCap") is False
    al = (alerts or {}).get("alerts") or []
    hard = ("BINDING-MISMATCH", "MISSED-RUN", "OVER-CAP", "ISOLATION-RESIDUE", "REGRESSION", "NEW-FAILURE", "FEATURE-FAILING", "CONCERN-PROBLEM", "UNRESERVED-RUN")
    blocking = sorted({a["kind"] for a in al if a["severity"] == "critical" or (a["severity"] == "high" and a["kind"] in hard)})
    stale = (alerts or {}).get("evidenceStale")
    age = (alerts or {}).get("evidenceAgeHours")
    nightly = (req or {}).get("priority") == "nightly-regression"
    other_high = sorted({a["kind"] for a in al if a["severity"] == "high" and a["kind"] not in hard})
    blocks = iso == "failed" or over or bool(blocking) or stale is True
    blocks_ready = blocks or iso != "proven" or bool(other_high) or (nightly and stale is not False) or stale is True
    parts = ["isolation %s" % {"proven": "proven", "failed": "FAILED", "not-proven": "not proven"}.get(iso, iso),
             "usage %s" % ("OVER A CAP" if over else "within caps"),
             "alerts %s" % (", ".join(blocking + other_high) if (blocking or other_high) else "none open"),
             "evidence %s" % ("STALE (%sh)" % age if stale else ("fresh (%sh)" % age if stale is False else "age unknown"))]
    return {"isolation": iso, "overCap": over, "alertsBlocking": blocking + other_high, "evidenceStale": stale, "evidenceAgeHours": age, "blocks": blocks, "blocksReady": blocks_ready, "text": "; ".join(parts)}


def total_words(f):
    j = lambda x: "; ".join(x) if isinstance(x, list) else str(x)
    return sum(words(j(f[k])) + 2 for k in ("status", "customerImpact", "deployedSinceLastRun", "good", "bad", "unknown", "readiness", "spend", "blockers", "recommendation")) + len(f["provenGapsClosed"]) + 8


def nightly_history(baselines):
    """The carried-forward nightly history as the summary reports it (G7, Sam 1793576632.959179): how many retained occurrences, how many
    rows are comparable with this run, which rows still carry a comparable FAIL from an earlier night, and which journeys have no
    last-known-good. Derived only from select_baselines.py --history-state output."""
    if not baselines or baselines.get("source") != "carried-forward-history":
        return None
    rows = baselines.get("rows") or {}
    carried = sorted(k for k, r in rows.items() if r.get("comparable") and r.get("baselineVerdict") == "FAIL")
    return {"occurrences": len(baselines.get("occurrences") or []), "sequence": baselines.get("sequence"),
            "comparableRows": sum(1 for r in rows.values() if r.get("comparable")), "rowsTotal": len(rows),
            "carriedFailRows": len(carried), "carriedFailCases": sorted({k.split("/")[0] for k in carried}),
            "journeysWithoutLastKnownGood": sorted(c for c, j in (baselines.get("journeys") or {}).items()
                                                   if j.get("previousVerdict") is not None and j.get("lastKnownGood") is None)}


def nightly_headline(f, nh, gates, limit=None):
    """With qualified retained nightly evidence (RETURN 1793577431.476549), the headline is derived from it, never from the fixed R4C/R5
    bootstrap comparison, which is kept only as a labelled historical field. A comparable row still FAILing in the latest retained evidence
    makes the headline BLOCKED / FIX AND RETEST (a retest stays possible); otherwise the gate decision decides."""
    if not nh or not nh.get("occurrences"):
        return f
    f = dict(f)
    f["bootstrapHistorical"] = {k: f[k] for k in ("customerImpact", "deployedSinceLastRun", "good", "bad", "readiness")}
    f["comparisonBasis"] = "nightly carried-forward history (%d qualified occurrence(s), sequence %s); the R4C/R5 bootstrap comparison is historical only" % (
        nh["occurrences"], nh["sequence"])
    f["deployedSinceLastRun"] = "the latest retained nightly evidence is the comparison basis; the bootstrap releases are historical"
    if nh["carriedFailRows"]:
        cases = ", ".join(cap(nh["carriedFailCases"], 4))
        f["customerImpact"] = "%d comparable row(s) still FAIL in the latest retained nightly evidence: %s." % (nh["carriedFailRows"], cases)
        f["bad"] = ["carried nightly FAIL: %s" % cases]
        f["good"] = ["%d of %d rows comparable" % (nh["comparableRows"], nh["rowsTotal"])]
        f["readiness"] = "Not ready: the retained nightly evidence carries a FAIL in %s." % cases
        f["status"], f["recommendation"] = "BLOCKED", "FIX AND RETEST"
    else:
        # RETURN 1793578066.007679: carried history can only LOWER the headline. Without a carried FAIL, the status, readiness and
        # recommendation derived from the fresh-full-run and safety conditions stand (never promoted to READY/PROCEED by history, never a
        # safety HOLD overridden); only a FIX AND RETEST that rested on the historical bootstrap failures becomes HOLD.
        f["customerImpact"] = "No comparable row carries a FAIL in the latest retained nightly evidence (%d of %d rows comparable)." % (
            nh["comparableRows"], nh["rowsTotal"])
        f["bad"] = ["none in the retained nightly evidence"]
        f["good"] = ["%d of %d rows comparable, none carrying a FAIL" % (nh["comparableRows"], nh["rowsTotal"])]
        if f["recommendation"] == "FIX AND RETEST":
            f["recommendation"] = "HOLD"
    if limit:
        for n in (3, 2, 1):
            f2 = dict(f)
            for k in ("good", "bad", "unknown", "blockers"):
                f2[k] = cap(f[k], n)
            if total_words(f2) <= limit:
                return f2
        return f2
    return f


def main():
    a = argparse.ArgumentParser()
    for k in ("comparison", "ledger-derived", "release-verification", "gates", "spend", "workflow", "request", "out"):
        a.add_argument("--" + k, required=True)
    a.add_argument("--latest-comparison")
    a.add_argument("--coverage")
    a.add_argument("--alerts")
    a.add_argument("--isolation")
    a.add_argument("--nightly-baselines")
    x = a.parse_args()
    wf = load(x.workflow)
    req = load(x.request)
    comparison = load(x.comparison)
    labels = [p.get("label") for p in req.get("priorRuns") or []]
    errors = comparison_errors(comparison, labels)
    if errors:
        raise SystemExit("comparison evidence is incomplete: " + "; ".join(errors))
    latest = load(x.latest_comparison) if x.latest_comparison else None
    if latest:
        latest_errors = comparison_errors(latest, [latest.get("previous", {}).get("label"), latest.get("current", {}).get("label")])
        if latest_errors:
            raise SystemExit("latest comparison evidence is incomplete: " + "; ".join(latest_errors))
    f = derive(comparison, latest, load(x.ledger_derived), load(x.release_verification), load(x.gates), load(x.spend), wf, req, wf["report"]["executiveSummaryMaxWords"] - 70, load(x.coverage) if x.coverage else None,
                load(x.alerts) if x.alerts else None, load(x.isolation) if x.isolation else None)
    nh = nightly_history(load(x.nightly_baselines)) if x.nightly_baselines else None
    if nh is not None:
        f = nightly_headline(f, nh, load(x.gates), wf["report"]["executiveSummaryMaxWords"] - 70)
        f["nightlyHistory"] = nh
    dump({"schema": "speaksharp.cloud-test.summary.v2", "derived": True, "fields": f}, x.out)
    print("summary derived:", f["status"], f["recommendation"])


if __name__ == "__main__":
    main()
