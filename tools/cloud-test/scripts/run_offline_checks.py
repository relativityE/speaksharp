#!/usr/bin/env python3
"""Runs every offline check of the package and writes offline-checks.json (consumed by gate G10). No network, no secrets.
Checks (current run only, never N/A): package tests (including the integration proof on loopback when its prerequisites exist; the GitHub job requires
them via CT_REQUIRE_INTEGRATION=1), report-builder tests, the reservation ledger, the additive catalog history, the vendored harness verified against the
approved hashes, the assertion catalog derived from the harness contract, config/workflow consistency and the offline proof generated in this job.
Usage: run_offline_checks.py --out offline-checks.json   (run from the package root: tools/cloud-test)"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _common import ROOT, load, dump, now_utc  # noqa: E402

# Current-run checks only (PO 2026-10-30, Sam 1793400946): this suite needs no retained campaign history and none of its checks is ever
# N/A. The audits of the retained campaigns (history index, sealed receipts, case costs, catalog rows of the compared runs) run only in
# scripts/run_legacy_audit.py, which never earns current-execution credit.
CHECKS = ("package-unit-tests", "report-builder-tests", "reservation-ledger-verified", "catalog-history-additive", "harness-verified",
          "assertion-catalog-matches-harness", "config-matches-workflow", "offline-proof-index")
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


def catalog_history_additive():
    """The catalog snapshots only ever add rows and the current catalog is the configured version's snapshot. Run in-process with NO index:
    verify_catalog_history.py's command line loads the retained campaign index whenever one exists, and that index belongs to the legacy audit."""
    import verify_catalog_history as VC
    cfg = load(os.path.join(ROOT, "config", "test-config.v1.json"))
    errs = VC.verify(VC.load_snapshots(os.path.join(ROOT, "config", "history", "catalogs")), load(os.path.join(ROOT, "config", "assertion-catalog.json")),
                     cfg["modes"]["full"]["assertionCatalog"]["version"], None)
    return not errs, "; ".join(errs) or "catalog history additive only (snapshots and current version; no campaign index read)"


def job_identity(env):
    """This GitHub job's run identity, which the in-job proof generator stamps and the consumer requires; None outside a GitHub job."""
    ident = {k: env.get(v) for k, v in (("sha", "GITHUB_SHA"), ("runId", "GITHUB_RUN_ID"), ("runAttempt", "GITHUB_RUN_ATTEMPT"), ("job", "GITHUB_JOB"))}
    return ident if all(ident.values()) else None


def catalog_matches_harness():
    """The tracked assertion catalog equals the one derived from the hash-verified harness contract alone (no compared runs)."""
    import derive_assertion_catalog as CAT
    with tempfile.TemporaryDirectory(prefix="ct-catalog-") as d:
        os.makedirs(os.path.join(d, "harness", "draft-adapters"))
        os.makedirs(os.path.join(d, "config"))
        shutil.copyfile(os.path.join(ROOT, "harness", "draft-adapters", "contracts.json"), os.path.join(d, "harness", "draft-adapters", "contracts.json"))
        dump({"history": {"comparisonBaselines": []}}, os.path.join(d, "config", "test-config.v1.json"))
        out, errs = CAT.derive(d)
    if errs:
        return False, "; ".join(errs)
    with open(os.path.join(ROOT, "config", "assertion-catalog.json"), encoding="utf-8") as f:
        same = f.read() == json.dumps(out, indent=1) + "\n"
    return same, "%d assertions from the harness contract%s" % (out["totalAssertions"], "" if same else "; the tracked catalog differs")


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--out", required=True)
    x = a.parse_args()
    if os.environ.get("CT_HISTORY"):
        print("OFFLINE_CHECKS_REFUSED: CT_HISTORY is retired for the current suite, which needs no retained history; the retained campaigns are "
              "audited by scripts/run_legacy_audit.py", file=sys.stderr)
        return 2
    # The offline proof must be generated in THIS job (CT_PROOF_FILE); a retained proof file is never substituted.
    proof_file = os.environ.get("CT_PROOF_FILE") or None
    checks = []
    env = {**os.environ}
    for name, cmd in (("package-unit-tests", [sys.executable, "-I", "-W", "ignore::ResourceWarning", "-m", "unittest", "discover", "-s", os.path.join(ROOT, "tests"), "-p", "test_*.py"]),
                      ("report-builder-tests", [sys.executable, "-I", "-W", "ignore::ResourceWarning", "-m", "unittest", "discover", "-s", os.path.join(ROOT, "report", "tests"), "-p", "test_*.py"])):
        checks.append(command_check(name, cmd, env))
    checks.append(command_check("reservation-ledger-verified", [sys.executable, "-I", os.path.join(HERE, "reservations.py"), "verify"], env))
    checks.append(input_check("catalog-history-additive", catalog_history_additive))
    checks.append(command_check("harness-verified", [sys.executable, "-I", os.path.join(HERE, "verify_harness.py"), "--config", os.path.join(ROOT, "config", "test-config.v1.json")], env))
    checks.append(input_check("assertion-catalog-matches-harness", catalog_matches_harness))

    cfg, wf = {}, {}

    def versions():
        nonlocal cfg, wf
        cfg = load(os.path.join(ROOT, "config", "test-config.v1.json"))
        wf = load(os.path.join(ROOT, "workflow.json"))
        return cfg["workflowVersion"] == wf["version"], "config %s workflow %s" % (cfg["workflowVersion"], wf["version"])

    def proof_index():
        # The proof must bind the harness the config pins (Sam 1793378783) and come from this job; an older proof is never substituted.
        pinned = cfg["harness"]["expectedCodeManifestSha256"]
        if not isinstance(pinned, str) or not re.fullmatch(r"[0-9a-f]{64}", pinned):
            return False, "the pinned harness manifest is not a sha256"
        if not proof_file:
            return False, "no offline proof was generated in this job (CT_PROOF_FILE is not set)"
        proof = load(proof_file)
        problem = proof_problem(proof, pinned)
        if problem:
            return False, "in-job proof: " + problem
        # Generator-to-consumer binding (Sam 1793405092): the proof must carry THIS job's run identity, stamped by generate_offline_proof.py.
        here = job_identity(os.environ)
        if here is None:
            return False, "not in a GitHub job, so the proof cannot be bound to this job"
        if proof.get("generatedIn") != dict(here, codeManifestSha256=pinned):
            return False, "the proof is not bound to this job (generatedIn differs from this run's identity and pinned harness)"
        return True, "in-job proof: all %d corrections PASS; bound to this job; hash matches config" % len(PROOF_CORRECTIONS)

    checks.append(input_check("config-matches-workflow", versions))
    checks.append(input_check("offline-proof-index", proof_index))
    out = {"schema": "speaksharp.cloud-test.offline-checks.v2", "ranUtc": now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"), "workflowVersion": wf.get("version") if isinstance(wf, dict) else None,
           "proofSource": "in-job" if next(c for c in checks if c["id"] == "offline-proof-index")["passed"] is True else None,
           "checks": checks, "passed": all(c["passed"] is True for c in checks)}
    # The job log of this public repository shows only check names and statuses; child output and details stay in the
    # written report on the runner. A report that cannot be written is a failure, and its diagnostics are not printed.
    written = True
    try:
        dump(out, x.out)
    except (OSError, TypeError, ValueError) as error:
        out["passed"], written = False, False
        print("OFFLINE_CHECKS_REPORT_WRITE_FAILED: " + type(error).__name__, file=sys.stderr)
    for c in checks:
        print(("PASS " if c["passed"] is True else "FAIL ") + c["id"])
    return 0 if written and out["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
