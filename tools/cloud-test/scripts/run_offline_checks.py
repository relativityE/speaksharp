#!/usr/bin/env python3
"""Runs every offline check of the package and writes offline-checks.json (consumed by gate G10). No network, no secrets.
Checks (current run only, never N/A): package tests (including the integration proof on loopback when its prerequisites exist; the GitHub job requires
them via CT_REQUIRE_INTEGRATION=1), report-builder tests, the reservation ledger, the additive catalog history, the vendored harness verified against the
approved hashes, the assertion catalog derived from the harness contract, config/workflow consistency and the offline proof the workflow supplies (CT_PROOF_FILE).
Usage: run_offline_checks.py --out offline-checks.json   (run from the package root: tools/cloud-test)"""
import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _common import ROOT, load, dump, now_utc  # noqa: E402

# Current-run checks only (PO 2026-10-30, Sam 1793400946): this suite needs no retained campaign history and none of its checks is ever
# N/A. The audits of the retained campaigns (history index, sealed receipts, case costs, catalog rows of the compared runs) run only in
# scripts/run_legacy_audit.py, which never earns current-execution credit.
CHECKS = ("package-unit-tests", "report-builder-tests", "reservation-ledger-verified", "catalog-history-additive", "harness-verified",
          "assertion-catalog-matches-harness", "config-matches-workflow", "offline-proof-index")
# The harness corrections an offline proof must cover, exactly (Sam 1793379188); held equal to offline_proof.py's CORR by test.
PROOF_CORRECTIONS = ("diagnostic-codes", "duplicate-markers", "contradictory-observations", "request-latency", "failure-path-evidence",
                     "effective-speech-stimulus", "selected-case-execution", "run-identity-binding", "outcome-classes")


def proof_problem(proof, pinned):
    """None when the proof binds the pinned harness and passes every expected correction exactly once; else the reason."""
    if not isinstance(proof, dict) or proof.get("result") != "PASS":
        return "proof result is not PASS"
    if proof.get("codeManifestSha256") != pinned:
        return "hash DIFFERS from the pinned harness"
    rows = proof.get("corrections")
    if not isinstance(rows, list) or not all(isinstance(r, dict) and isinstance(r.get("id"), str) for r in rows):
        return "a correction row is anonymous or malformed"
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        return "duplicate correction ids: %s" % sorted({i for i in ids if ids.count(i) > 1})
    if set(ids) != set(PROOF_CORRECTIONS):
        return "correction ids differ: missing %s, unknown %s" % (sorted(set(PROOF_CORRECTIONS) - set(ids)), sorted(set(ids) - set(PROOF_CORRECTIONS)))
    for r in rows:
        tests, controls = r.get("tests"), r.get("mutationControls")
        if r.get("result") != "PASS" or not isinstance(tests, list) or not tests or not isinstance(controls, list):
            return "correction %s is not a complete PASS row" % r["id"]
        if not all(isinstance(t, dict) and t.get("result") == "PASS" for t in tests):
            return "correction %s has a test that did not pass" % r["id"]
        if not all(isinstance(m, dict) and m.get("caught") is True for m in controls):
            return "correction %s has a mutation control that was not caught" % r["id"]
    return None


# ---------- Structured per-test results (Sam 1793406369, 1793406609, 1793406980) ----------
# Each suite runs in its existing child process through unittest's own discovery and text runner, so the job log and the count line
# are unittest's. The result class additionally keeps one record per test id from the result callbacks, never from text.
SUITE_DIRS = {"package-unit-tests": ("tests",), "report-builder-tests": ("report", "tests")}


