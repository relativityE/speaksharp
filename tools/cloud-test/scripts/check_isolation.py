#!/usr/bin/env python3
"""Isolation and cleanup proof for a recurring run (evidence schema isolation.v2). Offline; reads files only. The proof is NEVER assumed: with no evidence the
status is 'not-proven'; with evidence that breaks any rule it is 'failed'; only complete, fresh, account-bound evidence is 'proven'.
A run is proven isolated only when ALL hold:
  ACCOUNT   the evidence names the dedicated nightly account by the sha256 of its id, equal to the account the request declares (nightly.accountIdSha256) and to
            the account of the plan; the before and after queries were made for that same account; the account is not a shared fixture;
  BEFORE    a clean-start query of the account's WHOLE scope (every record of the account, not only a new marker) with a valid UTC time that precedes the run's start
            (and is not older than the allowed lead): it found no records at all (the baseline) and none left by an earlier run or carrying another run's marker;
  AFTER     a post-cleanup query of the same scope made after the run ended: no records remain, none carries this run's marker, no owned page or process remains;
  BALANCE   every record the run created was deleted (created equals deleted);
  FRESH     the evidence belongs to THIS run (run id, marker, and an execution window that matches the sealed run's own start and end), was generated after the
            after-query, and is not older than the allowed age;
  CHAIN     the marker differs from the previous run's, and the previous run's final state equals this run's clean-start state (nothing changed between runs).
Usage: check_isolation.py --request R.json [--isolation isolation.json] [--previous-isolation isolation.json] [--expected-account-sha SHA] [--run-start ISO --run-end ISO]
          [--now ISO] [--config C.json] --out result.json      Exit 0 always; 'status' and 'proven' are in the file."""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, dump, parse_utc, is_hex64  # noqa: E402

SHARED_KINDS = ("shared-fixture", "maintained-free", "maintained-pro", "checkout", "soak", "canary")
DEFAULTS = {"beforeMaxLeadMinutes": 120, "afterMaxLagMinutes": 120, "windowToleranceMinutes": 10, "maxEvidenceAgeHours": 48, "baselineRecords": 0}


def result(req, status, problems, marker=None):
    return {"schema": "speaksharp.cloud-test.isolation-result.v2", "runId": req.get("runId"), "status": status, "proven": status == "proven", "problems": problems, "marker": marker}


