#!/usr/bin/env python3
"""Builds run-record.json from the harness's original outputs after an execute run. Offline; reads files only; never prints identifiers.
Usage: collect_run_record.py --request R.json --case-results run/case-results.json --ledger-dir ledgers --gate-status G.json
                             --workflow W.json --started-utc T --ended-utc T --runner-json RUNNER.json --out run-record.json
RUNNER.json carries non-secret runner identity: {"os":..,"nodeVersion":..,"chromeVersion":..,"githubRunId":..,"githubRunAttempt":..,"githubSha":..}.
Spend comes only from the guard's own ledgers and case receipts (request counts by category, identity reads); no dollar figure is written here. Starts and takes are reported only if the harness records them; otherwise null."""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import load, dump, sha256_file  # noqa: E402
from derive_case_costs import count_actions  # noqa: E402


def paid_actions(cr):
    """Executed / not executed, from the harness's paid-effect layer; never a dollar figure."""
    pc = cr.get("paidCheckout") or {}
    if pc.get("result") == "NOT RUN":
        return "none-executed"
    return "unknown"


def main():
    a = argparse.ArgumentParser()
    for k in ("request", "case-results", "ledger-dir", "gate-status", "workflow", "runner-json", "out"):
        a.add_argument("--" + k, required=True)
    a.add_argument("--cases-dir", help="run/cases: Starts and takes are counted from each case's action-reservations.jsonl")
    a.add_argument("--started-utc")
    a.add_argument("--ended-utc")
    x = a.parse_args()
    req, cr, gs, wf = load(x.request), load(x.case_results), load(x.gate_status), load(x.workflow)
    camp = load(os.path.join(x.ledger_dir, "campaign-ledger.json"))
    idl = load(os.path.join(x.ledger_dir, "identity-ledger.json"))
    cases = []
    for c in cr.get("cases", []):
        ass = c.get("assertions") or []
        cases.append({"case": c["caseId"], "result": c.get("result"), "reason": c.get("reason"), "requestsUsed": c.get("requestsUsed"),
                      "plannedRequests": c.get("plannedRequests"), "requestAllowance": c.get("requestAllowance"),
                      "assertions": {"PASS": sum(1 for s in ass if s.get("result") == "PASS"), "FAIL": sum(1 for s in ass if s.get("result") == "FAIL"),
                                     "NOT RUN": sum(1 for s in ass if s.get("result") == "NOT RUN"), "total": len(ass)},
                      "outcomeClass": c.get("outcomeClass"), "receiptDigest": (c.get("executionReceipt") or {}).get("summarySha256")})
    def total(key):
        vals = [c.get(key) for c in cr.get("cases", []) if isinstance(c.get(key), int)]
        return sum(vals) if vals else None
    acts = count_actions(x.cases_dir) if x.cases_dir else None
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
        "artifactDigests": {"case-results.json": sha256_file(x.case_results)},
    }
    dump(out, x.out)
    print("run record written:", out["runId"], "cases", len(cases))


if __name__ == "__main__":
    main()
