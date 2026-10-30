#!/usr/bin/env python3
"""Maps a validated run request to the plan-builder environment variables (names, not secrets). Offline.
The names follow the harness plan builder (build_private_*.py): BP_CAMPAIGN, BP_T0/BP_T1, BP_TOTAL, BP_CLEANUP, BP_IDENT, BP_SELECT, BP_GATES, BP_EST,
BP_SELECT_REF, BP_SELECT_REASON, BP_BACKEND_*. Credentials are NOT written here; the workflow supplies them at the build and run steps only.
Usage: run_env.py --request R.json --out env.txt"""
import argparse
import os
import shlex
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import load  # noqa: E402


SAMPLE = {"partial": "minimal", "full": "full"}
BP_MODE = dict(SAMPLE)   # the request's coverageMode is the only source; a request without one fails here


def cfg_pin():
    from _common import ROOT
    return load(os.path.join(ROOT, "config", "test-config.v1.json"))["tools"]["pdfjs"]["pdfMjsSha256"]


def num(case):
    return int(case.split("-")[1])


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--request", required=True)
    a.add_argument("--out", required=True)
    x = a.parse_args()
    r = load(x.request)
    mode = r.get("coverageMode")
    if mode not in BP_MODE:
        sys.exit("coverageMode must be partial or full; the plan mode is never defaulted")
    if r.get("sampleMode") != SAMPLE[mode]:
        sys.exit("sampleMode %r does not match coverageMode %s" % (r.get("sampleMode"), mode))
    est, sel, win, appr, rel = r["estimate"], r["selection"], r["window"], r["approvedLimits"], r["release"]
    gates = []
    for s in sel:
        if s.get("gate"):
            gc, row = s["gate"].split(":")
            gates.append("%d:%d:%s" % (num(s["case"]), num(gc), row))
    env = {
        "BP_CAMPAIGN": r["runId"], "BP_MODE": BP_MODE[mode], "BP_T0": win["startUtc"], "BP_T1": win["endUtc"],
        "BP_TOTAL": str(appr["runCapRequests"]), "BP_CLEANUP": str(est["requests"]["cleanupReserve"]), "BP_COACHING_CAP": str(est["providerBillableRequests"]["coachingCap"]),
        "BP_IDENT": str(est["identityReads"]), "BP_SELECT": ",".join(str(num(s["case"])) for s in sel),
        "BP_GATES": ",".join(gates), "BP_EST": ",".join("%d:%d" % (num(s["case"]), s["plannedRequests"]) for s in sel),
        "BP_SELECT_REF": r["selectionApprovalRef"], "BP_SELECT_REASON": r["purpose"][:200], "BP_SOURCE_SHA": rel["testedSha"],
        "BP_PDFJS_SHA": cfg_pin(),
        "BP_BACKEND_SOURCE": rel["backend"]["source"], "BP_BACKEND_VERIFIED": rel["backend"]["verifiedAtUtc"] or "-",
    }
    env["BP_BACKEND_VERIFIED"] = "" if env["BP_BACKEND_VERIFIED"] == "-" else env["BP_BACKEND_VERIFIED"]
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
