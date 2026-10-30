#!/usr/bin/env python3
"""Runs every offline check of the package and writes offline-checks.json (consumed by gate G10). No network, no secrets.
Checks: package tests (including the integration proof on loopback when its prerequisites exist; the GitHub job requires them via CT_REQUIRE_INTEGRATION=1), report-builder tests, sealed receipts verified against their pinned hashes, the vendored harness verified against the approved hashes, the offline-proof index, config/workflow consistency.
Usage: run_offline_checks.py --out offline-checks.json   (run from the package root: tools/cloud-test)"""
import argparse
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _common import ROOT, load, dump, now_utc  # noqa: E402

# Owner decision 2026-10-30: a run may receive no retained history. With CT_HISTORY=none these checks, which can only
# judge the sealed receipts, index and proofs, are reported NOT APPLICABLE (never passed); every other check still gates.
# The assertion-catalog check cross-checks the harness contract against every compared run's sealed case results.
HISTORY_BOUND = ("history-index-verified", "assertion-catalog-matches-harness", "sealed-receipts-verified", "case-costs-reconcile-to-sealed-ledgers", "offline-proof-index")
NO_HISTORY_REASON = "NOT APPLICABLE: owner decision 2026-10-30, no retained history supplied (CT_HISTORY=none)"
# The harness corrections an offline proof must cover, exactly (Sam 1793379188); held equal to offline_proof.py's CORR by test.
PROOF_CORRECTIONS = ("diagnostic-codes", "duplicate-markers", "contradictory-observations", "request-latency", "failure-path-evidence",
                     "effective-speech-stimulus", "selected-case-execution", "run-identity-binding", "outcome-classes")


def proof_problem(proof, pinned):
    """None when the proof binds the pinned harness and passes every expected correction exactly once; else the reason."""
    if not isinstance(proof, dict) or proof.get("result") != "PASS":
        return "proof result is not PASS"
    if proof.get("codeManifestSha256") != pinned:
        return "hash DIFFERS from the pinned harness"
    rows = proof.get("corrections")
    if not isinstance(rows, list) or not all(isinstance(r, dict) and isinstance(r.get("id"), str) for r in rows):
        return "a correction row is anonymous or malformed"
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        return "duplicate correction ids: %s" % sorted({i for i in ids if ids.count(i) > 1})
    if set(ids) != set(PROOF_CORRECTIONS):
        return "correction ids differ: missing %s, unknown %s" % (sorted(set(PROOF_CORRECTIONS) - set(ids)), sorted(set(ids) - set(PROOF_CORRECTIONS)))
    for r in rows:
        tests, controls = r.get("tests"), r.get("mutationControls")
        if r.get("result") != "PASS" or not isinstance(tests, list) or not tests or not isinstance(controls, list):
            return "correction %s is not a complete PASS row" % r["id"]
        if not all(isinstance(t, dict) and t.get("result") == "PASS" for t in tests):
            return "correction %s has a test that did not pass" % r["id"]
        if not all(isinstance(m, dict) and m.get("caught") is True for m in controls):
            return "correction %s has a mutation control that was not caught" % r["id"]
    return None


def not_applicable(name):
    return {"id": name, "passed": None, "applicable": False, "detail": NO_HISTORY_REASON}


