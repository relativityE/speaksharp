#!/usr/bin/env python3
"""Reduces offline-checks.json to the public summary: check names, statuses and counts only (PO 2026-10-30, minimal exposure).
The repository is public, so no child output, detail or traceback leaves the runner; for a failed unittest check only the failing
test names and the unittest counts are kept. A missing, malformed or inconsistent result is a failure, never an empty success.
The equivalence block adds only hashes, public package paths, public test ids with their outcomes, and declared versions, so a GitHub run and a
Cloud Test run of the same commit can be compared with --compare (MATCHED / DIFFERENT / DIFFERENT-INPUTS / UNKNOWN / INCOMPLETE).
Usage: summarize_offline_checks.py --in offline-checks.json --out offline-checks-summary.json
       summarize_offline_checks.py --compare github-summary.json cloud-summary.json --out equivalence.json"""
import argparse
import builtins
import hashlib
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


# ---------- Equivalence (Sam 1793406117, 1793406369, 1793406609, 1793406980, 1793407393) ----------
# The summary carries what was tested and what each required test did, as hashes, public package paths and public test ids only. Every digest is
# recomputed from the canonical content it covers; a digest aids comparison and is never proof of execution or authenticity by itself.
MANIFEST = os.path.join(os.path.dirname(HERE), "config", "required-test-ids.v1.json")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
TEST_ID = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")
PACKAGE_PATH = re.compile(r"^(?!/)(?!.*(?:^|/)\.\.(?:/|$))[A-Za-z0-9_.\-/]+$")
VERSION = re.compile(r"^[A-Za-z0-9_.+\-]{1,40}$")
OUTCOMES = ("success", "expectedFailure", "skipped", "unexpectedSuccess", "failure", "error")   # aggregation precedence, lowest first
INPUT_STATES = ("BOUND", "UNKNOWN", "UNSET", "DECLARED")
INPUT_SOURCES = ("env", "default", "unset")
CALLBACK_KEYS = ("ran",) + tuple(sorted(COUNT_KEYS))
ENVIRONMENT_KEYS = ("python", "implementation", "system", "machine", "pyyaml", "node", "pdfjs")
UNEXPECTED_CATEGORIES = ("source", "config", "other")
FILE_SET_CODES = ("MISSING", "SCAN_ERROR", "SYMLINK", "UNEXPECTED", "FILE_SET_UNREADABLE")


