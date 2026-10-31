#!/usr/bin/env python3
"""Reduces offline-checks.json to the public summary: check names, statuses and counts only (PO 2026-10-30, minimal exposure).
The repository is public, so no child output, detail or traceback leaves the runner; for a failed unittest check only the failing
test names and the unittest counts are kept. A missing, malformed or inconsistent result is a failure, never an empty success.
Usage: summarize_offline_checks.py --in offline-checks.json --out offline-checks-summary.json"""
import argparse
import builtins
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# The exact inventory of run_offline_checks.py (Sam 1793373703): every ID once, none missing or extra. Every check is a current-run check and
# none is ever N/A; the retained-campaign audits run only in scripts/run_legacy_audit.py (PO 2026-10-30, Sam 1793400946).
CHECKS = frozenset(("package-unit-tests", "report-builder-tests", "reservation-ledger-verified", "catalog-history-additive", "harness-verified",
                    "assertion-catalog-matches-harness", "config-matches-workflow", "offline-proof-index"))
# The unittest suites whose own counts must prove a clean, non-empty run before the workflow counts as delivered.
SUITES = ("package-unit-tests", "report-builder-tests")
# unittest's closing status line after "Ran N tests": OK or FAILED, optionally with "key=value" counts in parentheses.
STATUS = re.compile(r"^(OK|FAILED)(?: \(((?:[a-z ]+=\d+)(?:, [a-z ]+=\d+)*)\))?$")
COUNT_KEYS = frozenset(("failures", "errors", "skipped", "expected failures", "unexpected successes"))
# unittest's failure headers, including class-level fixtures such as "ERROR: setUpClass (module.Class)".
FAILING = re.compile(r"^(?:ERROR|FAIL): (\w+ \([\w.]+\))", re.M)
# A closed allowlist is the public type boundary (Sam 1793377141): only Python's built-in exception classes and these named
# stdlib ones are ever published, so text shaped like a traceback cannot put an arbitrary word in the summary. Else OTHER.
PUBLIC_EXCEPTION_TYPES = frozenset(name for name, value in vars(builtins).items()
                                   if isinstance(value, type) and issubclass(value, BaseException)) | frozenset(
    ("unittest.case.SkipTest", "subprocess.CalledProcessError", "subprocess.TimeoutExpired", "json.decoder.JSONDecodeError"))


def _failure_types(text):
    """Exception class name per failing test (PO 2026-10-30): never the message or the traceback."""
    types = {}
    blocks = re.split(r"^={50,}$", text, flags=re.M)
    for block in blocks:
        head = FAILING.search(block)
        if not head:
            continue
        body = re.split(r"^-{50,}$", block, flags=re.M)
        lines = "".join(body[1:2]).splitlines()
        # The raised exception is the first unindented line after the traceback's last frame; its message may span
        # further lines and is never read past the class name.
        frames = [i for i, ln in enumerate(lines) if ln.startswith("  File ")]
        name = ""
        if frames:
            name = next((ln.split(":", 1)[0].strip() for ln in lines[frames[-1] + 1:] if ln and not ln[0].isspace()), "")
        types[head.group(1)] = name if name in PUBLIC_EXCEPTION_TYPES else "OTHER"
    return types


def _text(c):
    return str(c.get("stdout", "")) + "\n" + str(c.get("stderr", ""))


def _suite(c):
    """The unittest counts of a check, read strictly from ONE unambiguous, complete result (Sam 1793398852): exactly one line
    starting "Ran ", in unittest's exact form, whose next non-blank line is unittest's OK/FAILED status with known counts and is
    the last non-blank line of the output. Otherwise {}: none or several results, "NO TESTS RAN", a truncated or malformed
    summary, or anything (another summary, a contradictory status) after it."""
    text = _text(c)
    if len(re.findall(r"^Ran ", text, re.M)) != 1:
        return {}
    ran = list(re.finditer(r"^Ran (\d+) tests? in [\d.]+s$", text, re.M))
    if len(ran) != 1:
        return {}
    rest = [ln for ln in text[ran[-1].end():].splitlines() if ln.strip()]
    status = STATUS.match(rest[0]) if len(rest) == 1 else None
    if not status:
        return {}
    pairs = [p.split("=") for p in status.group(2).split(", ")] if status.group(2) else []
    got = {k: int(v) for k, v in pairs}
    unsuccessful = sum(got.get(k, 0) for k in ("failures", "errors", "unexpected successes"))
    if len(got) != len(pairs) or not set(got) <= COUNT_KEYS or (status.group(1) == "OK") != (unsuccessful == 0):
        return {}
    return {"ran": int(ran[-1].group(1)), **{k: got.get(k, 0) for k in sorted(COUNT_KEYS)}}


