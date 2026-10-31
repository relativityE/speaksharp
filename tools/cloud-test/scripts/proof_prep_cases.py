#!/usr/bin/env python3
"""Builds the 15 PLACEHOLDER case configs the ported offline-proof tests read as templates (fake-run.cjs `cases/AHT-NN.json`).
They come from the package's own plan builder (harness-adapter/build_plan.py phase 1) over the tracked synthetic full request and
tests/fixtures/plan-facts.PLACEHOLDER.json, with a dummy account id and a dummy publishable key: NOT A RUN, no real identity or key,
no network. The packet under test is the vendored harness unless --packet names another copy.
Usage: proof_prep_cases.py --out NEW_DIR [--packet HARNESS_DIR]   (prints NEW_DIR/cases on success)"""
import argparse
import json
import os
import shlex
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(ROOT, "..", ".."))
DUMMY_ACCOUNT = "00000000-0000-4000-8000-000000000001"


def placeholder_request(packet):
    with open(os.path.join(ROOT, "tests", "fixtures", "full-request.json"), encoding="utf-8") as f:
        req = json.load(f)
    with open(os.path.join(packet, "draft-adapters", "SOURCE.sha256.json"), encoding="utf-8") as f:
        req["release"]["testedSha"] = json.load(f)["sourceSha"]
    req["approvedLimits"] = {"cumulativeCeilingRequests": 10535, "identityCap": 126, "startsCap": 85, "takesCap": 55,
                             "runCapRequests": req["estimate"]["requests"]["runCap"], "approvalRef": "PLACEHOLDER-NOT-A-RUN", "approvedBy": "PLACEHOLDER"}
    req["window"] = {"startUtc": "2026-01-01T00:00:00Z", "endUtc": "2099-01-01T00:00:00Z", "approvalRef": "PLACEHOLDER-NOT-A-RUN"}
    req["selectionApprovalRef"] = "PLACEHOLDER-NOT-A-RUN-selection"
    return req


def pinned_pdfjs():
    """The existing pin-verified pdfjs-dist (AHT-01 needs it): CT_EXISTING_PDFJS_DIR or the runner's lockfile install. Never installs."""
    sys.path.insert(0, HERE)
    import install_pdfjs
    with open(os.path.join(ROOT, "config", "test-config.v1.json"), encoding="utf-8") as f:
        pin = json.load(f)["tools"]["pdfjs"]
    source = os.environ.get("CT_EXISTING_PDFJS_DIR") or os.path.join(ROOT, "runner", "node_modules", "pdfjs-dist")
    if not os.path.isdir(source):
        raise SystemExit("BLOCKED_SETUP: no existing pinned pdfjs-dist at %s (CI installs it from the runner lockfile)" % source)
    errors = install_pdfjs.verify_dir(source, pin)
    if errors:
        raise SystemExit("BLOCKED_SETUP: pdfjs-dist does not match its pin: " + "; ".join(errors))
    return source


def build(out, packet, phases=("phase1",), stimulus_receipt=None, browser_identity=None):
    """phase1 writes the 15 case configs; phase2 additionally requires the exact
    browser identity receipt used by the proof producer and binds it into the plan."""
    if os.path.exists(out):
        raise SystemExit("--out must not exist")
    pdfjs = pinned_pdfjs()
    work = tempfile.mkdtemp(prefix="ct-proof-prep-")
    reqp, acct, envf = (os.path.join(work, n) for n in ("req.json", "acct.txt", "env.txt"))
    with open(reqp, "w", encoding="utf-8") as f:
        json.dump(placeholder_request(packet), f)
    with open(acct, "w", encoding="utf-8") as f:
        f.write(DUMMY_ACCOUNT + "\n")
    os.chmod(acct, 0o600)
    base = {"PATH": os.environ["PATH"], "HOME": work}
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "run_env.py"), "--request", reqp, "--out", envf], capture_output=True, text=True, cwd=ROOT, env=base)
    if r.returncode:
        raise SystemExit("run_env.py failed (%d)" % r.returncode)
    if "phase2" in phases and not browser_identity:
        raise SystemExit("BLOCKED_SETUP: phase2 requires this proof run's browser identity receipt")
    env = dict(base, BP_PACKET=packet, BP_CHECKOUT=REPO, BP_PRIVATE=out, BP_FACTS=os.path.join(ROOT, "tests", "fixtures", "plan-facts.PLACEHOLDER.json"),
               BP_ACCOUNT_ID_FILE=acct, BP_LEASE_RPCS="1", BP_LEASE_READ="1", BP_TASK_ID="PLACEHOLDER-task", BP_SOURCE_REFERENCE="https://claude.ai/code/PLACEHOLDER",
               BP_ENV_ID="env_PLACEHOLDER", BP_MEDIA_PARENT=os.path.join(work, "media"), VITE_SUPABASE_ANON_KEY="placeholder-publishable-key", BP_PDFJS_DIR=pdfjs)
    if browser_identity:
        env["BP_BROWSER_IDENTITY"] = os.path.abspath(browser_identity)
    for phase in phases:
        # BP_STIM is exported AFTER the request-derived environment is sourced, as FullPlanProof does, so the request's values cannot override it.
        stim = "export BP_STIM=%s; " % shlex.quote(stimulus_receipt) if stimulus_receipt else ""
        script = "set -euo pipefail; set -a; . %s; set +a; %spython3 -I %s %s" % (shlex.quote(envf), stim, shlex.quote(os.path.join(ROOT, "harness-adapter", "build_plan.py")), phase)
        r = subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env)
        if r.returncode:
            raise SystemExit("build_plan.py %s failed (%d)" % (phase, r.returncode))
    cases = os.path.join(out, "cases")
    missing = [n for n in range(1, 16) if not os.path.isfile(os.path.join(cases, "AHT-%02d.json" % n))]
    if missing:
        raise SystemExit("placeholder case configs missing: %s" % missing)
    return cases


def main():
    sys.path.insert(0, HERE)
    import _netguard  # noqa: F401  (offline control plane; executable path only)
    a = argparse.ArgumentParser()
    a.add_argument("--out", required=True)
    a.add_argument("--packet", default=os.path.join(ROOT, "harness"))
    x = a.parse_args()
    print(build(os.path.abspath(x.out), os.path.abspath(x.packet)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
