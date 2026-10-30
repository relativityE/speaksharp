#!/usr/bin/env python3
"""Runs the harness's stimulus preflight (zero product traffic) with a bounded, fully recorded retry. The harness's audio-alignment measurement can come back
`indeterminate` under machine load (observed once in four runs for AHT-02 with an otherwise identical plan). The preflight touches no product host, so a re-run
costs nothing but time; it is NOT a way to hide a real failure: every attempt is recorded in <out>.attempts.json with its failing cases and reasons, at most
three attempts are made, a case that is not READY in the last attempt fails the stage, and the receipt written is the unchanged output of the last attempt.
Usage: stimulus_preflight_retry.py --harness DIR --plan plan.json --chrome PATH --out receipt.json [--cwd runner] [--attempts 3]
Exit 0 only when the final receipt is ready; 78 otherwise."""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile


def attempt(harness, plan, chrome, cwd, out):
    r = subprocess.run(["node", os.path.join(harness, "draft-adapters", "stimulus-preflight.cjs"), "--plan", plan, "--chrome", chrome, "--out", out], capture_output=True, text=True, cwd=cwd)
    rec = None
    if os.path.isfile(out):
        try:
            rec = json.load(open(out, encoding="utf-8"))
        except ValueError:
            rec = None
    return r, rec


def main():
    a = argparse.ArgumentParser()
    for k in ("harness", "plan", "chrome", "out"):
        a.add_argument("--" + k, required=True)
    a.add_argument("--cwd", default=None)
    a.add_argument("--attempts", type=int, default=3)
    x = a.parse_args()
    n = min(max(1, x.attempts), 3)
    log, final = [], None
    with tempfile.TemporaryDirectory() as d:
        for i in range(1, n + 1):
            out = os.path.join(d, "attempt-%d.json" % i)
            r, rec = attempt(x.harness, x.plan, x.chrome, x.cwd, out)
            bad = {cid: {k: v.get(k) for k in ("captureGranted", "speechDetected", "ungrantedOutcome", "noDeviceOutcome", "alignment")} for cid, v in ((rec or {}).get("cases") or {}).items() if not v.get("ready")}
            ready = bool(rec) and rec.get("productTraffic") == 0 and not bad and r.returncode == 0
            log.append({"attempt": i, "exitCode": r.returncode, "ready": ready, "notReady": bad, "productTraffic": (rec or {}).get("productTraffic")})
            final = out if rec else final
            if ready:
                break
        if final:
            shutil.copyfile(final, x.out)
    with open(x.out + ".attempts.json", "w", encoding="utf-8") as f:
        json.dump({"schema": "speaksharp.cloud-test.stimulus-preflight-attempts.v1", "maxAttempts": n, "attempts": log, "ready": bool(log) and log[-1]["ready"]}, f, indent=1)
    if not (log and log[-1]["ready"]):
        print("BLOCKED_SETUP: stimulus preflight not ready after %d attempt(s): %s" % (len(log), json.dumps(log[-1]["notReady"])), file=sys.stderr)
        sys.exit(78)
    print(json.dumps({"ready": True, "attempts": len(log), "out": x.out}))


if __name__ == "__main__":
    main()
