#!/usr/bin/env python3
"""Builds run-record.json from the harness's original outputs after an execute run. Offline; reads files only; never prints identifiers.
Usage: collect_run_record.py --request R.json --case-results run/case-results.json --ledger-dir ledgers --gate-status G.json
                             --workflow W.json --started-utc T --ended-utc T --runner-json RUNNER.json --out run-record.json
RUNNER.json carries non-secret runner identity: {"os":..,"nodeVersion":..,"chromeVersion":..,"githubRunId":..,"githubRunAttempt":..,"githubSha":..}.
Spend comes only from the guard's own ledgers and case receipts (request counts by category, identity reads); no dollar figure is written here. Starts and takes are reported only if the harness records them; otherwise null."""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import load, dump, sha256_file  # noqa: E402
from derive_case_costs import count_actions  # noqa: E402

SHA256 = re.compile(r"^[0-9a-f]{64}$")


def consume_request(path, expected_sha256):
    if not isinstance(path, str) or not os.path.isabs(path) or os.path.realpath(path) != path:
        sys.exit("BLOCKED_SETUP: request path must be absolute and canonical")
    if not SHA256.fullmatch(expected_sha256 or ""):
        sys.exit("BLOCKED_SETUP: admitted request digest is missing or malformed")
    with open(path, "rb") as stream:
        request_bytes = stream.read()
    if hashlib.sha256(request_bytes).hexdigest() != expected_sha256:
        sys.exit("BLOCKED_SETUP: request changed since admission")
    try:
        return json.loads(request_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError):
        sys.exit("BLOCKED_SETUP: admitted request is not valid JSON")


def paid_actions(cr):
    """Executed / not executed, from the harness's paid-effect layer; never a dollar figure."""
    pc = cr.get("paidCheckout") or {}
    if pc.get("result") == "NOT RUN":
        return "none-executed"
    return "unknown"


def canonical_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def main():
    a = argparse.ArgumentParser()
    for k in ("request", "case-results", "ledger-dir", "gate-status", "workflow", "runner-json", "out"):
        a.add_argument("--" + k, required=True)
    a.add_argument("--request-sha256", required=True)
    a.add_argument("--execution-run-id", required=True)
    a.add_argument("--attempt", type=int, required=True)
    a.add_argument("--cases-dir", help="run/cases: Starts and takes are counted from each case's action-reservations.jsonl")
    a.add_argument("--admission-receipt", help="run/admission/admission-receipt.json: proves a stop before the identity read (P1-4)")
    a.add_argument("--prerequisite-receipt", help="the prerequisite preflight's content-free receipt: its closed request charge (P1-4)")
    a.add_argument("--source-sha", help="this workflow's source sha: the prerequisite preflight receipt must name it (P1-4)")
    a.add_argument("--started-utc")
    a.add_argument("--ended-utc")
    x = a.parse_args()
    req = consume_request(x.request, x.request_sha256)
    if x.attempt != 1 or not x.execution_run_id.isdecimal():
        sys.exit("BLOCKED_SETUP: collector execution identity differs")
    # the reviewer N1 / the run stage started (started.txt precedes admission and every case) but its aggregate case results
    # are missing or do not verify. That is an INCOMPLETE run, never NOT RUN: every row UNKNOWN, every spend count unmeasured (null, so the
    # settle holds the reserved caps, never zero), any bound per-case receipts kept as digests only, and it can never qualify as passed.
    reason = None
    if not (isinstance(x.case_results, str) and os.path.isfile(x.case_results) and not os.path.islink(x.case_results)):
        reason = "case-results-missing"
    else:
        try:
            cr = load(x.case_results)
            if not valid_case_results(cr, req.get("runId")):
                reason = "case-results-invalid"
        except (ValueError, OSError):
            reason = "case-results-invalid"
    if reason is None:
        try:
            out = complete_record(x, req, cr)
        except IncompleteResults as refused:
            reason = str(refused)            # a forged or unbound receipt credits nothing: the run is recorded INCOMPLETE, never its results
    if reason is not None:
        out = incomplete_record(x, req, reason)
        print("INCOMPLETE run record: %s (no result is credited; %s)" % (reason, "spend MEASURED before the identity read"
              if out["spend"].get("identityReads") == 0 else "every count settles at the reserved caps"), file=sys.stderr)
    dump(out, x.out)
    print("run record written:", out["runId"], "cases", len(out["cases"]))


