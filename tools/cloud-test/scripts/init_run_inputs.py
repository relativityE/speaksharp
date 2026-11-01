"""Inputs and qualification of the GitHub live caller (Sam 1793538100.358869, 1793538322.008999). Offline; never prints a value or identifier.

prepare   selects a COMMITTED, reviewed run request by repository path (never generated, never a test fixture or template, byte-identical to the
          tested commit), refuses a synthetic or Claude-runtime request, binds its tested release to this source by request-only lineage
          (or an explicit approved older-release diagnostic), its approval and window, checks per-run request, identity, paid and TIME
          ceilings (sum of the selected cases' caseMaxMs plus admission, inter-case, cleanup, setup and collect reserves, inside the job
          timeout AND before the approved window closes), binds the account role to its credential names, account ID and history, translates
          the bounded facts input into the builder's real facts schema, and only then checks the CUMULATIVE request and identity caps against
          the verified continuity checkpoint's prior usage and reservations. It writes CT_* bindings for
          execute_run.sh; it computes nothing that the stage runner or gates own.
qualify   after collect: snapshots every consumed byte, runs the REAL verify_run_binding, requires the same bytes afterwards and zero
          verifier failures, and then, separately and from the snapshot, the builder's 15-row denominator with every selected case dispatched
          and every required assertion PASS exactly once. Verifier success alone is never PASS.
project   run-record.json -> the closed latest record the publisher accepts; statuses and counts only. `passed` also needs the qualify
          output for exactly the recorded cases (passed as --qualification); without it the record is `failed` with code not-qualified.

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
    # runCapRequests is per run; identityCap and cumulativeCeilingRequests are CUMULATIVE and are checked against verified prior usage.
    _need(lim["runCapRequests"] <= mode["maxRunCapRequests"], "approved-limit-above-mode-cap")
    reqs = est.get("requests") or {}
    _need(_int(reqs.get("runCap")) and reqs["runCap"] <= lim["runCapRequests"], "estimate-exceeds-approved-run-cap")
    _need(_int(est.get("identityReads")) and est["identityReads"] <= mode["maxIdentityReadsPerRun"], "estimate-exceeds-per-run-identity-cap")
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


def check_window_fit(req, now, live_minutes):
    """The whole job (setup + live + collect) must finish before the approved window closes, not merely start inside it."""
    end = _utc(req["window"]["endUtc"])
    _need((end - now).total_seconds() >= 60 * (SETUP_RESERVE_MINUTES + live_minutes + COLLECT_RESERVE_MINUTES), "run-would-outlast-approved-window")


def check_cumulative(req, prior):
    """Verified conservative prior usage plus outstanding reservations plus this run's allocation must fit the cumulative caps. `prior` comes
    only from the verified continuity checkpoint; unknown quantities are refused, never treated as zero."""
    keys = ("requests", "identityReads", "reservedRequests", "reservedIdentityReads")
    _need(isinstance(prior, dict) and all(_int(prior.get(k)) for k in keys), "prior-usage-unknown")
    lim, est = req["approvedLimits"], req["estimate"]
    _need(prior["requests"] + prior["reservedRequests"] + est["requests"]["runCap"] <= lim["cumulativeCeilingRequests"], "cumulative-request-ceiling-exceeded")
    _need(prior["identityReads"] + prior["reservedIdentityReads"] + est["identityReads"] <= lim["identityCap"], "cumulative-identity-cap-exceeded")


def check_release_lineage(repo, req, request_rel, source_sha):
    """Workflow source, tested product release and served release are distinct. The source may descend from the tested release only by
    request files (same directory as the request); a product or dependency change refuses unless the request names an explicit,
    approved older-release diagnostic. Served == tested is the pipeline's release verification, not proved here."""
    tested = req["release"]["testedSha"]
    _need(subprocess.run(["git", "-C", repo, "merge-base", "--is-ancestor", tested, source_sha], capture_output=True).returncode == 0,
          "request-release-not-in-source-history")
    changed = _git(repo, "diff", "--name-only", tested, source_sha)
    _need(changed is not None, "source-lineage-unreadable")
    request_dir = os.path.dirname(request_rel) + "/"
    beyond = [p for p in changed.splitlines() if p and not (p.startswith(request_dir) and p.endswith(".json"))]
    if not beyond:
        return "same" if tested == source_sha else "request-only-descendant"
    _need(_ref(req["release"].get("olderReleaseDiagnosticApprovalRef")), "source-changes-product-beyond-request")
    return "explicit-older-release-diagnostic"


