"""The ONE latest-run record of the live lane: a bot-owned issue comment, updated in place (Sam 1793471205.454429).

This module only selects, validates and renders; it never touches the network. The workflow's isolated publication job reads the
issue comments with `gh api` and PATCHes (or, once, creates) the selected comment with the body rendered here.

Retention rule: the previous COMPLETED record stays until a terminal replacement is rendered. `begin` records the in-progress attempt
beside it; `complete` replaces it only with a terminal (passed/failed) record of that same attempt; `interrupt` keeps it and marks the
attempt unreconciled, and the next `begin` then refuses: an ambiguous attempt is never read as a clean, empty history.

Only run/source identity, case statuses, row counts and closed codes are accepted. Any other field, a free-text value, an account
identifier or a payload is refused, never dropped silently.

Usage:
  publish_latest_record.py select    --comments COMMENTS.json --issue-url URL [--comment-id ID] [--bot-login LOGIN]
                                                                                       prints {"commentId": id|null, "body": "..."}
  publish_latest_record.py begin     --previous BODY --run-id N --attempt N --source-sha SHA --started-utc TS --out BODY
  publish_latest_record.py complete  --previous BODY --record RECORD.json --out BODY
  publish_latest_record.py interrupt --previous BODY --run-id N --attempt N --status cancelled|incomplete --out BODY
  publish_latest_record.py pending   --previous BODY --record RECORD.json --completion-deadline-utc TS
                                      --settle-receipt-sha256 SHA --occurrence-sha256 SHA --out BODY
  publish_latest_record.py reconcile --previous BODY --published-at TS --artifact-created-at TS
                                      --attestation ATTESTATION.json --settle-receipt RECEIPT.json
                                      --occurrence OCCURRENCE.json --out BODY
  publish_latest_record.py attest    --candidate BODY --public-body BODY --published RESPONSE.json
                                      --settle-receipt-sha256 SHA --occurrence-sha256 SHA --out ATTESTATION.json
  publish_latest_record.py unreserved-candidate --previous BODY
                                      prints the run id and exits 0 only when the in-progress attempt is exactly RETIRABLE_ATTEMPT, `incomplete`,
                                      with no pending completion; exits 1 otherwise
  publish_latest_record.py retire-unreserved --previous BODY --evidence EVIDENCE.json --out BODY
                                      retires that one attempt as `never-reserved` history, only on the closed evidence (see retire_unreserved)
  publish_latest_record.py unexecuted-candidate --previous BODY --evidence EVIDENCE.json
                                      prints the run id and exits 0 only when the in-progress attempt is `incomplete`, with no pending
                                      completion, and is exactly the run the unexecuted-attempt evidence is about
  publish_latest_record.py retire-unexecuted --previous BODY --evidence EVIDENCE.json --out BODY
                                      retires that attempt as `reserved-not-executed` history, only on the closed evidence (see retire_unexecuted)
  publish_latest_record.py executed-candidate --previous BODY --evidence EVIDENCE.json
                                      prints the run id and exits 0 only when the in-progress attempt is `incomplete`, with no pending
                                      completion, and is exactly the run the executed-attempt evidence is about
  publish_latest_record.py retire-executed --previous BODY --evidence EVIDENCE.json --out BODY
                                      retires that attempt as `executed-unpublished` history, only on the closed evidence (see retire_executed)
  publish_latest_record.py verify-predecessor --selected SELECTED.json --current COMMENT.json
                                      refuses unless the stored comment is still exactly the one `select` returned (body, id and updated_at)
Exit 78 (BLOCKED_SETUP) on every refusal.
"""
import argparse
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline: rendering never needs the network)