class IncompleteResults(Exception):
    pass


CASE_ID = re.compile(r"AHT-(?:0[1-9]|1[0-5])")


def valid_case_results(cr, campaign_id):
    """Explicit schema check before anything reads the aggregate results : every shape complete_record touches.
    Anything else is INCOMPLETE (case-results-invalid), never an exception that leaves no record."""
    if not (isinstance(cr, dict) and cr.get("campaignId") == campaign_id and isinstance(cr.get("cases"), list)):
        return False
    seen = set()
    for c in cr["cases"]:
        if not (isinstance(c, dict) and isinstance(c.get("caseId"), str) and CASE_ID.fullmatch(c["caseId"]) and c["caseId"] not in seen):
            return False
        seen.add(c["caseId"])
        if c.get("result") not in ("PASS", "FAIL", "NOT RUN"):
            return False
        ass = c.get("assertions", [])
        if ass is not None and not (isinstance(ass, list) and all(isinstance(a, dict) for a in ass)):
            return False
        if c.get("executionReceipt") is not None and not isinstance(c["executionReceipt"], dict):
            return False
        for key in ("requestsUsed", "plannedRequests", "requestAllowance", "startPresses", "takes"):
            if c.get(key) is not None and type(c.get(key)) is not int:
                return False
    return True


def bound_case_receipts(cases_dir):
    """Digests (never contents) of per-case receipt files the harness wrote before the run stopped, by case: preserved, never interpreted."""
    found = {}
    if not (isinstance(cases_dir, str) and os.path.isdir(cases_dir) and not os.path.islink(cases_dir)):
        return found
    for case in sorted(os.listdir(cases_dir)):
        if not re.fullmatch(r"AHT-(?:0[1-9]|1[0-5])", case):
            continue
        entry = {}
        for name in ("summary.json", "runtime-start-consumption.json"):
            path = os.path.join(cases_dir, case, name)
            if os.path.isfile(path) and not os.path.islink(path):
                entry[name] = sha256_file(path)
        if entry:
            found[case] = entry
    return found


ADMISSION_STAGES = ("A0.config", "A1.bundle", "A2.source", "A3.tools", "A4.credentials", "A5.browser", "A6.guard-selftest", "A7.identity")
PREFLIGHT_CHARGES = {"auth": 2, "signedIn": 8, "total": 10}


def _regular_json(path):
    if not (isinstance(path, str) and path and os.path.isfile(path) and not os.path.islink(path)):
        return None
    try:
        with open(path, "rb") as f:
            raw = f.read(1 << 20)
        return json.loads(raw)
    except (OSError, ValueError):
        return None


UTC_MS = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z")
SHA40 = re.compile(r"[0-9a-f]{40}")


def _utc(value):
    if not (isinstance(value, str) and UTC_MS.fullmatch(value)):
        return None
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _canonical_file(path):
    """A regular file at an absolute, normalized path whose every component is real: realpath equals the path itself."""
    return (isinstance(path, str) and os.path.isabs(path) and os.path.normpath(path) == path and os.path.isfile(path)
            and not os.path.islink(path) and os.path.realpath(path) == path)


