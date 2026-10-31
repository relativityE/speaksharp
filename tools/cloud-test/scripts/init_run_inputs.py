"""Run-scoped inputs of the GitHub live caller in LATEST-RUN history mode (Sam 1793472272.951949): the ONE validated schema that this initializer
writes and the gate pipeline reads (`load_run_inputs`), so the two can never disagree.

Latest-run mode keeps exactly one prior record: the previous TERMINAL run's sanitized record from the latest-record comment
(publish_latest_record.py), or an explicitly declared first run. There are no R4/R4C/R5 baselines and no hash chain here; the historical audit
stays separate and unchanged. Counters and reservations are scoped to THIS run and start at zero only because this is a new run: a re-run
attempt, a prior record of this same run, a prior attempt that never reached a terminal record, a missing or unreadable prior record and any
mixed or unknown history mode are refused before any live effect. Current caps come from the reviewed config and are never raised by input.

Usage:
  init_run_inputs.py build   --config CFG --out DIR --cases CSV --facts-refs JSON --run-id N --attempt N --source-sha SHA
                             --prior-state PRIOR.json [--first-run] [--env-file F] [--outputs F]
  init_run_inputs.py project --run-record RUN-RECORD.json --run-id N --attempt N --source-sha SHA --out LATEST-RECORD.json
Exit 78 (BLOCKED_SETUP) on every refusal.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline)
import publish_latest_record as LR  # noqa: E402

SCHEMA = "speaksharp.cloud-test.run-inputs.v1"
MODE = "latest-run"
PRODUCER_CASES = {"AHT-01", "AHT-02", "AHT-03", "AHT-07", "AHT-08"}
ROLE = {**{"AHT-%02d" % n: "existing-disposable" for n in range(1, 15)}, "AHT-15": "maintained-read-only"}
REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/#-]{2,159}$")
FACT_KEYS = {"ownerApprovalReference", "approvedBy", "reviewer", "approvedSourceSha", "approvedCases", "approvedAccountRole", "receipts", "backend"}
RECEIPT_KEYS = {"analytics", "disp", "fence", "review"}
BACKEND_KEYS = {"manifestRef", "generation", "completion", "migration129"}
COUNTERS = ("requests", "identityReads", "starts", "takes", "coaching")


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def parse_cases(csv):
    cases = [c.strip() for c in (csv or "").split(",") if c.strip()]
    _need(cases and len(cases) == len(set(cases)) and all(LR.CASE.match(c) for c in cases), "case-selection")
    return sorted(cases)


def validate_facts(facts, cases, source_sha):
    """Bounded reference strings only, bound to THIS source and case selection and to one account role. Values and identifiers are refused."""
    _need(isinstance(facts, dict) and set(facts) == FACT_KEYS, "facts-shape")
    for k in ("ownerApprovalReference", "approvedBy", "reviewer"):
        _need(isinstance(facts[k], str) and REF.match(facts[k]), "facts-reference:" + k)
    _need(facts["approvedSourceSha"] == source_sha, "approval-not-for-this-source")
    _need(isinstance(facts["approvedCases"], list) and sorted(facts["approvedCases"]) == cases, "approval-not-for-these-cases")
    roles = {ROLE[c] for c in cases}
    _need(len(roles) == 1, "mixed-account-roles")
    _need(facts["approvedAccountRole"] == roles.pop(), "approval-not-for-this-account-role")
    _need(isinstance(facts["receipts"], dict) and set(facts["receipts"]) == RECEIPT_KEYS and
          all(isinstance(v, str) and REF.match(v) for v in facts["receipts"].values()), "facts-receipts")
    b = facts["backend"]
    _need(isinstance(b, dict) and set(b) == BACKEND_KEYS and isinstance(b["manifestRef"], str) and REF.match(b["manifestRef"]) and
          isinstance(b["generation"], int) and not isinstance(b["generation"], bool) and b["generation"] >= 1 and
          b["completion"] in ("ON", "OFF") and b["migration129"] in ("present", "absent"), "facts-backend")
    return facts


def prior_from_state(state, run_id, first_run):
    """The prior as latest-run mode accepts it. `state` is the latest-record comment's state read BEFORE this attempt began: a first run is
    accepted only when it holds no record at all, a replacement only when it holds a terminal record of another run, and never with an
    attempt left unreconciled."""
    _need(isinstance(state, dict) and set(state) == {"schema", "latestCompleted", "inProgress"} and state["schema"] == LR.SCHEMA, "prior-unreadable")
    _need(state["inProgress"] is None, "prior-attempt-not-terminal")
    if first_run:
        _need(state["latestCompleted"] is None, "first-run-declared-but-a-record-exists")
        return {"mode": "first-run"}
    _need(state["latestCompleted"] is not None, "prior-missing-not-declared-first-run")
    try:
        rec = LR.sanitize_record(state["latestCompleted"])
    except LR.Refused:
        raise Refused("prior-unreadable")
    _need(rec["runId"] != run_id, "rerun-of-a-recorded-run")
    return {"mode": "replacement", "record": rec}


def build(cfg, cases, facts, run_id, attempt, source_sha, prior_state, first_run):
    _need(isinstance(run_id, str) and LR.RUN_ID.match(run_id), "run-id")
    _need(attempt == 1, "rerun-attempt-refused")
    _need(isinstance(source_sha, str) and LR.SHA40.match(source_sha), "source-sha")
    limits = cfg["limits"]
    _need(len(cases) <= limits["maxSelectedCases"], "selection-exceeds-current-cap")
    prior = prior_from_state(prior_state, run_id, first_run)
    return {"schema": SCHEMA, "historyMode": MODE, "runId": run_id, "attempt": attempt, "sourceSha": source_sha, "cases": cases,
            "route": "github-producer" if set(cases) & PRODUCER_CASES else "github-direct",
            "prior": prior, "facts": validate_facts(facts, cases, source_sha),
            "counters": {"scope": "run", "runId": run_id, "consumed": {k: 0 for k in COUNTERS},
                         "caps": {"requests": limits["maxRunCapRequests"], "identityReads": limits["maxIdentityReadsPerRun"]}},
            "reservations": {"scope": "run", "runId": run_id, "entries": []}}


def load_run_inputs(doc, run_id=None, source_sha=None):
    """The pipeline's reader: the same closed schema, re-validated, bound to the current run; anything else is refused, never coerced."""
    _need(isinstance(doc, dict) and doc.get("schema") == SCHEMA, "run-inputs-schema")
    _need(doc.get("historyMode") == MODE, "history-mode-unknown-or-mixed")
    _need(set(doc) == {"schema", "historyMode", "runId", "attempt", "sourceSha", "cases", "route", "prior", "facts", "counters", "reservations"},
          "run-inputs-shape")
    _need(run_id is None or doc["runId"] == run_id, "run-inputs-for-another-run")
    _need(source_sha is None or doc["sourceSha"] == source_sha, "run-inputs-for-another-source")
    _need(doc["attempt"] == 1, "rerun-attempt-refused")
    cases = parse_cases(",".join(doc["cases"]))
    validate_facts(doc["facts"], cases, doc["sourceSha"])
    p = doc["prior"]
    _need(p == {"mode": "first-run"} or (isinstance(p, dict) and set(p) == {"mode", "record"} and p["mode"] == "replacement"), "prior-mode")
    if p["mode"] == "replacement":
        _need(LR.sanitize_record(p["record"]) == p["record"] and p["record"]["runId"] != doc["runId"], "prior-record")
    c, r = doc["counters"], doc["reservations"]
    _need(c.get("scope") == "run" and c.get("runId") == doc["runId"] and r.get("scope") == "run" and r.get("runId") == doc["runId"], "counters-not-run-scoped")
    _need(set(c["consumed"]) == set(COUNTERS) and all(isinstance(v, int) and v >= 0 for v in c["consumed"].values()), "counters-shape")
    _need(all(c["consumed"].get(k, 0) <= v for k, v in c["caps"].items()), "current-cap-exceeded")
    return doc


