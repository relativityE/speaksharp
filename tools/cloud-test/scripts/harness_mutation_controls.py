#!/usr/bin/env python3
"""Mutation controls for the offline proof. Each control breaks one harness correction in a TEMP COPY (the pinned harness bytes are never
written) and must turn the correction's OWN tests red (Sam 1793383008): a control counts as caught only when at least one of its named tests
fails, the mutated run has the same test count as the unmutated baseline (so the module still loaded) and that baseline passes. An anchor
that does not occur exactly once is refused, never reported as caught.

Primary controls M01-M11 are the reviewed originals from the harness proof workspace (neg_controls_r15.py, ported with their exact
anchors): they mutate a copy of the whole packet and run the ported r15 proof tests plus the copy's presentation-controls test. Additional
controls (prefix A-) exercise single vendored modules with the package's focused FO/FS/CF tests; the proof's CORR never counts them.
Output: {control-id: {"fail": named tests that failed, "failedTests": [...], "tests": tests run}} -- the --mutations input of offline_proof.py.
Usage: harness_mutation_controls.py --cases-dir PLACEHOLDER_CASES_PARENT --out neg-controls.json [--additional-only]"""
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
HARNESS = os.path.join(ROOT, "harness")
PROOF_TESTS = ("tests/node/proof/harness-fixes-r15.offline.test.cjs",)

# Primary: control id -> ([(packet-relative file, exact anchor, replacement), ...], test-title prefixes the control must kill).
PACKET = {
    "M01-allowlist-removed": ([("draft-adapters/coaching-failure-policy.cjs",
                                "ERROR_CODE_ALLOWLIST.has(normalizeCode(rawCode))?'code-'+normalizeCode(rawCode):'code-unlisted'", "'code-'+normalizeCode(rawCode)")], ("D1 ",)),
    "M02-sampler-no-marker-count": ([("draft-adapters/presentation-controls.cjs", "if(marks>1&&s.multi.length<20)s.multi.push([Date.now()-s.t0,marks]);", "")], ("F4 ",)),
    "M03-duplicates-ignored": ([("draft-adapters/focus-oracle.cjs", "else if(duplicates.length>0){result='FAIL';basis='duplicate-marker';}", "")], ("F1 ",)),
    "M04-contradictions-ignored": ([("draft-adapters/focus-oracle.cjs", "else if(con.kinds.length>0){result='NOT RUN';basis='contradictory-state';}", "")], ("F2 ", "F3 ")),
    "M05-latency-fallback": ([("draft-adapters/coaching-failure-policy.cjs",
                               "const event=Number.isFinite(startedAt)&&Number.isFinite(respondedAt)&&respondedAt>=startedAt?Math.round(respondedAt-startedAt):null;",
                               "const event=Number.isFinite(startedAt)&&Number.isFinite(respondedAt)&&respondedAt>=startedAt?Math.round(respondedAt-startedAt):Date.now()%1000;")], ("D2 ", "D3 ")),
    "M06-live-rows-after-stop": ([("draft-adapters/source-adapters.cjs",
                                   "if(focus)await emitPresentation(livePresentation,{'focus-next-point-marked':liveDiagRefs});const firstStoppedAt=Date.now();await ui.stop(page);const first=await ui.saved(page);",
                                   "const firstStoppedAt=Date.now();await ui.stop(page);const first=await ui.saved(page);if(focus)await emitPresentation(livePresentation,{'focus-next-point-marked':liveDiagRefs});")], ("E1 ", "E2 ")),
    "M07-selection-ignored": ([("bundle/harness/campaign-core.cjs", "  for(const id of order){", "  for(const id of IDS){")], ("S1 ", "S3 ", "S6 ")),
    "M08-gates-ignored": ([("bundle/harness/campaign-core.cjs", "const gate=(plan.gates||[]).find(g=>g.caseId===id);", "const gate=null;")], ("S4 ", "S5 ")),
    "M09-run-identity-noop": ([("bundle/harness/campaign-runner.cjs", "if(r.runner.codeManifestSha256!==codeSha)throw", "if(false)throw")], ("I1 ", "I2 ", "I3 ")),
    "M10-receipt-denial-unchecked": ([("bundle/harness/stimulus-receipt.cjs", "if(denialCases.includes(id)&&c.ungrantedOutcome!=='not-allowed')", "if(false)")], ("P1 ", "S4 ")),
    "M11-identity-cap-not-scaled": ([("bundle/harness/campaign-core.cjs", "p.identityCap<requiredIdentityCap(nSelected)", "p.identityCap<requiredIdentityCap(15)")], ("S2 ", "S3 ")),
}
# Additional: single-module controls with the package's focused tests (module, env var, test file) -> anchors and named kills.
FOCUS = ("draft-adapters/focus-oracle.cjs", "FOCUS_ORACLE", "tests/node/focus-oracle-controls.test.cjs")
SAMPLER = ("draft-adapters/presentation-controls.cjs", "PRESENTATION_CONTROLS", "tests/node/focus-sampler-controls.test.cjs")
POLICY = ("draft-adapters/coaching-failure-policy.cjs", "COACHING_FAILURE_POLICY", "tests/node/coaching-failure-policy-controls.test.cjs")
ADDITIONAL = {
    "A-allowlist-removed": (POLICY, [("ERROR_CODE_ALLOWLIST.has(normalizeCode(rawCode))?", "true?")], ("CF2 ",)),
    "A-sampler-no-marker-count": (SAMPLER, [("if(marks>1&&s.multi.length<20)s.multi.push([Date.now()-s.t0,marks]);", "")], ("FS1 ",)),
    "A-duplicates-ignored": (FOCUS, [("else if(duplicates.length>0){result='FAIL';basis='duplicate-marker';}", "")], ("FO1 ",)),
    "A-contradictions-ignored": (FOCUS, [("else if(con.kinds.length>0){result='NOT RUN';basis='contradictory-state';}", "")], ("FO4 ", "FO6 ")),
    # Precedence: contradiction handling moved ahead of the wrong-marker and duplicate checks must hide a real defect, so FO5 fails.
    "A-contradiction-precedence-inverted": (FOCUS, [(
        "    if(wrong.length>0){result='FAIL';basis='marker-wrong';}\n    else if(duplicates.length>0){result='FAIL';basis='duplicate-marker';}\n    else if(con.kinds.length>0){result='NOT RUN';basis='contradictory-state';}\n",
        "    if(con.kinds.length>0){result='NOT RUN';basis='contradictory-state';}\n    else if(wrong.length>0){result='FAIL';basis='marker-wrong';}\n    else if(duplicates.length>0){result='FAIL';basis='duplicate-marker';}\n")], ("FO5 ",)),
    "A-latency-fallback": (POLICY, [("respondedAt>=startedAt?Math.round(respondedAt-startedAt):null;",
                                     "respondedAt>=startedAt?Math.round(respondedAt-startedAt):(Number.isFinite(browserTimingMs)?Math.round(browserTimingMs):0);")], ("LT2 ",)),
}
TEST_LINE = re.compile(r"^(not )?ok \d+ - (.*?)(?:\s+#\s*(SKIP|TODO)\b.*)?$", re.I)
SUMMARY_LINE = re.compile(r"^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$")