def digest(value):
    """sha256 of canonical JSON: sorted keys, no whitespace, ASCII."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("ascii")).hexdigest()


def _count(v, minimum=0):
    """A count field: an int (never a bool) at or above the minimum (Sam 1793410731)."""
    return isinstance(v, int) and not isinstance(v, bool) and v >= minimum


def _hex_or_none(v):
    return v is None or (isinstance(v, str) and bool(HEX64.match(v)))


def _identity(doc):
    """The validated identity block (closed shapes only), or None when it is absent or any field falls outside its allowlist."""
    i = doc.get("identity") if isinstance(doc, dict) else None
    try:
        fs, pins, inputs, env, git = i["fileSet"], i["pins"], i["externalInputs"], i["environment"], i["git"]
        files = [[p, h] for p, h in fs["files"]]
        ok = (fs["status"] in ("COMPLETE", "INCOMPLETE") and set(fs["codes"]) <= set(FILE_SET_CODES) and (fs["status"] == "COMPLETE") == (not fs["codes"])
              and all(isinstance(p, str) and PACKAGE_PATH.match(p) and isinstance(h, str) and HEX64.match(h) for p, h in files)
              and [p for p, _ in files] == sorted({p for p, _ in files})
              and all(isinstance(p, str) and PACKAGE_PATH.match(p) for p in fs["missing"])
              and all(_count(fs[k]) for k in ("symlinks", "scanErrors"))
              and set(fs["unexpected"]) <= set(UNEXPECTED_CATEGORIES) and all(_count(n, 1) for n in fs["unexpected"].values())
              and set(pins) == {"code", "packet"} and all(_hex_or_none(v) for v in pins.values())
              and all(set(x) == {"name", "source", "path", "sha256", "state"} and isinstance(x["name"], str) and TEST_ID.match(x["name"].replace("-", "_"))
                      and x["source"] in INPUT_SOURCES and x["state"] in INPUT_STATES and _hex_or_none(x["sha256"])
                      and (x["path"] is None or x["path"] == "outside-repo" or (isinstance(x["path"], str) and PACKAGE_PATH.match(x["path"])))
                      for x in inputs)
              and len({x["name"] for x in inputs}) == len(inputs)
              and set(env) == set(ENVIRONMENT_KEYS) and all(v is None or (isinstance(v, str) and VERSION.match(v)) for v in env.values())
              and set(git) == {"headTree", "packageClean"} and (git["headTree"] is None or re.fullmatch(r"[0-9a-f]{40}", str(git["headTree"])))
              and git["packageClean"] in (None, True, False))
    except (KeyError, TypeError, ValueError, AttributeError):
        return None
    if not ok:
        return None
    file_set = {"status": fs["status"], "codes": list(fs["codes"]), "files": files, "missing": list(fs["missing"]), "symlinks": fs["symlinks"],
                "unexpected": dict(fs["unexpected"]), "scanErrors": fs["scanErrors"]}
    canonical_inputs = sorted(({k: x[k] for k in ("name", "source", "path", "sha256", "state")} for x in inputs), key=lambda x: x["name"])
    return {"fileSet": dict(file_set, digest=digest(files)), "pins": dict(pins), "externalInputs": canonical_inputs,
            "inputsDigest": digest([[x["name"], x["sha256"]] for x in canonical_inputs]), "environment": dict(env), "git": dict(git)}


def _suite_records(c):
    """(per-test aggregated rows, codes) from a suite check's structured records; codes name every reason the records cannot be trusted."""
    res, codes = c.get("results"), []
    try:
        tests, fixtures, cb = res["tests"], res["fixtures"], res["callbackCounts"]
        ok = (isinstance(tests, list) and isinstance(fixtures, list) and isinstance(cb, dict) and set(cb) == set(CALLBACK_KEYS)
              and all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in cb.values())
              and all(isinstance(t, dict) and isinstance(t.get("id"), str) and TEST_ID.match(t["id"])
                      and all(isinstance(t.get(k), int) and not isinstance(t.get(k), bool) and t[k] >= 0 for k in ("starts", "stops")) and isinstance(t.get("outcomes"), list) and isinstance(t.get("subtests"), list)
                      and all(o in OUTCOMES for o in t["outcomes"] + t["subtests"]) for t in tests)
              and all(isinstance(f, dict) and f.get("outcome") in OUTCOMES for f in fixtures))
    except (KeyError, TypeError):
        ok = False
    if not ok:
        return {}, ["RESULTS_MALFORMED:" + c["id"]]
    rows = {}
    for t in tests:
        if t["id"] in rows:
            codes.append("DUPLICATE_ID:" + c["id"])
            continue
        if t["starts"] > 1 or t["stops"] > 1:
            codes.append("DUPLICATE_EXECUTION:" + c["id"])
        failed_subtests = [o for o in t["subtests"] if o != "success"]
        if t["starts"] != 1 or t["stops"] != 1 or not (t["outcomes"] or failed_subtests):
            codes.append("NO_TERMINAL_OUTCOME:" + c["id"])
        # Several unsuccessful callbacks are legitimate (a failure, then a tearDown error: Sam 1793410430) and all stay as evidence; only an
        # impossible combination is contradictory: success alongside anything else, or success twice.
        if "success" in t["outcomes"] and len(t["outcomes"]) > 1:
            codes.append("CONTRADICTORY_OUTCOMES:" + c["id"])
        observed = t["outcomes"] + t["subtests"]
        rows[t["id"]] = {"outcome": max(observed, key=OUTCOMES.index) if observed else "none",
                         "subtests": {o: t["subtests"].count(o) for o in sorted(set(t["subtests"]))},
                         "outcomes": {o: t["outcomes"].count(o) for o in sorted(set(t["outcomes"]))}}
    # Three independent accounts must agree (Sam 1793410315): counts derived from the recorded parent, subtest and fixture outcomes, the counters the
    # callbacks kept, and unittest's printed count line. A recorded failure can never hide behind zero counters and a printed OK.
    events = [o for t in tests for o in t["outcomes"] + t["subtests"]] + [f["outcome"] for f in fixtures]
    derived = {"ran": sum(t["starts"] for t in tests), "failures": events.count("failure"), "errors": events.count("error"),
               "skipped": events.count("skipped"), "expected failures": events.count("expectedFailure"),
               "unexpected successes": events.count("unexpectedSuccess")}
    printed = _suite(c)
    if not printed or derived != cb or any(printed[k] != cb[k] for k in CALLBACK_KEYS):
        codes.append("COUNTS_DISAGREE:" + c["id"])
    if fixtures:
        codes.append("FIXTURE_EVENTS:" + c["id"])
    return rows, sorted(set(codes))