def pre_identity_spend(admission_receipt, prerequisite_receipt, cases_dir, req, source_sha, started_utc, ended_utc):
    """Consultant P1-4: the MEASURED spend of a run whose admission stopped before its identity read, or None (settle at the caps).

    Closed evidence, all required, each piece bound to THIS execution (review RETURN on 7e07474b: a foreign, stale or contradictory receipt
    must never reduce a charge):
      * the cases directory is named, absolute, its run root exists as a real directory, and the cases directory itself does not exist
        (cases run only after ADMISSION PASS): a positive absence, never an omitted argument;
      * the admission receipt is exactly <run root>/admission/admission-receipt.json, a regular file: schemaVersion 3, result
        BLOCKED_SETUP, stage = its one BLOCKED step (A0-A7), every earlier step PASS and every later step NOT_RUN, productionTrafficSent
        the integer 0, identityDispatch NOT_RUN (set to ATTEMPTED before the identity helper is ever invoked);
      * its A0 binding names this request's campaign and tested release, and its own start/end lie inside this run stage (started.txt to
        collection) and inside the approved window it was bound to;
      * the prerequisite preflight receipt names this campaign and this workflow source, was observed inside that window and before the
        run stage started, made no mutation, and carries its exact closed charge (2 + 8 = 10).
    Then requests = 10, identity reads, Starts, takes and coaching = 0. Anything missing, malformed, foreign, stale or contradictory: None."""
    if not (isinstance(cases_dir, str) and os.path.isabs(cases_dir) and os.path.normpath(cases_dir) == cases_dir
            and not os.path.lexists(cases_dir)):
        return None
    run_root = os.path.dirname(cases_dir)
    if not (os.path.isdir(run_root) and os.path.realpath(run_root) == run_root):
        return None
    # Review of 50647108: the canonical path, with every ancestor real (no symlink anywhere, the admission directory included).
    if admission_receipt != os.path.join(run_root, "admission", "admission-receipt.json") or not _canonical_file(admission_receipt):
        return None
    if not _canonical_file(prerequisite_receipt):
        return None
    rec = _regular_json(admission_receipt)
    if not (isinstance(rec, dict) and rec.get("schemaVersion") == 3 and rec.get("result") == "BLOCKED_SETUP"):
        return None
    if type(rec.get("productionTrafficSent")) is not int or rec["productionTrafficSent"] != 0 or rec.get("identityDispatch") != "NOT_RUN":
        return None
    steps = rec.get("steps")
    if not (isinstance(steps, list) and [s.get("id") if isinstance(s, dict) else None for s in steps] == list(ADMISSION_STAGES)):
        return None
    results = [s.get("result") for s in steps]
    blocked = [i for i, r in enumerate(results) if r == "BLOCKED"]
    if len(blocked) != 1 or rec.get("stage") != ADMISSION_STAGES[blocked[0]]:
        return None
    if any(r != "PASS" for r in results[:blocked[0]]) or any(r != "NOT_RUN" for r in results[blocked[0] + 1:]):
        return None
    binding = rec.get("binding")
    release = req.get("release") if isinstance(req, dict) else None
    if not (isinstance(binding, dict) and isinstance(release, dict) and binding.get("campaignId") == req.get("runId")
            and isinstance(release.get("testedSha"), str) and binding.get("sourceSha") == release["testedSha"]):
        return None
    window = (_utc(binding.get("approvedStartAt")), _utc(binding.get("approvedDeadlineAt")))
    began, ended = _utc(rec.get("startedAt")), _utc(rec.get("endedAt"))
    stage_start, collected = _utc(started_utc), _utc(ended_utc)
    if None in window or None in (began, ended, stage_start, collected):
        return None
    # Review of 50647108: the whole admission, its end included, lies inside the approved window and inside this run stage.
    if not (window[0] <= stage_start <= began <= ended <= collected and ended <= window[1]):
        return None
    pre = _regular_json(prerequisite_receipt)
    observed = _utc(pre.get("observedAt")) if isinstance(pre, dict) else None
    if not (isinstance(pre, dict) and pre.get("schema") == "speaksharp.cloud-test.prerequisite-preflight.v1"
            and pre.get("runId") == req.get("runId") and isinstance(source_sha, str) and SHA40.fullmatch(source_sha)
            and pre.get("sourceSha") == source_sha and observed is not None and window[0] <= observed <= stage_start
            and type(pre.get("mutationCount")) is int and pre["mutationCount"] == 0 and pre.get("charges") == PREFLIGHT_CHARGES):
        return None
    return {"requests": PREFLIGHT_CHARGES["total"], "byCategory": {"preflight": PREFLIGHT_CHARGES["total"]}, "identityReads": 0, "starts": 0,
            "takes": 0, "coachingRequests": 0,
            "source": "MEASURED: admission stopped at %s before its identity read (productionTrafficSent 0, identityDispatch NOT_RUN, "
                      "no case directory), bound to this campaign, release, window and run stage; requests are the prerequisite "
                      "preflight's closed charge" % ADMISSION_STAGES[blocked[0]]}


