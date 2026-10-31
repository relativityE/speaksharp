#!/usr/bin/env python3
"""HISTORICAL AUDIT of the retained Cloud Test campaigns. Not fresh execution, and never current-run credit (PO 2026-10-30, Sam 1793400946).
Verifies the retained evidence itself: the history index chain, the sealed receipt sets against their pinned hashes, the case costs against the
sealed ledgers, the assertion catalog against the sealed rows of the compared runs, and the historical-audit test suite (tests/legacy_audit).
It needs the retained private history under tools/cloud-test/config/history; when that is absent nothing is executed and the audit reports
NOT EXECUTED (exit 3), never a pass. It runs where the owner keeps that history, never in the public workflow. The log carries names and
statuses only; child output stays in the written report.
Usage: run_legacy_audit.py --out legacy-audit.json   (run from the package root: tools/cloud-test)"""
import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _common import ROOT, dump, now_utc  # noqa: E402

HISTORY = os.path.join(ROOT, "config", "history")
# The historical-audit suite holds exactly this many test methods (moved unchanged from 96af08e7, one tamper copy made writable); a discovery
# that runs fewer, skips any, or finds none is never a PASS (Sam 1793405092).
AUDIT_TESTS = 49
AUDITS = ("history-index-verified", "sealed-receipts-verified", "case-costs-reconcile-to-sealed-ledgers", "assertion-catalog-matches-sealed-runs",
          "indexed-runs-name-a-catalog-snapshot", "legacy-audit-tests")


def present():
    """The retained history the audit reads: the receipt sets, the index and the owner counters."""
    return all(os.path.exists(os.path.join(HISTORY, p)) for p in ("receipts", "index.json", "owner-counters.json"))


def analyst_inputs_missing():
    """The analyst inputs the config pins for compared pairs (config/history/analysis); without them the audit is INCOMPLETE, never PASS."""
    import json
    with open(os.path.join(ROOT, "config", "test-config.v1.json"), encoding="utf-8") as f:
        pairs = json.load(f)["history"].get("analysis", {})
    return sorted(p[k] for p in pairs.values() for k in ("facts", "overlay") if p.get(k) and not os.path.isfile(os.path.join(ROOT, p[k])))


def audit_suite_judgement(check):
    """PASS only when the suite ran exactly AUDIT_TESTS tests with one complete, clean unittest result (the current gate's strict parser)."""
    import summarize_offline_checks as S
    suite = S._suite(check)
    if not suite:
        return False, "no single complete unittest result"
    if suite["ran"] != AUDIT_TESTS:
        return False, "ran %d of the %d historical-audit tests" % (suite["ran"], AUDIT_TESTS)
    unclean = [k for k in sorted(S.COUNT_KEYS) if suite[k]]
    return not unclean, "unclean: " + ", ".join(unclean) if unclean else "%d tests, none skipped" % AUDIT_TESTS


def run(name, cmd, env):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT, env=env)
        return {"id": name, "passed": r.returncode == 0, "returncode": r.returncode, "stdout": r.stdout, "stderr": r.stderr}
    except OSError as error:
        return {"id": name, "passed": False, "returncode": None, "stdout": "", "stderr": "%s: %s" % (type(error).__name__, error)}


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--out", required=True)
    x = a.parse_args()
    out = {"schema": "speaksharp.cloud-test.legacy-audit.v1", "provenance": "historical", "header": "HISTORICAL AUDIT. Not fresh execution.",
           "ranUtc": now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"), "currentExecutionCredit": False}
    if not present():
        out.update(executed=False, checks=[{"id": i, "passed": None, "executed": False} for i in AUDITS], passed=False,
                   status="NOT EXECUTED: the retained history is not present under config/history")
        dump(out, x.out)
        print(out["header"])
        print(out["status"])
        return 3
    # The historical-audit tests judge the retained history; CT_HISTORY=required makes a missing input a failure, never a skip.
    env = {**os.environ, "CT_HISTORY": "required"}
    cfg = os.path.join(ROOT, "config", "test-config.v1.json")
    checks = [
        run("history-index-verified", [sys.executable, "-I", os.path.join(HERE, "history_index.py"), "verify"], env),
        run("sealed-receipts-verified", [sys.executable, "-I", os.path.join(HERE, "verify_receipts.py"), "--config", cfg], env),
        run("case-costs-reconcile-to-sealed-ledgers", [sys.executable, "-I", os.path.join(HERE, "derive_case_costs.py"), "--receipts-root", os.path.join(HISTORY, "receipts"),
                                                       "--run", "R4C", "--run", "R5", "--out", os.path.join(os.environ.get("RUNNER_TEMP") or "/tmp", "legacy-case-costs.json")], env),
        run("assertion-catalog-matches-sealed-runs", [sys.executable, "-I", os.path.join(HERE, "derive_assertion_catalog.py"), "--out",
                                                      os.path.join(ROOT, "config", "assertion-catalog.json"), "--check"], env),
        run("indexed-runs-name-a-catalog-snapshot", [sys.executable, "-I", os.path.join(HERE, "verify_catalog_history.py"), "--index",
                                                     os.path.join(HISTORY, "index.json")], env),
        run("legacy-audit-tests", [sys.executable, "-I", "-W", "ignore::ResourceWarning", "-m", "unittest", "discover", "-s", os.path.join(ROOT, "tests", "legacy_audit"),
                                   "-p", "audit_*.py"], env),
    ]
    suite = checks[-1]
    suite["passed"], suite["judgement"] = audit_suite_judgement(suite) if suite["passed"] else (False, "the suite failed")
    missing = analyst_inputs_missing()
    out.update(executed=True, checks=checks, analystInputsMissing=missing, passed=all(c["passed"] for c in checks) and not missing,
               status="INCOMPLETE: analyst inputs missing" if missing else ("PASS" if all(c["passed"] for c in checks) else "FAIL"))
    try:
        dump(out, x.out)
    except (OSError, TypeError, ValueError) as error:
        print("LEGACY_AUDIT_REPORT_WRITE_FAILED: " + type(error).__name__, file=sys.stderr)
        return 1
    print(out["header"])
    for c in checks:
        print(("PASS " if c["passed"] else "FAIL ") + c["id"])
    print("historical audit: " + out["status"])
    return 0 if out["passed"] else (3 if missing else 1)


if __name__ == "__main__":
    sys.exit(main())