def _inventory(checks):
    """Exact manifest coverage per suite (Sam 1793406198): every required id executed exactly once with a terminal outcome, nothing unlisted."""
    try:
        with open(MANIFEST, "rb") as f:
            raw = f.read()
        manifest = json.loads(raw)
        ids = manifest["ids"]
        if not (isinstance(ids, list) and ids == sorted(set(ids)) and all(isinstance(i, str) and "::" in i for i in ids)):
            raise ValueError("manifest ids")
    except (OSError, ValueError, KeyError, TypeError):
        return {"status": "INCOMPLETE", "codes": ["MANIFEST_UNREADABLE"], "manifestSha256": None, "executed": [], "executedDigest": None}
    codes, executed = [], []
    for c in checks:
        if c["id"] not in SUITES:
            continue
        rows, suite_codes = _suite_records(c)
        codes += suite_codes
        required = {i.split("::", 1)[1] for i in ids if i.split("::", 1)[0] == c["id"]}
        if required - set(rows):
            codes.append("MANIFEST_IDS_NOT_EXECUTED:%s:%d" % (c["id"], len(required - set(rows))))
        if set(rows) - required:
            codes.append("UNLISTED_IDS_EXECUTED:%s:%d" % (c["id"], len(set(rows) - required)))
        # Each required test: its worst outcome, then every recorded subtest and own outcome by count, so no failed evidence is folded away.
        executed += [["%s::%s" % (c["id"], i), r["outcome"], r["subtests"], r["outcomes"]] for i, r in sorted(rows.items())]
    executed.sort(key=lambda e: e[0])
    return {"status": "INCOMPLETE" if codes else "COMPLETE", "codes": sorted(set(codes)), "manifestSha256": hashlib.sha256(raw).hexdigest(),
            "executed": executed, "executedDigest": digest(executed)}


def _result_digest(rows, inventory, delivery):
    """Covers every check status and count, the executed id-to-outcome mapping, and the delivery verdict with its refusals and proof source."""
    return digest({"checks": {r["id"]: [r["status"], r.get("tests")] for r in rows}, "executedDigest": inventory["executedDigest"],
                   "delivery": delivery})