class TapError(Exception):
    """The run produced no trustworthy TAP: a crash, a bail-out or a missing/malformed summary. Never a kill."""


def parse_tap(stdout, returncode):
    """Top-level TAP results with status and failure kind (Sam 1793384458): PASS, FAIL, SKIP or TODO per title, and whether a FAIL is an
    assertion failure (code ERR_ASSERTION) rather than a runtime exception or load error. Raises TapError when the run cannot be judged."""
    tests, summary, current = [], {}, None
    for line in stdout.splitlines():
        if line.startswith("Bail out!"):
            raise TapError("bail-out")
        m = TEST_LINE.match(line)
        if m:
            status = m.group(3).upper() if m.group(3) else ("FAIL" if m.group(1) else "PASS")
            current = {"title": m.group(2), "status": status, "assertion": False}
            tests.append(current)
            continue
        s = SUMMARY_LINE.match(line)
        if s:
            if s.group(1) in summary:
                raise TapError("malformed summary: %s repeated" % s.group(1))
            summary[s.group(1)] = int(s.group(2))
            continue
        if current is not None and line.startswith("  ") and re.match(r"^\s+code: 'ERR_ASSERTION'$", line):
            current["assertion"] = True
    if not {"tests", "pass", "fail"} <= set(summary):
        raise TapError("missing or malformed summary")
    if summary["tests"] != len(tests) or summary["fail"] != sum(t["status"] == "FAIL" for t in tests):
        raise TapError("summary does not match the reported tests")
    if (summary["fail"] > 0) != (returncode != 0):
        raise TapError("process status %d disagrees with the TAP summary" % returncode)
    titles = [t["title"] for t in tests]
    if len(titles) != len(set(titles)):
        raise TapError("duplicate test titles")
    return tests


def tap(args, env):
    r = subprocess.run(["node", "--test", "--test-concurrency=1", "--test-reporter=tap", *args], capture_output=True, text=True, cwd=ROOT,
                       env={"PATH": os.environ["PATH"], "HOME": tempfile.gettempdir(), **env})
    return parse_tap(r.stdout, r.returncode)


