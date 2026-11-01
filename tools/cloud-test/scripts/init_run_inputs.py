"""Inputs and qualification of the GitHub live caller (Sam 1793538100.358869, 1793538322.008999). Offline; never prints a value or identifier.

prepare   selects a COMMITTED, reviewed run request by repository path (never generated, never a test fixture or template, byte-identical to the
          tested commit), refuses a synthetic or Claude-runtime request, binds its release to this source history, its approval and window, checks request, identity,
          paid and TIME ceilings (sum of the selected cases' caseMaxMs plus admission, inter-case, cleanup, setup and collect reserves, all
          inside the job timeout), binds the account role to its credential names, account ID and history, translates the bounded facts input
          into the builder's real facts schema, and only then asks for the verified continuity checkpoint. It writes CT_* bindings for
          execute_run.sh; it computes nothing that the stage runner or gates own.
qualify   after collect: requires the REAL verify_run_binding output of THIS plan and case results with zero failures, and then, separately,
          every selected case dispatched with every required assertion PASS. Verifier success alone is never PASS.
project   run-record.json -> the closed latest record the publisher accepts; statuses and counts only.

Continuity (Sam 1793538322.008999): the cumulative checkpoint is derived from actual retained inputs, independently reconciled and bound to
the campaign and approval; its contract is Jensen's. Until it exists every prepare refuses with continuity-checkpoint-contract-pending. There
is no zero seed, fixture baseline or hash-only substitute.
Exit 78 (BLOCKED_SETUP) on every refusal.
"""
import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline)
import publish_latest_record as LR  # noqa: E402

RUNTIME = "GitHub Actions SpeakSharp"
PRODUCER_CASES = {"AHT-01", "AHT-02", "AHT-03", "AHT-07", "AHT-08"}
ALL_CASES = ["AHT-%02d" % n for n in range(1, 16)]
# build_plan.py binds ONE account id for the whole plan and labels AHT-15 maintained-read-only (line 179), so roles never mix in one run.
ROLE = {**{c: "existing-disposable" for c in ALL_CASES[:14]}, "AHT-15": "maintained-read-only"}
ROLE_CREDENTIALS = {"existing-disposable": {"email": "THROWAWAY_TEST_EMAIL", "password": "THROWAWAY_TEST_PASSWORD", "accountId": "THROWAWAY_TEST_ACCOUNT_ID"},
                    "maintained-read-only": {"email": "FREE_TEST_EMAIL", "password": "FREE_TEST_PASSWORD", "accountId": "FREE_TEST_ACCOUNT_ID"}}
REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/#-]{2,159}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
RECEIPT_KEYS = {"pre", "rls", "analytics", "disp", "fence", "review"}  # build_plan.py 55
BACKEND_KEYS = {"manifestRef", "generation", "completion", "migration129"}
FACT_REQUIRED = {"ownerApprovalReference", "approvedBy", "reviewer", "receipts", "account"}
FACT_OPTIONAL = {"producerReviewReference", "providerEvidenceReferences", "backend"}
UNREVIEWED_DIRS = ("tests", "templates", "fixtures")
# Caller reserves outside the harness window: tool verification, two plan builds, stimulus preflight and gates before; collect, binding
# verification, qualification and the record hand-off after. GitHub-hosted jobs cap at 360 minutes.
SETUP_RESERVE_MINUTES = 15
COLLECT_RESERVE_MINUTES = 10
HOSTED_JOB_CAP_MINUTES = 360


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def _ref(v):
    return isinstance(v, str) and bool(REF.match(v))


def _int(v):
    return isinstance(v, int) and not isinstance(v, bool) and v >= 0


def _utc(v):
    _need(isinstance(v, str) and LR.UTC.match(v), "utc")
    return datetime.strptime(v, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def _git(repo, *args):
    p = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=False)
    return p.stdout.strip() if p.returncode == 0 else None


def select_request(repo, rel, source_sha):
    """The request is a reviewed file at the tested commit: repository-relative, outside test fixtures and templates, tracked at exactly this
    source, and byte-identical in the checkout. Returns its absolute path and blob id."""
    _need(isinstance(rel, str) and rel and not os.path.isabs(rel) and os.path.normpath(rel) == rel and not rel.startswith(".."), "request-path")
    parts = rel.split("/")
    _need(rel.endswith(".json") and not any(p in UNREVIEWED_DIRS for p in parts[:-1]), "request-not-a-reviewed-run-request")
    _need(_git(repo, "rev-parse", "HEAD") == source_sha, "checkout-not-at-source")
    blob = _git(repo, "rev-parse", "--verify", "--quiet", source_sha + ":" + rel)
    _need(blob is not None, "request-not-committed-at-source")
    path = os.path.join(repo, rel)
    _need(os.path.isfile(path) and not os.path.islink(path) and _git(repo, "hash-object", "--", rel) == blob, "request-differs-from-commit")
    return path, blob


