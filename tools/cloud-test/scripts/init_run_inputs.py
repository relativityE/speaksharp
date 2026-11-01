"""Inputs and qualification of the GitHub live caller (Sam 1793538100.358869, 1793538322.008999). Offline; never prints a value or identifier.

prepare   selects a COMMITTED, reviewed run request by repository path (never generated, never a test fixture or template, byte-identical to the
          tested commit), refuses a synthetic or Claude-runtime request, binds its tested release to this source by request-only lineage
          (or an explicit approved older-release diagnostic), its approval and window, checks per-run request, identity, paid and TIME
          ceilings (sum of the selected cases' caseMaxMs plus admission, inter-case, cleanup, setup and collect reserves, inside the job
          timeout AND before the approved window closes), binds the account role to its credential names, account ID and history, translates
          the bounded facts input into the builder's real facts schema, and only then checks the CUMULATIVE request and identity caps against
          the verified continuity checkpoint's prior usage and reservations. It writes CT_* bindings for
          execute_run.sh; it computes nothing that the stage runner or gates own.
qualify   after collect: freezes EVERY verifier input into a new private snapshot, runs the REAL verify_run_binding on the snapshot only
          (exit 0, fresh output, zero failures), and then, separately and from the same frozen bytes, the builder's 15-row denominator with
          every selected case dispatched and every required assertion PASS exactly once. Its result is bound to the campaign, release and
          plan/results digests. Verifier success alone is never PASS.
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
FACT_OPTIONAL = {"producerReviewReference", "providerEvidenceReferences", "backend", "olderReleaseDiagnostic"}
# The ONE reviewed location for live run requests (Sam RETURN 3e0279d6 finding 1); nothing else counts as request-only lineage.
REQUEST_DIR = "tools/cloud-test/config/runs/"
TEMPLATE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "templates", "run-request.template.json")
# Beyond the template: the live/synthetic marker, the runtime, the producer scope limits, and full mode's owner-approved omissions
# (check_coverage.py 62); a nightly-only or fixture-only field is not a GitHub live request.
REQUEST_EXTRA_KEYS = {"synthetic", "executionRuntime", "evidenceScope", "approvedOmissions"}
SCOPE_LIMITS = {"maxDeliveries": (1, 128), "maxSupabaseRequests": (1, 256), "maxTelemetryReads": (0, 16)}  # authenticated-job-producer.cjs 26
SCOPE_MAX_WINDOW_SECONDS = 21600
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


def _request_keys():
    with open(TEMPLATE, encoding="utf-8") as f:
        return set(json.load(f))


def request_shape_ok(req, template_keys):
    """A run request is exactly the reviewed template's fields plus REQUEST_EXTRA_KEYS; the schema must be v2."""
    return (isinstance(req, dict) and req.get("schema") == "speaksharp.cloud-test.run-request.v2" and
            template_keys <= set(req) <= template_keys | REQUEST_EXTRA_KEYS)


def select_request(repo, rel, source_sha):
    """The request is a reviewed file in the ONE request location at the tested commit, tracked at exactly this source and byte-identical in
    the checkout. Returns its absolute path and blob id."""
    _need(isinstance(rel, str) and rel and not os.path.isabs(rel) and os.path.normpath(rel) == rel and not rel.startswith(".."), "request-path")
    _need(os.path.dirname(rel) + "/" == REQUEST_DIR and rel.endswith(".json"), "request-not-in-the-reviewed-request-location")
    _need(_git(repo, "rev-parse", "HEAD") == source_sha, "checkout-not-at-source")
    blob = _git(repo, "rev-parse", "--verify", "--quiet", source_sha + ":" + rel)
    _need(blob is not None, "request-not-committed-at-source")
    path = os.path.join(repo, rel)
    _need(os.path.isfile(path) and not os.path.islink(path) and _git(repo, "hash-object", "--", rel) == blob, "request-differs-from-commit")
    return path, blob


def check_request(req, now, template_keys):
    """Live, approved, for THIS source and window, complete-case sampling. Returns the sorted selected cases."""
    _need(request_shape_ok(req, template_keys), "request-schema")
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