def _counts(c):
    suite = _suite(c)
    return {k: suite[k] for k in ("ran", "failures", "errors", "skipped")} if suite else {}


def delivery_refusals(checks, rows, result):
    """Every reason this result is not the delivered workflow (PO 2026-10-30 via Sam 1793398305: GitHub cloud-test passing with NO skips).
    Empty means delivered."""
    refusals = ["FAILED:" + r["id"] for r in rows if r["status"] == "FAIL"]
    if result.get("proofSource") != "ct-proof-file":
        refusals.append("PROOF_NOT_SUPPLIED")
    for c in checks:
        if c["id"] not in SUITES:
            continue
        suite = _suite(c)
        if not suite:
            refusals.append("COUNTS_MISSING:" + c["id"])
        elif suite["ran"] == 0:
            refusals.append("COUNTS_EMPTY:" + c["id"])
        else:
            refusals += ["%s:%s" % (k.upper().replace(" ", "_"), c["id"]) for k in sorted(COUNT_KEYS) if suite[k]]
    return refusals


def summarize(result):
    """Return the public summary for a parsed result (None when the file is missing). Never raises on bad input."""
    summary = {"schema": "speaksharp.cloud-test.offline-checks-summary.v3", "liveExecutionAuthorized": False,
               "resultValid": False, "delivered": False, "overallPassed": False}

    def fail(error):
        summary["error"] = error
        return summary

    if result is None:
        return fail("RESULT_MISSING")
    checks = result.get("checks") if isinstance(result, dict) else None
    if not isinstance(checks, list) or not checks or not all(isinstance(c, dict) and isinstance(c.get("id"), str) for c in checks):
        return fail("RESULT_MALFORMED")
    ids = [c["id"] for c in checks]
    if len(ids) != len(set(ids)):
        return fail("RESULT_DUPLICATE_CHECK")
    if set(ids) != CHECKS:
        return fail("RESULT_CHECK_INVENTORY_MISMATCH")
    if result.get("proofSource") not in ("ct-proof-file", None):
        return fail("RESULT_MALFORMED")
    # No check is ever N/A: each must be applicable with a boolean outcome.
    if not all(c.get("applicable", True) is True and isinstance(c.get("passed"), bool) for c in checks):
        return fail("RESULT_ILLEGAL_APPLICABILITY")
    rows = []
    for c in checks:
        row = {"id": c["id"], "status": "PASS" if c["passed"] else "FAIL"}
        if _counts(c):
            row["tests"] = _counts(c)
        names = sorted(set(FAILING.findall(_text(c))))
        if row["status"] == "FAIL" and names:
            row["failingTests"] = names
            row["failureTypes"] = _failure_types(_text(c))
        rows.append(row)
    summary.update(checks=rows, passed=sum(r["status"] == "PASS" for r in rows), failed=sum(r["status"] == "FAIL" for r in rows))
    if (result.get("passed") is True) != all(r["status"] == "PASS" for r in rows):
        return fail("RESULT_INCONSISTENT")
    # The delivery: every check passes, both suites show one complete, non-empty, clean count, and the proof is the one the workflow supplied
    # (CT_PROOF_FILE; its freshness is the workflow boundary's, Sam 1793405248).
    refusals = delivery_refusals(checks, rows, result)
    summary.update(resultValid=True, delivered=not refusals, deliveryRefusals=refusals, overallPassed=not refusals)
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
    summary = summarize(result)
    with open(x.out, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1)
    for r in summary.get("checks", []):
        print("%-4s %s" % (r["status"], r["id"]))
        if "tests" in r:
            print("       tests %s" % json.dumps(r["tests"], sort_keys=True))
        for name in r.get("failingTests", []):
            print("       %s  [%s]" % (name, r.get("failureTypes", {}).get(name, "OTHER")))
    if "error" in summary:
        print("offline checks: " + summary["error"])
    else:
        print("offline checks: %d passed, %d failed; overall %s" % (summary["passed"], summary["failed"], "PASS" if summary["overallPassed"] else "FAIL"))
        print("delivery: " + ("DELIVERED (required mode, no skips)" if summary["delivered"]
                              else "NOT DELIVERED: " + ", ".join(summary["deliveryRefusals"])))
    return 0 if summary["overallPassed"] else 1


if __name__ == "__main__":
    sys.exit(main())
