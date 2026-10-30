#!/usr/bin/env python3
"""Mutation controls for the offline proof (proof v2): each control breaks one harness correction in a TEMP COPY of the vendored module
(the pinned harness bytes are never touched) and requires the focused proof tests to fail. An unmutated baseline copy must pass, and a
mutation whose anchor does not occur exactly once is refused instead of reported as caught.
Output: {control-id: {"fail": failing tests, "tests": tests run}} -- the --mutations input of offline_proof.py.
Usage: harness_mutation_controls.py --out neg-controls.json   (run from the package root: tools/cloud-test)"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FOCUS = ("harness/draft-adapters/focus-oracle.cjs", "FOCUS_ORACLE", "tests/node/focus-oracle-controls.test.cjs")
POLICY = ("harness/draft-adapters/coaching-failure-policy.cjs", "COACHING_FAILURE_POLICY", "tests/node/coaching-failure-policy-controls.test.cjs")

# control id -> (target, exact anchor, replacement). Ids keep the original M01-M11 numbering per correction.
CONTROLS = {
    "M01-allowlist-removed": (POLICY, "ERROR_CODE_ALLOWLIST.has(normalizeCode(rawCode))?", "true?"),
    "M02-sampler-no-marker-count": (FOCUS, "o.multiMarker.filter(m=>Array.isArray(m)&&Number.isInteger(m[1])&&m[1]>1)", "[]"),
    "M03-duplicates-ignored": (FOCUS, "else if(duplicates.length>0){result='FAIL';basis='duplicate-marker';}", ""),
    "M04-contradictions-ignored": (FOCUS, "else if(con.kinds.length>0){result='NOT RUN';basis='contradictory-state';}", ""),
    "M05-latency-fallback": (POLICY, "respondedAt>=startedAt?Math.round(respondedAt-startedAt):null;",
                             "respondedAt>=startedAt?Math.round(respondedAt-startedAt):(Number.isFinite(browserTimingMs)?Math.round(browserTimingMs):0);"),
}
SUMMARY = re.compile(r"^# (tests|fail) (\d+)$", re.M)


def run(target, source_text):
    """Run the target's focused tests against a temp copy holding source_text; return (tests, failing)."""
    rel, env_name, test_file = target
    with tempfile.TemporaryDirectory(prefix="ct-mutation-") as d:
        copy = os.path.join(d, os.path.basename(rel))
        with open(copy, "w", encoding="utf-8") as f:
            f.write(source_text)
        r = subprocess.run(["node", "--test", "--test-reporter=tap", os.path.join(ROOT, test_file)], capture_output=True, text=True,
                           cwd=ROOT, env={"PATH": os.environ["PATH"], env_name: copy})
    counts = {k: int(v) for k, v in SUMMARY.findall(r.stdout)}
    if "tests" not in counts or "fail" not in counts:
        raise RuntimeError("no TAP summary from %s" % test_file)
    return counts["tests"], counts["fail"]


def evaluate(controls=CONTROLS):
    out, refusals, baselines = {}, [], {}
    for cid, (target, anchor, replacement) in controls.items():
        with open(os.path.join(ROOT, target[0]), encoding="utf-8") as f:
            original = f.read()
        if target not in baselines:
            tests, failing = run(target, original)
            baselines[target] = (tests, failing)
            if not tests or failing:
                refusals.append("baseline %s: %d of %d tests fail unmutated" % (target[2], failing, tests))
        if original.count(anchor) != 1:
            refusals.append("%s: anchor occurs %d times, not exactly once" % (cid, original.count(anchor)))
            continue
        tests, failing = run(target, original.replace(anchor, replacement, 1))
        out[cid] = {"fail": failing, "tests": tests}
    return out, refusals


def main():
    sys.path.insert(0, HERE)
    import _netguard  # noqa: F401  (offline control plane; executable path only)
    a = argparse.ArgumentParser()
    a.add_argument("--out", required=True)
    x = a.parse_args()
    out, refusals = evaluate()
    with open(x.out, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    for cid, v in out.items():
        print(("CAUGHT " if v["fail"] > 0 else "MISSED ") + cid, "%d/%d tests fail" % (v["fail"], v["tests"]))
    for r in refusals:
        print("REFUSED", r)
    return 0 if out and not refusals and all(v["fail"] > 0 for v in out.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