MARKER = "<!-- speaksharp-cloud-test-latest-record v1 -->"
SCHEMA = "speaksharp.cloud-test.latest-record.v1"
ATTESTATION_SCHEMA = "speaksharp.cloud-test.completion-attestation.v1"
BOT_LOGIN = "github-actions[bot]"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
UTC = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
CODE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
CASE = re.compile(r"^AHT-(0[1-9]|1[0-5])$")
RUN_ID = re.compile(r"^[1-9][0-9]{0,19}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
CAMPAIGN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
JSON_BLOCK = re.compile(r"```json\n(.*?)\n```", re.S)
# one character per catalog row, in catalog order: P(ASS) F(AIL) N(OT RUN); bound to the record's catalogSha256
ROW_VERDICTS = re.compile(r"^[PFN]{1,64}$")


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def _count(v):
    return isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 10000


def _keys(obj, allowed, code):
    _need(isinstance(obj, dict), code)
    _need(set(obj) <= allowed, "unsanitized-field")


def _codes(v, limit):
    _need(isinstance(v, list) and len(v) <= limit and all(isinstance(c, str) and CODE.match(c) for c in v), "unsanitized-code")
    return list(v)


def _attempt(run_id, attempt):
    _need(isinstance(run_id, str) and RUN_ID.match(run_id), "run-id")
    _need(isinstance(attempt, int) and not isinstance(attempt, bool) and attempt >= 1, "run-attempt")


def sanitize_record(rec, require_source=False):
    """The terminal record exactly as published; refuses anything outside the closed shape."""
    # Three identities, never conflated: the workflow source that ran the harness, the product release the request tested, and the release
    # observed served at admission (Sam 1793539017 RETURN, finding 4).
    _keys(rec, {"runId", "attempt", "sourceSha", "testedSha", "servedSha", "campaignId", "coverage", "coverageMode", "assertionDepth", "requestSha256", "catalogSha256",
                "startedUtc", "endedUtc", "outcome", "cases", "codes", "rowVerdicts", "comparability", "evidence"}, "record")
    _attempt(rec.get("runId"), rec.get("attempt"))
    _need(isinstance(rec.get("sourceSha"), str) and SHA40.match(rec["sourceSha"]), "source-sha")
    _need(isinstance(rec.get("testedSha"), str) and SHA40.match(rec["testedSha"]), "tested-sha")
    # coverage (Sam 1793547120.015339): full/batch/smoke when every selected required row EXECUTED (PASS or FAIL), incomplete when any did
    # not, unqualified when the qualification was not bound to this record. Smoke is a diagnostic result, never full/nightly history.
    # Coverage is not the outcome: a fully executed baseline may still be failed.
    _need(rec.get("coverage") in ("batch", "smoke", "full", "incomplete", "unqualified"), "coverage")
    mode, depth = rec.get("coverageMode"), rec.get("assertionDepth")
    _need((mode is None) == (depth is None), "coverage-source")
    _need(not require_source or rec.get("coverage") == "unqualified" or mode is not None, "coverage-source")
    if mode is not None:
        _need(mode in ("partial", "smoke", "full") and depth == ("smoke" if mode == "smoke" else "full"), "coverage-source")
        allowed = {"partial": ("batch", "incomplete"), "smoke": ("smoke", "incomplete"), "full": ("full", "incomplete")}
        _need(rec["coverage"] in allowed[mode], "coverage-source")
    for k in ("requestSha256", "catalogSha256"):
        _need(rec.get(k) is None if rec["coverage"] == "unqualified" else isinstance(rec.get(k), str) and SHA64.match(rec[k]), k)
    _need(rec.get("campaignId") is None if rec["coverage"] == "unqualified" else isinstance(rec.get("campaignId"), str) and CAMPAIGN.match(rec["campaignId"]), "campaign-id")
    _need(rec.get("servedSha") is None or (isinstance(rec["servedSha"], str) and SHA40.match(rec["servedSha"])), "served-sha")
    for k in ("startedUtc", "endedUtc"):
        _need(isinstance(rec.get(k), str) and UTC.match(rec[k]), k)
    _need(rec["startedUtc"] <= rec["endedUtc"], "time-order")
    _need(rec.get("outcome") in ("passed", "failed"), "terminal-outcome")
    cases = rec.get("cases")
    _need(isinstance(cases, list) and len(cases) <= 15, "cases")
    out, seen = [], set()
    for c in cases:
        _keys(c, {"caseId", "result", "rows", "codes"}, "case")
        _need(isinstance(c.get("caseId"), str) and CASE.match(c["caseId"]) and c["caseId"] not in seen, "case-id")
        seen.add(c["caseId"])
        # UNKNOWN (Bezos N1): a selected case of a run that started but left no verified results; like NOT RUN it is never an executed
        # verdict and never erases history, but it does not claim the case did not run.
        _need(c.get("result") in ("PASS", "FAIL", "NOT RUN", "NOT SELECTED", "UNKNOWN"), "case-result")
        _keys(c.get("rows"), {"pass", "fail", "notRun"}, "rows")
        _need(set(c["rows"]) == {"pass", "fail", "notRun"} and all(_count(v) for v in c["rows"].values()), "rows")
        _need((c["result"] == "PASS") == (c["rows"]["fail"] == 0 and c["rows"]["notRun"] == 0 and c["rows"]["pass"] > 0), "case-result-rows")
        _need(c["result"] != "UNKNOWN" or not any(c["rows"].values()), "unknown-rows")
        _need(c["result"] != "NOT SELECTED" or (rec["coverage"] in ("batch", "incomplete") and not any(c["rows"].values()) and not c.get("codes")),
              "not-selected-rows")
        out.append({"caseId": c["caseId"], "result": c["result"], "rows": dict(c["rows"]), "codes": _codes(c.get("codes", []), 8)})
    ran = [c for c in out if c["result"] != "NOT SELECTED"]
    all_pass = bool(ran) and all(c["result"] == "PASS" for c in ran)
    _need(rec["coverage"] != "full" or (len(ran) == 15 and all(c["rows"]["notRun"] == 0 for c in ran)), "full-coverage-needs-fifteen-executed")
    # `passed` needs every selected case PASS under bound qualification; an all-PASS record that was not qualified is `failed` (not-qualified).
    _need(rec["outcome"] == "failed" if not all_pass else
          (rec["outcome"] == "passed" and rec["coverage"] in ("batch", "smoke", "full")) or
          (rec["outcome"] == "failed" and (rec["coverage"] == "incomplete" or "not-qualified" in (rec.get("codes") or []))),
          "outcome-cases")
    rv = rec.get("rowVerdicts")
    if rv is not None:
        # per-row verdicts (G7 rows): only for a qualified record, only for executed cases, each consistent with that case's row counts
        _need(rec["coverage"] != "unqualified" and isinstance(rv, dict), "row-verdicts")
        by_case = {c["caseId"]: c for c in out}
        for cid, v in rv.items():
            c = by_case.get(cid)
            _need(c is not None and c["result"] != "NOT SELECTED" and isinstance(v, str) and ROW_VERDICTS.match(v)
                  and (v.count("P"), v.count("F"), v.count("N")) == (c["rows"]["pass"], c["rows"]["fail"], c["rows"]["notRun"]), "row-verdicts")
    out_rec = {"runId": rec["runId"], "attempt": rec["attempt"], "sourceSha": rec["sourceSha"], "testedSha": rec["testedSha"], "servedSha": rec.get("servedSha"),
            "campaignId": rec.get("campaignId"), "coverage": rec["coverage"], "requestSha256": rec.get("requestSha256"),
            "catalogSha256": rec.get("catalogSha256"),
            "startedUtc": rec["startedUtc"], "endedUtc": rec["endedUtc"], "outcome": rec["outcome"],
            "cases": sorted(out, key=lambda c: c["caseId"]), "codes": _codes(rec.get("codes", []), 16)}
    if mode is not None:
        out_rec.update(coverageMode=mode, assertionDepth=depth)
    if rv is not None:
        out_rec["rowVerdicts"] = dict(sorted(rv.items()))
    comp = rec.get("comparability")
    if comp is not None:
        # the identities a row verdict is comparable under (Sam 1793573813.598689): harness/observer code, packet, media, backend
        _keys(comp, COMPARABILITY_KEYS, "comparability")
        _need(set(comp) == COMPARABILITY_KEYS and all(isinstance(v, str) and (SHA64.match(v) or SHA40.match(v)) for v in comp.values()), "comparability")
        out_rec["comparability"] = dict(sorted(comp.items()))
    ev = rec.get("evidence")
    if ev is not None:
        # the qualification's own digests: the frozen plan (which binds the stimulus receipt) and the case results the rows came from
        _need(rec["coverage"] != "unqualified" and isinstance(ev, dict) and set(ev) == {"planSha256", "caseResultsSha256"}
              and all(isinstance(v, str) and SHA64.match(v) for v in ev.values()), "evidence")
        out_rec["evidence"] = dict(sorted(ev.items()))
    return out_rec


# G7 durable carry-forward (Sam 1793573813.598689): the bounded history every completed run folds into this same record. Per case: the last
# EXECUTED verdict (PASS/FAIL) and the last-known-good, each bound to the occurrence that produced it; NOT RUN and NOT SELECTED never erase
# them. Each fold binds the expected predecessor (its digest and sequence), refuses a replayed run and an out-of-order occurrence, and fails
# closed when the serialized history would exceed its bound rather than drop required history.
HISTORY_KEYS = {"sequence", "predecessorSha256", "occurrences", "rows", "lastComparison", "identities"}
# each distinct comparability identity set is kept once (identities[]); an occurrence names it by index (identity), so the bound holds
OCCURRENCE_KEYS = {"runId", "attempt", "campaignId", "requestSha256", "catalogSha256", "sourceSha", "testedSha", "servedSha", "endedUtc",
                   "outcome", "coverage", "coverageMode", "assertionDepth", "identity", "evidence", "rowEvidence"}
OCCURRENCE_OPTIONAL = {"identity", "evidence", "rowEvidence", "coverageMode", "assertionDepth"}
COMPARABILITY_KEYS = {"codeManifestSha256", "packetManifestSha256", "mediaManifestSha256", "backendSha"}
MAX_OCCURRENCES = 62          # two 31-day periods of nightly occurrences, retained in order
MAX_HISTORY_BYTES = 48000     # serialized-size bound for the history block
MAX_BODY_CHARS = 60000        # the whole rendered comment, under GitHub's 65536-character body limit


def canon(doc):
    return json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()


def _smoke_source(rec):
    """New records preserve their source denominator explicitly; coverage fallback keeps existing v1 history readable."""
    return rec.get("coverageMode") == "smoke" or (rec.get("coverageMode") is None and rec.get("coverage") == "smoke")


def _occurrence(rec, identity):
    # usable row evidence needs at least one EXECUTED row (PASS or FAIL): an all-NOT-RUN map is not evidence (RETURN 1793576632.959179)
    executed = any(ch in "PF" for v in (rec.get("rowVerdicts") or {}).values() for ch in v)
    # Smoke rows remain visible in latestCompleted but never become G7/full/nightly carry-forward evidence.
    qualified_rows = executed and not _smoke_source(rec) and rec["coverage"] in ("batch", "full", "incomplete") and rec.get("evidence") is not None
    values = {k: rec.get(k) for k in OCCURRENCE_KEYS - OCCURRENCE_OPTIONAL}
    if rec.get("coverageMode") is not None:
        values.update(coverageMode=rec["coverageMode"], assertionDepth=rec["assertionDepth"])
    return dict(values, identity=identity,
                evidence=rec.get("evidence"), rowEvidence=qualified_rows)


def qualified_comparable(history, current):
    """The occurrences whose row evidence is qualified AND produced under exactly the `current` identities: only these clear G7."""
    if history is None or current is None:
        return []
    return [o for o in history["occurrences"] if o.get("rowEvidence") and o.get("identity") is not None
            and history["identities"][o["identity"]] == current]


def identity_of(history, occurrence):
    """The comparability identity set an occurrence's verdicts were produced under, or None when it was not known."""
    i = occurrence.get("identity")
    return None if i is None else history["identities"][i]


def sanitize_history(h):
    """The retained history exactly as published; anything outside the closed shape or its bounds refuses."""
    if h is None:
        return None
    _need(isinstance(h, dict) and HISTORY_KEYS - {"lastComparison", "identities"} <= set(h) <= HISTORY_KEYS, "history")
    ids = h.get("identities") or []
    _need(isinstance(ids, list) and len(ids) <= MAX_OCCURRENCES and all(isinstance(i, dict) and set(i) == COMPARABILITY_KEYS for i in ids)
          and len({json.dumps(i, sort_keys=True) for i in ids}) == len(ids), "history-identities")
    lc = h.get("lastComparison")
    _need(lc is None or (isinstance(lc, dict) and set(lc) == {"runId", "regressions", "fixes", "notComparable"}
                         and all(isinstance(lc[k], dict) and all(CASE.match(c) and type(n) is int and n >= 0 for c, n in lc[k].items())
                                 for k in ("regressions", "fixes", "notComparable"))), "history-comparison")
    _need(type(h.get("sequence")) is int and h["sequence"] >= 1, "history-sequence")
    _need(h.get("predecessorSha256") is None or (isinstance(h["predecessorSha256"], str) and SHA64.match(h["predecessorSha256"])), "history-predecessor")
    occ = h.get("occurrences")
    _need(isinstance(occ, list) and 1 <= len(occ) <= MAX_OCCURRENCES, "history-occurrences")
    for o in occ:
        _need(isinstance(o, dict) and OCCURRENCE_KEYS - OCCURRENCE_OPTIONAL <= set(o) <= OCCURRENCE_KEYS, "history-occurrence")
        mode, depth = o.get("coverageMode"), o.get("assertionDepth")
        _need((mode is None) == (depth is None), "history-occurrence")
        if mode is not None:
            _need(mode in ("partial", "smoke", "full") and depth == ("smoke" if mode == "smoke" else "full"), "history-occurrence")
        _need(type(o.get("rowEvidence", False)) is bool and (o.get("evidence") is None or (isinstance(o["evidence"], dict)
              and set(o["evidence"]) == {"planSha256", "caseResultsSha256"})), "history-occurrence")
        # row evidence only from a qualified run with its qualification digests: an unqualified or row-empty occurrence never counts
        _need(not o.get("rowEvidence") or (not _smoke_source(o) and o["coverage"] in ("batch", "full", "incomplete") and o.get("evidence") is not None), "history-occurrence")
        _need(o.get("identity") is None or (type(o["identity"]) is int and 0 <= o["identity"] < len(ids)), "history-occurrence")
        _attempt(o.get("runId"), o.get("attempt"))
        _need(isinstance(o.get("endedUtc"), str) and UTC.match(o["endedUtc"]) and o.get("outcome") in ("passed", "failed"), "history-occurrence")
    _need(all(a["endedUtc"] < b["endedUtc"] for a, b in zip(occ, occ[1:])) and len({o["runId"] for o in occ}) == len(occ), "history-order")
    rows, run_ids = h.get("rows"), {o["runId"] for o in occ}
    _need(isinstance(rows, dict) and set(rows) <= {"AHT-%02d" % n for n in range(1, 16)}, "history-rows")
    for r in rows.values():
        _need(isinstance(r, dict) and {"last", "lastKnownGood"} <= set(r) <= {"last", "lastKnownGood", "rowLast", "rowLastAt", "rowGood"},
              "history-row")
        if "rowLast" in r:
            # per row (catalog order): last executed verdict, the occurrence index that produced it, and the last-known-good occurrence index
            n = len(r["rowLast"]) if isinstance(r["rowLast"], str) else -1
            _need(re.match(r"^[PF-]{1,64}$", r["rowLast"] or "") is not None and all(isinstance(r.get(k), list) and len(r[k]) == n for k in ("rowLastAt", "rowGood"))
                  and all(type(i) is int and -1 <= i < len(occ) for i in r["rowLastAt"] + r["rowGood"])
                  and all((ch == "-") == (i == -1) for ch, i in zip(r["rowLast"], r["rowLastAt"])), "history-row")
        for k in ("last", "lastKnownGood"):
            v = r.get(k)
            # every retained verdict is bound to a retained occurrence
            _need(v is None or (isinstance(v, dict) and set(v) == {"result", "runId", "endedUtc"} and v["result"] in ("PASS", "FAIL")
                                and v["runId"] in run_ids), "history-row")
        _need(r.get("lastKnownGood") is None or r["lastKnownGood"]["result"] == "PASS", "history-row")
    _need(len(canon(h)) <= MAX_HISTORY_BYTES, "history-overflow")
    return h


def fold_history(history, rec, expected_predecessor):
    """The next history after the completed record `rec`. `expected_predecessor` is the digest of the history the publisher read (None on the
    first fold): a fold on any other predecessor refuses, so two writers can never both extend the same history."""
    prior = sanitize_history(history)
    _need((None if prior is None else hashlib.sha256(canon(prior)).hexdigest()) == expected_predecessor, "history-predecessor-moved")
    occ = list(prior["occurrences"]) if prior else []
    _need(all(o["runId"] != rec["runId"] for o in occ), "history-replay")
    _need(not occ or occ[-1]["endedUtc"] < rec["endedUtc"], "history-out-of-order")
    identities = list((prior or {}).get("identities") or [])
    comp = rec.get("comparability")
    if comp is not None and comp not in identities:
        identities.append(comp)
    occ.append(_occurrence(rec, identities.index(comp) if comp is not None else None))
    _need(len(occ) <= MAX_OCCURRENCES, "history-overflow")
    rows = {cid: dict(r) for cid, r in (prior["rows"] if prior else {}).items()}
    index = len(occ) - 1
    comparison = {"runId": rec["runId"], "regressions": {}, "fixes": {}, "notComparable": {}}
    acceptance_evidence = not _smoke_source(rec)
    if prior and acceptance_evidence and rec.get("rowVerdicts"):
        # row positions are catalog positions: a different catalog makes them incomparable, so the fold refuses rather than mixing them
        _need(all(_smoke_source(o) or o.get("catalogSha256") in (None, rec.get("catalogSha256"))
                  for o in prior["occurrences"]), "history-catalog-changed")
    for c in rec["cases"]:
        v = (rec.get("rowVerdicts") or {}).get(c["caseId"]) if acceptance_evidence else None
        if v is not None:
            row = rows.setdefault(c["caseId"], {"last": None, "lastKnownGood": None})
            last = list(row.get("rowLast") or "-" * len(v))
            at, good = list(row.get("rowLastAt") or [-1] * len(v)), list(row.get("rowGood") or [-1] * len(v))
            _need(len(last) == len(v), "history-catalog-changed")
            for i, ch in enumerate(v):
                # the real per-row comparison: this verdict against the row's last executed verdict, only under the same identities
                if ch in "PF" and last[i] in "PF":
                    base = occ[at[i]].get("identity")
                    same = base is not None and comp is not None and identities[base] == comp
                    key = "notComparable" if not same else "regressions" if (last[i], ch) == ("P", "F") else "fixes" if (last[i], ch) == ("F", "P") else None
                    if key:
                        comparison[key][c["caseId"]] = comparison[key].get(c["caseId"], 0) + 1
                if ch in "PF":  # N (NOT RUN) never erases a row's prior verdict
                    last[i], at[i] = ch, index
                    if ch == "P":
                        good[i] = index
            row.update(rowLast="".join(last), rowLastAt=at, rowGood=good)
        if not acceptance_evidence or c["result"] not in ("PASS", "FAIL"):
            continue  # NOT RUN / NOT SELECTED never erase prior evidence
        entry = {"result": c["result"], "runId": rec["runId"], "endedUtc": rec["endedUtc"]}
        row = rows.setdefault(c["caseId"], {"last": None, "lastKnownGood": None})
        row["last"] = entry
        if c["result"] == "PASS":
            row["lastKnownGood"] = entry
    nxt = {"sequence": (prior["sequence"] + 1) if prior else 1, "predecessorSha256": expected_predecessor, "occurrences": occ, "rows": rows,
           "lastComparison": comparison, "identities": identities}
    return sanitize_history(nxt)


def parse_body(body):
    """The state held by an existing comment; an empty body is the never-published state. Anything unreadable refuses."""
    if body == "":
        return {"schema": SCHEMA, "latestCompleted": None, "inProgress": None}
    _need(body.startswith(MARKER + "\n"), "latest-record-unreadable")
    blocks = JSON_BLOCK.findall(body)
    _need(len(blocks) == 1, "latest-record-unreadable")
    try:
        state = json.loads(blocks[0])
    except ValueError:
        raise Refused("latest-record-unreadable")
    _need(isinstance(state, dict) and {"schema", "latestCompleted", "inProgress"} <= set(state) <=
          {"schema", "latestCompleted", "inProgress", "history", "pendingCompletion", "retiredAttempts"},
          "latest-record-unreadable")
    _need(state.get("schema") == SCHEMA, "latest-record-unreadable")
    if state.get("latestCompleted") is not None:
        state["latestCompleted"] = sanitize_record(state["latestCompleted"])
    if "history" in state:
        state["history"] = sanitize_history(state["history"])
        _need(state["history"] is not None, "latest-record-unreadable")
    if "retiredAttempts" in state:
        retired = state["retiredAttempts"]
        _need(isinstance(retired, list) and 0 < len(retired) <= RETIRED_MAX, "latest-record-unreadable")
        state["retiredAttempts"] = [sanitize_retired(r) for r in retired]
    pending = state.get("pendingCompletion")
    if pending is not None:
        _keys(pending, {"record", "completionDeadlineUtc", "settleReceiptSha256", "occurrenceSha256"}, "pending-completion")
        _need(set(pending) == {"record", "completionDeadlineUtc", "settleReceiptSha256", "occurrenceSha256"}, "pending-completion")
        pending = dict(pending, record=sanitize_record(pending["record"]))
        _need(isinstance(pending["completionDeadlineUtc"], str) and UTC.match(pending["completionDeadlineUtc"]), "pending-deadline")
        _need(isinstance(pending["settleReceiptSha256"], str) and SHA64.match(pending["settleReceiptSha256"]), "pending-settlement")
        _need(isinstance(pending["occurrenceSha256"], str) and SHA64.match(pending["occurrenceSha256"]), "pending-occurrence")
        live = state.get("inProgress")
        _need(live is not None and live.get("status") == "incomplete" and
              (live.get("runId"), live.get("attempt"), live.get("sourceSha")) ==
              (pending["record"]["runId"], pending["record"]["attempt"], pending["record"]["sourceSha"]), "pending-attempt")
        state["pendingCompletion"] = pending
    return state


def render(state):
    done, live = state["latestCompleted"], state["inProgress"]
    lines = [MARKER, "**Cloud test: latest run record** (bot-maintained; replaced only by the next terminal run)", ""]
    if done:
        tally = {r: sum(1 for c in done["cases"] if c["result"] == r) for r in ("PASS", "FAIL", "NOT RUN", "UNKNOWN")}
        lines.append("Latest completed: run %s attempt %d at `%s`: **%s** (%d PASS, %d FAIL, %d NOT RUN%s)" % (
            done["runId"], done["attempt"], done["sourceSha"][:12], done["outcome"], tally["PASS"], tally["FAIL"], tally["NOT RUN"],
            ", %d UNKNOWN" % tally["UNKNOWN"] if tally["UNKNOWN"] else ""))
    else:
        lines.append("Latest completed: none yet.")
    lc = (state.get("history") or {}).get("lastComparison")
    if lc:
        lines.append("Row comparison for run %s: %d regression(s), %d fix(es), %d not comparable" % (
            lc["runId"], sum(lc["regressions"].values()), sum(lc["fixes"].values()), sum(lc["notComparable"].values())))
    if live:
        lines.append("In progress: run %s attempt %d, status %s." % (live["runId"], live["attempt"], live["status"]))
    for r in state.get("retiredAttempts") or []:
        if r["retiredReason"] == "reserved-not-executed":      # rendered exactly as before, so stored records read back unchanged
            lines.append("Reserved, not executed: no credential-bearing step ran (not a completed run): run %s attempt %d at `%s`, started %s; "
                         "0 product usage, %d runner minute(s), evidence `%s`." % (
                             r["runId"], r["attempt"], r["sourceSha"][:12], r["startedUtc"], r["evidence"]["runnerMinutes"], r["evidence"]["evidenceSha256"][:12]))
            continue
        if r["retiredReason"] == EXECUTED_REASON:
            e = r["evidence"]
            lines.append("Executed, record not publishable (not a completed run; no case results recorded): run %s attempt %d at `%s`, started %s; "
                         "settled on the journal at `%s` over reserve `%s`, %d runner minute(s), evidence `%s`." % (
                             r["runId"], r["attempt"], r["sourceSha"][:12], r["startedUtc"], e["settleSha"][:12], e["reserveSha"][:12],
                             e["runnerMinutes"], e["evidenceSha256"][:12]))
            continue
        if r["retiredReason"] in RESERVED_REASONS:
            lines.append("%s (not a completed run): run %s attempt %d at `%s`, started %s; %d runner minute(s), evidence `%s`." % (
                RESERVED_REASONS[r["retiredReason"]], r["runId"], r["attempt"], r["sourceSha"][:12], r["startedUtc"],
                r["evidence"]["runnerMinutes"], r["evidence"]["evidenceSha256"][:12]))
            continue
        lines.append("Retired without a reservation (not a completed run): run %s attempt %d at `%s`, started %s." % (
            r["runId"], r["attempt"], r["sourceSha"][:12], r["startedUtc"]))
    pending = state.get("pendingCompletion")
    if pending:
        rec = pending["record"]
        tally = {r: sum(1 for c in rec["cases"] if c["result"] == r) for r in ("PASS", "FAIL", "NOT RUN", "UNKNOWN")}
        lines.append("Pending completion: run %s attempt %d: **%s** (%d PASS, %d FAIL, %d NOT RUN%s); next admitted run reconciles it from GitHub server time." %
                     (rec["runId"], rec["attempt"], rec["outcome"], tally["PASS"], tally["FAIL"], tally["NOT RUN"],
                      ", %d UNKNOWN" % tally["UNKNOWN"] if tally["UNKNOWN"] else ""))
    lines += ["", "```json", json.dumps(state, sort_keys=True, separators=(",", ":")), "```"]
    body = "\n".join(lines) + "\n"
    _need(len(body) <= MAX_BODY_CHARS, "record-overflow")  # fail closed: never publish a truncated or rejected record
    return body


def select(comments, issue_url, bot_login=BOT_LOGIN, comment_id=None):
    """The bot's one marked comment on exactly `issue_url`, or None for a first publication. A marked comment by anyone else is refused, never
    overwritten; a comment from another issue or PR, or other than the expected id, is refused."""
    _need(isinstance(comments, list), "comments")
    _need(isinstance(issue_url, str) and re.match(r"^https://[^/]+/repos/[^/]+/[^/]+/issues/[1-9][0-9]*$", issue_url), "issue-url")
    _need(all(isinstance(c, dict) and c.get("issue_url") == issue_url for c in comments), "comment-from-another-issue")
    marked = [c for c in comments if isinstance(c, dict) and MARKER in str(c.get("body") or "")]
    for c in marked:
        user = c.get("user") or {}
        _need(user.get("login") == bot_login and user.get("type") == "Bot", "marker-in-foreign-comment")
    _need(len(marked) <= 1, "ambiguous-latest-record")
    if not marked:
        return {"commentId": None, "body": "", "updatedAt": None}
    _need(isinstance(marked[0].get("id"), int) and (comment_id is None or marked[0]["id"] == comment_id), "comment-id")
    _need(marked[0]["body"].startswith(MARKER + "\n"), "latest-record-unreadable")
    updated = marked[0].get("updated_at")
    _need(isinstance(updated, str) and UTC.match(updated), "comment-updated-at")
    return {"commentId": marked[0]["id"], "body": marked[0]["body"], "updatedAt": updated}


def begin(state, run_id, attempt, source_sha, started_utc):
    _attempt(run_id, attempt)
    _need(attempt == 1, "rerun-attempt-refused")    # consumed state of an earlier attempt cannot be carried, and is never reset
    _need(SHA40.match(source_sha or ""), "source-sha")
    _need(UTC.match(started_utc or ""), "startedUtc")
    _need(state["inProgress"] is None, "previous-attempt-unreconciled")
    done = state["latestCompleted"]
    _need(done is None or done["runId"] != run_id, "run-already-recorded")
    return dict(state, inProgress={"runId": run_id, "attempt": attempt, "sourceSha": source_sha, "startedUtc": started_utc, "status": "running"})


def complete(state, record):
    rec = sanitize_record(record, require_source=True)
    live = state["inProgress"]
    _need(live is not None and live["status"] == "running" and (live["runId"], live["attempt"], live["sourceSha"]) ==
          (rec["runId"], rec["attempt"], rec["sourceSha"]), "record-not-the-running-attempt")
    prior = state.get("history")
    # the carry-forward folds on exactly the history this publication read; interruption leaves it (and latestCompleted) untouched
    history = fold_history(prior, rec, None if prior is None else hashlib.sha256(canon(prior)).hexdigest())
    lc = history["lastComparison"]
    # the comparison is part of the outcome: a comparable row that regressed (PASS -> FAIL) or was fixed (FAIL -> PASS) is named in the codes
    codes = list(rec["codes"]) + [c for c, k in (("row-regression", "regressions"), ("row-fix", "fixes")) if lc[k]]
    rec = dict(rec, codes=_codes(codes, 16))
    done = {"schema": SCHEMA, "latestCompleted": rec, "inProgress": None, "history": history}
    if state.get("retiredAttempts"):
        done["retiredAttempts"] = state["retiredAttempts"]   # retired history is never dropped by a later completion
    return done


def interrupt(state, run_id, attempt, status):
    _need(status in ("cancelled", "incomplete"), "interrupt-status")
    live = state["inProgress"]
    _need(live is not None and (live["runId"], live["attempt"]) == (run_id, attempt), "record-not-the-running-attempt")
    return dict(state, inProgress=dict(live, status=status))


# One attempt, named exactly, may be retired without a completion. Run 41933223835 stopped at the reserve job (the workflow token was refused)
# before any reservation, so no completion artifact exists and `begin` would refuse every later run (`previous-attempt-unreconciled`). The
# retirement does NOT manufacture a completed run: latestCompleted and history are untouched, no usage, attempt or reservation record is read
# for change or written, and the attempt is kept in the record as `retiredAttempts` history with the evidence that it never reserved.
RETIRABLE_ATTEMPT = {"runId": "41933223835", "attempt": 1, "sourceSha": "af1781ba6e07524c82dea3a66a1b7cb772c14e51"}
# Run 42472935773 (setup failure, reserved-not-executed) would be the 9th retired attempt: with a bound of 8 the next record-begin refused
# `retired-attempts-bound` before any reserve, so no run could start. The bound only keeps the public record small; the rendered comment is
# independently held under MAX_BODY_CHARS (fail closed `record-overflow`), and 32 retired entries render well inside it (tested).
RETIRED_MAX = 32
RETIRED_KEYS = {"runId", "attempt", "sourceSha", "startedUtc", "retiredReason", "predecessorSha256", "evidence"}
RETIRED_EVIDENCE_KEYS = {"runStatus", "runConclusion", "runUpdatedUtc", "collectedUtc", "reserveJob", "liveJob", "settleJob", "journalRootSha",
                         "journalHeadSha", "journalEventsNamingRun"}
# A never-reserved attempt: its reserve job failed or never ran, and its live and settle jobs were skipped. The journal check below is what
# proves no reservation exists; the jobs only have to agree with it.
UNRESERVED_JOBS = (("reserveJob", "Reserve the run on the state-ref journal", ("failure", "skipped")),
                   ("liveJob", "Selected live journeys", ("skipped",)),
                   ("settleJob", "Settle the run's reservation", ("skipped",)))
UNRESERVED_EVIDENCE_KEYS = {"run", "jobs", "journal", "collectedAt"}


# The retirement reason follows the evidence's accounting (unexecuted_attempt_evidence.ACCOUNTING); the settle carries the usage itself.
RESERVED_REASONS = {"reserved-not-executed": "Reserved, not executed: no credential-bearing step ran; 0 product usage",
                    "reserved-preflight-only": "Reserved, setup failed: only the prerequisite preflight ran; settled at its bounded request charge",
                    "reserved-capped": "Reserved, setup failed after a credential-bearing step ran; usage unknown, settled at the reserved caps",
                    "reserved-terminated-capped": "Reserved, the run was cancelled or timed out; usage unknown, settled at the reserved caps"}
ACCOUNTING_REASON = {"none": "reserved-not-executed", "preflight-bound": "reserved-preflight-only", "capped": "reserved-capped",
                     "terminated-capped": "reserved-terminated-capped"}
UNEXECUTED_EVIDENCE_KEYS = {"runStatus", "runConclusion", "runUpdatedUtc", "evidenceSha256", "journalHeadSha", "runnerMinutes", "settleAtUtc"}
# Run 42483030590 (Sam 1794144135, 1794145971): reserved, EXECUTED and SETTLED, but its record was not publishable, so the attempt stayed
# `incomplete` with no completion and every later begin refused. It retires as history bound to its exact reserve/settle pair; nothing is
# re-settled and no case result is invented.
EXECUTED_REASON = "executed-unpublished"
EXECUTED_EVIDENCE_KEYS = {"runStatus", "runConclusion", "runUpdatedUtc", "collectedUtc", "evidenceSha256", "journalHeadSha", "reserveSha",
                          "settleSha", "settleAtUtc", "runnerMinutes"}


def sanitize_retired(r):
    """A retired-attempt entry exactly as stored; anything outside the closed shape of its reason refuses."""
    _keys(r, RETIRED_KEYS, "retired-attempt")
    _need(set(r) == RETIRED_KEYS and (r["retiredReason"] in ("never-reserved", EXECUTED_REASON) or r["retiredReason"] in RESERVED_REASONS),
          "retired-attempt")
    _need(isinstance(r["predecessorSha256"], str) and SHA64.match(r["predecessorSha256"]), "retired-attempt")
    _attempt(r["runId"], r["attempt"])
    _need(isinstance(r["sourceSha"], str) and SHA40.match(r["sourceSha"]) and isinstance(r["startedUtc"], str) and UTC.match(r["startedUtc"]), "retired-attempt")
    ev = r["evidence"]
    if r["retiredReason"] == EXECUTED_REASON:
        _keys(ev, EXECUTED_EVIDENCE_KEYS, "retired-evidence")
        _need(set(ev) == EXECUTED_EVIDENCE_KEYS and ev["runStatus"] == "completed" and ev["runConclusion"] == "failure"
              and type(ev["runnerMinutes"]) is int and 0 <= ev["runnerMinutes"] <= 1000
              and all(isinstance(ev[k], str) and UTC.match(ev[k]) for k in ("runUpdatedUtc", "collectedUtc", "settleAtUtc"))
              and ev["settleAtUtc"] <= ev["runUpdatedUtc"] <= ev["collectedUtc"]
              and isinstance(ev["evidenceSha256"], str) and SHA64.match(ev["evidenceSha256"])
              and all(isinstance(ev[k], str) and SHA40.match(ev[k]) for k in ("journalHeadSha", "reserveSha", "settleSha"))
              and ev["reserveSha"] != ev["settleSha"], "retired-evidence")
        return {k: (dict(sorted(v.items())) if k == "evidence" else v) for k, v in sorted(r.items())}
    if r["retiredReason"] in RESERVED_REASONS:
        _keys(ev, UNEXECUTED_EVIDENCE_KEYS, "retired-evidence")
        # a cancelled or timed-out run retires only as reserved-terminated-capped; every other reserved reason is a failed run
        conclusions = ("failure", "cancelled", "timed_out") if r["retiredReason"] == "reserved-terminated-capped" else ("failure",)
        _need(set(ev) == UNEXECUTED_EVIDENCE_KEYS and ev["runStatus"] == "completed" and ev["runConclusion"] in conclusions
              and type(ev["runnerMinutes"]) is int and 0 < ev["runnerMinutes"] <= 1000
              and all(isinstance(ev[k], str) and UTC.match(ev[k]) for k in ("runUpdatedUtc", "settleAtUtc"))
              and isinstance(ev["evidenceSha256"], str) and SHA64.match(ev["evidenceSha256"])
              and isinstance(ev["journalHeadSha"], str) and SHA40.match(ev["journalHeadSha"]), "retired-evidence")
        return {k: (dict(sorted(v.items())) if k == "evidence" else v) for k, v in sorted(r.items())}
    _keys(ev, RETIRED_EVIDENCE_KEYS, "retired-evidence")
    _need(set(ev) == RETIRED_EVIDENCE_KEYS and ev["runStatus"] == "completed" and ev["runConclusion"] == "failure"
          and ev["reserveJob"] in ("failure", "skipped") and ev["liveJob"] == "skipped" and ev["settleJob"] == "skipped"
          and ev["journalEventsNamingRun"] == 0
          and all(isinstance(ev[k], str) and UTC.match(ev[k]) for k in ("runUpdatedUtc", "collectedUtc")) and ev["runUpdatedUtc"] <= ev["collectedUtc"]
          and all(isinstance(ev[k], str) and SHA40.match(ev[k]) for k in ("journalRootSha", "journalHeadSha")), "retired-evidence")
    return {k: (dict(sorted(v.items())) if k == "evidence" else v) for k, v in sorted(r.items())}


def unreserved_candidate(state):
    """The run id when the in-progress attempt is `incomplete` with no pending completion, else None. The workflow tries the reserved-attempt
    retirement first, so a reserved attempt reaching here is refused below (the journal names it). Sam 1793881260.206739: any manual attempt that stopped before reserving (41933223835, or a later run interrupted
    before its reserve) must be retirable, or one setup failure wedges every later run. Being a candidate proves nothing: retire_unreserved
    retires it only on GitHub's evidence and a journal that names no event for it; otherwise it refuses and `begin` keeps refusing."""
    live = state.get("inProgress")
    if live is None or live.get("status") != "incomplete" or state.get("pendingCompletion") is not None:
        return None
    return live["runId"]


def _with_retired(state, entry):
    """The one place the retired state is built: in-progress cleared, the entry appended, nothing else touched."""
    return dict(state, inProgress=None, retiredAttempts=list(state.get("retiredAttempts") or []) + [entry])


def retire_unreserved(state, evidence, predecessor_sha256):
    """The state after retiring the one incomplete attempt, or a refusal. Closed evidence, every piece required and unambiguous:
    run {runId, attempt, headSha, status, conclusion, updatedAt}: GitHub's report of the failed run, `completed`, equal to the attempt in the record;
    jobs [{name, status, conclusion, runId, attempt, headSha}]: every job belongs to that run, attempt and source; exactly one job per
      UNRESERVED_JOBS prefix, `completed`, the reserve job `failure`, the live and settle jobs `skipped` (a missing, duplicated, running,
      cancelled or successful job is uncertain or contradicting, and refuses);
    journal {rootSha, headSha, runIds}: the state-ref head freshly read and validated from the pinned reviewed root, at any head, naming no event
      of this run, so this attempt never reserved or settled anything (other runs' events, such as an earlier settle, are untouched);
    collectedAt: when that was read, not before the run finished.
    `predecessor_sha256` binds the exact record body this retirement consumed. Only inProgress and retiredAttempts change; latestCompleted and
    history come back exactly as read, which is checked here, not assumed."""
    _need(unreserved_candidate(state) is not None, "unreserved-not-a-candidate")
    live = state["inProgress"]
    _need(isinstance(predecessor_sha256, str) and SHA64.match(predecessor_sha256), "unreserved-predecessor")
    _need(isinstance(evidence, dict) and set(evidence) == UNRESERVED_EVIDENCE_KEYS, "unreserved-evidence")
    run, jobs, journal = evidence["run"], evidence["jobs"], evidence["journal"]
    _need(isinstance(run, dict) and set(run) == {"runId", "attempt", "headSha", "status", "conclusion", "updatedAt"}, "unreserved-evidence")
    _need((run["runId"], run["attempt"], run["headSha"]) == (live["runId"], live["attempt"], live["sourceSha"]), "unreserved-run-differs")
    _need(run["status"] == "completed", "unreserved-run-not-completed")
    _need(run["conclusion"] == "failure", "unreserved-run-not-failed")
    _need(isinstance(run["updatedAt"], str) and UTC.match(run["updatedAt"]) and live["startedUtc"] <= run["updatedAt"], "unreserved-time")
    collected = evidence["collectedAt"]
    _need(isinstance(collected, str) and UTC.match(collected) and run["updatedAt"] <= collected, "unreserved-time")
    job_keys = {"name", "status", "conclusion", "runId", "attempt", "headSha"}
    _need(isinstance(jobs, list) and all(isinstance(j, dict) and set(j) == job_keys for j in jobs), "unreserved-evidence")
    # every job in the evidence is of THIS run, attempt and source: a job borrowed from another run or attempt is not evidence about this one
    _need(all((j["runId"], j["attempt"], j["headSha"]) == (live["runId"], live["attempt"], live["sourceSha"]) for j in jobs), "unreserved-job-not-of-the-run")
    seen = {}
    for key, prefix, wanted in UNRESERVED_JOBS:
        found = [j for j in jobs if isinstance(j["name"], str) and j["name"].startswith(prefix)]
        _need(len(found) == 1 and found[0]["status"] == "completed" and found[0]["conclusion"] in wanted, "unreserved-job-" + key)
        seen[key] = found[0]["conclusion"]
    import state_ref_writer
    _need(isinstance(journal, dict) and set(journal) == {"rootSha", "headSha", "runIds"}, "unreserved-evidence")
    _need(isinstance(journal["runIds"], list) and all(isinstance(r, str) for r in journal["runIds"]) and run["runId"] not in journal["runIds"],
          "unreserved-journal-names-the-run")
    # the freshly read chain is validated from the pinned reviewed root; at whatever head, no event names this run
    _need(journal["rootSha"] == state_ref_writer.REVIEWED_ROOT and isinstance(journal["headSha"], str) and SHA40.match(journal["headSha"]),
          "unreserved-journal-unverified")
    entry = sanitize_retired({"runId": live["runId"], "attempt": live["attempt"], "sourceSha": live["sourceSha"], "startedUtc": live["startedUtc"],
                              "retiredReason": "never-reserved", "predecessorSha256": predecessor_sha256,
                              "evidence": {"runStatus": "completed", "runConclusion": "failure", "runUpdatedUtc": run["updatedAt"], "collectedUtc": collected,
                                           "reserveJob": seen["reserveJob"], "liveJob": seen["liveJob"], "settleJob": seen["settleJob"],
                                           "journalRootSha": journal["rootSha"], "journalHeadSha": journal["headSha"], "journalEventsNamingRun": 0}})
    prior = list(state.get("retiredAttempts") or [])
    _need(all(r["runId"] != entry["runId"] for r in prior) and len(prior) < RETIRED_MAX, "retired-attempts-bound")
    out = _with_retired(state, entry)
    # the prior run's record and history must come back exactly as read
    for key in ("latestCompleted", "history", "pendingCompletion"):
        _need(canon(out.get(key)) == canon(state.get(key)), "unreserved-history-changed")
    return out


def unexecuted_candidate(state, evidence):
    """The run id when the in-progress attempt is `incomplete`, with no pending completion, and is exactly the run (id, attempt and head) the
    unexecuted-attempt evidence is about; else None. Which run that is comes from the journal's open reserve (unexecuted_attempt_evidence
    pending), never from a pinned list (Sam 1793881491.714239)."""
    live = state.get("inProgress")
    # Sam 1794100293: record-complete marks a cancelled attempt `cancelled`; only a terminated-capped settlement may retire one.
    # Sam 1794102706: when cancellation also kills record-complete, the record still says `running`. GitHub's authenticated evidence (run and
    # EVERY job completed, re-verified in check_evidence) proves it is not active; only terminated-capped evidence may retire such a record, so
    # an actually active run is never read as stopped.
    status = live.get("status") if live is not None else None
    if (live is None or status not in ("incomplete", "cancelled", "running") or state.get("pendingCompletion") is not None
            or not isinstance(evidence, dict)
            or (status in ("cancelled", "running") and evidence.get("accounting") != "terminated-capped")):
        return None
    ident = evidence.get("identity") or {}
    if (live.get("runId"), live.get("attempt"), live.get("sourceSha")) != (ident.get("runId"), ident.get("attempt"), ident.get("headSha")):
        return None
    return live["runId"]


def retire_unexecuted(state, evidence, predecessor_sha256):
    """The state after retiring a RESERVED attempt that did not execute, or a refusal. `evidence` is the closed document of
    unexecuted_attempt_evidence, re-verified HERE (never trusted from the caller): the pinned run, attempt and head, completed and failed, every job
    of that run, the live job failed at the pinned step with every credential-bearing step skipped, the journal (freshly validated from the pinned
    root) at the pinned head holding this run's one reserve, and the usage and settle time recomputed. The attempt is kept as `retiredAttempts`
    history, never as a completed run. It does not settle anything: the reservation is settled on the journal from the SAME evidence digest by
    journal-reserve, at that exact head. `predecessor_sha256` binds the exact record body consumed. Only inProgress and retiredAttempts change;
    latestCompleted, history, pendingCompletion and the earlier retired entries come back exactly as read, which is checked, not assumed."""
    import unexecuted_attempt_evidence as U
    _need(unexecuted_candidate(state, evidence) is not None, "unexecuted-not-a-candidate")
    live = state["inProgress"]
    _need(isinstance(predecessor_sha256, str) and SHA64.match(predecessor_sha256), "unexecuted-predecessor")
    try:
        digest, usage, at_utc = U.check_evidence(evidence)
    except U.Refused as err:
        raise Refused(str(err))
    run = evidence["run"]
    _need((run["runId"], run["attempt"], run["headSha"]) == (live["runId"], live["attempt"], live["sourceSha"]), "unexecuted-run-differs")
    _need(live["startedUtc"] <= run["updatedAt"], "unexecuted-time")
    entry = sanitize_retired({"runId": live["runId"], "attempt": live["attempt"], "sourceSha": live["sourceSha"], "startedUtc": live["startedUtc"],
                              "retiredReason": ACCOUNTING_REASON[evidence["accounting"]], "predecessorSha256": predecessor_sha256,
                              "evidence": {"runStatus": run["status"], "runConclusion": run["conclusion"], "runUpdatedUtc": run["updatedAt"],
                                           "evidenceSha256": digest, "journalHeadSha": evidence["journal"]["headSha"],
                                           "runnerMinutes": usage["runnerMinutes"], "settleAtUtc": at_utc}})
    prior = list(state.get("retiredAttempts") or [])
    _need(all(r["runId"] != entry["runId"] for r in prior) and len(prior) < RETIRED_MAX, "retired-attempts-bound")
    out = _with_retired(state, entry)
    for key in ("latestCompleted", "history", "pendingCompletion"):
        _need(canon(out.get(key)) == canon(state.get(key)), "unexecuted-history-changed")
    _need(out["retiredAttempts"][:len(prior)] == prior, "unexecuted-history-changed")
    return out


def executed_candidate(state, evidence):
    """The run id when the in-progress attempt is `incomplete`, with no pending completion, and is exactly the run (id, attempt and head) the
    executed-attempt evidence is about; else None. A `running` or `cancelled` record is never a candidate here."""
    live = state.get("inProgress")
    if (live is None or live.get("status") != "incomplete" or state.get("pendingCompletion") is not None or not isinstance(evidence, dict)):
        return None
    ident = evidence.get("identity") or {}
    if (live.get("runId"), live.get("attempt"), live.get("sourceSha")) != (ident.get("runId"), ident.get("attempt"), ident.get("headSha")):
        return None
    return live["runId"]


def retire_executed(state, evidence, predecessor_sha256):
    """The state after retiring a RESERVED, EXECUTED and SETTLED attempt whose record was not publishable, or a refusal. `evidence` is the closed
    document of executed_attempt_evidence, re-checked HERE: the run, attempt and head equal to the record's attempt, completed and failed; the
    record-begin, reserve, settle and record-complete jobs succeeded and the live job failed; the journal (validated from the pinned root when
    collected) holding exactly this run's one reserve and its directly following settle. Nothing is settled or re-settled: the entry only
    names the existing reserve/settle commits and the settled runner minutes. No case result is recorded, so it is never a completed run.
    `predecessor_sha256` binds the exact record body consumed. Only inProgress and retiredAttempts change; latestCompleted, history,
    pendingCompletion and the earlier retired entries come back exactly as read, which is checked, not assumed."""
    import executed_attempt_evidence as E
    _need(executed_candidate(state, evidence) is not None, "executed-not-a-candidate")
    live = state["inProgress"]
    _need(isinstance(predecessor_sha256, str) and SHA64.match(predecessor_sha256), "executed-predecessor")
    try:
        digest, settled = E.check_evidence(evidence)
    except E.Refused as err:
        raise Refused(str(err))
    import state_ref_writer
    run, journal = evidence["run"], evidence["journal"]
    _need(journal["rootSha"] == state_ref_writer.REVIEWED_ROOT, "executed-journal-unverified")
    _need(live["startedUtc"] <= journal["settleAtUtc"] <= run["updatedAt"], "executed-time")
    entry = sanitize_retired({"runId": live["runId"], "attempt": live["attempt"], "sourceSha": live["sourceSha"], "startedUtc": live["startedUtc"],
                              "retiredReason": EXECUTED_REASON, "predecessorSha256": predecessor_sha256,
                              "evidence": {"runStatus": run["status"], "runConclusion": run["conclusion"], "runUpdatedUtc": run["updatedAt"],
                                           "collectedUtc": evidence["collectedUtc"], "evidenceSha256": digest,
                                           "journalHeadSha": journal["headSha"], "reserveSha": journal["reserveSha"],
                                           "settleSha": journal["settleSha"], "settleAtUtc": journal["settleAtUtc"],
                                           "runnerMinutes": settled["runnerMinutes"]}})
    prior = list(state.get("retiredAttempts") or [])
    _need(all(r["runId"] != entry["runId"] for r in prior) and len(prior) < RETIRED_MAX, "retired-attempts-bound")
    out = _with_retired(state, entry)
    for key in ("latestCompleted", "history", "pendingCompletion"):
        _need(canon(out.get(key)) == canon(state.get(key)), "executed-history-changed")
    _need(out["retiredAttempts"][:len(prior)] == prior, "executed-history-changed")
    return out


def verify_predecessor(selected, current):
    """Refuses unless the stored comment is still exactly the record `select` returned: same comment id, same body bytes, same updated_at.
    Run immediately before publishing a retirement, so a record changed since it was read is never overwritten (the PATCH itself is not a
    compare-and-swap; the workflow's one serialized publisher is what excludes a second writer, and this closes the read-to-write gap)."""
    _need(isinstance(selected, dict) and set(selected) >= {"commentId", "body", "updatedAt"}, "record-predecessor-moved")
    _need(isinstance(current, dict) and {"id", "body", "updated_at"} <= set(current), "record-predecessor-moved")
    _need(selected["commentId"] is not None and current["id"] == selected["commentId"], "record-predecessor-moved")
    _need(isinstance(current["body"], str) and current["body"] == selected["body"], "record-predecessor-moved")
    _need(isinstance(current["updated_at"], str) and current["updated_at"] == selected["updatedAt"], "record-predecessor-moved")


def pending_completion(state, record, completion_deadline_utc, settle_receipt_sha256, occurrence_sha256):
    """Publish a durable, non-terminal candidate in the one mutable comment.

    It is intentionally not folded into history yet.  GitHub's trusted
    `updated_at` is only known after the PATCH; the next admitted record-begin
    is the consumer that reconciles the candidate after checking that time.
    """
    rec = sanitize_record(record, require_source=True)
    live = state.get("inProgress")
    _need(live is not None and live.get("status") == "running" and
          (live.get("runId"), live.get("attempt"), live.get("sourceSha")) ==
          (rec["runId"], rec["attempt"], rec["sourceSha"]), "record-not-the-running-attempt")
    _need(isinstance(completion_deadline_utc, str) and UTC.match(completion_deadline_utc), "pending-deadline")
    _need(isinstance(settle_receipt_sha256, str) and SHA64.match(settle_receipt_sha256), "pending-settlement")
    _need(isinstance(occurrence_sha256, str) and SHA64.match(occurrence_sha256), "pending-occurrence")
    return dict(state, inProgress=dict(live, status="incomplete"), pendingCompletion={
        "record": rec, "completionDeadlineUtc": completion_deadline_utc,
        "settleReceiptSha256": settle_receipt_sha256, "occurrenceSha256": occurrence_sha256})


def _pending_candidate(state, published_at):
    """Rebuild the candidate only when GitHub stored the pending record in time."""
    pending = state.get("pendingCompletion")
    _need(pending is not None, "no-pending-completion")
    _need(isinstance(published_at, str) and UTC.match(published_at), "pending-published-at")
    _need(published_at <= pending["completionDeadlineUtc"], "pending-completion-late")
    live = state.get("inProgress")
    base = dict(state, inProgress=dict(live, status="running"))
    base.pop("pendingCompletion", None)
    return complete(base, pending["record"])


def reconcile_pending(state, published_at, attestation, settle_receipt_raw, occurrence_raw, artifact_created_at, public_body):
    """Fold a pending candidate only from its immutable completion artifact.

    This is deliberately called by the next protected-main record-begin before
    it opens a new attempt.  The public pending record alone is insufficient:
    the separately uploaded attestation, the exact settlement receipt bytes and
    exact occurrence bytes must all agree, and GitHub must have created that
    immutable artifact inside the occurrence deadline.
    """
    pending = state.get("pendingCompletion")
    expected = _pending_candidate(state, published_at)
    _need(isinstance(artifact_created_at, str) and UTC.match(artifact_created_at), "completion-artifact-created-at")
    _need(artifact_created_at <= pending["completionDeadlineUtc"], "completion-artifact-late")
    _need(isinstance(attestation, dict) and set(attestation) == {
        "schema", "runId", "attempt", "sourceSha", "candidateSha256", "publicIncompleteSha256",
        "publishedAt", "settleReceiptSha256", "occurrenceSha256"}, "completion-attestation-shape")
    record = pending["record"]
    _need((attestation.get("schema"), attestation.get("runId"), attestation.get("attempt"), attestation.get("sourceSha")) ==
          (ATTESTATION_SCHEMA, record["runId"], record["attempt"], record["sourceSha"]), "completion-attestation-identity")
    _need(attestation.get("publishedAt") == published_at, "completion-attestation-published-at")
    _need(isinstance(public_body, str) and hashlib.sha256(public_body.encode()).hexdigest() ==
          attestation.get("publicIncompleteSha256"), "completion-attestation-public-state")
    candidate_body = render(expected)
    _need(hashlib.sha256(candidate_body.encode()).hexdigest() == attestation.get("candidateSha256"),
          "completion-attestation-candidate")
    _need(isinstance(settle_receipt_raw, bytes) and hashlib.sha256(settle_receipt_raw).hexdigest() ==
          pending["settleReceiptSha256"] == attestation.get("settleReceiptSha256"), "completion-settlement-bytes")
    try:
        receipt = json.loads(settle_receipt_raw)
    except ValueError:
        raise Refused("completion-settlement-bytes")
    _need(isinstance(receipt, dict) and set(receipt) == {"ref", "previousSha", "newSha", "ledgerBlobSha256", "proposalSha256"}
          and receipt.get("ref") == "refs/heads/cloud-test-state"
          and all(isinstance(receipt.get(k), str) and SHA40.match(receipt[k]) for k in ("previousSha", "newSha"))
          and all(isinstance(receipt.get(k), str) and SHA64.match(receipt[k]) for k in ("ledgerBlobSha256", "proposalSha256")),
          "completion-settlement-receipt")
    _need(isinstance(occurrence_raw, bytes) and hashlib.sha256(occurrence_raw).hexdigest() ==
          pending["occurrenceSha256"] == attestation.get("occurrenceSha256"), "completion-occurrence-bytes")
    try:
        occurrence = json.loads(occurrence_raw)
    except ValueError:
        raise Refused("completion-occurrence-bytes")
    _need(isinstance(occurrence, dict) and isinstance(occurrence.get("runId"), str) and occurrence["runId"]
          and (occurrence["runId"] == record.get("campaignId") or _unqualified(record)), "completion-occurrence-identity")
    return expected


def _unqualified(record):
    """init_run_inputs.project's UNQUALIFIED record, exactly: it names no campaign, request or catalog identity (all three are emitted only
    when qualified), is `failed`, coverage `unqualified`, and its codes begin with `not-qualified`. Its occurrence is bound by the pinned
    digests, not a campaign field it never carries. Run 42284568156 (refused in admission, every case UNKNOWN) refused here as
    completion-occurrence-identity; run 42423408284 (admission PASS, campaign refused before its first case, every case NOT RUN) refused the
    same way, and so would every incomplete or unqualified run that did execute cases, because the projection drops the campaign identity
    for all of them. An unqualified record never becomes row evidence (`_occurrence`: coverage `unqualified` is not batch/full/incomplete),
    so folding it is history, never a pass. A record that names a campaign must still name the occurrence's own."""
    codes = record.get("codes") or []
    return (record.get("campaignId") is None and record.get("requestSha256") is None and record.get("catalogSha256") is None
            and record.get("outcome") == "failed" and record.get("coverage") == "unqualified" and codes[:1] == ["not-qualified"])


def completion_attestation(candidate_body, public_body, published, settle_receipt_sha256, occurrence_sha256):
    """Bind a terminal candidate to the fail-closed public state GitHub actually stored.

    The public comment is deliberately *incomplete*, never terminal.  A completed
    occurrence exists only when this separate attestation is produced after the
    PATCH response and deadline checks.  Therefore a missing/malformed response,
    a timeout, or an interrupted correction cannot leave a visible false-complete
    record behind.
    """
    candidate, public = parse_body(candidate_body), parse_body(public_body)
    done, live = candidate.get("latestCompleted"), public.get("inProgress")
    _need(done is not None and candidate.get("inProgress") is None, "attestation-candidate-not-terminal")
    _need(live is not None and live.get("status") == "incomplete" and public.get("pendingCompletion") is not None,
          "attestation-public-not-incomplete")
    _need((done["runId"], done["attempt"], done["sourceSha"]) ==
          (live.get("runId"), live.get("attempt"), live.get("sourceSha")), "attestation-attempt-mismatch")
    # Rebuild the terminal state from the exact public predecessor. This binds
    # its retained history and latest-completed predecessor too; matching only
    # the run identity would let a different candidate be attested.
    expected = _pending_candidate(public, published.get("updated_at") if isinstance(published, dict) else None)
    _need(candidate == expected, "attestation-candidate-not-derived-from-public-state")
    _need(isinstance(published, dict) and isinstance(published.get("updated_at"), str)
          and UTC.match(published["updated_at"]), "attestation-published-at")
    _need(isinstance(published.get("body"), str)
          and published["body"].rstrip("\r\n") == public_body.rstrip("\r\n"), "attestation-public-readback")
    _need(isinstance(settle_receipt_sha256, str) and SHA64.match(settle_receipt_sha256), "attestation-settlement")
    _need(isinstance(occurrence_sha256, str) and SHA64.match(occurrence_sha256), "attestation-occurrence")
    _need(public["pendingCompletion"]["settleReceiptSha256"] == settle_receipt_sha256, "attestation-settlement")
    _need(public["pendingCompletion"]["occurrenceSha256"] == occurrence_sha256, "attestation-occurrence")
    return {"schema": ATTESTATION_SCHEMA, "runId": done["runId"], "attempt": done["attempt"],
            "sourceSha": done["sourceSha"], "candidateSha256": hashlib.sha256(candidate_body.encode()).hexdigest(),
            "publicIncompleteSha256": hashlib.sha256(public_body.encode()).hexdigest(),
            "publishedAt": published["updated_at"], "settleReceiptSha256": settle_receipt_sha256,
            "occurrenceSha256": occurrence_sha256}


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("select", "begin", "complete", "interrupt", "pending", "reconcile", "verify", "attest",
                                       "unreserved-candidate", "retire-unreserved", "unexecuted-candidate", "retire-unexecuted",
                                       "executed-candidate", "retire-executed", "verify-predecessor"))
    for flag in ("--comments", "--previous", "--record", "--run-id", "--source-sha", "--started-utc", "--status", "--out", "--issue-url",
                 "--candidate", "--public-body", "--published", "--settle-receipt-sha256", "--occurrence-sha256",
                 "--completion-deadline-utc", "--published-at", "--artifact-created-at", "--attestation",
                 "--settle-receipt", "--occurrence", "--evidence", "--selected", "--current"):
        a.add_argument(flag)
    a.add_argument("--attempt", type=int)
    a.add_argument("--comment-id", type=int)
    a.add_argument("--bot-login", default=BOT_LOGIN)
    x = a.parse_args(argv[1:])
    try:
        if x.command == "select":
            print(json.dumps(select(json.loads(_read(x.comments)), x.issue_url, x.bot_login, x.comment_id)))
            return 0
        if x.command == "verify":
            # readback after publication: the stored comment must be exactly the rendered body and parse to the same state. The PATCH itself is
            # not compare-and-swap; the workflow's single serialized publisher (its concurrency group) is what prevents a concurrent writer.
            expected = _read(x.previous)
            stored = select(json.loads(_read(x.comments)), x.issue_url, x.bot_login, x.comment_id)["body"]
            _need(stored.rstrip("\r\n") == expected.rstrip("\r\n") and parse_body(stored) == parse_body(expected), "record-readback-differs")
            return 0
        if x.command == "verify-predecessor":
            verify_predecessor(json.loads(_read(x.selected)), json.loads(_read(x.current)))
            return 0
        if x.command == "attest":
            attestation = completion_attestation(_read(x.candidate), _read(x.public_body), json.loads(_read(x.published)),
                                                 x.settle_receipt_sha256, x.occurrence_sha256)
            with open(x.out, "w", encoding="utf-8") as f:
                json.dump(attestation, f, sort_keys=True, separators=(",", ":"))
                f.write("\n")
            return 0
        state = parse_body(_read(x.previous))
        if x.command == "unreserved-candidate":
            run_id = unreserved_candidate(state)
            if run_id is None:
                return 1
            print(run_id)
            return 0
        if x.command == "unexecuted-candidate":
            run_id = unexecuted_candidate(state, json.loads(_read(x.evidence)) if x.evidence else None)
            if run_id is None:
                return 1
            print(run_id)
            return 0
        if x.command == "executed-candidate":
            run_id = executed_candidate(state, json.loads(_read(x.evidence)) if x.evidence else None)
            if run_id is None:
                return 1
            print(run_id)
            return 0
        if x.command == "retire-executed":
            state = retire_executed(state, json.loads(_read(x.evidence)), hashlib.sha256(_read(x.previous).encode("utf-8")).hexdigest())
        elif x.command == "retire-unexecuted":
            state = retire_unexecuted(state, json.loads(_read(x.evidence)), hashlib.sha256(_read(x.previous).encode("utf-8")).hexdigest())
        elif x.command == "retire-unreserved":
            state = retire_unreserved(state, json.loads(_read(x.evidence)), hashlib.sha256(_read(x.previous).encode("utf-8")).hexdigest())
        elif x.command == "reconcile":
            state = reconcile_pending(state, x.published_at, json.loads(_read(x.attestation)),
                                      open(x.settle_receipt, "rb").read(), open(x.occurrence, "rb").read(),
                                      x.artifact_created_at, _read(x.previous))
        elif x.command == "pending":
            state = pending_completion(state, json.loads(_read(x.record)), x.completion_deadline_utc,
                                       x.settle_receipt_sha256, x.occurrence_sha256)
        elif x.command == "begin":
            state = begin(state, x.run_id, x.attempt, x.source_sha, x.started_utc)
        elif x.command == "complete":
            state = complete(state, json.loads(_read(x.record)))
        else:
            state = interrupt(state, x.run_id, x.attempt, x.status)
        with open(x.out, "w", encoding="utf-8") as f:
            f.write(render(state))
        return 0
    except (Refused, OSError, ValueError, TypeError) as e:
        print("BLOCKED_SETUP: " + (str(e) if isinstance(e, Refused) else "latest-record-input-unreadable"), file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