def _eligible(rows, proof_source, ident, inventory):
    """Delivery eligibility recomputed from validated summary content alone (Sam 1793410315): every check passes, the workflow supplied the proof,
    both suites show a non-empty clean count, the inventory and the file set are complete, and every required test's outcome is success."""
    by_id = {r["id"]: r for r in rows}
    clean = all(isinstance(by_id[i].get("tests"), dict) and by_id[i]["tests"].get("ran", 0) > 0
                and all(by_id[i]["tests"].get(k) == 0 for k in ("failures", "errors", "skipped")) for i in SUITES)
    return (all(r["status"] == "PASS" for r in rows) and proof_source == "ct-proof-file" and clean and inventory["status"] == "COMPLETE"
            and ident is not None and ident["fileSet"]["status"] == "COMPLETE" and all(e[1] == "success" for e in inventory["executed"]))


def summarize(result):
    """Return the public summary for a parsed result (None when the file is missing). Never raises on bad input."""
    summary = {"schema": "speaksharp.cloud-test.offline-checks-summary.v4", "liveExecutionAuthorized": False,
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
    # Equivalence: what was tested and what every required test did. An incomplete inventory or file set is never delivery (exact manifest
    # coverage, Sam 1793406369); unbound external inputs only make a comparison UNKNOWN, they do not change this run's own gate.
    ident, inventory = _identity(result), _inventory(checks)
    if inventory["status"] != "COMPLETE":
        refusals.append("INVENTORY_INCOMPLETE")
    if ident is None:
        refusals.append("IDENTITY_MISSING")
    elif ident["fileSet"]["status"] != "COMPLETE":
        refusals.append("FILE_SET_INCOMPLETE")
    # Any unsuccessful recorded parent or subtest outcome refuses delivery on its own, whatever the counters say (Sam 1793410315).
    refusals += sorted({"UNSUCCESSFUL_OUTCOMES:" + e[0].split("::", 1)[0] for e in inventory["executed"] if e[1] != "success"})
    delivered = not refusals
    summary.update(resultValid=True, delivered=delivered, deliveryRefusals=refusals, overallPassed=delivered, proofSource=result.get("proofSource"))
    summary["equivalence"] = {"identity": ident, "inventory": inventory,
                              "resultDigest": _result_digest(rows, inventory, {"delivered": delivered, "refusals": sorted(refusals),
                                                                               "proofSource": result.get("proofSource")})}
    return summary


def _side(summary):
    """(validated, codes) for one summary given to --compare: every shape checked and every digest recomputed from its canonical content."""
    try:
        if summary.get("schema") != "speaksharp.cloud-test.offline-checks-summary.v4" or summary.get("resultValid") is not True:
            return None, ["SUMMARY_INVALID"]
        rows = summary["checks"]
        if sorted(r["id"] for r in rows) != sorted(CHECKS) or not all(r["status"] in ("PASS", "FAIL") for r in rows):
            return None, ["SUMMARY_INVALID"]
        # Every count a comparison reads is a non-negative int, never a bool: summary-row test counts here, executed and identity counts below.
        if not all("tests" not in r or (isinstance(r["tests"], dict) and set(r["tests"]) == {"ran", "failures", "errors", "skipped"}
                                         and all(_count(v) for v in r["tests"].values())) for r in rows):
            return None, ["SUMMARY_INVALID"]
        eq = summary["equivalence"]
        ident, inv = eq["identity"], eq["inventory"]
        executed = inv["executed"]
        valid_executed = (isinstance(executed, list) and all(isinstance(e, list) and len(e) == 4 and isinstance(e[0], str) and "::" in e[0]
                                                               and TEST_ID.match(e[0].split("::", 1)[1]) and e[0].split("::", 1)[0] in SUITES
                                                               and e[1] in OUTCOMES + ("none",) and all(isinstance(e[j], dict) for j in (2, 3))
                                                               and all(k in OUTCOMES and _count(n, 1)
                                                                       for j in (2, 3) for k, n in e[j].items()) for e in executed)
                          and [e[0] for e in executed] == sorted({e[0] for e in executed}))
        if not valid_executed or inv["status"] not in ("COMPLETE", "INCOMPLETE") or not _hex_or_none(inv["manifestSha256"]):
            return None, ["SUMMARY_INVALID"]
    except (KeyError, TypeError, AttributeError):
        return None, ["SUMMARY_INVALID"]
    codes = []
    if ident is None:
        codes.append("IDENTITY_MISSING")
    else:
        raw = {"fileSet": {k: ident["fileSet"].get(k) for k in ("status", "codes", "files", "missing", "symlinks", "unexpected", "scanErrors")},
               **{k: ident.get(k) for k in ("pins", "externalInputs", "environment", "git")}}
        if _identity({"identity": raw}) != ident:
            codes.append("IDENTITY_DIGEST_MISMATCH")
    delivery = {"delivered": summary.get("delivered"), "refusals": sorted(summary.get("deliveryRefusals") or []), "proofSource": summary.get("proofSource")}
    if inv.get("executedDigest") != digest(executed) or eq.get("resultDigest") != _result_digest(rows, inv, delivery):
        codes.append("RESULT_DIGEST_MISMATCH")
    # Each row's aggregate is recomputed from its own and subtest maps, and for a complete inventory the map-derived suite totals must equal the
    # summary-row counts (Sam 1793410909): a valid positive failure map can never sit under a "success" aggregate or behind clean row counts.
    for e in executed:
        maps = list(e[2]) + list(e[3])
        if e[1] != (max(maps, key=OUTCOMES.index) if maps else "none"):
            codes.append("AGGREGATE_CONTRADICTED")
            break
    if inv["status"] == "COMPLETE":
        by_id = {r["id"]: r for r in rows}
        for suite in SUITES:
            mine = [e for e in executed if e[0].split("::", 1)[0] == suite]
            total = lambda o: sum(m.get(o, 0) for e in mine for m in (e[2], e[3]))
            derived = {"ran": len(mine), "failures": total("failure"), "errors": total("error"), "skipped": total("skipped")}
            if by_id[suite].get("tests") != derived:
                codes.append("ROW_COUNTS_CONTRADICTED")
                break
    # The delivered flag is never trusted: it must equal the eligibility recomputed from the validated content, and agree with its refusals.
    eligible = (ident is not None and not {"IDENTITY_DIGEST_MISMATCH", "AGGREGATE_CONTRADICTED", "ROW_COUNTS_CONTRADICTED"} & set(codes)
                and _eligible(rows, summary.get("proofSource"), ident, inv))
    if (summary.get("delivered") is not eligible or summary.get("overallPassed") is not eligible
            or (not summary.get("deliveryRefusals")) is not eligible or not isinstance(summary.get("deliveryRefusals"), list)):
        codes.append("DELIVERED_FLAG_CONTRADICTED")
    return {"rows": rows, "identity": ident, "inventory": inv, "delivered": eligible}, codes


def compare(a, b):
    """Equivalence of two summaries (normally one GitHub run and one Cloud Test run of the same commit). MATCHED means equal observations of equal
    inputs only: each run keeps its own delivery gate, so identical failures are MATCHED and still not delivered."""
    out = {"schema": "speaksharp.cloud-test.equivalence-comparison.v1", "state": "INCOMPLETE", "codes": [], "differences": {},
           "environmentDifferences": [], "declaredInputDifferences": [], "delivered": [None, None]}
    sides = []
    for label, summary in (("a", a), ("b", b)):
        side, codes = _side(summary if isinstance(summary, dict) else {})
        out["codes"] += ["%s:%s" % (label, c) for c in codes]
        sides.append(side)
    if None in sides:
        return out
    out["delivered"] = [s["delivered"] for s in sides]
    if out["codes"]:
        return out
    ia, ib = sides[0]["identity"], sides[1]["identity"]
    va, vb = sides[0]["inventory"], sides[1]["inventory"]
    if va["status"] != "COMPLETE" or vb["status"] != "COMPLETE":
        out["codes"].append("INVENTORY_INCOMPLETE")
    if va["manifestSha256"] != vb["manifestSha256"]:
        out["codes"].append("MANIFEST_DIFFERS")
    if ia["fileSet"]["status"] != "COMPLETE" or ib["fileSet"]["status"] != "COMPLETE":
        out["codes"].append("FILE_SET_INCOMPLETE")
    if out["codes"]:
        return out
    out["environmentDifferences"] = sorted(k for k in ENVIRONMENT_KEYS if ia["environment"][k] != ib["environment"][k])
    inputs_a, inputs_b = ({x["name"]: x for x in i["externalInputs"]} for i in (ia, ib))
    out["declaredInputDifferences"] = sorted(n for n in set(inputs_a) | set(inputs_b)
                                             if n in inputs_a and n in inputs_b and (inputs_a[n]["source"], inputs_a[n]["path"]) != (inputs_b[n]["source"], inputs_b[n]["path"]))
    unbound = sorted(n for n in set(inputs_a) | set(inputs_b) if n not in inputs_a or n not in inputs_b
                     or {inputs_a[n]["state"], inputs_b[n]["state"]} & {"UNKNOWN"})
    if unbound or None in ia["pins"].values() or None in ib["pins"].values():
        out.update(state="UNKNOWN", codes=["UNBOUND:" + n for n in unbound] + (["PINS_UNVERIFIED"] if None in ia["pins"].values() or None in ib["pins"].values() else []))
        return out
    files_a, files_b = dict(map(tuple, ia["fileSet"]["files"])), dict(map(tuple, ib["fileSet"]["files"]))
    paths = sorted(p for p in set(files_a) | set(files_b) if files_a.get(p) != files_b.get(p))
    inputs = sorted(n for n in inputs_a if inputs_a[n]["sha256"] != inputs_b[n]["sha256"])
    if paths or inputs or ia["pins"] != ib["pins"]:
        out.update(state="DIFFERENT-INPUTS", differences={"paths": paths, "inputs": inputs, "pins": ia["pins"] != ib["pins"]})
        return out
    ra, rb = ({r["id"]: r for r in s["rows"]} for s in sides)
    ea, eb = ({e[0]: e[1:] for e in s["inventory"]["executed"]} for s in sides)
    checks = sorted(i for i in ra if [ra[i]["status"], ra[i].get("tests")] != [rb[i]["status"], rb[i].get("tests")])
    tests = [[i, ea.get(i, [None])[0], eb.get(i, [None])[0]] for i in sorted(set(ea) | set(eb)) if ea.get(i) != eb.get(i)]
    if checks or tests:
        out.update(state="DIFFERENT", differences={"checks": checks, "tests": tests})
    else:
        out["state"] = "MATCHED"
    return out


def main():
    # The executable control-plane path loads the network guard, like every control-plane script (Sam 1793375168): only
    # here, so importing summarize() for tests stays pure and never patches the importing process's sockets.
    sys.path.insert(0, HERE)
    import _netguard  # noqa: F401
    a = argparse.ArgumentParser()
    a.add_argument("--in", dest="src")
    a.add_argument("--compare", nargs=2, metavar=("SUMMARY_A", "SUMMARY_B"))
    a.add_argument("--out", required=True)
    x = a.parse_args()
    if bool(x.src) == bool(x.compare):
        a.error("give exactly one of --in or --compare")
    if x.compare:
        docs = []
        for path in x.compare:
            try:
                with open(path, encoding="utf-8") as f:
                    docs.append(json.load(f))
            except (OSError, ValueError):
                docs.append(None)
        cmp = compare(*docs)
        with open(x.out, "w", encoding="utf-8") as f:
            json.dump(cmp, f, indent=1)
        print("equivalence: %s%s" % (cmp["state"], (" (" + ", ".join(cmp["codes"]) + ")") if cmp["codes"] else ""))
        return 0 if cmp["state"] == "MATCHED" else 1
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