class RecordingResult(unittest.TextTestResult):
    """unittest's text result plus, per test id: start and stop counts, the test's own outcomes and each subtest's outcome. Class and
    module fixture events (setUpClass, setUpModule) are kept apart: they credit no method. Callback counts are counted here, independently
    of unittest's lists, so the summary can hold them against the printed count line."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.records, self.fixtures = {}, []
        self.callbacks = {"ran": 0, "failures": 0, "errors": 0, "skipped": 0, "expected failures": 0, "unexpected successes": 0}

    def _record(self, test):
        return self.records.setdefault(test.id(), {"id": test.id(), "starts": 0, "stops": 0, "outcomes": [], "subtests": []})

    def _outcome(self, test, outcome, count):
        if count:
            self.callbacks[count] += 1
        if isinstance(test, unittest.case._SubTest):
            self._record(test.test_case)["subtests"].append(outcome)
        elif isinstance(test, unittest.suite._ErrorHolder):
            self.fixtures.append({"description": test.description, "outcome": outcome})
        else:
            self._record(test)["outcomes"].append(outcome)

    def startTest(self, test):
        super().startTest(test)
        self.callbacks["ran"] += 1
        self._record(test)["starts"] += 1

    def stopTest(self, test):
        super().stopTest(test)
        self._record(test)["stops"] += 1

    def addSuccess(self, test):
        super().addSuccess(test)
        self._outcome(test, "success", None)

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._outcome(test, "failure", "failures")

    def addError(self, test, err):
        super().addError(test, err)
        self._outcome(test, "error", "errors")

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self._outcome(test, "skipped", "skipped")

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self._outcome(test, "expectedFailure", "expected failures")

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self._outcome(test, "unexpectedSuccess", "unexpected successes")

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err is None:
            self._outcome(subtest, "success", None)
        elif issubclass(err[0], test.failureException):
            self._outcome(subtest, "failure", "failures")
        else:
            self._outcome(subtest, "error", "errors")


class RecordingRunner(unittest.TextTestRunner):
    resultclass = RecordingResult


def suite_child(start, results_path):
    """The child side of a suite check: exactly `python -m unittest discover -s START -p test_*.py` (same output, same exit codes), plus the
    structured records written to RESULTS. A results file that cannot be written fails the check."""
    program = unittest.main(module=None, argv=["python -m unittest", "discover", "-s", start, "-p", "test_*.py"], testRunner=RecordingRunner, exit=False)
    result = program.result
    try:
        dump({"schema": "speaksharp.cloud-test.suite-results.v1", "tests": list(result.records.values()), "fixtures": result.fixtures,
              "callbackCounts": result.callbacks}, results_path)
    except (OSError, TypeError, ValueError) as error:
        print("SUITE_RESULTS_WRITE_FAILED: " + type(error).__name__, file=sys.stderr)
        return 1
    if result.testsRun == 0 and not result.skipped:
        return 5
    return 0 if result.wasSuccessful() else 1


def suite_check(name, env):
    """A unittest suite in its own child, with its structured records attached (None when the child wrote none or wrote it malformed)."""
    with tempfile.TemporaryDirectory(prefix="ct-suite-") as d:
        path = os.path.join(d, "results.json")
        check = command_check(name, [sys.executable, "-I", "-W", "ignore::ResourceWarning", os.path.abspath(__file__), "--suite-child", os.path.join(ROOT, *SUITE_DIRS[name]),
                                     "--results", path], env)
        try:
            check["results"] = load(path)
        except (OSError, ValueError):
            check["results"] = None
    return check


# ---------- Identity of what was tested (Sam 1793406369, 1793406980, 1793407393) ----------
# The reviewed file set is hashed from the checkout's bytes; nothing is taken from a passed SHA. Excluded trees are pruned by path before descent and
# never entered; a symlink inside the included tree is never followed and makes the identity INCOMPLETE. Unexpected files are counted by category only.
SOURCE_SUFFIXES = (".py", ".sh", ".js", ".cjs", ".mjs", ".ts", ".yml", ".yaml")
MUTATION_OVERRIDES = ("FOCUS_ORACLE", "PRESENTATION_CONTROLS", "COACHING_FAILURE_POLICY", "CT_PROOF_PACKET", "CT_PROOF_CASES_DIR")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


SPEC_PATH, PACKET_PATH = "config/equivalence-file-set.v1.json", "harness/PACKET-MANIFEST.sha256"


def _linked(rel):
    """True when the path or any of its directory components is a symlink (lstat only; nothing is followed)."""
    parts = rel.split("/")
    return any(os.path.islink(os.path.join(ROOT, *parts[:i])) for i in range(1, len(parts) + 1))


def _regular(rel):
    """True when the path is a regular file reached through no symlink (Sam 1793410354: preflight before any content read)."""
    try:
        return not _linked(rel) and stat.S_ISREG(os.lstat(os.path.join(ROOT, rel)).st_mode)
    except OSError:
        return False


def harness_paths():
    """The harness files the verified PACKET manifest names, plus the manifest itself (package-relative). Read only after the manifest's preflight."""
    names = [PACKET_PATH]
    with open(os.path.join(ROOT, PACKET_PATH), encoding="utf-8") as f:
        names += ["harness/" + line.split(None, 1)[1].strip().lstrip("*") for line in f if line.strip()]
    return set(names)