def incomplete_record(x, req, reason):
    gs, wf = load(x.gate_status) if os.path.isfile(x.gate_status) else {}, load(x.workflow)
    selected = [r.get("case") for r in req.get("selection") or [] if isinstance(r, dict)]
    cases = [{"case": c, "result": "UNKNOWN", "reason": reason, "requestsUsed": None, "plannedRequests": None, "requestAllowance": None,
              "assertions": {"PASS": 0, "FAIL": 0, "NOT RUN": 0, "total": 0}, "outcomeClass": "incomplete-run", "receiptDigest": None}
             for c in selected]
    consumed_at_utc = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return {
        "schema": "speaksharp.cloud-test.run-record.v1", "runId": req["runId"], "workflowVersion": wf["version"], "configVersion": req.get("configVersion"),
        "deviations": req.get("deviations", []), "purpose": req["purpose"], "priority": req["priority"], "targetedGaps": req["targetedGaps"],
        "startedUtc": x.started_utc, "endedUtc": x.ended_utc, "gateDecisionAtLaunch": gs.get("decision"),
        "release": {"testedSha": req["release"]["testedSha"], "servedShaAtAdmission": None, "finalIdentity": None},
        "harness": req["harness"], "runner": load(x.runner_json),
        "spend": pre_identity_spend(getattr(x, "admission_receipt", None), getattr(x, "prerequisite_receipt", None), x.cases_dir, req,
                                    getattr(x, "source_sha", None), x.started_utc, x.ended_utc)
                 or {"requests": None, "byCategory": {}, "identityReads": None, "starts": None, "takes": None,
                     "source": "INCOMPLETE run (%s): no verified aggregate results, so every count is unmeasured (null) and settles at the reserved caps" % reason},
        "paidActions": "unknown", "safetyStopped": None, "result": "INCOMPLETE", "incompleteReason": reason, "cases": cases,
        "boundCaseReceipts": bound_case_receipts(x.cases_dir),
        "executionProvenance": {"consumer": "collector", "campaignId": req["runId"], "runId": x.execution_run_id, "attempt": 1,
                                "requestSha256": x.request_sha256, "consumedAtUtc": consumed_at_utc, "caseResultsSha256": None,
                                "runtimeReceiptDigests": {}, "runtimeReceipts": {}},
        "artifactDigests": {},
    }