def check_release_lineage(repo, req, request_rel, source_sha, request_blob, cases, diagnostic, template_keys):
    """Workflow source, tested product release and served release are distinct. The source may descend from the tested release only by
    schema-valid run requests in the ONE reviewed request location; anything else (product, dependency, harness, or any other JSON) refuses
    unless facts carry an older-release diagnostic approval bound to exactly this workflow SHA, tested SHA, request blob and selection.
    Served == tested is the pipeline's release verification, not proved here. Returns the classification for the outputs and record."""
    tested = req["release"]["testedSha"]
    _need(subprocess.run(["git", "-C", repo, "merge-base", "--is-ancestor", tested, source_sha], capture_output=True).returncode == 0,
          "request-release-not-in-source-history")
    changed = _git(repo, "diff", "--name-only", "--no-renames", tested, source_sha)
    _need(changed is not None, "source-lineage-unreadable")

    def request_only(path):
        if os.path.dirname(path) + "/" != REQUEST_DIR or not path.endswith(".json"):
            return False
        text = _git(repo, "show", source_sha + ":" + path)
        try:
            return text is not None and request_shape_ok(json.loads(text), template_keys)
        except ValueError:
            return False
    beyond = [p for p in changed.splitlines() if p and not request_only(p)]
    if not beyond:
        _need(diagnostic is None, "diagnostic-declared-without-product-change")
        return "same" if tested == source_sha else "request-only-descendant"
    _need(diagnostic == {"approvalRef": (diagnostic or {}).get("approvalRef"), "workflowSha": source_sha, "testedSha": tested,
                         "requestBlob": request_blob, "cases": cases} and _ref(diagnostic["approvalRef"]), "source-changes-product-beyond-request")
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
    return {k: v for k, v in facts.items() if k not in ("account", "olderReleaseDiagnostic")}


def compose_scope(req, facts, account_id, cases, route):
    """The producer route's private evidence scope, composed from the COMMITTED request (campaign, release, window, case selection and the
    reviewed evidenceScope limits) plus the facts' approval/review references and the bound account. It holds the raw account ID, so it is
    written privately in the job and never committed; authenticated_job_bootstrap.cjs validates it (validateBindings) against the builder
    environment run_env.py derives from the same request."""
    if route != "github-producer":
        _need("evidenceScope" not in req, "evidence-scope-only-for-producer-route")
        return None
    lim = req.get("evidenceScope")
    _need(isinstance(lim, dict) and set(lim) == set(SCOPE_LIMITS) and all(_int(lim[k]) and lo <= lim[k] <= hi for k, (lo, hi) in SCOPE_LIMITS.items()),
          "evidence-scope-limits")
    w = req["window"]
    _need((_utc(w["endUtc"]) - _utc(w["startUtc"])).total_seconds() <= SCOPE_MAX_WINDOW_SECONDS, "producer-scope-window-over-six-hours")
    tested = req["release"]["testedSha"]
    return {"campaignId": req["runId"], "sourceSha": tested, "servedSha": tested, "notBefore": w["startUtc"], "deadlineAt": w["endUtc"],
            "caseIds": sorted(set(cases) & PRODUCER_CASES), "ownerAccountId": account_id, "ownerApprovalReference": facts["ownerApprovalReference"],
            "producerReviewReference": facts["producerReviewReference"], **{k: lim[k] for k in SCOPE_LIMITS}}


def verified_checkpoint(path):
    """Jensen defines the verified continuity checkpoint contract (Sam 1793538322.008999). No contract exists yet, so nothing is accepted."""
    raise Refused("continuity-checkpoint-contract-pending")


def prepare(x, now):
    repo = os.path.realpath(x.repo)
    _need(isinstance(x.run_id, str) and LR.RUN_ID.match(x.run_id) and x.attempt == 1, "run-identity")
    _need(isinstance(x.source_sha, str) and LR.SHA40.match(x.source_sha), "source-sha")
    req_path, req_blob = select_request(repo, x.request, x.source_sha)
    req, cfg, template_keys = _load(req_path), _load(os.path.join(repo, x.config)), _request_keys()
    cases = check_request(req, now, template_keys)
    route = "github-producer" if set(cases) & PRODUCER_CASES else "github-direct"
    live_minutes = check_ceilings(cfg, req, cases, x.job_timeout_minutes)
    check_window_fit(req, now, live_minutes)
    facts = json.loads(x.facts or "null")
    _need(isinstance(facts, dict), "facts-shape")
    lineage = check_release_lineage(repo, req, x.request, x.source_sha, req_blob, cases, facts.get("olderReleaseDiagnostic"), template_keys)
    account_id = os.environ.get(ROLE_CREDENTIALS[ROLE[cases[0]]]["accountId"])
    account = account_binding(cfg, cases, facts.get("account"), account_id)
    builder_facts = translate_facts(facts, req, route)
    scope = compose_scope(req, builder_facts, account_id, cases, route)
    # Cumulative request/identity/Starts/takes caps are G5's (check_gates.py 131-170, run by execute_run gate-and-validate with --enforce-go
    # before reserve or run); the caller supplies G5's verified inputs and never re-derives its formula.
    verified_checkpoint(x.checkpoint)
    return {"request": req_path, "requestBlob": req_blob, "testedSha": req["release"]["testedSha"], "lineage": lineage, "cases": cases, "route": route, "liveMinutes": live_minutes,
            "account": account, "facts": builder_facts, "scope": scope}


