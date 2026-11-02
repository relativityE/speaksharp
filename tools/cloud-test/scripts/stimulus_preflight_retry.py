#!/usr/bin/env python3
"""Runs the harness's stimulus preflight (zero product traffic) with a bounded, fully recorded retry. The harness's audio-alignment measurement can come back
`indeterminate` under machine load (observed once in four runs for AHT-02 with an otherwise identical plan). The preflight touches no product host, so a re-run
costs nothing but time; it is NOT a way to hide a real failure: every attempt is recorded in <out>.attempts.json with its failing cases and reasons, at most
three attempts are made, a case that is not READY in the last attempt fails the stage, and the receipt written is the unchanged output of the last attempt.
Usage: stimulus_preflight_retry.py --harness DIR --plan plan.json --chrome PATH --browser-receipt RECEIPT --out receipt.json [--cwd runner] [--attempts 3]
Exit 0 only when the final receipt is ready; 78 otherwise."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def bound_browser(chrome, receipt):
    try:
        with open(receipt, encoding="utf-8") as f:
            identity = json.load(f)
    except (OSError, ValueError):
        raise SystemExit("BLOCKED_SETUP: browser identity receipt is missing or unreadable")
    real = os.path.realpath(chrome)
    if identity.get("schema") not in ("speaksharp.cloud-test.existing-browser.v1", "speaksharp.cloud-test.installed-browser.v1") \
            or identity.get("path") != real or real != os.path.abspath(chrome) or os.path.islink(chrome) \
            or not os.path.isfile(chrome) or identity.get("observedBinarySha256") != digest(chrome):
        raise SystemExit("BLOCKED_SETUP: stimulus browser path/bytes differ from the verified setup receipt")
    return real, identity["observedBinarySha256"]


def attempt(harness, plan, chrome, browser_receipt, browser_sha, cwd, out):
    r = subprocess.run(["node", os.path.join(harness, "draft-adapters", "stimulus-preflight.cjs"), "--plan", plan, "--chrome", chrome, "--out", out], capture_output=True, text=True, cwd=cwd)
    rec = None
    if os.path.isfile(out):
        try:
            rec = json.load(open(out, encoding="utf-8"))
        except ValueError:
            rec = None
    _, after_sha = bound_browser(chrome, browser_receipt)
    if after_sha != browser_sha:
        raise SystemExit("BLOCKED_SETUP: stimulus browser bytes changed during preflight")
    return r, rec


def main():
    a = argparse.ArgumentParser()
    for k in ("harness", "plan", "chrome", "browser-receipt", "out"):
        a.add_argument("--" + k, required=True)
    a.add_argument("--cwd", default=None)
    a.add_argument("--attempts", type=int, default=3)
    x = a.parse_args()
    chrome, browser_sha = bound_browser(x.chrome, x.browser_receipt)
    n = min(max(1, x.attempts), 3)
    log, final = [], None
    with tempfile.TemporaryDirectory() as d:
        for i in range(1, n + 1):
            out = os.path.join(d, "attempt-%d.json" % i)
            r, rec = attempt(x.harness, x.plan, chrome, x.browser_receipt, browser_sha, x.cwd, out)
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