def _incomplete(codes, symlinks=0, missing=(), scan_errors=0):
    return {"status": "INCOMPLETE", "codes": sorted(set(codes)), "files": [], "missing": sorted(missing), "symlinks": symlinks, "unexpected": {},
            "scanErrors": scan_errors}


def file_set_identity():
    # Both manifests are preflighted before either is read: a linked or non-regular spec or PACKET manifest makes the identity INCOMPLETE without
    # reading its content, so a link to matching bytes can never stand in for the reviewed file (Sam 1793410354).
    for rel in (SPEC_PATH, PACKET_PATH):
        if _linked(rel):
            return _incomplete(["SYMLINK"], symlinks=1)
        if not _regular(rel):
            return _incomplete(["MISSING"], missing=[rel])
    spec = load(os.path.join(ROOT, SPEC_PATH))
    listed, excluded = list(spec["paths"]), spec["excluded"]
    harness = harness_paths()
    files, missing, symlinks, unexpected, scan_errors = [], [], 0, {}, 0
    # Every included file (listed paths and named harness files alike) is preflighted with lstat on itself and each directory component before any
    # content is read; only the listed paths are hashed here (the harness enters through the verified pins).
    for rel in sorted(set(listed) | harness):
        if _linked(rel):
            symlinks += 1
        elif not _regular(rel):
            missing.append(rel)
        elif rel in listed:
            try:
                files.append([rel, sha256_file(os.path.join(ROOT, rel))])
            except OSError:
                scan_errors += 1
    known = set(listed) | harness

    def scan_error(_error):
        nonlocal scan_errors
        scan_errors += 1

    for dirpath, dirnames, filenames in os.walk(ROOT, followlinks=False, onerror=scan_error):
        reldir = os.path.relpath(dirpath, ROOT).replace(os.sep, "/")
        reldir = "" if reldir == "." else reldir + "/"
        # Prune before descent: excluded trees are never entered, inspected or published.
        dirnames[:] = sorted(d for d in dirnames if d not in excluded["dirNamesAnywhere"] and reldir + d not in excluded["dirs"])
        for d in dirnames:
            if os.path.islink(os.path.join(dirpath, d)):
                symlinks += 1
        for name in filenames:
            rel = reldir + name
            if rel in excluded["files"] or name.endswith(tuple(excluded["fileSuffixes"])):
                continue
            full = os.path.join(dirpath, name)
            if os.path.islink(full):
                if rel not in known:      # a linked included file is already counted by the preflight
                    symlinks += 1
                continue
            if rel in known:
                continue
            category = "source" if name.endswith(SOURCE_SUFFIXES) or os.access(full, os.X_OK) else "config" if name.endswith(".json") else "other"
            unexpected[category] = unexpected.get(category, 0) + 1
    codes = (["MISSING"] if missing else []) + (["SCAN_ERROR"] if scan_errors else []) + (["SYMLINK"] if symlinks else []) + (["UNEXPECTED"] if unexpected else [])
    return {"status": "INCOMPLETE" if codes else "COMPLETE", "codes": codes, "files": files, "missing": missing, "symlinks": symlinks,
            "unexpected": unexpected, "scanErrors": scan_errors}