def _run_verifier(plan, case_results, approval, code_manifest, packet_root, cases_dir, out):
    """The REAL verify_run_binding.py, unchanged, as a child process. Returns its exit status; the caller reads --out itself."""
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "verify_run_binding.py")
    return subprocess.run([sys.executable, "-I", script, "--plan", plan, "--case-results", case_results, "--approval", approval,
                           "--code-manifest", code_manifest, "--packet-root", packet_root, "--cases-dir", cases_dir, "--out", out],
                          capture_output=True, check=False).returncode


def _read_regular(path):
    st = os.lstat(path)
    _need(os.path.isfile(path) and not os.path.islink(path) and st.st_nlink >= 1, "verifier-input-not-a-regular-file")
    return _read(path)


def _freeze(snap, plan_path, case_results_path, cases_dir, approval, code_manifest):
    """Copies EVERY verifier input exactly once into a new private snapshot: plan, case results, approval, the code manifest and each file it
    lists, every planned driver/config/media, and every file of every case directory (results, summaries, evidence). The frozen plan is the
    original with only its driver/config/media paths pointed at the frozen copies; every recorded digest is unchanged."""
    os.makedirs(snap, mode=0o700)
    frozen = {}

    def keep(rel, data):
        dst = os.path.join(snap, rel)
        os.makedirs(os.path.dirname(dst), mode=0o700, exist_ok=True)
        fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        frozen[rel] = data
        return dst
    original_plan = _read_regular(plan_path)
    plan = json.loads(original_plan)
    for row in _unique(plan.get("cases"), "id", "duplicate-plan-case").values():
        for key, sub in (("driverFile", "drivers"), ("configFile", "configs"), ("mediaFile", "media")):
            if row.get(key):
                row[key] = keep("%s/%s-%s" % (sub, row["id"], os.path.basename(row[key])), _read_regular(row[key]))
    keep("case-results.json", _read_regular(case_results_path))
    keep("approval.json", _read_regular(approval))
    manifest = _read_regular(code_manifest)
    keep("packet/CODE.sha256", manifest)
    for line in manifest.decode().splitlines():
        rel = line.split("  ", 1)[1] if "  " in line else ""
        _need(rel and not os.path.isabs(rel) and os.path.normpath(rel) == rel and not rel.startswith(".."), "code-manifest-path")
        keep("packet/" + rel, _read_regular(os.path.join(os.path.dirname(code_manifest), rel)))
    for cid in sorted(os.listdir(cases_dir)) if os.path.isdir(cases_dir) else []:
        root = os.path.join(cases_dir, cid)
        _need(cid in ROLE and os.path.isdir(root) and not os.path.islink(root), "unexpected-case-directory")
        for dirpath, dirs, files in os.walk(root):
            _need(not any(os.path.islink(os.path.join(dirpath, d)) for d in dirs), "case-directory-link")
            for name in files:
                full = os.path.join(dirpath, name)
                keep(os.path.join("cases", os.path.relpath(full, cases_dir)), _read_regular(full))
    plan_file = keep("plan.json", json.dumps(plan, sort_keys=True).encode())
    return frozen, original_plan, plan_file


