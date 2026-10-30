"""Shared fixtures. Tests are hermetic: git-dependent tests build synthetic repositories; tests that need the real repository history or the pinned
browser skip unless CT_REQUIRE_INTEGRATION=1 (the GitHub offline job sets it, so a missing prerequisite there is a failure, not a skip)."""
import copy
import datetime
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REPO = os.environ.get("CT_TEST_REPO") or os.path.abspath(os.path.join(ROOT, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
sys.path.insert(0, os.path.join(ROOT, "report"))
REQUIRE = os.environ.get("CT_REQUIRE_INTEGRATION") == "1"
# Owner decision 2026-10-30: a GitHub run may receive NO retained history (sealed receipts, index, bindings, proofs).
# CT_HISTORY=none marks exactly the tests that read those real files NOT APPLICABLE; every other test still runs and gates.
HISTORY_MODE = os.environ.get("CT_HISTORY", "required")
if HISTORY_MODE not in ("required", "none"):
    raise SystemExit("CT_HISTORY must be 'required' or 'none', not %r" % HISTORY_MODE)
NO_HISTORY_REASON = "NOT APPLICABLE: owner decision 2026-10-30, no retained history supplied (CT_HISTORY=none)"


def needs_history(obj):
    """Skip a test or test class that reads the real retained history when CT_HISTORY=none; never otherwise."""
    return unittest.skipIf(HISTORY_MODE == "none", NO_HISTORY_REASON)(obj)
NOW = "2026-10-28T22:00:00Z"
TESTED = "4c85b006ac05e180521fd6e7d807f736987cafe8"
REQUEST_FIXTURES = {
    "R6-aht12-prove-1744.json": "partial-request.json",
    "R7-full-coverage-proposal.json": "full-request.json",
    "R8-nightly-regression-proposal.json": "nightly-request.json",
}


def request_path(name="R6-aht12-prove-1744.json"):
    """An explicitly synthetic unapproved validator input, never a selected live run."""
    return os.path.join(ROOT, "tests", "fixtures", REQUEST_FIXTURES[name])


def wjson(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f)


def J(*p):
    path = request_path(p[2]) if len(p) == 3 and p[:2] == ("config", "runs") and p[2] in REQUEST_FIXTURES else os.path.join(ROOT, *p)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def prerequisite(ok, what):
    """Skip when a prerequisite is missing, unless integration is required (then fail loudly)."""
    if ok:
        return
    if REQUIRE:
        raise AssertionError("integration prerequisite missing: " + what)
    raise unittest.SkipTest("prerequisite missing: " + what)


def sample():
    return dict(req=J("config", "runs", "R6-aht12-prove-1744.json"), cfg=J("config", "test-config.v1.json"), ledger=J("config", "gap-ledger.json"), wf=J("workflow.json"))


def reconciliation():
    import reconcile_cumulative as RC
    from _usage_fixtures import UsageHistory
    s = sample()
    history = UsageHistory(s["cfg"])
    try:
        return RC.reconcile(history.cfg, history.counters, str(history.receipts))
    finally:
        history.close()


def fake_rv(fixes=None, since=None, backend_verified=False, frontend_fresh=True):
    """A hand-made release verification for validator and gate tests that do not need git."""
    base = {"GAP-%02d" % i: {"inclusion": "no-fix-identified", "pr": None, "commit": None} for i in range(1, 7)}
    base["GAP-03"] = {"inclusion": "cloud-verified", "pr": "1744", "commit": "8b2e7de" + "0" * 33, "touchesBackend": False}
    base.update(fixes or {})
    return {"testedSha": TESTED, "lastRunTestedSha": TESTED, "needs": [], "fixes": base, "sinceLastRun": since if since is not None else [], "sinceBaseline": [],
            "backend": {"verified": backend_verified, "source": "owner-stated"}, "frontend": {"fresh": frontend_fresh, "servedSha": TESTED}}


def approved(req, ledger):
    """The proposal with every owner input supplied, as a run would look when ready."""
    r = copy.deepcopy(req)
    l = copy.deepcopy(ledger)
    r["ownerInputs"]["prDocsCloseout"] = {"status": "closed", "evidence": "owner decision record"}
    r["approvedLimits"] = {"cumulativeCeilingRequests": 6700, "identityCap": 98, "runCapRequests": 180, "approvalRef": "owner-approval-1", "approvedBy": "owner"}
    r["window"] = {"startUtc": "2099-01-01T10:00:00Z", "endUtc": "2099-01-01T12:00:00Z", "approvalRef": "owner-window-1"}
    r["harness"]["ownerApprovalRef"] = "owner-harness-1"
    r["selectionApprovalRef"] = "owner-selection-1"
    r["expectedPassConfirmedByOwner"] = True
    for g in l["gaps"]:
        g["expectedPass"]["confirmedByOwner"] = True
    return r, l


def receipt(req, minutes_old=1):
    # relative to the fixed evaluation time NOW, never the wall clock: a fixture that follows the clock fails on a later day
    base = datetime.datetime.strptime(NOW, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    t = (base - datetime.timedelta(minutes=minutes_old)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"createdAt": t, "productTraffic": 0, "codeManifestSha256": req["harness"]["codeManifestSha256"],
            "cases": {s["case"]: {"ready": True} for s in req["selection"] if s.get("needsCaptureDevice")}}


def run_py(script, *args, env=None, cwd=None):
    e = {"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", "/tmp")}
    e.update(env or {})
    return subprocess.run([sys.executable, "-I", os.path.join(ROOT, script)] + list(args), capture_output=True, text=True, env=e, cwd=cwd)


def git_repo():
    """A synthetic repository: a base commit (the last run's tested SHA) and helpers to add commits touching given paths."""
    d = tempfile.mkdtemp(prefix="ct-git-")
    def g(*a):
        r = subprocess.run(["git", "-C", d] + list(a), capture_output=True, text=True, env={"PATH": os.environ["PATH"], "HOME": d, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"})
        if r.returncode:
            raise RuntimeError(r.stderr)
        return r.stdout.strip()
    g("init", "-q", "-b", "main")
    def commit(subject, files):
        for p in files:
            fp = os.path.join(d, p)
            os.makedirs(os.path.dirname(fp), exist_ok=True)
            with open(fp, "a") as f:
                f.write(subject + "\n")
        g("add", "-A")
        g("commit", "-q", "-m", subject)
        return g("rev-parse", "HEAD")
    return d, g, commit