def repo_root():
    return os.environ.get("CT_TEST_REPO") or os.path.abspath(os.path.join(ROOT, "..", ".."))


def external_input(name, env_name, default):
    """One external test input: where it came from (env or default), its repository-relative location and its sha256; UNKNOWN when unreadable.
    An absolute or out-of-repository location is never published."""
    value = os.environ.get(env_name) if env_name else None
    path = value or default
    if not path:
        return {"name": name, "source": "unset", "path": None, "sha256": None, "state": "UNKNOWN"}
    rel = os.path.relpath(os.path.abspath(path), repo_root()).replace(os.sep, "/")
    try:
        sha, state = sha256_file(path), "BOUND"
    except OSError:
        sha, state = None, "UNKNOWN"
    return {"name": name, "source": "env" if value else "default", "path": "outside-repo" if rel == ".." or rel.startswith("../") else rel,
            "sha256": sha, "state": state}


def external_inputs():
    repo = repo_root()
    rwt = os.path.join(repo, "tests", "fixtures", "rwt")
    pdfjs = os.environ.get("CT_EXISTING_PDFJS_DIR")
    inputs = [external_input("cloud-test-yml", "CLOUD_TEST_YML", os.path.join(ROOT, "tests", "fixtures", "cloud-test.yml")),
              external_input("github-workflow-cloud-test", None, os.path.join(repo, ".github", "workflows", "cloud-test.yml")),
              external_input("rc-gates-yml", "RC_GATES_YML", os.path.join(repo, ".github", "workflows", "rc-gates.yml")),
              external_input("checkout-lock", None, os.path.join(repo, "pnpm-lock.yaml"))]
    inputs += [external_input("speech-" + n, None, os.path.join(rwt, n)) for n in
               ("open_mic_tts.wav", "focus_points_tts.wav", "focus_points_partial_tts.wav", "rwt-fixtures.manifest.json")]
    inputs.append(external_input("chrome", "CT_CHROME", None))
    pdf = os.path.join(pdfjs or os.path.join(ROOT, "runner", "node_modules", "pdfjs-dist"), "legacy", "build", "pdf.mjs")
    inputs.append(dict(external_input("pdfjs-pdf-mjs", None, pdf), source="env" if pdfjs else "default"))
    inputs.append({"name": "test-repo", "source": "env" if os.environ.get("CT_TEST_REPO") else "default", "path": None, "sha256": None, "state": "DECLARED"})
    inputs += [{"name": "override-" + n.lower(), "source": "env" if os.environ.get(n) else "unset", "path": None, "sha256": None,
                "state": "UNKNOWN" if os.environ.get(n) else "UNSET"} for n in MUTATION_OVERRIDES]
    return inputs


def environment():
    """Declared environment (listed when two runs differ; never part of the result digest). Pins stay enforced by their own checks."""
    def version(cmd):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
            return r.stdout.strip().lstrip("v") if r.returncode == 0 else None
        except (OSError, subprocess.SubprocessError):
            return None
    try:
        import yaml
        pyyaml = getattr(yaml, "__version__", None)
    except ImportError:
        pyyaml = None
    pdfjs_pkg = os.path.join(os.environ.get("CT_EXISTING_PDFJS_DIR") or os.path.join(ROOT, "runner", "node_modules", "pdfjs-dist"), "package.json")
    try:
        pdfjs = load(pdfjs_pkg).get("version")
    except (OSError, ValueError, AttributeError):
        pdfjs = None
    return {"python": platform.python_version(), "implementation": platform.python_implementation(), "system": platform.system(),
            "machine": platform.machine(), "pyyaml": pyyaml, "node": version(["node", "--version"]), "pdfjs": pdfjs}


