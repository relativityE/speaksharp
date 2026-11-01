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
BOT_LOGIN = "github-actions[bot]"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
UTC = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
CODE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
CASE = re.compile(r"^AHT-(0[1-9]|1[0-5])$")
RUN_ID = re.compile(r"^[1-9][0-9]{0,19}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
CAMPAIGN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
JSON_BLOCK = re.compile(r"```json\n(.*?)\n```", re.S)


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
                "startedUtc", "endedUtc", "outcome", "cases", "codes"}, "record")
    _attempt(rec.get("runId"), rec.get("attempt"))
    _need(isinstance(rec.get("sourceSha"), str) and SHA40.match(rec["sourceSha"]), "source-sha")
    _need(isinstance(rec.get("testedSha"), str) and SHA40.match(rec["testedSha"]), "tested-sha")
    # coverage (Sam 1793547120.015339): full/batch when every selected required row EXECUTED (PASS or FAIL), incomplete when any did not,
    # unqualified when the qualification was not bound to this record. Coverage is not the outcome: a full baseline may be failed.
    _need(rec.get("coverage") in ("batch", "full", "incomplete", "unqualified"), "coverage")
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
          (rec["outcome"] == "passed" and rec["coverage"] in ("batch", "full")) or
          (rec["outcome"] == "failed" and (rec["coverage"] == "incomplete" or "not-qualified" in (rec.get("codes") or []))),
          "outcome-cases")
    return {"runId": rec["runId"], "attempt": rec["attempt"], "sourceSha": rec["sourceSha"], "testedSha": rec["testedSha"], "servedSha": rec.get("servedSha"),
            "campaignId": rec.get("campaignId"), "coverage": rec["coverage"], "requestSha256": rec.get("requestSha256"),
            "catalogSha256": rec.get("catalogSha256"),
            "startedUtc": rec["startedUtc"], "endedUtc": rec["endedUtc"], "outcome": rec["outcome"],
            "cases": sorted(out, key=lambda c: c["caseId"]), "codes": _codes(rec.get("codes", []), 16)}


# G7 durable carry-forward (Sam 1793573813.598689): the bounded history every completed run folds into this same record. Per case: the last
# EXECUTED verdict (PASS/FAIL) and the last-known-good, each bound to the occurrence that produced it; NOT RUN and NOT SELECTED never erase
# them. Each fold binds the expected predecessor (its digest and sequence), refuses a replayed run and an out-of-order occurrence, and fails
# closed when the serialized history would exceed its bound rather than drop required history.
HISTORY_KEYS = {"sequence", "predecessorSha256", "occurrences", "rows"}
OCCURRENCE_KEYS = {"runId", "attempt", "campaignId", "requestSha256", "catalogSha256", "sourceSha", "testedSha", "servedSha", "endedUtc",
                   "outcome", "coverage"}
MAX_OCCURRENCES = 62          # two 31-day periods of nightly occurrences, retained in order
MAX_HISTORY_BYTES = 32768     # serialized-size bound; the GitHub comment body limit is 65536 characters


def canon(doc):
    return json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()


def _occurrence(rec):
    return {k: rec.get(k) for k in OCCURRENCE_KEYS}


def sanitize_history(h):
    """The retained history exactly as published; anything outside the closed shape or its bounds refuses."""
    if h is None:
        return None
    _keys(h, HISTORY_KEYS, "history")
    _need(type(h.get("sequence")) is int and h["sequence"] >= 1, "history-sequence")
    _need(h.get("predecessorSha256") is None or (isinstance(h["predecessorSha256"], str) and SHA64.match(h["predecessorSha256"])), "history-predecessor")
    occ = h.get("occurrences")
    _need(isinstance(occ, list) and 1 <= len(occ) <= MAX_OCCURRENCES, "history-occurrences")
    for o in occ:
        _keys(o, OCCURRENCE_KEYS, "history-occurrence")
        _attempt(o.get("runId"), o.get("attempt"))
        _need(isinstance(o.get("endedUtc"), str) and UTC.match(o["endedUtc"]) and o.get("outcome") in ("passed", "failed"), "history-occurrence")
    _need(all(a["endedUtc"] < b["endedUtc"] for a, b in zip(occ, occ[1:])) and len({o["runId"] for o in occ}) == len(occ), "history-order")
    rows, run_ids = h.get("rows"), {o["runId"] for o in occ}
    _need(isinstance(rows, dict) and set(rows) <= {"AHT-%02d" % n for n in range(1, 16)}, "history-rows")
    for r in rows.values():
        _keys(r, {"last", "lastKnownGood"}, "history-row")
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
    occ.append(_occurrence(rec))
    _need(len(occ) <= MAX_OCCURRENCES, "history-overflow")
    rows = {cid: dict(r) for cid, r in (prior["rows"] if prior else {}).items()}
    for c in rec["cases"]:
        if c["result"] not in ("PASS", "FAIL"):
            continue  # NOT RUN / NOT SELECTED never erase prior evidence
        entry = {"result": c["result"], "runId": rec["runId"], "endedUtc": rec["endedUtc"]}
        row = rows.setdefault(c["caseId"], {"last": None, "lastKnownGood": None})
        row["last"] = entry
        if c["result"] == "PASS":
            row["lastKnownGood"] = entry
    nxt = {"sequence": (prior["sequence"] + 1) if prior else 1, "predecessorSha256": expected_predecessor, "occurrences": occ, "rows": rows}
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
    _need(isinstance(state, dict) and {"schema", "latestCompleted", "inProgress"} <= set(state) <= {"schema", "latestCompleted", "inProgress", "history"},
          "latest-record-unreadable")
    _need(state.get("schema") == SCHEMA, "latest-record-unreadable")
    if state.get("latestCompleted") is not None:
        state["latestCompleted"] = sanitize_record(state["latestCompleted"])
    if "history" in state:
        state["history"] = sanitize_history(state["history"])
        _need(state["history"] is not None, "latest-record-unreadable")
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
    if live:
        lines.append("In progress: run %s attempt %d, status %s." % (live["runId"], live["attempt"], live["status"]))
    lines += ["", "```json", json.dumps(state, sort_keys=True, indent=1), "```"]
    return "\n".join(lines) + "\n"


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
        return {"commentId": None, "body": ""}
    _need(isinstance(marked[0].get("id"), int) and (comment_id is None or marked[0]["id"] == comment_id), "comment-id")
    _need(marked[0]["body"].startswith(MARKER + "\n"), "latest-record-unreadable")
    return {"commentId": marked[0]["id"], "body": marked[0]["body"]}


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
    return {"schema": SCHEMA, "latestCompleted": rec, "inProgress": None, "history": history}


def interrupt(state, run_id, attempt, status):
    _need(status in ("cancelled", "incomplete"), "interrupt-status")
    live = state["inProgress"]
    _need(live is not None and (live["runId"], live["attempt"]) == (run_id, attempt), "record-not-the-running-attempt")
    return dict(state, inProgress=dict(live, status=status))


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("select", "begin", "complete", "interrupt"))
    for flag in ("--comments", "--previous", "--record", "--run-id", "--source-sha", "--started-utc", "--status", "--out", "--issue-url"):
        a.add_argument(flag)
    a.add_argument("--attempt", type=int)
    a.add_argument("--comment-id", type=int)
    a.add_argument("--bot-login", default=BOT_LOGIN)
    x = a.parse_args(argv[1:])
    try:
        if x.command == "select":
            print(json.dumps(select(json.loads(_read(x.comments)), x.issue_url, x.bot_login, x.comment_id)))
            return 0
        state = parse_body(_read(x.previous))
        if x.command == "begin":
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