def check_request(req, now):
    """Live, approved, for THIS source and window, complete-case sampling. Returns the sorted selected cases."""
    _need(isinstance(req, dict) and req.get("schema") == "speaksharp.cloud-test.run-request.v2", "request-schema")
    _need(req.get("synthetic") is False, "synthetic-request-refused")
    _need(req.get("executionRuntime") == RUNTIME, "request-not-for-github-runtime")
    # The request is committed AFTER the release it names, so its testedSha is never the commit holding it; prepare binds it to this history.
    _need(isinstance((req.get("release") or {}).get("testedSha"), str) and LR.SHA40.match(req["release"]["testedSha"]), "request-release-sha")
    cases = [s.get("case") for s in req.get("selection") or [] if isinstance(s, dict)]
    _need(cases and len(cases) == len(req["selection"]) == len(set(cases)) and all(c in ROLE for c in cases), "case-selection")
    _need(req.get("coverageMode") in ("partial", "full"), "coverage-mode")
    _need(req["coverageMode"] == "partial" or sorted(cases) == ALL_CASES, "full-mode-needs-all-fifteen")
    _need(req.get("sampleMode") == "full", "partial-selection-needs-selected-full-sampling")
    for ref in (req.get("selectionApprovalRef"), (req.get("harness") or {}).get("ownerApprovalRef"), (req.get("window") or {}).get("approvalRef")):
        _need(_ref(ref), "approval-reference-missing")
    lim = req.get("approvedLimits") or {}
    _need(_ref(lim.get("approvalRef")) and _ref(lim.get("approvedBy")) and all(_int(lim.get(k)) and lim[k] > 0 for k in ("runCapRequests", "identityCap", "cumulativeCeilingRequests")),
          "approved-limits-missing")
    w = req["window"]
    _need(all(isinstance(w.get(k), str) and LR.UTC.match(w[k]) for k in ("startUtc", "endUtc")), "approved-window-missing")
    _need(_utc(w["startUtc"]) <= now < _utc(w["endUtc"]), "outside-approved-window")
    return sorted(cases)


def check_ceilings(cfg, req, cases, job_timeout_minutes):
    """Request, identity, paid and time ceilings, never raised by input. Returns the live-window minutes for the run step."""
    full = req["coverageMode"] == "full"
    mode = cfg["modes"]["full"]["limits"] if full else cfg["limits"]
    _need(len(cases) <= mode["maxSelectedCases"], "selection-exceeds-mode-cap")
    lim, est = req["approvedLimits"], req.get("estimate") or {}
    _need(lim["runCapRequests"] <= mode["maxRunCapRequests"] and lim["identityCap"] <= mode["maxIdentityReadsPerRun"], "approved-limit-above-mode-cap")
    reqs = est.get("requests") or {}
    _need(_int(reqs.get("runCap")) and reqs["runCap"] <= lim["runCapRequests"], "estimate-exceeds-approved-run-cap")
    _need(_int(est.get("identityReads")) and est["identityReads"] <= lim["identityCap"], "estimate-exceeds-approved-identity-cap")
    _need(cfg["limits"]["maxPaidActionsUsd"] == 0 and est.get("paidActionsAuthorizedUsd") == 0, "paid-actions-refused")
    w = cfg["modes"]["full"]["window"]
    case_minutes = math.ceil(sum(cfg["modes"]["full"]["caseMaxMs"][c] for c in cases) / 60000)
    live = case_minutes + w["admissionMaxMinutes"] + w["interCaseAndReportMinutes"] + w["cleanupReserveMinutes"]
    _need(live <= mode["maxWindowMinutes"], "time-exceeds-mode-window")
    worst = (est.get("window") or {}).get("worstCaseMinutes")
    _need(worst is None or (_int(worst) and worst <= live), "estimate-worst-case-exceeds-case-limits")
    _need(_int(job_timeout_minutes) and job_timeout_minutes <= HOSTED_JOB_CAP_MINUTES, "job-timeout")
    _need(SETUP_RESERVE_MINUTES + live + COLLECT_RESERVE_MINUTES <= job_timeout_minutes, "time-exceeds-job-timeout")
    return live


def account_binding(cases, facts_account, account_id):
    """One role per run, bound to its credential NAMES, the account ID (by digest) and the account's history reference together."""
    roles = {ROLE[c] for c in cases}
    _need(len(roles) == 1, "mixed-account-roles")
    role = roles.pop()
    _need(isinstance(facts_account, dict) and set(facts_account) == {"role", "idSha256", "historyRef"}, "account-binding-shape")
    _need(facts_account["role"] == role, "account-role-not-for-these-cases")
    _need(isinstance(account_id, str) and account_id.strip() == account_id and account_id, "account-id-source-missing")
    _need(isinstance(facts_account["idSha256"], str) and SHA64.match(facts_account["idSha256"]) and
          hashlib.sha256(account_id.encode()).hexdigest() == facts_account["idSha256"], "account-id-not-the-approved-account")
    _need(_ref(facts_account["historyRef"]), "account-history-reference")
    return {"role": role, "credentials": dict(ROLE_CREDENTIALS[role]), "historyRef": facts_account["historyRef"]}