def git_diagnostic():
    """Whole-repository tree and package cleanliness: diagnostic only, never required for a match (Sam 1793406369 point 2); null without git."""
    def git(*args):
        r = subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True, timeout=30)
        return r.stdout.strip() if r.returncode == 0 else None
    try:
        tree = git("rev-parse", "HEAD^{tree}")
        status = git("status", "--porcelain", "--untracked-files=all", "--", ".")
    except (OSError, subprocess.SubprocessError):
        return {"headTree": None, "packageClean": None}
    return {"headTree": tree if tree and re.fullmatch(r"[0-9a-f]{40}", tree) else None, "packageClean": None if status is None else status == ""}


def identity(checks, cfg):
    harness = next((c for c in checks if c["id"] == "harness-verified"), {})
    # The pins enter the identity only from a PASSING harness-verified check, which verified the 233 harness files against them.
    pinned = cfg.get("harness") or {}
    pins = ({"code": pinned.get("expectedCodeManifestSha256"), "packet": pinned.get("expectedPacketManifestSha256")}
            if harness.get("passed") is True else {"code": None, "packet": None})
    try:
        file_set = file_set_identity()
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        file_set = _incomplete(["FILE_SET_UNREADABLE"])
    return {"fileSet": file_set, "pins": pins, "externalInputs": external_inputs(), "environment": environment(), "git": git_diagnostic()}


def command_check(name, cmd, env):
    """Keep actual child outcomes, including output needed to diagnose a failed run."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT, env=env)
        return {"id": name, "passed": r.returncode == 0, "returncode": r.returncode,
                "stdout": r.stdout, "stderr": r.stderr,
                "detail": " ".join((r.stdout + r.stderr).split())[:160]}
    except OSError as error:
        return {"id": name, "passed": False, "returncode": None,
                "stdout": "", "stderr": "", "detail": "%s: %s" % (type(error).__name__, error)}


def input_check(name, evaluate):
    try:
        passed, detail = evaluate()
        return {"id": name, "passed": bool(passed), "detail": detail}
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        return {"id": name, "passed": False, "detail": "%s: %s" % (type(error).__name__, error)}


def catalog_history_additive():
    """The catalog snapshots only ever add rows and the current catalog is the configured version's snapshot. Run in-process with NO index:
    verify_catalog_history.py's command line loads the retained campaign index whenever one exists, and that index belongs to the legacy audit."""
    import verify_catalog_history as VC
    cfg = load(os.path.join(ROOT, "config", "test-config.v1.json"))
    errs = VC.verify(VC.load_snapshots(os.path.join(ROOT, "config", "history", "catalogs")), load(os.path.join(ROOT, "config", "assertion-catalog.json")),
                     cfg["modes"]["full"]["assertionCatalog"]["version"], None)
    return not errs, "; ".join(errs) or "catalog history additive only (snapshots and current version; no campaign index read)"


def catalog_matches_harness():
    """The tracked assertion catalog equals the one derived from the hash-verified harness contract alone (no compared runs)."""
    import derive_assertion_catalog as CAT
    with tempfile.TemporaryDirectory(prefix="ct-catalog-") as d:
        os.makedirs(os.path.join(d, "harness", "draft-adapters"))
        os.makedirs(os.path.join(d, "config"))
        shutil.copyfile(os.path.join(ROOT, "harness", "draft-adapters", "contracts.json"), os.path.join(d, "harness", "draft-adapters", "contracts.json"))
        dump({"history": {"comparisonBaselines": []}}, os.path.join(d, "config", "test-config.v1.json"))
        out, errs = CAT.derive(d)
    if errs:
        return False, "; ".join(errs)
    with open(os.path.join(ROOT, "config", "assertion-catalog.json"), encoding="utf-8") as f:
        same = f.read() == json.dumps(out, indent=1) + "\n"
    return same, "%d assertions from the harness contract%s" % (out["totalAssertions"], "" if same else "; the tracked catalog differs")


