#!/usr/bin/env python3
"""Reduces offline-checks.json to the public summary: check names, statuses and counts only (PO 2026-10-30, minimal exposure).
The repository is public, so no child output, detail or traceback leaves the runner; for a failed unittest check only the failing
test names and the unittest counts are kept. A missing, malformed or inconsistent result is a failure, never an empty success.
Usage: summarize_offline_checks.py --in offline-checks.json --out offline-checks-summary.json   (mode from CT_HISTORY)"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# The exact inventory of run_offline_checks.py (Sam 1793373703): every ID once, none missing or extra.
HISTORY_BOUND = frozenset(("history-index-verified", "assertion-catalog-matches-harness", "sealed-receipts-verified",
                           "case-costs-reconcile-to-sealed-ledgers", "offline-proof-index"))
CURRENT_SOURCE = frozenset(("package-unit-tests", "report-builder-tests", "reservation-ledger-verified", "catalog-history-additive",
                            "harness-verified", "config-matches-workflow"))
# unittest's failure headers, including class-level fixtures such as "ERROR: setUpClass (module.Class)".
FAILING = re.compile(r"^(?:ERROR|FAIL): (\w+ \([\w.]+\))", re.M)
TYPE_NAME = re.compile(r"^[A-Za-z_][\w.]*$")


def _failure_types(text):
    """Exception class name per failing test (PO 2026-10-30): never the message or the traceback."""
    types = {}
    blocks = re.split(r"^={50,}$", text, flags=re.M)
    for block in blocks:
        head = FAILING.search(block)
        if not head:
            continue
        body = re.split(r"^-{50,}$", block, flags=re.M)
        lines = [ln for ln in "".join(body[1:2]).splitlines() if ln and not ln[0].isspace()
                 and not ln.startswith(("Traceback", "During handling", "The above exception"))]
        name = lines[-1].split(":", 1)[0].strip() if lines else ""
        types[head.group(1)] = name if TYPE_NAME.match(name) else "UNPARSED"
    return types


def _text(c):
    return str(c.get("stdout", "")) + "\n" + str(c.get("stderr", ""))


def _counts(c):
    text = _text(c)
    ran = re.findall(r"^Ran (\d+) tests?", text, re.M)
    if not ran:
        return {}
    tail = text[text.rindex("Ran " + ran[-1]):]
    got = lambda key: int((re.search(key + r"=(\d+)", tail) or [0, 0])[1])
    return {"ran": int(ran[-1]), "failures": got("failures"), "errors": got("errors"), "skipped": got("skipped")}


def _status(c):
    return "N/A" if c.get("applicable", True) is False and c.get("passed") is None else "PASS" if c.get("passed") is True else "FAIL"


def summarize(result, history):
    """Return the public summary for a parsed result (None when the file is missing). Never raises on bad input."""
    reduced = history == "none"
    # Reduced scope (Sam 1793373376): the history-bound pipeline and its attestation do not run, so neither is claimed.
    summary = {"schema": "speaksharp.cloud-test.offline-checks-summary.v2", "historyMode": history, "reducedScope": reduced,
               "liveExecutionAuthorized": False,
               "steps": {"control-plane-pipeline": "NOT APPLICABLE" if reduced else "REQUIRED",
                         "preflight-attestation": "NOT APPLICABLE" if reduced else "REQUIRED"},
               "resultValid": False, "overallPassed": False}

    def fail(error):
        summary["error"] = error
        return summary

    if history not in ("required", "none"):
        return fail("HISTORY_MODE_INVALID")
    if result is None:
        return fail("RESULT_MISSING")
    checks = result.get("checks") if isinstance(result, dict) else None
    if not isinstance(checks, list) or not checks or not all(isinstance(c, dict) and isinstance(c.get("id"), str) for c in checks):
        return fail("RESULT_MALFORMED")
    ids = [c["id"] for c in checks]
    if len(ids) != len(set(ids)):
        return fail("RESULT_DUPLICATE_CHECK")
    if set(ids) != HISTORY_BOUND | CURRENT_SOURCE:
        return fail("RESULT_CHECK_INVENTORY_MISMATCH")
    for c in checks:
        # Current-source checks are never N/A; in the reduced scope exactly the history-bound checks are, in required mode none is.
        if c["id"] in HISTORY_BOUND and reduced:
            legal = c.get("applicable") is False and c.get("passed") is None
        else:
            legal = c.get("applicable", True) is True and isinstance(c.get("passed"), bool)
        if not legal:
            return fail("RESULT_ILLEGAL_APPLICABILITY")
    rows = []
    for c in checks:
        row = {"id": c["id"], "status": _status(c)}
        if _counts(c):
            row["tests"] = _counts(c)
        names = sorted(set(FAILING.findall(_text(c))))
        if row["status"] == "FAIL" and names:
            row["failingTests"] = names
            row["failureTypes"] = _failure_types(_text(c))
        rows.append(row)
    count = lambda value: sum(r["status"] == value for r in rows)
    summary.update(checks=rows, passed=count("PASS"), failed=count("FAIL"), notApplicable=count("N/A"))
    derived = all(r["status"] == "PASS" for r in rows if r["status"] != "N/A")
    if result.get("historyMode", "required") != history or (result.get("passed") is True) != derived:
        return fail("RESULT_INCONSISTENT")
    summary.update(resultValid=True, overallPassed=derived)
    return summary


def main():
    # The executable control-plane path loads the network guard, like every control-plane script (Sam 1793375168): only
    # here, so importing summarize() for tests stays pure and never patches the importing process's sockets.
    sys.path.insert(0, HERE)
    import _netguard  # noqa: F401
    a = argparse.ArgumentParser()
    a.add_argument("--in", dest="src", required=True)
    a.add_argument("--out", required=True)
    x = a.parse_args()
    result = None
    if os.path.isfile(x.src):
        try:
            with open(x.src, encoding="utf-8") as f:
                result = json.load(f)
        except (OSError, ValueError):
            result = {}
    summary = summarize(result, os.environ.get("CT_HISTORY", "required"))
    with open(x.out, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1)
    for r in summary.get("checks", []):
        print("%-4s %s" % (r["status"], r["id"]))
        if "tests" in r:
            print("       tests %s" % json.dumps(r["tests"], sort_keys=True))
        for name in r.get("failingTests", []):
            print("       %s  [%s]" % (name, r.get("failureTypes", {}).get(name, "UNPARSED")))
    if "error" in summary:
        print("offline checks: " + summary["error"])
    else:
        print("offline checks: %d passed, %d failed, %d not applicable; reduced scope %s; overall %s"
              % (summary["passed"], summary["failed"], summary["notApplicable"], summary["reducedScope"], "PASS" if summary["overallPassed"] else "FAIL"))
    return 0 if summary["overallPassed"] else 1


if __name__ == "__main__":
    sys.exit(main())
