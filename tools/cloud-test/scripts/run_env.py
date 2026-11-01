#!/usr/bin/env python3
"""Maps a validated run request to the plan-builder environment variables (names, not secrets). Offline.
The names follow the harness plan builder (build_private_*.py): BP_CAMPAIGN, BP_T0/BP_T1, BP_TOTAL, BP_CLEANUP, BP_IDENT, BP_SELECT, BP_GATES, BP_EST,
BP_SELECT_REF, BP_SELECT_REASON, BP_BACKEND_*. Credentials are NOT written here; the workflow supplies them at the build and run steps only.
Usage: run_env.py --request R.json --out env.txt"""
import argparse
import hashlib
import json
import os
import re
import shlex
import stat
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import load  # noqa: E402
from case_start_caps import request_caps  # noqa: E402


SAMPLE = {"partial": "minimal", "full": "full"}
BP_MODE = dict(SAMPLE)   # the request's coverageMode is the only source; a request without one fails here
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def bound_request(path, expected_sha256):
    if not isinstance(path, str) or not os.path.isabs(path) or os.path.realpath(path) != path:
        sys.exit("BLOCKED_SETUP: request path must be absolute and canonical")
    try:
        info = os.lstat(path)
    except OSError:
        sys.exit("BLOCKED_SETUP: admitted request is unavailable")
    if not stat.S_ISREG(info.st_mode) or os.path.islink(path) or info.st_nlink != 1:
        sys.exit("BLOCKED_SETUP: admitted request must be a single private file")
    if not SHA256.fullmatch(expected_sha256 or ""):
        sys.exit("BLOCKED_SETUP: admitted request digest is missing or malformed")
    with open(path, "rb") as stream:
        raw = stream.read()
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        sys.exit("BLOCKED_SETUP: request changed since admission")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        sys.exit("BLOCKED_SETUP: admitted request is not valid JSON")
    if not isinstance(value, dict):
        sys.exit("BLOCKED_SETUP: admitted request must be an object")
    return value


def cfg_pin():
    from _common import ROOT
    return load(os.path.join(ROOT, "config", "test-config.v1.json"))["tools"]["pdfjs"]["pdfMjsSha256"]


def num(case):
    return int(case.split("-")[1])


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--request", required=True)
    a.add_argument("--request-sha256", required=True)
    a.add_argument("--out", required=True)
    x = a.parse_args()
    r = bound_request(x.request, x.request_sha256)
    try:
        contract_mode, _ = request_caps(r, execution=True)
    except (KeyError, TypeError, ValueError):
        sys.exit("BLOCKED_SETUP: invalid Start allocation")
    mode = r.get("coverageMode")
    if mode not in BP_MODE:
        sys.exit("coverageMode must be partial or full; the plan mode is never defaulted")
    from _common import ROOT
    cfg = load(os.path.join(ROOT, "config", "test-config.v1.json"))
    allowed = cfg["modes"][mode].get("allowedSampleModes", [SAMPLE[mode]])
    if r.get("sampleMode") not in allowed:
        sys.exit("sampleMode %r does not match coverageMode %s" % (r.get("sampleMode"), mode))
    runtime = r.get("executionRuntime", "Claude SpeakSharp R4")
    if runtime not in ("Claude SpeakSharp R4", "GitHub Actions SpeakSharp"):
        sys.exit("executionRuntime must be an explicitly supported runtime")
    builder_mode = "selected-full" if mode == "partial" and r["sampleMode"] == "full" else BP_MODE[mode]
    if contract_mode != builder_mode:
        sys.exit("BLOCKED_SETUP: Start allocation mode differs from builder mode")
    est, sel, win, appr, rel = r["estimate"], r["selection"], r["window"], r["approvedLimits"], r["release"]
    gates = []
    for s in sel:
        if s.get("gate"):
            gc, row = s["gate"].split(":")
            gates.append("%d:%d:%s" % (num(s["case"]), num(gc), row))
    env = {
        "BP_CAMPAIGN": r["runId"], "BP_MODE": builder_mode, "BP_RUNTIME": runtime, "BP_T0": win["startUtc"], "BP_T1": win["endUtc"],
        "BP_PRODUCER_MODE": "same-github-job" if runtime == "GitHub Actions SpeakSharp" and any(s["case"] in ("AHT-01", "AHT-02", "AHT-03", "AHT-07", "AHT-08") for s in sel) else "unavailable",
        "BP_TOTAL": str(appr["runCapRequests"]), "BP_CLEANUP": str(est["requests"]["cleanupReserve"]), "BP_COACHING_CAP": str(est["providerBillableRequests"]["coachingCap"]),
        "BP_IDENT": str(est["identityReads"]), "BP_SELECT": ",".join(str(num(s["case"])) for s in sel),
        "BP_GATES": ",".join(gates), "BP_EST": ",".join("%d:%d" % (num(s["case"]), s["plannedRequests"]) for s in sel),
        "BP_SELECT_REF": r["selectionApprovalRef"], "BP_SELECT_REASON": r["purpose"][:200], "BP_SOURCE_SHA": rel["testedSha"],
        "BP_PDFJS_SHA": cfg_pin(),
        "BP_BACKEND_SOURCE": rel["backend"]["source"], "BP_BACKEND_VERIFIED": rel["backend"]["verifiedAtUtc"] or "-",
    }
    env["BP_BACKEND_VERIFIED"] = "" if env["BP_BACKEND_VERIFIED"] == "-" else env["BP_BACKEND_VERIFIED"]
    if builder_mode == "selected-full":
        # Preserve the runner's fifteen-row denominator; only selection dispatches.
        env["BP_CASES"] = ",".join(str(n) for n in range(1, 16))
    missing = [k for k, v in env.items() if v in (None, "None") or (v == "" and k not in ("BP_GATES", "BP_BACKEND_VERIFIED"))]
    if missing:
        print("missing values for", missing)
        sys.exit(1)
    with open(x.out, "w", encoding="utf-8") as f:
        for k, v in env.items():
            if "\n" in str(v):
                sys.exit(1)
            f.write("%s=%s\n" % (k, shlex.quote(str(v))))
    print("wrote", len(env), "plan-builder variables (no credentials)")


if __name__ == "__main__":
    main()
