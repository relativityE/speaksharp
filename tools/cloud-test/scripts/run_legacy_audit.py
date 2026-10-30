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
AUDITS = ("history-index-verified", "sealed-receipts-verified", "case-costs-reconcile-to-sealed-ledgers", "assertion-catalog-matches-sealed-runs",
          "legacy-audit-tests")


def present():
    """The retained history the audit reads: the receipt sets, the index and the owner counters."""
    return all(os.path.exists(os.path.join(HISTORY, p)) for p in ("receipts", "index.json", "owner-counters.json"))


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
        run("legacy-audit-tests", [sys.executable, "-I", "-W", "ignore::ResourceWarning", "-m", "unittest", "discover", "-s", os.path.join(ROOT, "tests", "legacy_audit"),
                                   "-p", "audit_*.py"], env),
    ]
    out.update(executed=True, checks=checks, passed=all(c["passed"] for c in checks))
    try:
        dump(out, x.out)
    except (OSError, TypeError, ValueError) as error:
        print("LEGACY_AUDIT_REPORT_WRITE_FAILED: " + type(error).__name__, file=sys.stderr)
        return 1
    print(out["header"])
    for c in checks:
        print(("PASS " if c["passed"] else "FAIL ") + c["id"])
    return 0 if out["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