def translate_facts(facts, req, route):
    """The bounded facts input -> exactly the builder's facts schema (build_plan.py 51-60, 143, 242, 374). References only."""
    _need(isinstance(facts, dict) and FACT_REQUIRED <= set(facts) <= FACT_REQUIRED | FACT_OPTIONAL, "facts-shape")
    for k in ("ownerApprovalReference", "approvedBy", "reviewer"):
        _need(_ref(facts[k]), "facts-reference:" + k)
    _need(facts["ownerApprovalReference"] == req["harness"]["ownerApprovalRef"], "facts-approval-not-the-request-approval")
    _need(isinstance(facts["receipts"], dict) and set(facts["receipts"]) == RECEIPT_KEYS and all(_ref(v) for v in facts["receipts"].values()), "facts-receipts")
    if route == "github-producer":
        _need(_ref(facts.get("producerReviewReference")), "producer-review-reference-missing")
    if "providerEvidenceReferences" in facts:
        p = facts["providerEvidenceReferences"]
        _need(isinstance(p, list) and 0 < len(p) <= 8 and all(_ref(v) for v in p), "facts-provider-evidence")
    if "backend" in facts:
        b = facts["backend"]
        _need(isinstance(b, dict) and set(b) == BACKEND_KEYS and _ref(b["manifestRef"]) and _int(b["generation"]) and b["generation"] >= 1 and
              b["completion"] in ("ON", "OFF") and b["migration129"] in ("present", "absent"), "facts-backend")
    return {k: v for k, v in facts.items() if k != "account"}


def evidence_scope(repo, rel, source_sha, route):
    """The producer route's bound evidence scope is a reviewed file at this source; its digest goes to execute_run as CT_EVIDENCE_SCOPE_SHA256."""
    if route != "github-producer":
        _need(rel is None, "evidence-scope-only-for-producer-route")
        return None
    _need(rel is not None, "evidence-scope-missing")
    path, _ = select_request(repo, rel, source_sha)
    return {"file": path, "sha256": _sha(path)}


def verified_checkpoint(path):
    """Jensen defines the verified continuity checkpoint contract (Sam 1793538322.008999). No contract exists yet, so nothing is accepted."""
    raise Refused("continuity-checkpoint-contract-pending")


def prepare(x, now):
    repo = os.path.realpath(x.repo)
    _need(isinstance(x.run_id, str) and LR.RUN_ID.match(x.run_id) and x.attempt == 1, "run-identity")
    _need(isinstance(x.source_sha, str) and LR.SHA40.match(x.source_sha), "source-sha")
    req_path, req_blob = select_request(repo, x.request, x.source_sha)
    req, cfg = _load(req_path), _load(os.path.join(repo, x.config))
    cases = check_request(req, now)
    _need(subprocess.run(["git", "-C", repo, "merge-base", "--is-ancestor", req["release"]["testedSha"], x.source_sha], capture_output=True).returncode == 0,
          "request-release-not-in-source-history")
    route = "github-producer" if set(cases) & PRODUCER_CASES else "github-direct"
    live_minutes = check_ceilings(cfg, req, cases, x.job_timeout_minutes)
    facts = json.loads(x.facts or "null")
    _need(isinstance(facts, dict), "facts-shape")
    account = account_binding(cases, facts.get("account"), os.environ.get(ROLE_CREDENTIALS[ROLE[cases[0]]]["accountId"]))
    builder_facts = translate_facts(facts, req, route)
    scope = evidence_scope(repo, x.evidence_scope, x.source_sha, route)
    verified_checkpoint(x.checkpoint)
    return {"request": req_path, "requestBlob": req_blob, "cases": cases, "route": route, "liveMinutes": live_minutes,
            "account": account, "facts": builder_facts, "scope": scope}