def qualify(plan_path, case_results_path, cases_dir, selected, approval, code_manifest, snapshot_dir, run_verifier=_run_verifier):
    """Freeze every verifier input, run the REAL verifier on the frozen snapshot only (fresh --out, exit 0, zero failures for exactly the
    frozen plan and results), then decide from the same frozen bytes: the builder's 15-row denominator with the dispatch subset in
    plan.selection, every selected case dispatched, every required assertion PASS exactly once, and every evidence digest and summary
    matching the frozen bytes. The result is bound to the campaign, the tested and served release, and the plan and results digests."""
    selected = sorted(selected)
    _need(selected and all(c in ROLE for c in selected) and len(set(selected)) == len(selected), "case-selection")
    frozen, original_plan, plan_file = _freeze(snapshot_dir, plan_path, case_results_path, cases_dir, approval, code_manifest)
    out = os.path.join(snapshot_dir, "verification.json")
    status = run_verifier(plan_file, os.path.join(snapshot_dir, "case-results.json"), os.path.join(snapshot_dir, "approval.json"),
                          os.path.join(snapshot_dir, "packet", "CODE.sha256"), os.path.join(snapshot_dir, "packet"),
                          os.path.join(snapshot_dir, "cases"), out)
    _need(all(_read_regular(os.path.join(snapshot_dir, rel)) == data for rel, data in frozen.items()), "snapshot-changed-during-verification")
    _need(status == 0, "binding-verifier-failed")
    _need(os.path.isfile(out), "binding-verification-missing")
    verification = _load(out)
    digest = lambda b: hashlib.sha256(b).hexdigest()  # noqa: E731
    _need(isinstance(verification, dict) and verification.get("schema") == "speaksharp.cloud-test.binding-verification.v1", "binding-verification-schema")
    _need(verification.get("planSha256") == digest(frozen["plan.json"]) and verification.get("caseResultsSha256") == digest(frozen["case-results.json"]),
          "binding-verification-stale")
    checks = verification.get("checks")
    _need(isinstance(checks, list) and checks and verification.get("failed") == 0 and all(c.get("result") == "PASS" for c in checks), "binding-verification-failed")
    plan, results = json.loads(original_plan), json.loads(frozen["case-results.json"])
    rows, res = _unique(plan.get("cases"), "id", "duplicate-plan-case"), _unique(results.get("cases"), "caseId", "duplicate-case-result")
    _need(sorted(rows) == ALL_CASES, "plan-denominator-not-fifteen")
    # Every planned driver/config/media byte is checked against the plan's own digest here too: the verifier skips undispatched rows.
    for cid, row in rows.items():
        for key, sha_key, sub in (("driverFile", "driverSha256", "drivers"), ("configFile", "configSha256", "configs"), ("mediaFile", "mediaSha256", "media")):
            if row.get(key):
                _need(digest(frozen["%s/%s-%s" % (sub, cid, os.path.basename(row[key]))]) == row.get(sha_key), "planned-bytes-differ:" + cid)
    _need(plan.get("campaignId") == results.get("campaignId") and plan.get("sourceSha") == results.get("sourceSha"), "results-not-for-this-plan")
    sel = plan.get("selection")
    _need(sorted(sel["ids"]) == selected and sel.get("order") == sel["ids"] if isinstance(sel, dict) and isinstance(sel.get("ids"), list) else selected == ALL_CASES,
          "plan-selection-not-the-selected-cases")
    required_rows = 0
    for cid in ALL_CASES:
        r = res.get(cid)
        if cid not in selected:
            _need(isinstance(r, dict) and r.get("notSelected") is True and not r.get("requestsUsed") and "cases/%s/case-result.json" % cid not in frozen,
                  "unselected-case-dispatched:" + cid)
            continue
        _need(isinstance(r, dict) and r.get("notSelected") is not True and r.get("reason") is None, "case-not-dispatched:" + cid)
        config = frozen["configs/%s-%s" % (cid, os.path.basename(rows[cid]["configFile"]))]
        _need(digest(config) == rows[cid].get("configSha256"), "case-config-not-the-planned-bytes:" + cid)
        required = json.loads(config).get("requiredAssertions")
        _need(isinstance(required, list) and required and len(set(required)) == len(required), "case-required-assertions-missing:" + cid)
        raw = frozen.get("cases/%s/case-result.json" % cid)
        _need(raw is not None, "case-result-missing:" + cid)
        out_case = json.loads(raw)
        for ref, want in (out_case.get("evidenceDigests") or {}).items():
            _need(digest(frozen.get("cases/%s/%s" % (cid, os.path.normpath(ref)), b"\0missing")) == want, "evidence-not-the-frozen-bytes:" + cid)
        summary = (r.get("executionReceipt") or {}).get("summarySha256")
        _need(summary is None or digest(frozen.get("cases/%s/summary.json" % cid, b"\0missing")) == summary, "summary-not-the-frozen-bytes:" + cid)
        got = _unique(out_case.get("assertions"), "id", "duplicate-assertion:" + cid)
        _need(out_case.get("caseId") == cid and out_case.get("result") == "PASS", "case-not-pass:" + cid)
        _need(all(got.get(a, {}).get("result") == "PASS" for a in required), "required-assertion-not-pass:" + cid)
        required_rows += len(required)
    return {"qualified": True, "campaignId": plan["campaignId"], "testedSha": plan["sourceSha"], "servedSha": results.get("servedSha"),
            "planSha256": digest(original_plan), "caseResultsSha256": digest(frozen["case-results.json"]), "cases": selected,
            "coverage": "full" if selected == ALL_CASES and not isinstance(sel, dict) else "batch",
            "planCases": len(rows), "requiredRows": required_rows, "passRows": required_rows}