def command_check(name, cmd, env):
    """Keep actual child outcomes, including output needed to diagnose a failed run."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT, env=env)
        return {"id": name, "passed": r.returncode == 0, "returncode": r.returncode,
                "stdout": r.stdout, "stderr": r.stderr,
                "detail": " ".join((r.stdout + r.stderr).split())[:160]}
    except OSError as error:
        return {"id": name, "passed": False, "returncode": None,
                "stdout": "", "stderr": "", "detail": "%s: %s" % (type(error).__name__, error)}


def input_check(name, evaluate):
    try:
        passed, detail = evaluate()
        return {"id": name, "passed": bool(passed), "detail": detail}
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        return {"id": name, "passed": False, "detail": "%s: %s" % (type(error).__name__, error)}


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--out", required=True)
    x = a.parse_args()
    history = os.environ.get("CT_HISTORY", "required")
    if history not in ("required", "none"):
        print("OFFLINE_CHECKS_REFUSED: CT_HISTORY must be 'required' or 'none', not %r" % history, file=sys.stderr)
        return 2
    bound = (lambda name, make: not_applicable(name) if history == "none" and name in HISTORY_BOUND else make())
    checks = []
    env = {**os.environ}
    for name, cmd in (("package-unit-tests", [sys.executable, "-I", "-W", "ignore::ResourceWarning", "-m", "unittest", "discover", "-s", os.path.join(ROOT, "tests"), "-p", "test_*.py"]),
                      ("report-builder-tests", [sys.executable, "-I", "-W", "ignore::ResourceWarning", "-m", "unittest", "discover", "-s", os.path.join(ROOT, "report", "tests"), "-p", "test_*.py"])):
        checks.append(command_check(name, cmd, env))
    for name, script, extra in (("history-index-verified", "history_index.py", ["verify"]), ("reservation-ledger-verified", "reservations.py", ["verify"]), ("catalog-history-additive", "verify_catalog_history.py", [])):
        checks.append(bound(name, lambda: command_check(name, [sys.executable, "-I", os.path.join(HERE, script)] + extra, env)))
    checks.append(bound("assertion-catalog-matches-harness", lambda: command_check("assertion-catalog-matches-harness", [sys.executable, "-I", os.path.join(HERE, "derive_assertion_catalog.py"), "--out", os.path.join(ROOT, "config", "assertion-catalog.json"), "--check"], env)))
    for name, script in (("sealed-receipts-verified", "verify_receipts.py"), ("harness-verified", "verify_harness.py")):
        checks.append(bound(name, lambda: command_check(name, [sys.executable, "-I", os.path.join(HERE, script), "--config", os.path.join(ROOT, "config", "test-config.v1.json")], env)))
    checks.append(bound("case-costs-reconcile-to-sealed-ledgers", lambda: command_check("case-costs-reconcile-to-sealed-ledgers", [sys.executable, "-I", os.path.join(HERE, "derive_case_costs.py"), "--receipts-root", os.path.join(ROOT, "config", "history", "receipts"), "--run", "R4C", "--run", "R5", "--out", os.path.join(os.environ.get("RUNNER_TEMP") or "/tmp", "case-costs-check.json")], env)))

    cfg, wf = {}, {}

    def versions():
        nonlocal cfg, wf
        cfg = load(os.path.join(ROOT, "config", "test-config.v1.json"))
        wf = load(os.path.join(ROOT, "workflow.json"))
        return cfg["workflowVersion"] == wf["version"], "config %s workflow %s" % (cfg["workflowVersion"], wf["version"])

    def proof_index():
        # The proof is selected by the harness the config pins (Sam 1793378783), never by a fixed or historical filename,
        # and must bind that exact manifest; an older proof is never substituted or relabelled.
        pinned = cfg["harness"]["expectedCodeManifestSha256"]
        if not isinstance(pinned, str) or not re.fullmatch(r"[0-9a-f]{64}", pinned):
            return False, "the pinned harness manifest is not a sha256"
        name = "offline-proof-%s.json" % pinned[:8]
        problem = proof_problem(load(os.path.join(ROOT, "config", "proofs", name)), pinned)
        return problem is None, "%s: %s" % (name, problem or "all %d corrections PASS; hash matches config" % len(PROOF_CORRECTIONS))

    checks.append(input_check("config-matches-workflow", versions))
    checks.append(bound("offline-proof-index", lambda: input_check("offline-proof-index", proof_index)))
    applicable = [c for c in checks if c.get("applicable", True)]
    out = {"schema": "speaksharp.cloud-test.offline-checks.v1", "ranUtc": now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"), "workflowVersion": wf.get("version") if isinstance(wf, dict) else None,
           "historyMode": history, "notApplicable": [c["id"] for c in checks if not c.get("applicable", True)],
           "checks": checks, "passed": bool(applicable) and all(c["passed"] is True for c in applicable)}
    # The job log of this public repository shows only check names and statuses; child output and details stay in the
    # written report on the runner. A report that cannot be written is a failure, and its diagnostics are not printed.
    written = True
    try:
        dump(out, x.out)
    except (OSError, TypeError, ValueError) as error:
        out["passed"], written = False, False
        print("OFFLINE_CHECKS_REPORT_WRITE_FAILED: " + type(error).__name__, file=sys.stderr)
    for c in checks:
        print(("N/A  " if not c.get("applicable", True) else "PASS " if c["passed"] is True else "FAIL ") + c["id"])
    return 0 if written and out["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