def check(req, iso, prev=None, expected_account=None, run_window=None, now=None, limits=None):
    lim = dict(DEFAULTS)
    lim.update(limits or {})
    if iso is None:
        return result(req, "not-proven", ["no isolation.json: isolation and cleanup are not proven (the harness does not emit this evidence yet)"])
    P = []
    if iso.get("schema") != "speaksharp.cloud-test.isolation.v2":
        P.append("isolation evidence schema is %r, not isolation.v2 (an older evidence format cannot prove account binding or old-run residue)" % iso.get("schema"))
    if iso.get("runId") != req.get("runId"):
        P.append("isolation.json belongs to run %r, not %r" % (iso.get("runId"), req.get("runId")))
    marker = iso.get("marker") or ""
    if not marker or str(req.get("runId")) not in marker:
        P.append("the data marker does not name this run")
    # ACCOUNT
    acct = iso.get("account") or {}
    b, a, c, d = iso.get("before") or {}, iso.get("after") or {}, iso.get("created") or {}, iso.get("deleted") or {}
    if acct.get("kind") in SHARED_KINDS or acct.get("dedicated") is not True:
        P.append("the account is not a dedicated nightly test account (kind %r, dedicated %r)" % (acct.get("kind"), acct.get("dedicated")))
    sha = acct.get("idSha256")
    if not is_hex64(sha):
        P.append("the evidence does not identify the account (account.idSha256 is not a sha256)")
    declared = expected_account or (req.get("nightly") or {}).get("accountIdSha256")
    if not declared:
        P.append("no account binding is declared: the request names no nightly.accountIdSha256, so the evidence cannot be tied to the account under test")
    elif sha != declared:
        P.append("the evidence is for account %s, not the declared account %s (mismatched account)" % (str(sha)[:12], str(declared)[:12]))
    for name, q in (("before", b), ("after", a)):
        if q.get("accountIdSha256") != sha:
            P.append("the %s query was made for account %s, not %s" % (name, str(q.get("accountIdSha256"))[:12], str(sha)[:12]))
    # TIMES
    run = iso.get("run") or {}
    rs, re_ = parse_utc(run.get("startedUtc")), parse_utc(run.get("endedUtc"))
    qb, qa, gen = parse_utc(b.get("queriedUtc")), parse_utc(a.get("queriedUtc")), parse_utc(iso.get("generatedUtc"))
    tol = lim["windowToleranceMinutes"] * 60
    if not rs or not re_ or re_ <= rs:
        P.append("the execution window (run.startedUtc, run.endedUtc) is missing or invalid")
    if run_window:
        ws, we = run_window
        if ws and rs and abs((rs - ws).total_seconds()) > tol:
            P.append("the evidence's run start %s does not match the sealed run's start %s" % (run.get("startedUtc"), ws.strftime("%Y-%m-%dT%H:%M:%SZ")))
        if we and re_ and abs((re_ - we).total_seconds()) > tol:
            P.append("the evidence's run end %s does not match the sealed run's end %s (evidence from another run?)" % (run.get("endedUtc"), we.strftime("%Y-%m-%dT%H:%M:%SZ")))
    # BEFORE
    if not qb:
        P.append("the clean-start query has no valid UTC time")
    elif rs and qb > rs:
        P.append("the clean-start query (%s) was made after execution began (%s)" % (b.get("queriedUtc"), run.get("startedUtc")))
    elif rs and (rs - qb).total_seconds() > lim["beforeMaxLeadMinutes"] * 60:
        P.append("the clean-start query is %d minutes older than the run (limit %d): stale" % ((rs - qb).total_seconds() // 60, lim["beforeMaxLeadMinutes"]))
    if not b.get("source") or not a.get("source"):
        P.append("a query has no source")
    if b.get("scope") != "account-all-records" or a.get("scope") != "account-all-records":
        P.append("the queries did not cover the account's whole scope (scope must be account-all-records): an empty new marker does not show that nothing was left by an earlier run")
    base = lim["baselineRecords"]
    for fld, label in (("totalRecords", "records in the account"), ("recordsFromEarlierRuns", "records left by earlier runs"), ("recordsWithOtherMarkers", "records carrying another run's marker")):
        if not isinstance(b.get(fld), int):
            P.append("the clean-start query does not report %s" % label)
    if isinstance(b.get("totalRecords"), int) and b["totalRecords"] != base:
        P.append("the clean-start query found %d record(s) in the account (baseline %d): residue" % (b["totalRecords"], base))
    if isinstance(b.get("recordsFromEarlierRuns"), int) and b["recordsFromEarlierRuns"] != 0:
        P.append("the clean-start query found %d record(s) left by earlier runs" % b["recordsFromEarlierRuns"])
    if isinstance(b.get("recordsWithOtherMarkers"), int) and b["recordsWithOtherMarkers"] != 0:
        P.append("the clean-start query found %d record(s) with another run's marker" % b["recordsWithOtherMarkers"])
    # AFTER
    if not qa:
        P.append("the post-cleanup query has no valid UTC time")
    elif re_ and qa < re_:
        P.append("the post-cleanup query (%s) was made before the run ended (%s)" % (a.get("queriedUtc"), run.get("endedUtc")))
    elif re_ and (qa - re_).total_seconds() > lim["afterMaxLagMinutes"] * 60:
        P.append("the post-cleanup query is %d minutes after the run ended (limit %d): stale" % ((qa - re_).total_seconds() // 60, lim["afterMaxLagMinutes"]))
    if a.get("totalRecords") != base:
        P.append("the post-cleanup query found %s record(s) in the account (baseline %d)" % (a.get("totalRecords"), base))
    if a.get("markedRecordsRemaining") != 0:
        P.append("the post-cleanup query found %s marked record(s) remaining" % a.get("markedRecordsRemaining"))
    if a.get("ownedPagesOpen") != 0 or a.get("ownedProcessesRunning") != 0:
        P.append("an owned page or process remains (pages %s, processes %s)" % (a.get("ownedPagesOpen"), a.get("ownedProcessesRunning")))
    if c != d or not c:
        P.append("records created %s differ from records deleted %s" % (c, d))
    # FRESH
    if not gen:
        P.append("the evidence has no valid generation time")
    else:
        if qa and gen < qa:
            P.append("the evidence claims to be generated before its own post-cleanup query")
        if now is not None and (now - gen).total_seconds() > lim["maxEvidenceAgeHours"] * 3600:
            P.append("the evidence is %d hours old (limit %d): stale" % ((now - gen).total_seconds() // 3600, lim["maxEvidenceAgeHours"]))
    # CHAIN
    if prev is not None:
        if prev.get("marker") == marker:
            P.append("the marker is the same as the previous run's: a repeat run must not reuse its data")
        pd, bd = (prev.get("after") or {}).get("stateDigest"), b.get("stateDigest")
        if not pd or not bd:
            P.append("the state digest is missing, so continuity with the previous run cannot be shown")
        elif pd != bd:
            P.append("the account changed between the previous run's final state and this run's clean start (state digest differs)")
    return result(req, "proven" if not P else "failed", P, marker or None)


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--request", required=True)
    for k in ("isolation", "previous-isolation", "expected-account-sha", "run-start", "run-end", "now", "config"):
        a.add_argument("--" + k)
    a.add_argument("--out", required=True)
    x = a.parse_args()
    req = load(x.request)
    cfg = load(x.config or os.path.join(ROOT, "config", "test-config.v1.json"))
    window = (parse_utc(x.run_start), parse_utc(x.run_end)) if x.run_start or x.run_end else None
    out = check(req, load(x.isolation) if x.isolation and os.path.exists(x.isolation) else None, load(x.previous_isolation) if x.previous_isolation and os.path.exists(x.previous_isolation) else None,
                x.expected_account_sha, window, parse_utc(x.now) if x.now else None, (cfg.get("nightly") or {}).get("isolation", {}).get("limits"))
    dump(out, x.out)
    print("isolation: %s%s" % (out["status"].upper(), "" if out["proven"] else " - " + "; ".join(out["problems"][:2])))


if __name__ == "__main__":
    main()