def judge(baseline, mutated, kills):
    """A kill is a NAMED test that fails with an assertion, in a run whose exact title inventory equals the clean baseline's."""
    if not baseline or any(t["status"] != "PASS" for t in baseline):
        raise TapError("baseline is not a clean pass")
    if [t["title"] for t in mutated] != [t["title"] for t in baseline]:
        return {"fail": 0, "failedTests": [], "tests": len(mutated), "reason": "test inventory changed"}
    named = [t["title"] for t in mutated if t["title"].startswith(kills) and t["status"] == "FAIL" and t["assertion"]]
    other = [t["title"] for t in mutated if t["title"].startswith(kills) and t["status"] != "PASS" and t["title"] not in named]
    return {"fail": len(named), "failedTests": [x[:120] for x in named][:6], "tests": len(mutated),
            **({"reason": "named tests failed without an assertion or were skipped/todo"} if other and not named else {})}


def apply(root, rel, edits):
    path = os.path.join(root, rel)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    for anchor, replacement in edits:
        if text.count(anchor) != 1:
            return "anchor occurs %d times in %s, not exactly once" % (text.count(anchor), rel)
        text = text.replace(anchor, replacement, 1)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return None


def evaluate_packet(cases_dir, controls=PACKET, harness=HARNESS):
    out, refusals = {}, []
    with tempfile.TemporaryDirectory(prefix="ct-mutation-packet-") as d:
        base_copy = os.path.join(d, "base")
        shutil.copytree(harness, base_copy, symlinks=True)
        run_args = lambda packet: ([os.path.join(ROOT, t) for t in PROOF_TESTS] + [os.path.join(packet, "draft-adapters", "tests", "presentation-controls.offline.test.cjs")],
                                   {"CT_PROOF_PACKET": packet, "CT_PROOF_CASES_DIR": cases_dir})
        try:
            baseline = tap(*run_args(base_copy))
        except TapError as e:
            return {}, ["baseline: %s" % e]
        for cid, (edits, kills) in controls.items():
            copy = os.path.join(d, cid)
            shutil.copytree(harness, copy, symlinks=True)
            problems = [p for p in (apply(copy, rel, [(a, r)]) for rel, a, r in edits) if p]
            if problems:
                refusals.append("%s: %s" % (cid, problems[0]))
                continue
            try:
                out[cid] = judge(baseline, tap(*run_args(copy)), kills)
            except TapError as e:
                refusals.append("%s: %s" % (cid, e))
            shutil.rmtree(copy)
    return out, refusals


def evaluate_additional(controls=ADDITIONAL, harness=HARNESS):
    out, refusals, baselines = {}, [], {}
    for cid, (target, edits, kills) in controls.items():
        rel, env_name, test_file = target
        with tempfile.TemporaryDirectory(prefix="ct-mutation-") as d:
            copy = os.path.join(d, "draft-adapters")
            shutil.copytree(os.path.join(harness, "draft-adapters"), copy, symlinks=True)
            module = os.path.join(d, rel)
            try:
                if target not in baselines:
                    baselines[target] = tap([os.path.join(ROOT, test_file)], {env_name: module})
                problem = apply(d, rel, edits)
                if problem:
                    refusals.append("%s: %s" % (cid, problem))
                    continue
                out[cid] = judge(baselines[target], tap([os.path.join(ROOT, test_file)], {env_name: module}), kills)
            except TapError as e:
                refusals.append("%s: %s" % (cid, e))
    return out, refusals


def main():
    sys.path.insert(0, HERE)
    import _netguard  # noqa: F401  (offline control plane; executable path only)
    a = argparse.ArgumentParser()
    a.add_argument("--out", required=True)
    a.add_argument("--cases-dir")
    a.add_argument("--additional-only", action="store_true")
    x = a.parse_args()
    if not x.additional_only and not x.cases_dir:
        a.error("--cases-dir (placeholder case configs from proof_prep_cases.py) is required for the primary controls")
    out, refusals = evaluate_additional()
    if not x.additional_only:
        primary, more = evaluate_packet(os.path.abspath(x.cases_dir))
        out.update(primary)
        refusals += more
    with open(x.out, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    for cid, v in out.items():
        print(("CAUGHT " if v["fail"] > 0 else "MISSED ") + cid, "%d named of %d tests" % (v["fail"], v["tests"]))
    for r in refusals:
        print("REFUSED", r)
    return 0 if out and not refusals and all(v["fail"] > 0 for v in out.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
