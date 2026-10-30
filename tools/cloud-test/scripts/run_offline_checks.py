#!/usr/bin/env python3
"""Runs every offline check of the package and writes offline-checks.json (consumed by gate G10). No network, no secrets.
Checks: package tests (including the integration proof on loopback when its prerequisites exist; the GitHub job requires them via CT_REQUIRE_INTEGRATION=1), report-builder tests, sealed receipts verified against their pinned hashes, the vendored harness verified against the approved hashes, the offline-proof index, config/workflow consistency.
Usage: run_offline_checks.py --out offline-checks.json   (run from the package root: tools/cloud-test)"""
import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _common import ROOT, load, dump, now_utc  # noqa: E402


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--out", required=True)
    x = a.parse_args()
    checks = []
    env = {**os.environ}
    for name, cmd in (("package-unit-tests", [sys.executable, "-I", "-W", "ignore::ResourceWarning", "-m", "unittest", "discover", "-s", os.path.join(ROOT, "tests"), "-p", "test_*.py"]),
                      ("report-builder-tests", [sys.executable, "-I", "-W", "ignore::ResourceWarning", "-m", "unittest", "discover", "-s", os.path.join(ROOT, "report", "tests"), "-p", "test_*.py"])):
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT, env=env)
        tail = " ".join((r.stderr.strip().splitlines() or [""])[-3:])[:160]
        checks.append({"id": name, "passed": r.returncode == 0, "detail": tail})
    for name, script, extra in (("history-index-verified", "history_index.py", ["verify"]), ("reservation-ledger-verified", "reservations.py", ["verify"]), ("catalog-history-additive", "verify_catalog_history.py", [])):
        r = subprocess.run([sys.executable, "-I", os.path.join(HERE, script)] + extra, capture_output=True, text=True)
        checks.append({"id": name, "passed": r.returncode == 0, "detail": " ".join((r.stdout + r.stderr).split())[:140]})
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "derive_assertion_catalog.py"), "--out", os.path.join(ROOT, "config", "assertion-catalog.json"), "--check"], capture_output=True, text=True)
    checks.append({"id": "assertion-catalog-matches-harness", "passed": r.returncode == 0, "detail": " ".join((r.stdout + r.stderr).split())[:140]})
    cfg, wf = load(os.path.join(ROOT, "config", "test-config.v1.json")), load(os.path.join(ROOT, "workflow.json"))
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "verify_receipts.py"), "--config", os.path.join(ROOT, "config", "test-config.v1.json")], capture_output=True, text=True)
    checks.append({"id": "sealed-receipts-verified", "passed": r.returncode == 0, "detail": " ".join(r.stdout.split())[:120]})
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "verify_harness.py"), "--config", os.path.join(ROOT, "config", "test-config.v1.json")], capture_output=True, text=True)
    checks.append({"id": "harness-verified", "passed": r.returncode == 0, "detail": (r.stdout + r.stderr).strip()[:140]})
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "derive_case_costs.py"), "--receipts-root", os.path.join(ROOT, "config", "history", "receipts"), "--run", "R4C", "--run", "R5",
                        "--out", os.path.join(os.environ.get("RUNNER_TEMP") or "/tmp", "case-costs-check.json")], capture_output=True, text=True)
    checks.append({"id": "case-costs-reconcile-to-sealed-ledgers", "passed": r.returncode == 0, "detail": " ".join(r.stdout.split())[:140]})
    checks.append({"id": "config-matches-workflow", "passed": cfg["workflowVersion"] == wf["version"], "detail": "config %s workflow %s" % (cfg["workflowVersion"], wf["version"])})
    proof = load(os.path.join(ROOT, "config", "proofs", "offline-proof-7dae348f.json"))
    ok = proof.get("result") == "PASS" and all(c.get("result") == "PASS" for c in proof.get("corrections", [])) and proof.get("codeManifestSha256") == cfg["harness"]["expectedCodeManifestSha256"]
    checks.append({"id": "offline-proof-index", "passed": ok, "detail": "%d corrections; hash %s" % (len(proof.get("corrections", [])), "matches config" if proof.get("codeManifestSha256") == cfg["harness"]["expectedCodeManifestSha256"] else "DIFFERS")})
    out = {"schema": "speaksharp.cloud-test.offline-checks.v1", "ranUtc": now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"), "workflowVersion": wf["version"], "checks": checks, "passed": all(c["passed"] for c in checks)}
    dump(out, x.out)
    for c in checks:
        print(("PASS " if c["passed"] else "FAIL ") + c["id"], "-", c["detail"])
    sys.exit(0 if out["passed"] else 1)


if __name__ == "__main__":
    main()
