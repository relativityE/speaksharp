#!/usr/bin/env python3
"""Maps a validated run request to the plan-builder environment variables (names, not secrets). Offline.
The names follow the harness plan builder (build_private_*.py): BP_CAMPAIGN, BP_T0/BP_T1, BP_TOTAL, BP_CLEANUP, BP_IDENT, BP_SELECT, BP_GATES, BP_EST,
BP_SELECT_REF, BP_SELECT_REASON, BP_BACKEND_*. Credentials are NOT written here; the workflow supplies them at the build and run steps only.
BP_T1 is the run's ONE execution deadline (init_run_inputs.execution_deadline, passed unchanged as an init step output), never the
occurrence end: it must lie inside the occurrence, and a missing or malformed value refuses .
Usage: run_env.py --request R.json --request-sha256 SHA --reconciliation RC.json --execution-deadline YYYY-MM-DDTHH:MM:SSZ --out env.txt"""
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


SAMPLE = {"partial": "minimal", "smoke": "smoke", "full": "full"}
BP_MODE = dict(SAMPLE)   # the request's coverageMode is the only source; a request without one fails here
SHA256 = re.compile(r"^[0-9a-f]{64}$")
UTC = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")


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
    a.add_argument("--reconciliation", required=True)
    a.add_argument("--execution-deadline", required=True)
    a.add_argument("--out", required=True)
    # the manual run's reservation binding, by its private file and digest only (never a bare number), with the execution
    # identity it must name ("<run id>.<attempt>", CT_EXECUTION_RUN_ID).
    a.add_argument("--reservation-binding")
    a.add_argument("--reservation-binding-sha256")
    a.add_argument("--execution-run-id")
    a.add_argument("--source-sha")
    x = a.parse_args()
    r = bound_request(x.request, x.request_sha256)
    if not os.path.isabs(x.reconciliation) or os.path.realpath(x.reconciliation) != x.reconciliation:
        sys.exit("BLOCKED_SETUP: reconciliation path must be absolute and canonical")
    try:
        reconciliation_info = os.lstat(x.reconciliation)
        reconciliation_raw = open(x.reconciliation, "rb").read()
        reconciliation = json.loads(reconciliation_raw)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        sys.exit("BLOCKED_SETUP: reconciliation is unavailable or invalid")
    if not stat.S_ISREG(reconciliation_info.st_mode) or os.path.islink(x.reconciliation) or reconciliation_info.st_nlink != 1 \
            or type(reconciliation) is not dict:
        sys.exit("BLOCKED_SETUP: reconciliation must be one regular JSON object")
    reconciliation_sha256 = hashlib.sha256(reconciliation_raw).hexdigest()
    try:
        contract_mode, _ = request_caps(r, execution=True)
    except (KeyError, TypeError, ValueError):
        sys.exit("BLOCKED_SETUP: invalid Start allocation")
    mode = r.get("coverageMode")
    if mode not in BP_MODE:
        sys.exit("coverageMode must be partial, smoke or full; the plan mode is never defaulted")
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
    deadline = x.execution_deadline
    # Same-format UTC strings order lexically; the deadline is strictly after the occurrence start and never after its end.
    if not (isinstance(deadline, str) and UTC.match(deadline) and UTC.match(str(win.get("startUtc"))) and UTC.match(str(win.get("endUtc")))
            and win["startUtc"] < deadline <= win["endUtc"]):
        sys.exit("BLOCKED_SETUP: the run's execution deadline is missing, malformed or outside the occurrence")
    gates = []
    for s in sel:
        if s.get("gate"):
            gc, row = s["gate"].split(":")
            gates.append("%d:%d:%s" % (num(s["case"]), num(gc), row))
    env = {
        "BP_CAMPAIGN": r["runId"], "BP_MODE": builder_mode, "BP_RUNTIME": runtime, "BP_T0": win["startUtc"], "BP_T1": deadline,
        "BP_PRODUCER_MODE": "same-github-job" if runtime == "GitHub Actions SpeakSharp" and any(s["case"] in ("AHT-01", "AHT-02", "AHT-03", "AHT-07", "AHT-08") for s in sel) else "unavailable",
        "BP_TOTAL": str(appr["runCapRequests"]), "BP_CLEANUP": str(est["requests"]["cleanupReserve"]), "BP_COACHING_CAP": str(est["providerBillableRequests"]["coachingCap"]),
        "BP_IDENT": str(est["identityReads"]), "BP_SELECT": ",".join(str(num(s["case"])) for s in sel),
        "BP_GATES": ",".join(gates), "BP_EST": ",".join("%d:%d" % (num(s["case"]), s["plannedRequests"]) for s in sel),
        "BP_SELECT_REF": r["selectionApprovalRef"], "BP_SELECT_REASON": r["purpose"][:200], "BP_SOURCE_SHA": rel["testedSha"],
        "BP_PDFJS_SHA": cfg_pin(),
        "BP_BACKEND_SOURCE": rel["backend"]["source"], "BP_BACKEND_VERIFIED": rel["backend"]["verifiedAtUtc"] or "-",
        "BP_REQUEST_FILE": x.request, "BP_REQUEST_SHA256": x.request_sha256,
        "BP_RECONCILIATION_FILE": x.reconciliation, "BP_RECONCILIATION_SHA256": reconciliation_sha256,
    }
    env["BP_BACKEND_VERIFIED"] = "" if env["BP_BACKEND_VERIFIED"] == "-" else env["BP_BACKEND_VERIFIED"]
    if x.reservation_binding or x.reservation_binding_sha256:
        import reservation_binding as RB
        run_id, _, attempt = (x.execution_run_id or "").partition(".")
        try:
            RB.verify(x.reservation_binding, x.reservation_binding_sha256, request_sha256=x.request_sha256, campaign_id=r["runId"],
                      run_id=run_id, attempt=int(attempt) if attempt.isdigit() else None, reconciliation_head=reconciliation.get("headSha"),
                      configured_max=est["identityReads"], tested_sha=rel["testedSha"], harness_source_sha=x.source_sha or None)
        except (RB.Refused, OSError) as e:
            sys.exit("BLOCKED_SETUP: " + (str(e) if isinstance(e, RB.Refused) else "reservation-binding-unreadable"))
        env.update(BP_RESERVATION_BINDING_FILE=x.reservation_binding, BP_RESERVATION_BINDING_SHA256=x.reservation_binding_sha256)
    # R10 run 42142985744: the same-job bootstrap validates the account bindings against https://$BP_HOST_DB, but nothing on the real path
    # set it (only unit fixtures did), so it compared against https://undefined and refused. The host comes from the SAME origin the
    # binding resolver was given (VITE_SUPABASE_URL, execute_run.sh ensure_account_bindings), never a default.
    origin = os.environ.get("VITE_SUPABASE_URL", "")
    if origin:
        # Normalised like the resolver's projectOrigin: https, no credentials, default port only, no path beyond "/", lower-case host.
        # (A regex, not urllib: this control-plane script stays outside the network-import boundary.)
        m = re.fullmatch(r"https://([A-Za-z0-9]{20}\.[Ss][Uu][Pp][Aa][Bb][Aa][Ss][Ee]\.[Cc][Oo])(?::443)?/?", origin)
        if not m:
            sys.exit("BLOCKED_SETUP: project origin must be https://<20-char ref>.supabase.co")
        host = m.group(1).lower()
        env["BP_HOST_DB"] = host
    elif env["BP_PRODUCER_MODE"] == "same-github-job":
        sys.exit("BLOCKED_SETUP: project origin (VITE_SUPABASE_URL) is required for the same-job producer")
    if builder_mode in ("selected-full", "smoke"):
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
