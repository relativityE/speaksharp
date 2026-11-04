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


def sanitize_record(rec):
    """The terminal record exactly as published; refuses anything outside the closed shape."""
    # Three identities, never conflated: the workflow source that ran the harness, the product release the request tested, and the release
    # observed served at admission (Sam 1793539017 RETURN, finding 4).
    _keys(rec, {"runId", "attempt", "sourceSha", "testedSha", "servedSha", "campaignId", "coverage", "requestSha256", "catalogSha256",
                "startedUtc", "endedUtc", "outcome", "cases", "codes", "rowVerdicts", "comparability", "evidence"}, "record")
    _attempt(rec.get("runId"), rec.get("attempt"))
    _need(isinstance(rec.get("sourceSha"), str) and SHA40.match(rec["sourceSha"]), "source-sha")
    _need(isinstance(rec.get("testedSha"), str) and SHA40.match(rec["testedSha"]), "tested-sha")
    # coverage (Sam 1793547120.015339): full/batch/smoke when every selected required row EXECUTED (PASS or FAIL), incomplete when any did
    # not, unqualified when the qualification was not bound to this record. Smoke is a diagnostic result, never full/nightly history.
    # Coverage is not the outcome: a fully executed baseline may still be failed.
    _need(rec.get("coverage") in ("batch", "smoke", "full", "incomplete", "unqualified"), "coverage")
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
        _need(c.get("result") in ("PASS", "FAIL", "NOT RUN", "NOT SELECTED"), "case-result")
        _keys(c.get("rows"), {"pass", "fail", "notRun"}, "rows")
        _need(set(c["rows"]) == {"pass", "fail", "notRun"} and all(_count(v) for v in c["rows"].values()), "rows")
        _need((c["result"] == "PASS") == (c["rows"]["fail"] == 0 and c["rows"]["notRun"] == 0 and c["rows"]["pass"] > 0), "case-result-rows")
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
                   "outcome", "coverage", "identity", "evidence", "rowEvidence"}
COMPARABILITY_KEYS = {"codeManifestSha256", "packetManifestSha256", "mediaManifestSha256", "backendSha"}
MAX_OCCURRENCES = 62          # two 31-day periods of nightly occurrences, retained in order
MAX_HISTORY_BYTES = 48000     # serialized-size bound for the history block
MAX_BODY_CHARS = 60000        # the whole rendered comment, under GitHub's 65536-character body limit


def canon(doc):
    return json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()