def qualify(verification, plan_path, case_results_path, cases_dir, selected):
    """Fresh verifier output for THIS plan and case results with zero failures, then every selected case dispatched with every required
    assertion PASS. Undispatched, skipped, missing, stale or failed rows never give PASS."""
    _need(isinstance(verification, dict) and verification.get("schema") == "speaksharp.cloud-test.binding-verification.v1", "binding-verification-schema")
    _need(verification.get("planSha256") == _sha(plan_path) and verification.get("caseResultsSha256") == _sha(case_results_path), "binding-verification-stale")
    checks = verification.get("checks")
    _need(isinstance(checks, list) and checks and verification.get("failed") == 0 and all(c.get("result") == "PASS" for c in checks), "binding-verification-failed")
    plan, results = _load(plan_path), _load(case_results_path)
    rows = {c.get("id"): c for c in plan.get("cases") or []}
    res = {c.get("caseId"): c for c in results.get("cases") or []}
    _need(sorted(rows) == sorted(selected), "plan-not-the-selected-cases")
    for cid in selected:
        r = res.get(cid)
        _need(isinstance(r, dict) and r.get("notSelected") is not True and r.get("reason") is None, "case-not-dispatched:" + cid)
        required = _load(rows[cid]["configFile"]).get("requiredAssertions")
        _need(isinstance(required, list) and required, "case-required-assertions-missing:" + cid)
        out = _load(os.path.join(cases_dir, cid, "case-result.json"))
        got = {a.get("id"): a.get("result") for a in out.get("assertions") or []}
        _need(out.get("caseId") == cid and out.get("result") == "PASS", "case-not-pass:" + cid)
        _need(all(got.get(a) == "PASS" for a in required), "required-assertion-not-pass:" + cid)
    return {"qualified": True, "cases": sorted(selected)}


def project(run_record, run_id, attempt, source_sha):
    _need(isinstance(run_record, dict) and run_record.get("schema") == "speaksharp.cloud-test.run-record.v1", "run-record-schema")
    _need((run_record.get("release") or {}).get("testedSha") == source_sha, "run-record-for-another-source")
    cases = []
    for c in run_record.get("cases") or []:
        a = c.get("assertions") or {}
        cases.append({"caseId": c.get("case"), "result": c.get("result"),
                      "rows": {"pass": a.get("PASS"), "fail": a.get("FAIL"), "notRun": a.get("NOT RUN")},
                      "codes": [c["outcomeClass"]] if isinstance(c.get("outcomeClass"), str) and LR.CODE.match(c["outcomeClass"]) else []})
    rec = {"runId": run_id, "attempt": attempt, "sourceSha": source_sha, "servedSha": (run_record.get("release") or {}).get("servedShaAtAdmission"),
           "startedUtc": run_record.get("startedUtc"), "endedUtc": run_record.get("endedUtc"),
           "outcome": "passed" if cases and all(c["result"] == "PASS" for c in cases) else "failed", "cases": cases, "codes": []}
    try:
        return LR.sanitize_record(rec)
    except LR.Refused as e:
        raise Refused("run-record-not-publishable:" + str(e))


def _sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _write_private(path, doc):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(doc, f, sort_keys=True)


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("prepare", "qualify", "project"))
    for flag in ("--repo", "--config", "--request", "--facts", "--evidence-scope", "--checkpoint", "--run-id", "--source-sha", "--out",
                 "--env-file", "--outputs", "--verification", "--plan", "--case-results", "--cases-dir", "--cases", "--run-record"):
        a.add_argument(flag)
    a.add_argument("--attempt", type=int)
    a.add_argument("--job-timeout-minutes", type=int)
    x = a.parse_args(argv[1:])
    try:
        if x.command == "project":
            _write_private(x.out, project(_load(x.run_record), x.run_id, x.attempt, x.source_sha))
            return 0
        if x.command == "qualify":
            _write_private(x.out, qualify(_load(x.verification), x.plan, x.case_results, x.cases_dir, sorted((x.cases or "").split(","))))
            return 0
        p = prepare(x, datetime.now(timezone.utc))
        os.makedirs(x.out, mode=0o700)
        facts_file, account_file = os.path.join(x.out, "facts.json"), os.path.join(x.out, "account-id")
        _write_private(facts_file, p["facts"])
        fd = os.open(account_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(os.environ[p["account"]["credentials"]["accountId"]])
        env = {"CT_REQUEST": p["request"], "CT_FACTS_FILE": facts_file, "CT_ACCOUNT_ID_FILE": account_file}
        if p["scope"]:
            env.update(CT_EVIDENCE_SCOPE_FILE=p["scope"]["file"], CT_EVIDENCE_SCOPE_SHA256=p["scope"]["sha256"])
        with open(x.env_file, "a", encoding="utf-8") as f:
            f.writelines("%s=%s\n" % kv for kv in sorted(env.items()))
        with open(x.outputs, "a", encoding="utf-8") as f:
            f.write("route=%s\nrole=%s\nlive_minutes=%d\ncases=%s\n" % (p["route"], p["account"]["role"], p["liveMinutes"], ",".join(p["cases"])))
        return 0
    except (Refused, LR.Refused) as e:
        print("BLOCKED_SETUP: " + str(e), file=sys.stderr)
        return 78
    except (OSError, ValueError, TypeError, KeyError):
        print("BLOCKED_SETUP: run-inputs-unreadable", file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