def account_binding(cfg, cases, facts_account, account_id):
    """One role per run, bound to its credential NAMES, the account ID (by digest) and the account's history reference together. The role's
    names must be ones the run stage actually receives (config credentials.runEnvironment.stages.run); values are never renamed into
    another role's names."""
    roles = {ROLE[c] for c in cases}
    _need(len(roles) == 1, "mixed-account-roles")
    role = roles.pop()
    names = ROLE_CREDENTIALS[role]
    _need({names["email"], names["password"]} <= set(cfg["credentials"]["runEnvironment"]["stages"]["run"]), "role-credentials-not-in-run-stage-allowlist")
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
    lineage = check_release_lineage(repo, req, x.request, x.source_sha)
    route = "github-producer" if set(cases) & PRODUCER_CASES else "github-direct"
    live_minutes = check_ceilings(cfg, req, cases, x.job_timeout_minutes)
    check_window_fit(req, now, live_minutes)
    facts = json.loads(x.facts or "null")
    _need(isinstance(facts, dict), "facts-shape")
    account = account_binding(cfg, cases, facts.get("account"), os.environ.get(ROLE_CREDENTIALS[ROLE[cases[0]]]["accountId"]))
    builder_facts = translate_facts(facts, req, route)
    scope = evidence_scope(repo, x.evidence_scope, x.source_sha, route)
    check_cumulative(req, verified_checkpoint(x.checkpoint))
    return {"request": req_path, "requestBlob": req_blob, "testedSha": req["release"]["testedSha"], "lineage": lineage, "cases": cases, "route": route, "liveMinutes": live_minutes,
            "account": account, "facts": builder_facts, "scope": scope}


def _run_verifier(plan, case_results, approval, code_manifest, packet_root, cases_dir, out):
    """The REAL verify_run_binding.py, unchanged, as a child process; its --out is read back by the caller."""
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "verify_run_binding.py")
    subprocess.run([sys.executable, "-I", script, "--plan", plan, "--case-results", case_results, "--approval", approval, "--code-manifest", code_manifest,
                    "--packet-root", packet_root, "--cases-dir", cases_dir, "--out", out], capture_output=True, check=False)
    return _load(out)


def _snapshot(plan_path, case_results_path, cases_dir, selected):
    """Every byte qualification consumes: plan, case results, each selected case config, case result and evidence file."""
    snap = {plan_path: _read(plan_path), case_results_path: _read(case_results_path)}
    plan = json.loads(snap[plan_path])
    for row in plan.get("cases") or []:
        if row.get("id") in selected:
            snap[row["configFile"]] = _read(row["configFile"])
    for cid in selected:
        path = os.path.join(cases_dir, cid, "case-result.json")
        snap[path] = _read(path)
        for ref in sorted((json.loads(snap[path]).get("evidenceDigests") or {})):
            ev = os.path.realpath(os.path.join(cases_dir, cid, ref))
            _need(ev.startswith(os.path.realpath(os.path.join(cases_dir, cid)) + os.sep), "evidence-outside-case:" + cid)
            snap[ev] = _read(ev)
    return snap


def qualify(plan_path, case_results_path, cases_dir, selected, approval, code_manifest, packet_root, verification_out, run_verifier=_run_verifier):
    """Snapshot every consumed byte, run the REAL verifier, require the same bytes afterwards, then decide from the snapshot only: zero
    verifier failures for THIS plan and these case results, the builder's 15-row denominator with the dispatch subset in plan.selection,
    every selected case dispatched, every required assertion PASS exactly once. Undispatched, skipped, missing, duplicate, substituted or
    failed rows never give PASS."""
    selected = sorted(selected)
    _need(selected and all(c in ROLE for c in selected) and len(set(selected)) == len(selected), "case-selection")
    before = _snapshot(plan_path, case_results_path, cases_dir, selected)
    verification = run_verifier(plan_path, case_results_path, approval, code_manifest, packet_root, cases_dir, verification_out)
    _need(_snapshot(plan_path, case_results_path, cases_dir, selected) == before, "consumed-bytes-changed-during-verification")
    digest = lambda p: hashlib.sha256(before[p]).hexdigest()  # noqa: E731
    _need(isinstance(verification, dict) and verification.get("schema") == "speaksharp.cloud-test.binding-verification.v1", "binding-verification-schema")
    _need(verification.get("planSha256") == digest(plan_path) and verification.get("caseResultsSha256") == digest(case_results_path), "binding-verification-stale")
    checks = verification.get("checks")
    _need(isinstance(checks, list) and checks and verification.get("failed") == 0 and all(c.get("result") == "PASS" for c in checks), "binding-verification-failed")
    plan, results = json.loads(before[plan_path]), json.loads(before[case_results_path])
    rows, res = _unique(plan.get("cases"), "id", "duplicate-plan-case"), _unique(results.get("cases"), "caseId", "duplicate-case-result")
    _need(sorted(rows) == ALL_CASES, "plan-denominator-not-fifteen")
    sel = plan.get("selection")
    _need(sorted(sel["ids"]) == selected and sel.get("order") == sel["ids"] if isinstance(sel, dict) and isinstance(sel.get("ids"), list) else selected == ALL_CASES,
          "plan-selection-not-the-selected-cases")
    required_rows = 0
    for cid in ALL_CASES:
        r = res.get(cid)
        if cid not in selected:
            _need(r is None or r.get("notSelected") is True or r.get("reason") is not None, "unselected-case-dispatched:" + cid)
            continue
        _need(isinstance(r, dict) and r.get("notSelected") is not True and r.get("reason") is None, "case-not-dispatched:" + cid)
        config = before[rows[cid]["configFile"]]
        _need(hashlib.sha256(config).hexdigest() == rows[cid].get("configSha256"), "case-config-not-the-planned-bytes:" + cid)
        required = json.loads(config).get("requiredAssertions")
        _need(isinstance(required, list) and required and len(set(required)) == len(required), "case-required-assertions-missing:" + cid)
        out = json.loads(before[os.path.join(cases_dir, cid, "case-result.json")])
        got = _unique(out.get("assertions"), "id", "duplicate-assertion:" + cid)
        _need(out.get("caseId") == cid and out.get("result") == "PASS", "case-not-pass:" + cid)
        _need(all(got.get(a, {}).get("result") == "PASS" for a in required), "required-assertion-not-pass:" + cid)
        required_rows += len(required)
    return {"qualified": True, "cases": selected, "planCases": len(rows), "requiredRows": required_rows, "passRows": required_rows}


