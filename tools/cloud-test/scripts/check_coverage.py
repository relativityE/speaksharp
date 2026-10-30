#!/usr/bin/env python3
"""Completeness check for a finished run: did it execute every required assertion row of the pinned catalog? Offline; reads files only.
A row is EXECUTED when its recorded result is PASS or FAIL. NOT RUN, a missing row, or a case that never started is NOT executed.
A full live run (the only result that may be called the passing 15-journey result) needs ALL of: coverageMode full; results that belong to THIS request
(campaign id and tested SHA); all 15 journeys present; no safety stop; every identity read MATCHes the tested SHA (deployed-version binding); and EVERY catalog row executed (204 of 204). An approved omission (named in the
request's approvedOmissions with a reason and an approval reference) is a named gap, not coverage: it is listed in the report and the run stays INCOMPLETE
(fullLiveRun false) however it was approved. A partial run, a run with NOT RUN rows (approved or not) and carried-forward verdicts are never a full live run.
Usage: check_coverage.py --request R.json --catalog assertion-catalog.json [--case-results case-results.json] --out coverage.json"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import load, dump, request_mode  # noqa: E402

EXECUTED = ("PASS", "FAIL")


def deployed_version_binding(req, results):
    """Is every result bound to the deployed version that was tested? The served SHA read from the live site before and after each journey (and at the end) must be
    the request's tested SHA and must MATCH; the results' own source and served SHA must be it too. No identity receipt at all is 'unproven', never 'ok'."""
    want = (req.get("release") or {}).get("testedSha")
    problems, checked = [], 0
    for k in ("sourceSha", "servedSha"):
        if results.get(k) != want:
            problems.append("results %s %s is not the tested SHA %s" % (k, str(results.get(k))[:8], str(want)[:8]))
    for row in results.get("cases", []):
        for phase in ("identityBefore", "identityAfter"):
            r = row.get(phase)
            if r is None:
                if row.get("gateBlocked") or row.get("requestBudgetSkipped"):
                    continue
                problems.append("%s has no %s receipt" % (row.get("caseId"), phase))
                continue
            checked += 1
            if r.get("result") != "MATCH" or r.get("servedSha") != want or r.get("expectedSha") != want:
                problems.append("%s %s: served %s expected %s result %s (tested SHA %s)" % (row.get("caseId"), phase, str(r.get("servedSha"))[:8], str(r.get("expectedSha"))[:8], r.get("result"), str(want)[:8]))
    fi = results.get("finalIdentity")
    if fi != "MATCH":
        problems.append("the final identity read is %s, not MATCH" % fi)
    if checked == 0:
        problems.append("no identity receipt exists: the deployed version was never read, so the results are not bound to it")
    return {"ok": not problems, "testedSha": want, "receiptsChecked": checked, "problems": problems[:12], "problemCount": len(problems)}


def assess(req, catalog, results):
    mode = request_mode(req)
    cases = catalog["cases"]
    total = sum(len(v["requiredAssertions"]) for v in cases.values())      # counted from the rows, never trusted from a stored total
    out = {"schema": "speaksharp.cloud-test.coverage.v1", "derived": True, "runId": req.get("runId"), "coverageMode": mode, "rowsRequired": total, "casesRequired": len(cases)}
    if results is None:
        out.update({"kind": "NO RUN", "fullLiveRun": False, "rowsExecuted": 0, "reasons": ["no results exist for this request yet"], "cases": [], "missing": [], "approvedOmissionsApplied": [], "unexpectedRows": []})
        return out
    reasons = []
    if results.get("campaignId") != req.get("runId"):
        reasons.append("the results belong to %s, not to this request (%s)" % (results.get("campaignId"), req.get("runId")))
    if results.get("sourceSha") != (req.get("release") or {}).get("testedSha"):
        reasons.append("the results were produced on a different SHA than the request tested")
    if results.get("safetyStopped"):
        reasons.append("the run stopped for safety before all journeys finished")
    rows = {c["caseId"]: c for c in results.get("cases", [])}
    omissions = {(o["case"], o["assertion"]): o for o in (req.get("approvedOmissions") or []) if o.get("case") and o.get("assertion") and o.get("reason") and o.get("approvalRef")}
    per, missing, applied, unexpected = [], [], [], []
    executed_total = 0
    for cid, spec in cases.items():
        req_ids = spec["requiredAssertions"]
        got = {a["id"]: a["result"] for a in (rows.get(cid) or {}).get("assertions", [])}
        ex = [i for i in req_ids if got.get(i) in EXECUTED]
        miss = [i for i in req_ids if got.get(i) not in EXECUTED]
        executed_total += len(ex)
        for i in miss:
            if (cid, i) in omissions:
                applied.append({"case": cid, "assertion": i, "reason": omissions[(cid, i)]["reason"], "approvalRef": omissions[(cid, i)]["approvalRef"]})
            else:
                missing.append({"case": cid, "assertion": i, "recorded": got.get(i, "absent")})
        unexpected += [{"case": cid, "assertion": i} for i in got if i not in req_ids]
        per.append({"case": cid, "required": len(req_ids), "executed": len(ex), "notExecuted": miss, "caseStarted": cid in rows})
    binding = deployed_version_binding(req, results)
    if not binding["ok"]:
        reasons.append("the results are not bound to the deployed version that was tested (%s)" % binding["problems"][0])
    if mode != "full":
        reasons.append("a partial run does not claim full coverage")
    if len(rows) < len(cases):
        reasons.append("%d of %d journeys have no result" % (len(cases) - len(rows), len(cases)))
    if missing:
        reasons.append("%d required row(s) were not executed and are not approved omissions" % len(missing))
    if applied:
        reasons.append("%d required row(s) were not executed and are approved omissions: approved, but coverage is incomplete, so this is not a full %d-row pass" % (len(applied), total))
    if executed_total != total and not reasons:
        reasons.append("%d of %d required rows executed" % (executed_total, total))
    full = not reasons and executed_total == total
    out.update({"kind": "FULL" if full else ("FULL-INCOMPLETE (approved omissions)" if mode == "full" and applied and not missing else ("FULL-INCOMPLETE" if mode == "full" else "PARTIAL")), "fullLiveRun": full, "deployedVersionBinding": binding,
                "coverageComplete": executed_total == total and not applied and not missing,
                "rowsExecuted": executed_total, "reasons": reasons, "cases": per, "missing": missing, "approvedOmissionsApplied": applied, "unexpectedRows": unexpected,
                "statement": "%d of %d required rows executed%s" % (executed_total, total, "; %d approved omission(s) remain visible as incomplete coverage" % len(applied) if applied else "")})
    return out


def main():
    a = argparse.ArgumentParser()
    for k in ("request", "catalog", "out"):
        a.add_argument("--" + k, required=True)
    a.add_argument("--case-results")
    x = a.parse_args()
    res = load(x.case_results) if x.case_results and os.path.exists(x.case_results) else None
    out = assess(load(x.request), load(x.catalog), res)
    dump(out, x.out)
    print("coverage: %s; %s" % (out["kind"], out.get("statement") or "; ".join(out["reasons"])))


if __name__ == "__main__":
    main()
