#!/usr/bin/env python3
"""Generates the offline proof for the vendored harness IN THIS JOB (proof v2): same-job provenance for every TAP and control file.
1. placeholder plan (build_plan.py phase 1+2, dummy account id and key, NOT A RUN), stimulus receipt on the pinned Chrome, plan rebuilt bound to it;
2. the packet's own tests and the ported proof tests (serially), as TAP;
3. the eleven original mutation controls plus the additional A- controls (harness_mutation_controls.py);
4. the 3 positive / 11 negative plan controls on the real runner;
5. offline_proof.py (fail-closed) over all of it, bound to the pinned code manifest.
Only statuses and counts are printed; TAP, plans and the proof stay in --work on the runner. No network beyond loopback, no credentials.
Usage: generate_offline_proof.py --work NEW_DIR --proof-out FILE [--chrome PINNED_CHROME] [--playwright-cwd DIR]"""
import argparse
import glob
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HARNESS = os.path.join(ROOT, "harness")


def config():
    with open(os.path.join(ROOT, "config", "test-config.v1.json"), encoding="utf-8") as f:
        return json.load(f)


def pinned_chrome(path, cfg):
    with open(path, "rb") as f:
        if hashlib.sha256(f.read()).hexdigest() != cfg["tools"]["browser"]["chromeBinarySha256"]:
            raise SystemExit("BLOCKED_SETUP: the browser is not the pinned, hash-verified Chrome for Testing")
    return path


def node_tap(args, cwd, env, out):
    r = subprocess.run(["node", "--test", "--test-reporter=tap", *args], capture_output=True, text=True, cwd=cwd, env=env)
    with open(out, "w", encoding="utf-8") as f:
        f.write(r.stdout)
    return r.returncode


def main():
    sys.path.insert(0, HERE)
    import _netguard  # noqa: F401  (offline control plane; executable path only)
    import harness_mutation_controls as M
    import proof_prep_cases as prep
    a = argparse.ArgumentParser()
    a.add_argument("--work", required=True)
    a.add_argument("--proof-out", required=True)
    a.add_argument("--chrome", default=os.environ.get("CT_CHROME"))
    a.add_argument("--playwright-cwd", default=os.path.join(ROOT, "runner"))
    x = a.parse_args()
    cfg = config()
    if not x.chrome:
        raise SystemExit("BLOCKED_SETUP: --chrome or CT_CHROME (the pinned chromium-1200 binary) is required")
    chrome, pw = pinned_chrome(x.chrome, cfg), os.path.abspath(x.playwright_cwd)
    work = os.path.abspath(x.work)
    os.makedirs(work)
    base = {"PATH": os.environ["PATH"], "HOME": work}

    plan0 = os.path.join(work, "plan0")
    prep.build(plan0, HARNESS, phases=("phase1", "phase2"))
    receipt = os.path.join(work, "stimulus-receipt.json")
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "stimulus_preflight_retry.py"), "--harness", HARNESS, "--plan", os.path.join(plan0, "cfg", "campaign-plan.json"),
                        "--chrome", chrome, "--cwd", pw, "--out", receipt], capture_output=True, text=True, cwd=ROOT, env=base)
    if r.returncode:
        raise SystemExit("BLOCKED_SETUP: stimulus preflight on the pinned Chrome failed (%d)" % r.returncode)
    plan = os.path.join(work, "plan")
    prep.build(plan, HARNESS, phases=("phase1", "phase2"), stimulus_receipt=receipt)

    packet_tap, extra_tap = os.path.join(work, "packet.tap"), os.path.join(work, "extra.tap")
    packet_tests = sorted(glob.glob(os.path.join(HARNESS, "draft-adapters", "tests", "*.test.cjs")) + glob.glob(os.path.join(HARNESS, "bundle", "selftest", "*.test.cjs"))
                          + glob.glob(os.path.join(HARNESS, "bundle", "qualification", "*.test.cjs")))
    rc_packet = node_tap(packet_tests, HARNESS, base, packet_tap)
    proof_env = dict(base, CT_PROOF_CASES_DIR=plan, CT_CHROME=chrome, NODE_PATH=os.path.join(pw, "node_modules"))
    rc_extra = node_tap(["--test-concurrency=1", *sorted(glob.glob(os.path.join(ROOT, "tests", "node", "proof", "*.test.cjs")))], ROOT, proof_env, extra_tap)

    mutations, refusals = M.evaluate_packet(plan)
    more, more_refusals = M.evaluate_additional()
    mutations.update(more)
    neg = os.path.join(work, "neg-controls.json")
    with open(neg, "w", encoding="utf-8") as f:
        json.dump(mutations, f, indent=1)

    r = subprocess.run(["node", os.path.join(ROOT, "tests", "node", "proof", "plan-controls.cjs"), os.path.join(plan, "cfg", "campaign-plan.json")],
                       capture_output=True, text=True, cwd=ROOT, env=base)
    try:
        plan_controls = json.loads(r.stdout)
    except ValueError:
        plan_controls = {}
    pc = os.path.join(work, "plan-controls.json")
    with open(pc, "w", encoding="utf-8") as f:
        json.dump(plan_controls, f, indent=1)

    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "offline_proof.py"), "--tap", packet_tap, "--tap", extra_tap, "--mutations", neg, "--plan-controls", pc,
                        "--code-manifest-sha256", cfg["harness"]["expectedCodeManifestSha256"], "--out", os.path.abspath(x.proof_out)], capture_output=True, text=True, cwd=ROOT, env=base)
    if not os.path.isfile(x.proof_out):
        raise SystemExit("BLOCKED_SETUP: offline_proof.py wrote no proof (%d)" % r.returncode)
    with open(x.proof_out, encoding="utf-8") as f:
        proof = json.load(f)
    print("packet tests exit %d; proof tests exit %d" % (rc_packet, rc_extra))
    print("mutation controls: %d caught of %d; %d refused" % (sum(v["fail"] > 0 for v in mutations.values()), len(mutations), len(refusals) + len(more_refusals)))
    print("plan controls: %s" % {k: v for k, v in proof["planControls"].items() if k != "mismatched"})
    print("corrections: %s" % ", ".join("%s %s" % (c["id"], c["result"]) for c in proof["corrections"]))
    print("proof %s; refusals: %s" % (proof["result"], "; ".join(proof["refusals"]) or "none"))
    # A produced proof, PASS or FAIL, is judged by the offline-proof-index check; only a setup block (raised above) stops here.
    return 0


if __name__ == "__main__":
    sys.exit(main())