def _unique(items, key, code):
    _need(isinstance(items, list), code)
    out = {}
    for item in items:
        _need(isinstance(item, dict) and item.get(key) not in out, code)
        out[item[key]] = item
    return out


def project(run_record, run_id, attempt, source_sha, tested_sha, qualification=None):
    """`passed` needs every case PASS AND the qualify result for exactly these cases; anything else is `failed`. The run record must be for
    the request's tested release (prepare's tested_sha output), which is not the harness source commit."""
    _need(isinstance(run_record, dict) and run_record.get("schema") == "speaksharp.cloud-test.run-record.v1", "run-record-schema")
    _need(isinstance(tested_sha, str) and LR.SHA40.match(tested_sha) and (run_record.get("release") or {}).get("testedSha") == tested_sha,
          "run-record-for-another-release")
    cases = []
    recorded = sorted(c.get("case") for c in run_record.get("cases") or [] if isinstance(c, dict))
    qualified = isinstance(qualification, dict) and qualification.get("qualified") is True and qualification.get("cases") == recorded
    for c in run_record.get("cases") or []:
        a = c.get("assertions") or {}
        cases.append({"caseId": c.get("case"), "result": c.get("result"),
                      "rows": {"pass": a.get("PASS"), "fail": a.get("FAIL"), "notRun": a.get("NOT RUN")},
                      "codes": [c["outcomeClass"]] if isinstance(c.get("outcomeClass"), str) and LR.CODE.match(c["outcomeClass"]) else []})
    rec = {"runId": run_id, "attempt": attempt, "sourceSha": source_sha, "testedSha": tested_sha, "servedSha": (run_record.get("release") or {}).get("servedShaAtAdmission"),
           "startedUtc": run_record.get("startedUtc"), "endedUtc": run_record.get("endedUtc"),
           "outcome": "passed" if cases and all(c["result"] == "PASS" for c in cases) and qualified else "failed",
           "cases": cases, "codes": [] if qualified else ["not-qualified"]}
    try:
        return LR.sanitize_record(rec)
    except LR.Refused as e:
        raise Refused("run-record-not-publishable:" + str(e))


def _read(path):
    with open(path, "rb") as f:
        return f.read()


def _sha(path):
    return hashlib.sha256(_read(path)).hexdigest()


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
                 "--env-file", "--outputs", "--verification", "--plan", "--case-results", "--cases-dir", "--cases", "--run-record", "--tested-sha", "--approval", "--qualification",
                 "--code-manifest", "--packet-root"):
        a.add_argument(flag)
    a.add_argument("--attempt", type=int)
    a.add_argument("--job-timeout-minutes", type=int)
    x = a.parse_args(argv[1:])
    try:
        if x.command == "project":
            q = _load(x.qualification) if x.qualification and os.path.exists(x.qualification) else None
            _write_private(x.out, project(_load(x.run_record), x.run_id, x.attempt, x.source_sha, x.tested_sha, q))
            return 0
        if x.command == "qualify":
            _write_private(x.out, qualify(x.plan, x.case_results, x.cases_dir, (x.cases or "").split(","), x.approval, x.code_manifest,
                                          x.packet_root, x.verification))
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
            f.write("route=%s\nrole=%s\nlive_minutes=%d\ncases=%s\ntested_sha=%s\nlineage=%s\n" % (p["route"], p["account"]["role"], p["liveMinutes"],
                                                                                         ",".join(p["cases"]), p["testedSha"], p["lineage"]))
        return 0
    except (Refused, LR.Refused) as e:
        print("BLOCKED_SETUP: " + str(e), file=sys.stderr)
        return 78
    except (OSError, ValueError, TypeError, KeyError):
        print("BLOCKED_SETUP: run-inputs-unreadable", file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