def main():
    if "--suite-child" in sys.argv[1:]:
        c = argparse.ArgumentParser()
        c.add_argument("--suite-child", required=True)
        c.add_argument("--results", required=True)
        y = c.parse_args()
        return suite_child(y.suite_child, y.results)
    a = argparse.ArgumentParser()
    a.add_argument("--out", required=True)
    x = a.parse_args()
    if os.environ.get("CT_HISTORY"):
        print("OFFLINE_CHECKS_REFUSED: CT_HISTORY is retired for the current suite, which needs no retained history; the retained campaigns are "
              "audited by scripts/run_legacy_audit.py", file=sys.stderr)
        return 2
    # The offline proof is the file the workflow supplies through CT_PROOF_FILE: its freshness is the workflow's (a fresh-directory generator writing
    # that exact path earlier in the same job, Sam 1793405248); this runner only reports the source it was given and never substitutes a retained file.
    proof_file = os.environ.get("CT_PROOF_FILE") or None
    checks = []
    env = {**os.environ}
    for name in SUITE_DIRS:
        checks.append(suite_check(name, env))
    checks.append(command_check("reservation-ledger-verified", [sys.executable, "-I", os.path.join(HERE, "reservations.py"), "verify"], env))
    checks.append(input_check("catalog-history-additive", catalog_history_additive))
    checks.append(command_check("harness-verified", [sys.executable, "-I", os.path.join(HERE, "verify_harness.py"), "--config", os.path.join(ROOT, "config", "test-config.v1.json")], env))
    checks.append(input_check("assertion-catalog-matches-harness", catalog_matches_harness))

    cfg, wf = {}, {}

    def versions():
        nonlocal cfg, wf
        cfg = load(os.path.join(ROOT, "config", "test-config.v1.json"))
        wf = load(os.path.join(ROOT, "workflow.json"))
        return cfg["workflowVersion"] == wf["version"], "config %s workflow %s" % (cfg["workflowVersion"], wf["version"])

    def proof_index():
        # The proof must bind the harness the config pins (Sam 1793378783); a retained proof file is never substituted.
        pinned = cfg["harness"]["expectedCodeManifestSha256"]
        if not isinstance(pinned, str) or not re.fullmatch(r"[0-9a-f]{64}", pinned):
            return False, "the pinned harness manifest is not a sha256"
        if not proof_file:
            return False, "no offline proof was supplied (CT_PROOF_FILE is not set)"
        problem = proof_problem(load(proof_file), pinned)
        return problem is None, "CT_PROOF_FILE proof: %s" % (problem or "all %d corrections PASS; hash matches config" % len(PROOF_CORRECTIONS))

    checks.append(input_check("config-matches-workflow", versions))
    checks.append(input_check("offline-proof-index", proof_index))
    out = {"schema": "speaksharp.cloud-test.offline-checks.v3", "ranUtc": now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"), "workflowVersion": wf.get("version") if isinstance(wf, dict) else None,
           "proofSource": "ct-proof-file" if proof_file else None,
           "checks": checks, "passed": all(c["passed"] is True for c in checks)}
    # What was tested, for the equivalence comparison of two environments; the summary validates it and recomputes every digest.
    out["identity"] = identity(checks, cfg if isinstance(cfg, dict) else {})
    # The job log of this public repository shows only check names and statuses; child output and details stay in the
    # written report on the runner. A report that cannot be written is a failure, and its diagnostics are not printed.
    written = True
    try:
        dump(out, x.out)
    except (OSError, TypeError, ValueError) as error:
        out["passed"], written = False, False
        print("OFFLINE_CHECKS_REPORT_WRITE_FAILED: " + type(error).__name__, file=sys.stderr)
    for c in checks:
        print(("PASS " if c["passed"] is True else "FAIL ") + c["id"])
    return 0 if written and out["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