def _occurrence(rec, identity):
    # usable row evidence needs at least one EXECUTED row (PASS or FAIL): an all-NOT-RUN map is not evidence (RETURN 1793576632.959179)
    executed = any(ch in "PF" for v in (rec.get("rowVerdicts") or {}).values() for ch in v)
    # Smoke rows remain visible in latestCompleted but never become G7/full/nightly carry-forward evidence.
    qualified_rows = executed and rec["coverage"] in ("batch", "full", "incomplete") and rec.get("evidence") is not None
    return dict({k: rec.get(k) for k in OCCURRENCE_KEYS - {"identity", "evidence", "rowEvidence"}}, identity=identity,
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
        _need(isinstance(o, dict) and OCCURRENCE_KEYS - {"identity", "evidence", "rowEvidence"} <= set(o) <= OCCURRENCE_KEYS, "history-occurrence")
        _need(type(o.get("rowEvidence", False)) is bool and (o.get("evidence") is None or (isinstance(o["evidence"], dict)
              and set(o["evidence"]) == {"planSha256", "caseResultsSha256"})), "history-occurrence")
        # row evidence only from a qualified run with its qualification digests: an unqualified or row-empty occurrence never counts
        _need(not o.get("rowEvidence") or (o["coverage"] in ("batch", "full", "incomplete") and o.get("evidence") is not None), "history-occurrence")
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
    acceptance_evidence = rec["coverage"] != "smoke"
    if prior and acceptance_evidence and rec.get("rowVerdicts"):
        # row positions are catalog positions: a different catalog makes them incomparable, so the fold refuses rather than mixing them
        _need(all(o.get("coverage") == "smoke" or o.get("catalogSha256") in (None, rec.get("catalogSha256"))
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
          {"schema", "latestCompleted", "inProgress", "history", "pendingCompletion"},
          "latest-record-unreadable")
    _need(state.get("schema") == SCHEMA, "latest-record-unreadable")
    if state.get("latestCompleted") is not None:
        state["latestCompleted"] = sanitize_record(state["latestCompleted"])
    if "history" in state:
        state["history"] = sanitize_history(state["history"])
        _need(state["history"] is not None, "latest-record-unreadable")
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
        tally = {r: sum(1 for c in done["cases"] if c["result"] == r) for r in ("PASS", "FAIL", "NOT RUN")}
        lines.append("Latest completed: run %s attempt %d at `%s`: **%s** (%d PASS, %d FAIL, %d NOT RUN)" % (
            done["runId"], done["attempt"], done["sourceSha"][:12], done["outcome"], tally["PASS"], tally["FAIL"], tally["NOT RUN"]))
    else:
        lines.append("Latest completed: none yet.")
    lc = (state.get("history") or {}).get("lastComparison")
    if lc:
        lines.append("Row comparison for run %s: %d regression(s), %d fix(es), %d not comparable" % (
            lc["runId"], sum(lc["regressions"].values()), sum(lc["fixes"].values()), sum(lc["notComparable"].values())))
    if live:
        lines.append("In progress: run %s attempt %d, status %s." % (live["runId"], live["attempt"], live["status"]))
    pending = state.get("pendingCompletion")
    if pending:
        rec = pending["record"]
        tally = {r: sum(1 for c in rec["cases"] if c["result"] == r) for r in ("PASS", "FAIL", "NOT RUN")}
        lines.append("Pending completion: run %s attempt %d: **%s** (%d PASS, %d FAIL, %d NOT RUN); next admitted run reconciles it from GitHub server time." %
                     (rec["runId"], rec["attempt"], rec["outcome"], tally["PASS"], tally["FAIL"], tally["NOT RUN"]))
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
    rec = sanitize_record(record)
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
    return {"schema": SCHEMA, "latestCompleted": rec, "inProgress": None, "history": history}


def interrupt(state, run_id, attempt, status):
    _need(status in ("cancelled", "incomplete"), "interrupt-status")
    live = state["inProgress"]
    _need(live is not None and (live["runId"], live["attempt"]) == (run_id, attempt), "record-not-the-running-attempt")
    return dict(state, inProgress=dict(live, status=status))


def pending_completion(state, record, completion_deadline_utc, settle_receipt_sha256, occurrence_sha256):
    """Publish a durable, non-terminal candidate in the one mutable comment.

    It is intentionally not folded into history yet.  GitHub's trusted
    `updated_at` is only known after the PATCH; the next admitted record-begin
    is the consumer that reconciles the candidate after checking that time.
    """
    rec = sanitize_record(record)
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
    _need(isinstance(occurrence, dict) and occurrence.get("runId") == record.get("campaignId"), "completion-occurrence-identity")
    return expected


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
    a.add_argument("command", choices=("select", "begin", "complete", "interrupt", "pending", "reconcile", "verify", "attest"))
    for flag in ("--comments", "--previous", "--record", "--run-id", "--source-sha", "--started-utc", "--status", "--out", "--issue-url",
                 "--candidate", "--public-body", "--published", "--settle-receipt-sha256", "--occurrence-sha256",
                 "--completion-deadline-utc", "--published-at", "--artifact-created-at", "--attestation",
                 "--settle-receipt", "--occurrence"):
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
        if x.command == "attest":
            attestation = completion_attestation(_read(x.candidate), _read(x.public_body), json.loads(_read(x.published)),
                                                 x.settle_receipt_sha256, x.occurrence_sha256)
            with open(x.out, "w", encoding="utf-8") as f:
                json.dump(attestation, f, sort_keys=True, separators=(",", ":"))
                f.write("\n")
            return 0
        state = parse_body(_read(x.previous))
        if x.command == "reconcile":
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