def project(run_record, run_id, attempt, source_sha):
    """run-record.json -> the closed latest record the publisher accepts; statuses and counts only."""
    _need(isinstance(run_record, dict) and run_record.get("schema") == "speaksharp.cloud-test.run-record.v1", "run-record-schema")
    _need((run_record.get("release") or {}).get("testedSha") == source_sha, "run-record-for-another-source")
    cases = []
    for c in run_record.get("cases") or []:
        a = c.get("assertions") or {}
        cases.append({"caseId": c.get("case"), "result": c.get("result"),
                      "rows": {"pass": a.get("PASS"), "fail": a.get("FAIL"), "notRun": a.get("NOT RUN")},
                      "codes": [c["outcomeClass"]] if isinstance(c.get("outcomeClass"), str) and LR.CODE.match(c["outcomeClass"]) else []})
    rec = {"runId": run_id, "attempt": attempt, "sourceSha": source_sha, "servedSha": (run_record.get("release") or {}).get("servedShaAtAdmission"),
           "startedUtc": run_record.get("startedUtc"), "endedUtc": run_record.get("endedUtc"),
           "outcome": "passed" if cases and all(c["result"] == "PASS" for c in cases) else "failed", "cases": cases, "codes": []}
    try:
        return LR.sanitize_record(rec)
    except LR.Refused as e:
        raise Refused("run-record-not-publishable:" + str(e))


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("build", "project"))
    for flag in ("--config", "--out", "--cases", "--facts-refs", "--run-id", "--source-sha", "--prior-state", "--env-file", "--outputs", "--run-record"):
        a.add_argument(flag)
    a.add_argument("--attempt", type=int)
    a.add_argument("--first-run", action="store_true")
    x = a.parse_args(argv[1:])
    try:
        if x.command == "project":
            rec = project(_load(x.run_record), x.run_id, x.attempt, x.source_sha)
            with open(x.out, "x", encoding="utf-8") as f:
                json.dump(rec, f, sort_keys=True)
            return 0
        doc = build(_load(x.config), parse_cases(x.cases), json.loads(x.facts_refs or "null"), x.run_id, x.attempt, x.source_sha,
                    _load(x.prior_state), x.first_run)
        load_run_inputs(doc, x.run_id, x.source_sha)
        os.makedirs(x.out, mode=0o700)
        path = os.path.join(x.out, "run-inputs.json")
        with open(path, "x", encoding="utf-8") as f:
            json.dump(doc, f, sort_keys=True, indent=1)
        if x.env_file:
            with open(x.env_file, "a", encoding="utf-8") as f:
                f.write("CT_RUN_INPUTS=%s\n" % path)
        if x.outputs:
            with open(x.outputs, "a", encoding="utf-8") as f:
                f.write("route=%s\n" % doc["route"])
        return 0
    except (Refused, LR.Refused) as e:
        print("BLOCKED_SETUP: " + str(e), file=sys.stderr)
        return 78
    except (OSError, ValueError, TypeError, KeyError):
        print("BLOCKED_SETUP: run-inputs-unreadable", file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