def complete_record(x, req, cr):
    gs, wf = load(x.gate_status), load(x.workflow)
    camp = load(os.path.join(x.ledger_dir, "campaign-ledger.json"))
    idl = load(os.path.join(x.ledger_dir, "identity-ledger.json"))
    cases, runtime_receipts, runtime_receipt_digests = [], {}, {}
    for c in cr.get("cases", []):
        ass = c.get("assertions") or []
        receipt = c.get("executionReceipt")
        if receipt is not None:
            expected = {"schema": "speaksharp.cloud-test.case-execution-receipt.v1", "campaignId": req["runId"],
                        "runId": x.execution_run_id, "attempt": 1, "caseId": c["caseId"],
                        "requestSha256": x.request_sha256, "sourceSha": cr.get("sourceSha"), "servedSha": cr.get("servedSha")}
            if not isinstance(receipt, dict) or any(receipt.get(key) != value for key, value in expected.items()) \
                    or not all(SHA256.fullmatch(receipt.get(key) or "") for key in ("planSha256", "configSha256", "runtimeStartReceiptSha256")):
                raise IncompleteResults("runtime-receipt-differs")
            runtime_receipts[c["caseId"]] = {key: receipt.get(key) for key in
                ("campaignId", "runId", "attempt", "caseId", "requestSha256", "planSha256", "configSha256",
                 "sourceSha", "servedSha", "runtimeStartReceiptSha256", "caseResultSha256", "summarySha256")}
            runtime_receipt_digests[c["caseId"]] = canonical_digest(receipt)
        elif c.get("result") != "NOT RUN":
            raise IncompleteResults("executed-case-without-receipt")
        cases.append({"case": c["caseId"], "result": c.get("result"), "reason": c.get("reason"), "requestsUsed": c.get("requestsUsed"),
                      "plannedRequests": c.get("plannedRequests"), "requestAllowance": c.get("requestAllowance"),
                      "assertions": {"PASS": sum(1 for s in ass if s.get("result") == "PASS"), "FAIL": sum(1 for s in ass if s.get("result") == "FAIL"),
                                     "NOT RUN": sum(1 for s in ass if s.get("result") == "NOT RUN"), "total": len(ass)},
                      "outcomeClass": c.get("outcomeClass"), "receiptDigest": (c.get("executionReceipt") or {}).get("summarySha256")})
    def total(key):
        vals = [c.get(key) for c in cr.get("cases", []) if isinstance(c.get(key), int)]
        return sum(vals) if vals else None
    acts = count_actions(x.cases_dir) if x.cases_dir else None
    case_results_sha256 = sha256_file(x.case_results)
    consumed_at_utc = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    out = {
        "schema": "speaksharp.cloud-test.run-record.v1", "runId": req["runId"], "workflowVersion": wf["version"], "configVersion": req.get("configVersion"),
        "deviations": req.get("deviations", []), "purpose": req["purpose"], "priority": req["priority"], "targetedGaps": req["targetedGaps"],
        "startedUtc": x.started_utc, "endedUtc": x.ended_utc, "gateDecisionAtLaunch": gs.get("decision"),
        "release": {"testedSha": req["release"]["testedSha"], "servedShaAtAdmission": cr.get("servedSha"), "finalIdentity": (cr.get("finalIdentity") or {}).get("result") if isinstance(cr.get("finalIdentity"), dict) else cr.get("finalIdentity")},
        "harness": req["harness"], "runner": load(x.runner_json),
        "spend": {"requests": camp.get("used", {}).get("total"), "byCategory": {k: v for k, v in (camp.get("used") or {}).items() if k != "total"}, "identityReads": idl.get("identityGets"),
                  "starts": acts["starts"] if acts else total("startPresses"), "takes": acts["takes"] if acts else total("takes"),
                  "source": "guard campaign-ledger and identity-ledger; Starts and takes counted from the cases' action-reservations.jsonl; null (never zero) when no reservation log exists"},
        "paidActions": paid_actions(cr),
        "safetyStopped": cr.get("safetyStopped"), "result": cr.get("result"), "cases": cases,
        "executionProvenance": {"consumer": "collector", "campaignId": req["runId"], "runId": x.execution_run_id,
                                "attempt": 1, "requestSha256": x.request_sha256, "consumedAtUtc": consumed_at_utc,
                                "caseResultsSha256": case_results_sha256,
                                "runtimeReceiptDigests": runtime_receipt_digests,
                                "runtimeReceipts": runtime_receipts},
        "artifactDigests": {"case-results.json": case_results_sha256},
    }
    return out


if __name__ == "__main__":
    main()