def _unique(items, key, code):
    _need(isinstance(items, list), code)
    out = {}
    for item in items:
        _need(isinstance(item, dict) and item.get(key) not in out, code)
        out[item[key]] = item
    return out


def project(run_record, run_id, attempt, source_sha, tested_sha, qualification=None):
    """run-record.json (the real collector keeps all 15 rows) -> the closed latest record. Qualification counts only when it is bound to THIS
    record: the same case-results digest, tested release and observed served release. Then the selected rows keep their results, the others
    are NOT SELECTED, and coverage says batch or full truthfully. `passed` needs that binding and every selected row PASS; anything else is
    `failed` with code not-qualified."""
    _need(isinstance(run_record, dict) and run_record.get("schema") == "speaksharp.cloud-test.run-record.v1", "run-record-schema")
    rel = run_record.get("release") or {}
    _need(isinstance(tested_sha, str) and LR.SHA40.match(tested_sha) and rel.get("testedSha") == tested_sha, "run-record-for-another-release")
    q = qualification if isinstance(qualification, dict) else {}
    qualified = (q.get("qualified") is True and q.get("caseResultsSha256") == (run_record.get("artifactDigests") or {}).get("case-results.json") and
                 q.get("testedSha") == tested_sha and q.get("servedSha") == rel.get("servedShaAtAdmission") and
                 (q.get("coverage") == "batch" or (q.get("coverage") == "full" and sorted(q.get("cases") or []) == ALL_CASES)) and
                 isinstance(q.get("cases"), list) and set(q["cases"]) <= {c.get("case") for c in run_record.get("cases") or [] if isinstance(c, dict)})
    cases = []
    for c in run_record.get("cases") or []:
        a = c.get("assertions") or {}
        unselected = qualified and c.get("case") not in q["cases"]
        cases.append({"caseId": c.get("case"), "result": "NOT SELECTED" if unselected else c.get("result"),
                      "rows": {"pass": 0, "fail": 0, "notRun": 0} if unselected else {"pass": a.get("PASS"), "fail": a.get("FAIL"), "notRun": a.get("NOT RUN")},
                      "codes": [c["outcomeClass"]] if not unselected and isinstance(c.get("outcomeClass"), str) and LR.CODE.match(c["outcomeClass"]) else []})
    selected = [c for c in cases if c["result"] != "NOT SELECTED"]
    rec = {"runId": run_id, "attempt": attempt, "sourceSha": source_sha, "testedSha": tested_sha, "servedSha": rel.get("servedShaAtAdmission"),
           "campaignId": q.get("campaignId") if qualified else None, "coverage": q["coverage"] if qualified else "unqualified",
           "startedUtc": run_record.get("startedUtc"), "endedUtc": run_record.get("endedUtc"),
           "outcome": "passed" if qualified and selected and all(c["result"] == "PASS" for c in selected) else "failed",
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
    for flag in ("--repo", "--config", "--request", "--facts", "--checkpoint", "--run-id", "--source-sha", "--out",
                 "--env-file", "--outputs", "--plan", "--case-results", "--cases-dir", "--cases", "--run-record", "--tested-sha", "--approval", "--qualification",
                 "--code-manifest", "--snapshot-dir"):
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
                                          x.snapshot_dir))
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
            scope_file = os.path.join(x.out, "evidence-scope.json")
            _write_private(scope_file, p["scope"])
            env.update(CT_EVIDENCE_SCOPE_FILE=scope_file, CT_EVIDENCE_SCOPE_SHA256=_sha(scope_file))
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
