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

Continuity (Sam 1793538322.008999; Increment I, Sam 1793566031.065709): the cumulative checkpoint is the ACCEPTED ROLLUP
(accounting_rollup.receive) of the committed, content-free accepted bootstrap and approved period scope (each pinned by digest) over the
state-ref journal verified from its reviewed root, bound to the admitted request's approval reference and every applicable cumulative
ceiling. prepare writes its canonical bytes privately (reconciliation.json) and publishes their digest as a step output; those bytes are
what the stage runner's plan construction consumes (run_env --reconciliation). Every pin is None today, so every prepare refuses with a
continuity-* code naming the missing acceptance. There is no zero seed, fixture baseline, hash-only substitute or journal-less mode.
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
import tempfile
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline)
import accounting_rollup  # noqa: E402
import manual_reservation  # noqa: E402
import publish_latest_record as LR  # noqa: E402
import state_ref_writer  # noqa: E402

RUNTIME = "GitHub Actions SpeakSharp"
PRODUCER_CASES = {"AHT-01", "AHT-02", "AHT-03", "AHT-07", "AHT-08"}
# NIGHTLY facts (Elon 1793560137.871769, pending Sam's content/pin decision): a scheduled run has no operator facts input, so its facts are
# the committed file below, admitted only when its bytes hash to the reviewed pin. None today: every nightly prepare refuses.
NIGHTLY_FACTS_PATH = "tools/cloud-test/config/nightly/facts.json"
NIGHTLY_FACTS_SHA256 = None
ALL_CASES = ["AHT-%02d" % n for n in range(1, 16)]
# build_plan.py binds ONE account id for the whole plan and labels AHT-15 maintained-read-only (line 179), so roles never mix in one run.
ROLE = {**{c: "existing-disposable" for c in ALL_CASES[:14]}, "AHT-15": "maintained-read-only"}
ROLE_CREDENTIALS = {"existing-disposable": {"email": "THROWAWAY_TEST_EMAIL", "password": "THROWAWAY_TEST_PASSWORD"},
                    "maintained-read-only": {"email": "FREE_TEST_EMAIL", "password": "FREE_TEST_PASSWORD"}}
# The private CLOUD_TEST_LIVE_ACCOUNTS bundle (Sam 1793544453.003099): configuration only (emails and account ids, never a password or
# token), validated exactly as scripts/verify-test-users.mjs does, in the same order and with the same codes (shared vectors).
BUNDLE_ROLES = ("existing-disposable", "maintained-read-only")
BUNDLE_LIMIT = 4096
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
UUID_V4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
PROJECT_REF = re.compile(r"^[a-z0-9]{20}$")
# One explicit shared email contract (Sam 1793545693.919369): printable ASCII without space or "@" on both sides of exactly one "@", at
# most 254 characters; CONTROL stays for the environment-file writer.
EMAIL_ASCII = re.compile(r"^[\x21-\x3f\x41-\x7e]+@[\x21-\x3f\x41-\x7e]+$")
ENV_NAME = re.compile(r"^[A-Z_][A-Z0-9_]*$")
REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/#-]{2,159}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
RECEIPT_KEYS = {"pre", "rls", "analytics", "disp", "fence", "review"}  # build_plan.py 55
BACKEND_KEYS = {"manifestRef", "generation", "completion", "migration129"}
FACT_REQUIRED = {"ownerApprovalReference", "approvedBy", "reviewer", "receipts", "accounts"}
FACT_OPTIONAL = {"producerReviewReference", "providerEvidenceReferences", "backend", "olderReleaseDiagnostic", "actionApproval", "case10RequestBound"}
# The builder's Start/take action approval (case_start_caps.bind_inputs), supplied by its approver; prepare admits it, never builds it.
ACTION_APPROVAL_SCHEMA = "speaksharp.case-start-approval.v1"
ACTION_APPROVAL_KEYS = {"schema", "requestSha256", "reconciliationSha256", "approvalRef", "approvedBy", "selectionApprovalRef"}
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


def request_shape_ok(req, template_keys, extra=frozenset()):
    """A run request is exactly the reviewed template's fields plus REQUEST_EXTRA_KEYS (plus `extra`, only the gate-derived nightly request's
    `nightly` block in nightly mode); the schema must be v2."""
    return (isinstance(req, dict) and req.get("schema") == "speaksharp.cloud-test.run-request.v2" and
            template_keys <= set(req) <= template_keys | REQUEST_EXTRA_KEYS | set(extra))


def select_request(repo, rel, source_sha):
    """The request is a reviewed file in the ONE request location at the tested commit, tracked at exactly this source and byte-identical in
    the checkout. Returns its absolute path, blob id and the bytes read ONCE (the blob id is recomputed from exactly those bytes)."""
    _need(isinstance(rel, str) and rel and not os.path.isabs(rel) and os.path.normpath(rel) == rel and not rel.startswith(".."), "request-path")
    _need(os.path.dirname(rel) + "/" == REQUEST_DIR and rel.endswith(".json"), "request-not-in-the-reviewed-request-location")
    _need(_git(repo, "rev-parse", "HEAD") == source_sha, "checkout-not-at-source")
    blob = _git(repo, "rev-parse", "--verify", "--quiet", source_sha + ":" + rel)
    _need(blob is not None, "request-not-committed-at-source")
    path = os.path.join(repo, rel)
    _need(os.path.isfile(path) and not os.path.islink(path), "request-differs-from-commit")
    raw = _read(path)
    _need(hashlib.sha1(b"blob %d\0" % len(raw) + raw).hexdigest() == blob, "request-differs-from-commit")
    return path, blob, raw


def nightly_request(path, gate_sha256, run_id, source_sha):
    """NIGHTLY mode (Sam 1793557964.186059): the request is exactly the bytes the credential-free nightly gate derived and admitted, delivered
    as its step outputs (request_b64 beside request_sha256), never a committed file. Read ONCE from a regular private file; their digest must
    be the gate's; they must be a nightly-regression request for THIS run (attempt 1) testing exactly this source. Returns (path, blob, raw)."""
    _need(isinstance(gate_sha256, str) and SHA64.match(gate_sha256) is not None, "nightly-gate-digest")
    _need(isinstance(path, str) and os.path.isfile(path) and not os.path.islink(path), "nightly-request-unreadable")
    raw = _read(path)
    _need(hashlib.sha256(raw).hexdigest() == gate_sha256, "nightly-request-not-the-gate-admission")
    try:
        req = json.loads(raw)
    except ValueError:
        raise Refused("nightly-request-unreadable")
    n = req.get("nightly") if isinstance(req, dict) else None
    _need(isinstance(n, dict) and req.get("priority") == "nightly-regression", "nightly-request-not-nightly")
    _need(n.get("runId") == run_id and type(n.get("attempt")) is int and n["attempt"] == 1, "nightly-request-not-this-run")
    _need((req.get("release") or {}).get("testedSha") == source_sha, "nightly-request-not-this-source")
    return path, hashlib.sha1(b"blob %d\0" % len(raw) + raw).hexdigest(), raw


def nightly_facts(repo, pin=None):
    """The scheduled run's facts: exactly the committed facts file whose bytes hash to the reviewed pin (`pin` is a TEST-ONLY override of
    NIGHTLY_FACTS_SHA256). Validated afterwards by the same translate_facts/account checks as a dispatch's facts."""
    pinned = NIGHTLY_FACTS_SHA256 if pin is None else pin
    _need(pinned is not None, "nightly-facts-not-pinned")
    path = os.path.join(repo, NIGHTLY_FACTS_PATH)
    _need(os.path.isfile(path) and not os.path.islink(path), "nightly-facts-unreadable")
    raw = _read(path)
    _need(hashlib.sha256(raw).hexdigest() == pinned, "nightly-facts-not-the-pinned-bytes")
    try:
        return json.loads(raw)
    except ValueError:
        raise Refused("nightly-facts-unreadable")


def admitted_request(path, admitted_sha256):
    """Every later reader of the request (window check, qualification) reads its bytes ONCE, hashes and parses those same bytes, and refuses
    unless they are exactly the bytes prepare admitted. The admitted digest travels only as the init step's output, which no later step can
    rewrite, so a request substituted after admission (even one keeping every field qualify compares) never reaches a record."""
    _need(isinstance(admitted_sha256, str) and SHA64.match(admitted_sha256), "admitted-request-digest")
    raw = _read(path)
    _need(hashlib.sha256(raw).hexdigest() == admitted_sha256, "request-changed-since-admission")
    return json.loads(raw)


def check_request(req, now, template_keys, nightly=False):
    """Live, approved, for THIS source and window, complete-case sampling. Returns the sorted selected cases. A nightly-regression request
    is admitted only in nightly mode (from the gate), and only there may it carry its `nightly` block."""
    _need(request_shape_ok(req, template_keys, {"nightly"} if nightly else ()), "request-schema")
    _need((req.get("priority") == "nightly-regression") == nightly, "nightly-request-needs-the-gate" if not nightly else "nightly-request-not-nightly")
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


def check_window_remaining(req, now, live_minutes):
    """Immediately before the run step (admission): the approved window must still hold the live minutes plus the collect reserve. The
    window is never reset or extended; setup time already spent is simply gone."""
    end = _utc(req["window"]["endUtc"])
    _need(_int(live_minutes) and live_minutes > 0, "live-minutes")
    _need((end - now).total_seconds() >= 60 * (live_minutes + COLLECT_RESERVE_MINUTES), "approved-window-too-short-at-admission")


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


def parse_live_accounts_bundle(raw):
    """The bundle -> {"projectRef", "accounts": {role: {"email", "accountId"}}}, or Refused with a fixed code that never quotes it."""
    _need(isinstance(raw, str) and raw.strip(), "bundle-missing")
    _need(len(raw.encode("utf-8")) <= BUNDLE_LIMIT, "bundle-too-large")
    def no_constants(name):  # NaN/Infinity are not JSON (JSON.parse refuses them too)
        raise ValueError(name)
    try:
        doc = json.loads(raw, parse_constant=no_constants)
    except ValueError:
        raise Refused("bundle-not-json")

    def exact(o, keys):
        return isinstance(o, dict) and sorted(o) == sorted(keys)
    v = doc.get("version") if isinstance(doc, dict) else None
    _need(exact(doc, ("version", "projectRef", "accounts")) and type(v) in (int, float) and v == 1 and exact(doc["accounts"], BUNDLE_ROLES), "bundle-shape")
    for role in BUNDLE_ROLES:
        _need(exact(doc["accounts"][role], ("email", "accountId")), "bundle-shape")
    _need(isinstance(doc["projectRef"], str) and PROJECT_REF.match(doc["projectRef"]), "bundle-project")
    for role in BUNDLE_ROLES:
        e = doc["accounts"][role]["email"]
        _need(isinstance(e, str) and len(e) <= 254 and EMAIL_ASCII.fullmatch(e), "bundle-email")
    for role in BUNDLE_ROLES:
        _need(isinstance(doc["accounts"][role]["accountId"], str) and UUID_V4.match(doc["accounts"][role]["accountId"]), "bundle-account-id")
    a, b = (doc["accounts"][r] for r in BUNDLE_ROLES)
    _need(a["email"].lower() != b["email"].lower() and a["accountId"] != b["accountId"], "bundle-duplicate")
    return {"projectRef": doc["projectRef"], "accounts": {r: {"email": doc["accounts"][r]["email"], "accountId": doc["accounts"][r]["accountId"]}
                                                          for r in BUNDLE_ROLES}}


def canonical_bundle_bytes(bundle):
    """The VALIDATED minimum binding document as the exact file bytes both runtimes agree on (Jensen 1793552377.273939): UTF-8 JSON with
    keys sorted at every level, "," and ":" separators, no whitespace, then exactly one LF. Every value is ASCII by validation, so Python
    and a sorted-key JS stringify match. live_accounts_sha256 is the lowercase SHA-256 of exactly these bytes."""
    doc = {"version": 1, "projectRef": bundle["projectRef"], "accounts": bundle["accounts"]}
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii") + b"\n"


def mask_values(raw):
    """The whole raw bundle (even malformed) and, once it parses, every email (as given and lower-cased) and account id."""
    values = [raw]
    try:
        for acct in parse_live_accounts_bundle(raw)["accounts"].values():
            values += [acct["email"], acct["email"].lower(), acct["accountId"]]
    except Refused:
        pass
    return values


def mask_commands(values):
    """GitHub ::add-mask:: lines with escaped data (% -> %25, CR -> %0D, LF -> %0A), one line each; multi-line values also per line."""
    out = []
    for v in values:
        if not isinstance(v, str) or not v.strip():
            continue
        for item in [v] + [ln for ln in re.split(r"\r\n|\r|\n", v) if ln.strip() and ln != v]:
            cmd = "::add-mask::" + item.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
            if cmd not in out:
                out.append(cmd)
    return out


def is_project_origin(url, project_ref):
    """The approved Supabase project origin, exactly: https://<projectRef>.supabase.co (a trailing "/" and the default port are the same
    origin; scheme and host compare case-insensitively, as URL origins do). One full-string match bound to THIS project's reference, with
    literal dots and no URL parser (Sam 1793564538.998609): HTTP, any userinfo or "@", another port, another or suffixed domain, any path,
    query or fragment, trailing junk, and anything else refuse."""
    # fullmatch, not match: `$` alone admits a final newline. ASCII case-folding only: Unicode folding would accept "\u017fupabase.co".
    if not isinstance(url, str) or not isinstance(project_ref, str) or not PROJECT_REF.fullmatch(project_ref):
        return False
    return re.fullmatch(r"https://" + re.escape(project_ref) + r"\.supabase\.co(?::443)?/?", url, re.IGNORECASE | re.ASCII) is not None


def role_account(bundle, role, supabase_url):
    """Role truth: each role's data populates only its own credential names (AHT-01..14 existing-disposable -> THROWAWAY_*, AHT-15
    maintained-read-only -> FREE_*), never another role's. Whether a role may run at all is the reviewed run-stage allowlist's decision
    (account_bindings)."""
    _need(is_project_origin(supabase_url, bundle["projectRef"]), "bundle-project-mismatch")
    _need(role in bundle["accounts"], "account-role-not-in-bundle")
    return bundle["accounts"][role]


def write_env_file(path, mapping):
    """$GITHUB_ENV lines only for plain names and single-line, control-free values; anything else refuses before a byte is written."""
    for k, v in mapping.items():
        _need(ENV_NAME.match(k) and isinstance(v, str) and not CONTROL.search(v), "unsafe-environment-value")
    with open(path, "a", encoding="utf-8") as f:
        f.writelines("%s=%s\n" % kv for kv in sorted(mapping.items()))


def account_bindings(cfg, cases, facts_accounts, bundle):
    """Every role the selection needs (Jensen's I1'/I2' contract: AHT-01..14 existing-disposable, AHT-15 maintained-read-only, so an all-15 run
    is 14+1), each bound to its own credential NAMES, its account ID from the private bundle (checked by digest against the approved binding)
    and its history reference. A role's names must be ones the run stage actually receives (config credentials.runEnvironment.stages.run);
    values are never renamed into another role's names. Returns one binding per role, sorted by role."""
    roles = sorted({ROLE[c] for c in cases})
    _need(isinstance(facts_accounts, dict) and sorted(facts_accounts) == roles, "account-binding-roles")
    run_names = set(cfg["credentials"]["runEnvironment"]["stages"]["run"])
    out = []
    for role in roles:
        names = ROLE_CREDENTIALS[role]
        _need({names["email"], names["password"]} <= run_names, "role-credentials-not-in-run-stage-allowlist")
        fa = facts_accounts[role]
        _need(isinstance(fa, dict) and set(fa) == {"idSha256", "historyRef"}, "account-binding-shape")
        account_id = (bundle["accounts"].get(role) or {}).get("accountId")
        _need(isinstance(account_id, str) and account_id.strip() == account_id and account_id, "account-id-source-missing")
        _need(isinstance(fa["idSha256"], str) and SHA64.match(fa["idSha256"]) and
              hashlib.sha256(account_id.encode()).hexdigest() == fa["idSha256"], "account-id-not-the-approved-account")
        _need(_ref(fa["historyRef"]), "account-history-reference")
        out.append({"role": role, "credentials": dict(names), "historyRef": fa["historyRef"]})
    return out


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
    return {k: v for k, v in facts.items() if k not in ("accounts", "olderReleaseDiagnostic")}


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


# The committed, content-free continuity inputs (each admitted only by its reviewed digest pin; none is committed or pinned today).
CONTINUITY_DIR = "tools/cloud-test/config/aggregate"
CONTINUITY_BOOTSTRAP, CONTINUITY_SCOPE = "accounting-bootstrap.json", "period-scope.json"
# Cumulative ceilings the accepted scope must state exactly as the admitted request approved them (scope key, approvedLimits key).
CONTINUITY_CEILINGS = (("requests", "cumulativeCeilingRequests"), ("identityReads", "identityCap"), ("starts", "startsCap"), ("takes", "takesCap"))


def continuity_pins():
    """The production acceptance pins, all reviewed changes: the bootstrap digest and its root, the approved scope digest, the writer root."""
    return {"accepted_sha256": accounting_rollup.ACCEPTED_BOOTSTRAP_SHA256, "accepted_root": accounting_rollup.ACCEPTED_ROOT,
            "accepted_scope_sha256": manual_reservation.ACCEPTED_SCOPE_SHA256, "reviewed_root": state_ref_writer.REVIEWED_ROOT}


def state_chain(root):
    """The state-ref journal, fetched into an empty private repository and verified from the reviewed root through its head."""
    path = tempfile.mkdtemp(prefix="continuity-ledger-")
    _need(subprocess.run(["git", "init", "-q", path], capture_output=True, env={"PATH": os.environ.get("PATH", ""), "GIT_CONFIG_NOSYSTEM": "1",
                         "GIT_CONFIG_GLOBAL": os.devnull, "GIT_TEMPLATE_DIR": ""}).returncode == 0, "continuity-ledger-repo")
    url = state_ref_writer.APPROVED_URL
    return state_ref_writer.validate_chain(path, state_ref_writer.fetch_head(path, url, url), root)


def check_case10_bound(req, facts, cases, entries):
    """Sam 1793567664.474339 item 2: the Case 10 request-bound projection the builder consumes is admitted only when the builder's own
    validator (case_start_caps.case10_execution_bound: shape, schema, run/source/account binding, evidence reference, the request row's
    requestBoundSha256 over the exact record bytes, and the unchanged 240 allowance) accepts it for the admitted request and the Case 10
    role's account. A record supplied when Case 10 needs none refuses. Returns the builder's bound report, or None."""
    import case_start_caps as CS
    account = entries[ROLE["AHT-10"]]["accountId"] if "AHT-10" in cases else ""
    try:
        bound = CS.case10_execution_bound(req, facts, account)
    except CS.InputValidationError as e:
        raise Refused(str(e))
    _need(bound is not None or "case10RequestBound" not in facts, "case10-bound-not-applicable")
    return bound


def check_action_approval(approval, request_sha256, reconciliation_bytes, req):
    """RETURN 1793567352.685309 #1: the builder's Start/take action approval, as SUPPLIED in the facts by its approver, admitted only when it
    names exactly the admitted request bytes, exactly the continuity checkpoint bytes, and the request's own approval and selection
    references. The real consumer (case_start_caps.bind_inputs) checks the same envelope again against the bytes it reads."""
    _need(isinstance(approval, dict) and set(approval) == ACTION_APPROVAL_KEYS and approval["schema"] == ACTION_APPROVAL_SCHEMA,
          "action-approval-shape")
    _need(approval["requestSha256"] == request_sha256, "action-approval-not-the-request")
    _need(approval["reconciliationSha256"] == hashlib.sha256(reconciliation_bytes).hexdigest(), "action-approval-not-the-checkpoint")
    lim = req["approvedLimits"]
    _need(_ref(approval["approvalRef"]) and approval["approvalRef"] == lim.get("approvalRef") and approval["approvedBy"] == lim.get("approvedBy"),
          "action-approval-reference")
    _need(approval["selectionApprovalRef"] == req.get("selectionApprovalRef"), "action-approval-selection")
    return approval


def verified_checkpoint(repo, req, pins=None, chain_reader=None):
    """The continuity checkpoint: the canonical bytes of the accepted rollup, bound to this request, or a continuity-* refusal. `pins` and
    `chain_reader` are TEST-ONLY overrides; production uses continuity_pins() (all None today) and the real state-ref journal."""
    pins = continuity_pins() if pins is None else pins
    _need(pins.get("accepted_sha256") is not None and pins.get("accepted_root") is not None, "continuity-rollup-not-accepted")
    _need(pins.get("reviewed_root") is not None and pins["reviewed_root"] == pins["accepted_root"], "continuity-state-root-not-pinned")
    _need(pins.get("accepted_scope_sha256") is not None, "continuity-scope-not-accepted")
    raws = {}
    for name in (CONTINUITY_BOOTSTRAP, CONTINUITY_SCOPE):
        path = os.path.join(repo, CONTINUITY_DIR, name)
        _need(os.path.isfile(path) and not os.path.islink(path), "continuity-inputs-missing")
        raws[name] = _read(path)
    try:
        scope = manual_reservation.accepted_scope(raws[CONTINUITY_SCOPE], pins["accepted_scope_sha256"])
        rc = accounting_rollup.receive(raws[CONTINUITY_BOOTSTRAP], scope, (chain_reader or state_chain)(pins["reviewed_root"]), pins["accepted_sha256"],
                                       pins["accepted_root"])
    except (accounting_rollup.Refused, manual_reservation.Refused, state_ref_writer.Refused) as e:
        raise Refused("continuity-" + str(e))
    lim = req.get("approvedLimits") or {}
    _need(isinstance(lim.get("approvalRef"), str) and scope["approvalRef"] == lim["approvalRef"], "continuity-approval-not-the-request")
    # Sam RETURN 1793567352.685309 #2: the whole execution window lies inside the accepted period (no future or expired period admits it).
    window = req.get("window") or {}
    _need(_utc(scope["periodStartUtc"]) <= _utc(window.get("startUtc")) and _utc(window.get("endUtc")) <= _utc(scope["periodEndUtc"]),
          "continuity-window-outside-period")
    nightly = req.get("priority") == "nightly-regression"
    for ceiling, limit in CONTINUITY_CEILINGS:
        if nightly and limit == "identityCap":
            # RETURN #3: a nightly request's identityCap is its PER-RUN cap (nightly_request.derive), not the period ceiling; it must fit
            # the period's remaining identity headroom instead of equalling the period ceiling.
            _need(_int(lim.get(limit)) and lim[limit] <= rc["currentHeadroom"]["identityReads"], "continuity-run-identity-exceeds-period")
            continue
        # Applicable = stated by the admitted request; the cumulative request and identity ceilings are always stated (check_request).
        if lim.get(limit) is not None or limit in ("cumulativeCeilingRequests", "identityCap"):
            _need(_int(lim.get(limit)) and rc["ceilings"][ceiling] == lim[limit], "continuity-ceiling-not-the-request:" + ceiling)
    return (json.dumps(rc, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")


def prepare(x, now):
    repo = os.path.realpath(x.repo)
    _need(isinstance(x.run_id, str) and LR.RUN_ID.match(x.run_id) and x.attempt == 1, "run-identity")
    _need(isinstance(x.source_sha, str) and LR.SHA40.match(x.source_sha), "source-sha")
    nightly = bool(x.nightly_request_file or x.nightly_request_sha256)
    _need(not (nightly and x.request), "request-source-ambiguous")
    _need(_git(repo, "rev-parse", "HEAD") == x.source_sha, "checkout-not-at-source")
    req_path, req_blob, req_raw = (nightly_request(x.nightly_request_file, x.nightly_request_sha256, x.run_id, x.source_sha) if nightly
                                   else select_request(repo, x.request, x.source_sha))
    req, cfg, template_keys = json.loads(req_raw), _load(os.path.join(repo, x.config)), _request_keys()
    cases = check_request(req, now, template_keys, nightly)
    route = "github-producer" if set(cases) & PRODUCER_CASES else "github-direct"
    live_minutes = check_ceilings(cfg, req, cases, x.job_timeout_minutes)
    check_window_fit(req, now, live_minutes)
    _need(not (nightly and x.facts), "nightly-facts-input-refused")
    facts = nightly_facts(repo) if nightly else json.loads(x.facts or "null")
    _need(isinstance(facts, dict), "facts-shape")
    lineage = check_release_lineage(repo, req, x.request, x.source_sha, req_blob, cases, facts.get("olderReleaseDiagnostic"), template_keys)
    bundle = parse_live_accounts_bundle(os.environ.get("CLOUD_TEST_LIVE_ACCOUNTS"))
    accounts = account_bindings(cfg, cases, facts.get("accounts"), bundle)
    entries = {b["role"]: role_account(bundle, b["role"], os.environ.get("SUPABASE_URL")) for b in accounts}
    check_case10_bound(req, facts, cases, entries)
    # The producer route's cases (01/02/03/07/08) all run as existing-disposable; it is also the primary id for the account-id file.
    primary = "existing-disposable" if "existing-disposable" in entries else "maintained-read-only"
    account_id = entries[primary]["accountId"]
    builder_facts = translate_facts(facts, req, route)
    scope = compose_scope(req, builder_facts, entries["existing-disposable"]["accountId"] if route == "github-producer" else account_id, cases, route)
    # Cumulative request/identity/Starts/takes caps are G5's (check_gates.py 131-170, run by execute_run gate-and-validate with --enforce-go
    # before reserve or run); the caller supplies G5's verified inputs and never re-derives its formula.
    reconciliation = verified_checkpoint(repo, req)
    check_action_approval(facts.get("actionApproval"), hashlib.sha256(req_raw).hexdigest(), reconciliation, req)
    return {"request": req_path, "requestBlob": req_blob, "requestRaw": req_raw, "bundleBytes": canonical_bundle_bytes(bundle),
            "reconciliationBytes": reconciliation, "requestSha256": hashlib.sha256(req_raw).hexdigest(),
            "testedSha": req["release"]["testedSha"], "lineage": lineage, "cases": cases,
            "accountId": account_id, "emails": {b["credentials"]["email"]: entries[b["role"]]["email"] for b in accounts},
            "coverageMode": req["coverageMode"], "route": route, "liveMinutes": live_minutes,
            "accounts": accounts, "facts": builder_facts, "scope": scope}


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


def identities(request_path, config_path, admitted_sha256):
    """The ADMITTED request (exactly the bytes prepare admitted) and the pinned assertion catalog this run claims coverage against: the
    catalog file must still be the pinned bytes, and its exact per-case required-assertion sets are what qualification checks every case
    config against."""
    request = admitted_request(request_path, admitted_sha256)
    pin = _load(config_path)["modes"]["full"]["assertionCatalog"]
    catalog = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(config_path))), pin["file"])
    raw = _read(catalog)
    _need(hashlib.sha256(raw).hexdigest() == pin["sha256"], "assertion-catalog-not-pinned")
    cases = json.loads(raw)["cases"]
    return {"requestSha256": admitted_sha256, "request": request, "catalogSha256": pin["sha256"],
            "catalog": {cid: list(c["requiredAssertions"]) for cid, c in cases.items()}}


def qualify(plan_path, case_results_path, cases_dir, selected, approval, code_manifest, snapshot_dir, coverage_mode, ids,
            run_verifier=_run_verifier):
    """Freeze every verifier input, run the REAL verifier on the frozen snapshot only (fresh --out, exit 0, zero failures for exactly the
    frozen plan and results), then decide from the same frozen bytes: the builder's 15-row denominator with the dispatch subset in
    plan.selection, every selected case dispatched with a case result consistent with its rows, every required assertion present exactly
    once, and every evidence digest and summary matching the frozen bytes. EXECUTION and OUTCOME are separate (Sam 1793547120.015339):
    coverage is full/batch only when every selected required row was executed (PASS or FAIL), otherwise incomplete; the outcome is passed
    only when every one is PASS. A FAIL never weakens a binding check. The result binds the campaign, releases, plan/results digests,
    request, assertion catalog and harness CODE manifest."""
    selected = sorted(selected)
    _need(selected and all(c in ROLE for c in selected) and len(set(selected)) == len(selected), "case-selection")
    _need(coverage_mode in ("partial", "full"), "coverage-mode")
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
    # The committed request is THIS campaign's: its runId, selection, tested release, mode and harness CODE pin are what ran (Sam RETURN
    # 546429c4 #2). A substituted request refuses before any row is read.
    req = ids["request"]
    _need(req.get("runId") == plan.get("campaignId"), "request-campaign-mismatch")
    _need(sorted(s.get("case") for s in req.get("selection") or []) == selected, "request-selection-mismatch")
    _need((req.get("release") or {}).get("testedSha") == plan.get("sourceSha"), "request-release-mismatch")
    _need(req.get("coverageMode") == coverage_mode, "request-mode-mismatch")
    _need((req.get("harness") or {}).get("codeManifestSha256") == digest(frozen["packet/CODE.sha256"]), "request-harness-mismatch")
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
    # Coverage comes from the request's validated mode and the builder's own markers (build_plan.py 345-353, run_env.py 45): selected-full
    # marks coverageMode partial + assertionDepth full; full mode adds no marker and selects all 15 (an explicit selection object is allowed).
    if coverage_mode == "full":
        _need(selected == ALL_CASES and "coverageMode" not in plan and "assertionDepth" not in plan, "plan-not-a-full-coverage-plan")
    else:
        _need(plan.get("coverageMode") == "partial" and plan.get("assertionDepth") == "full", "plan-not-a-selected-full-plan")
    counts = {"PASS": 0, "FAIL": 0, "NOT RUN": 0}
    case_outcomes = []
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
        # Exact catalog membership (RETURN 546429c4 #1): the case's required set IS the pinned catalog's set for that case.
        _need(sorted(required) == sorted(ids["catalog"].get(cid) or []), "required-assertions-not-the-catalog:" + cid)
        raw = frozen.get("cases/%s/case-result.json" % cid)
        _need(raw is not None, "case-result-missing:" + cid)
        out_case = json.loads(raw)
        for ref, want in (out_case.get("evidenceDigests") or {}).items():
            _need(digest(frozen.get("cases/%s/%s" % (cid, os.path.normpath(ref)), b"\0missing")) == want, "evidence-not-the-frozen-bytes:" + cid)
        summary = (r.get("executionReceipt") or {}).get("summarySha256")
        _need(summary is None or digest(frozen.get("cases/%s/summary.json" % cid, b"\0missing")) == summary, "summary-not-the-frozen-bytes:" + cid)
        got = _unique(out_case.get("assertions"), "id", "duplicate-assertion:" + cid)
        _need(out_case.get("caseId") == cid, "case-result-for-another-case:" + cid)
        _need(all(a.get("result") in ("PASS", "FAIL", "NOT RUN") for a in got.values()), "assertion-result-unknown:" + cid)
        # The harness's own case result must agree with its rows (case-results.cjs): FAIL if any row FAILs, PASS only if every row PASSes.
        rows_all = [a["result"] for a in got.values()]
        expect = "FAIL" if "FAIL" in rows_all else "PASS" if rows_all and all(r == "PASS" for r in rows_all) else "NOT RUN"
        _need(out_case.get("result") == expect, "case-result-inconsistent:" + cid)
        # The campaign case-results row must say exactly what the per-case result says (RETURN 546429c4 #3): the same case result and the
        # same assertion ids with the same statuses, whatever the overall outcome.
        row = _unique(r.get("assertions"), "id", "campaign-row-disagrees:" + cid)
        _need(r.get("result") == out_case["result"] and {k: v.get("result") for k, v in row.items()} == {k: v["result"] for k, v in got.items()},
              "campaign-row-disagrees:" + cid)
        for a in required:
            counts[got[a]["result"] if a in got else "NOT RUN"] += 1
        case_outcomes.append(out_case["result"])
    executed = counts["NOT RUN"] == 0
    return {"qualified": True, "campaignId": plan["campaignId"], "testedSha": plan["sourceSha"], "servedSha": results.get("servedSha"),
            "planSha256": digest(original_plan), "caseResultsSha256": digest(frozen["case-results.json"]), "cases": selected,
            "coverage": ("full" if coverage_mode == "full" else "batch") if executed else "incomplete",
            "outcome": "passed" if executed and counts["FAIL"] == 0 and all(o == "PASS" for o in case_outcomes) else "failed",
            "requestSha256": ids["requestSha256"], "catalogSha256": ids["catalogSha256"], "codeManifestSha256": digest(frozen["packet/CODE.sha256"]),
            "planCases": len(rows), "requiredRows": sum(counts.values()), "passRows": counts["PASS"], "failRows": counts["FAIL"],
            "notRunRows": counts["NOT RUN"]}


# I4' receiving contract, bound to Jensen's producers at 75b47b2c (Sam 1793550229.086469 / 1793554840.089039). Every request reader records
# the digest of the ONE buffer it hashed, parsed and compared with the admitted digest before any effect:
#   build-plan     plan/cfg/build-plan-consumption.json: {consumer, campaignId, runId, attempt, requestSha256, planSha256, sourceSha, ...}
#   reservation    the reserve ledger event's requestConsumption (nightly-regression requests only; reservations.py refuses others)
#   runtime-start  run/cases/<case>/runtime-start-consumption.json, bound by the case execution receipt's runtimeStartReceiptSha256
#   collector      run-record.json executionProvenance: {consumer, ..., caseResultsSha256, runtimeReceiptDigests{case: execution receipt}}
# The execution identity is {campaignId: the request runId, runId: GITHUB_RUN_ID, attempt: 1}.
READER_KEYS = {"requestSha256", "campaignId", "runId", "attempt", "consumer", "consumedAtUtc"}
EXECUTION_KEYS = {"campaignId", "runId", "attempt", "caseId", "requestSha256", "planSha256", "configSha256", "sourceSha", "servedSha",
                  "runtimeStartReceiptSha256"}


def required_readers(priority):
    """Nightly runs reserve before any spend, so their reservation record is required. A manual run has no reservation record until the
    manual/accepted-rollup reservation design lands (Sam 1793554840.089039); then it becomes required here too."""
    return ("reservation", "build-plan", "collector") if priority == "nightly-regression" else ("build-plan", "collector")


def _canon_digest(doc):
    """The collector's canonical digest (collect_run_record.canonical_digest): sorted keys, compact separators, no trailing LF."""
    return hashlib.sha256(json.dumps(doc, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _is64(v):
    return isinstance(v, str) and SHA64.match(v) is not None


def _is40(v):
    return isinstance(v, str) and LR.SHA40.match(v) is not None


def _same(record, identity):
    """Strict equality on every identity field: the same type AND value (True is not 1; 123 is not "123")."""
    return all(type(record.get(k)) is type(v) and record.get(k) == v for k, v in identity.items())


def _json_object(raw, code):
    _need(isinstance(raw, bytes), code)
    try:
        doc = json.loads(raw)
    except ValueError:
        raise Refused(code)
    _need(isinstance(doc, dict), code)
    return doc


def _reader(record, consumer, admitted, identity):
    _need(isinstance(record, dict) and READER_KEYS <= set(record) and record.get("consumer") == consumer, "request-reader-record:" + consumer)
    _need(_is64(record["requestSha256"]) and record["requestSha256"] == admitted, "request-not-the-admitted-request:" + consumer)
    _need(_same(record, identity), "reader-not-this-attempt:" + consumer)


def check_execution_provenance(admitted, identity, priority, plan_raw, build_receipt_raw, reservation_record, case_results_raw,
                               runtime_start_raws, run_record, selected):
    """Execution provenance from what each consumer RECORDED when it read its input, never a rehash of a file at the end. Every expectation
    (campaign, releases, config digests) comes from the FROZEN PLAN BYTES; every input's shape is validated before any lookup or hash, and
    every refusal is a deliberate code.
    - the admission identity is checked on its own first: campaignId, a numeric GitHub run id, and attempt exactly 1;
    - build-plan's record names the admitted digest, this identity, the executed plan's exact bytes and the plan's releases, and the plan's
      own bytes name the admitted request (a misreporting builder is caught by the plan);
    - for a nightly run, the reservation's request-consumption record names the admitted digest and this identity;
    - every selected case's execution receipt names this identity, the admitted digest, the plan, the plan's config digest for the case and
      the plan's releases, and binds its runtime-start record by its file bytes; that record says the same;
    - the collector's record names the admitted digest, this identity, the frozen case results and each execution receipt's canonical digest.
    A request swapped for the run and restored before collection fails at build-plan (it read the swapped bytes)."""
    _need(_is64(admitted), "admitted-request-digest")
    _need(isinstance(identity, dict) and set(identity) == {"campaignId", "runId", "attempt"} and
          isinstance(identity["campaignId"], str) and identity["campaignId"].strip() == identity["campaignId"] and identity["campaignId"] and
          isinstance(identity["runId"], str) and LR.RUN_ID.match(identity["runId"]) and type(identity["attempt"]) is int and
          identity["attempt"] == 1, "execution-identity")
    _need(isinstance(selected, list) and selected and all(isinstance(c, str) and c in ROLE for c in selected) and
          len(set(selected)) == len(selected), "case-selection")
    _need(isinstance(plan_raw, bytes) and isinstance(case_results_raw, bytes), "provenance-inputs")
    plan = _json_object(plan_raw, "runtime-plan-unreadable")
    _need(type(plan.get("campaignId")) is str and plan["campaignId"] == identity["campaignId"], "plan-not-this-campaign")
    _need(_is40(plan.get("sourceSha")) and _is40(plan.get("servedSha")), "plan-release")
    _need(isinstance(plan.get("cases"), list) and all(isinstance(c, dict) and isinstance(c.get("id"), str) for c in plan["cases"]), "plan-cases")
    planned = _unique(plan["cases"], "id", "plan-cases")
    _need(all(c in planned and _is64(planned[c].get("configSha256")) for c in selected), "planned-config-digests")
    plan_sha = hashlib.sha256(plan_raw).hexdigest()
    release = {"sourceSha": plan["sourceSha"], "servedSha": plan["servedSha"]}
    # build-plan
    build = _json_object(build_receipt_raw, "request-reader-record:build-plan")
    _reader(build, "build-plan", admitted, identity)
    _need(build.get("planSha256") == plan_sha, "runtime-plan-not-the-built-plan")
    _need(all(build.get(k) == v for k, v in release.items()), "build-plan-release")
    _need(plan.get("requestSha256") == admitted, "runtime-plan-not-from-the-admitted-request")
    # reservation
    if "reservation" in required_readers(priority):
        _reader(reservation_record, "reservation", admitted, identity)
    else:
        _need(reservation_record is None, "unexpected-reservation-record")
    # runtime: each selected case's execution receipt, and its runtime-start record by file bytes
    results = _json_object(case_results_raw, "case-results-unreadable")
    _need(isinstance(results.get("cases"), list) and all(isinstance(r, dict) and isinstance(r.get("caseId"), str) for r in results["cases"]),
          "case-results-unreadable")
    rows = _unique(results["cases"], "caseId", "duplicate-case-result")
    _need(isinstance(runtime_start_raws, dict), "runtime-start-records")
    receipts = {}
    for cid in sorted(selected):
        rr = (rows.get(cid) or {}).get("executionReceipt")
        expected = dict(identity, caseId=cid, requestSha256=admitted, planSha256=plan_sha, configSha256=planned[cid]["configSha256"], **release)
        _need(isinstance(rr, dict) and EXECUTION_KEYS <= set(rr) and _same(rr, expected), "runtime-receipt-not-bound:" + cid)
        start_raw = runtime_start_raws.get(cid)
        _need(isinstance(start_raw, bytes) and hashlib.sha256(start_raw).hexdigest() == rr["runtimeStartReceiptSha256"], "runtime-start-not-bound:" + cid)
        start = _json_object(start_raw, "runtime-start-not-bound:" + cid)
        _reader(start, "runtime-start", admitted, identity)
        _need(_same(start, {k: expected[k] for k in ("caseId", "planSha256", "configSha256", "sourceSha", "servedSha")}), "runtime-start-not-bound:" + cid)
        receipts[cid] = rr
    # collector
    _need(isinstance(run_record, dict), "request-reader-record:collector")
    collector = run_record.get("executionProvenance")
    _reader(collector, "collector", admitted, identity)
    _need(collector.get("caseResultsSha256") == hashlib.sha256(case_results_raw).hexdigest(), "collection-not-these-case-results")
    digests = collector.get("runtimeReceiptDigests")
    _need(isinstance(digests, dict) and all(digests.get(cid) == _canon_digest(receipts[cid]) for cid in receipts), "collection-runtime-digests")
    return {"requestSha256": admitted, "planSha256": plan_sha, "cases": sorted(selected), "readers": list(required_readers(priority)),
            "caseResultsSha256": hashlib.sha256(case_results_raw).hexdigest(), **identity}


def reservation_consumption(ledger, campaign_id):
    """The nightly reservation's request-consumption record for this campaign, from the reservation ledger's reserve events: exactly one."""
    events = [e for e in (ledger or {}).get("events") or [] if isinstance(e, dict) and e.get("event") == "reserve"
              and isinstance(e.get("requestConsumption"), dict) and e["requestConsumption"].get("campaignId") == campaign_id]
    _need(len(events) == 1, "request-reader-record:reservation")
    return events[0]["requestConsumption"]


def provenance_from_files(request_path, request_sha256, run_id, plan_path, build_receipt_path, reservations_path, case_results_path,
                          cases_dir, run_record_path, selected):
    """Reads each producer's record from the files the run wrote and checks them. Every file is read once, as bytes."""
    req = admitted_request(request_path, request_sha256)
    identity = {"campaignId": req.get("runId"), "runId": run_id, "attempt": 1}
    reservation = None
    if req.get("priority") == "nightly-regression":
        reservation = reservation_consumption(_load(reservations_path), req.get("runId")) if reservations_path else None
    starts = {}
    for cid in selected:
        path = os.path.join(cases_dir, cid, "runtime-start-consumption.json") if cid in ROLE else None
        if path and os.path.isfile(path) and not os.path.islink(path):
            starts[cid] = _read(path)
    return check_execution_provenance(request_sha256, identity, req.get("priority"), _read(plan_path), _read(build_receipt_path), reservation,
                                      _read(case_results_path), starts, _load(run_record_path), list(selected))


def _unique(items, key, code):
    _need(isinstance(items, list), code)
    out = {}
    for item in items:
        _need(isinstance(item, dict) and item.get(key) not in out, code)
        out[item[key]] = item
    return out


def project(run_record, run_id, attempt, source_sha, tested_sha, qualification=None, request_sha256=None, provenance=None):
    """run-record.json (the real collector keeps all 15 rows) -> the closed latest record. Qualification counts only when it is bound to THIS
    record and THIS admission: the same case-results digest, tested release, observed served release and admitted request digest. Then the selected rows keep their results, the others
    are NOT SELECTED, and coverage says batch or full truthfully. `passed` needs that binding and every selected row PASS; anything else is
    `failed` with code not-qualified."""
    _need(isinstance(run_record, dict) and run_record.get("schema") == "speaksharp.cloud-test.run-record.v1", "run-record-schema")
    rel = run_record.get("release") or {}
    _need(isinstance(tested_sha, str) and LR.SHA40.match(tested_sha) and rel.get("testedSha") == tested_sha, "run-record-for-another-release")
    q = qualification if isinstance(qualification, dict) else {}
    campaign = run_record.get("runId")
    qualified = (q.get("qualified") is True and isinstance(campaign, str) and campaign.strip() and q.get("campaignId") == campaign and
                 q.get("caseResultsSha256") == (run_record.get("artifactDigests") or {}).get("case-results.json") and
                 q.get("testedSha") == tested_sha and q.get("servedSha") == rel.get("servedShaAtAdmission") and
                 q.get("codeManifestSha256") == (run_record.get("harness") or {}).get("codeManifestSha256") and
                 isinstance(request_sha256, str) and SHA64.match(request_sha256) is not None and q.get("requestSha256") == request_sha256 and
                 # Execution provenance (I4'): the verdict of check_execution_provenance for this admission, plan and selected cases.
                 isinstance(provenance, dict) and provenance.get("requestSha256") == request_sha256 and
                 provenance.get("planSha256") == q.get("planSha256") and provenance.get("cases") == sorted(q.get("cases") or []) and
                 # ...for exactly these case results (the qualification's and the collector's) and this execution.
                 provenance.get("caseResultsSha256") == q.get("caseResultsSha256") and
                 provenance.get("caseResultsSha256") == (run_record.get("artifactDigests") or {}).get("case-results.json") and
                 provenance.get("campaignId") == campaign and type(provenance.get("runId")) is str and provenance.get("runId") == run_id and
                 type(provenance.get("attempt")) is int and provenance.get("attempt") == 1 and attempt == 1 and
                 q.get("outcome") in ("passed", "failed") and
                 (q.get("coverage") in ("batch", "incomplete") or (q.get("coverage") == "full" and sorted(q.get("cases") or []) == ALL_CASES)) and
                 isinstance(q.get("cases"), list) and set(q["cases"]) <= {c.get("case") for c in run_record.get("cases") or [] if isinstance(c, dict)})
    if qualified and q["coverage"] in ("batch", "full"):
        # The qualification and the record derive from the same digest-bound case results; their outcomes must agree or neither counts.
        chosen = [c for c in run_record.get("cases") or [] if isinstance(c, dict) and c.get("case") in q["cases"]]
        qualified = (q["outcome"] == "passed") == (bool(chosen) and all(c.get("result") == "PASS" for c in chosen))
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
           "requestSha256": q.get("requestSha256") if qualified else None, "catalogSha256": q.get("catalogSha256") if qualified else None,
           "outcome": "passed" if qualified and q["outcome"] == "passed" and selected and all(c["result"] == "PASS" for c in selected) else "failed",
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
    a.add_argument("command", choices=("prepare", "qualify", "provenance", "project", "window-check"))
    for flag in ("--repo", "--config", "--request", "--facts", "--checkpoint", "--run-id", "--source-sha", "--out",
                 "--env-file", "--outputs", "--plan", "--case-results", "--cases-dir", "--cases", "--run-record", "--tested-sha", "--approval", "--qualification",
                 "--code-manifest", "--snapshot-dir", "--coverage-mode", "--live-minutes", "--request-sha256", "--build-receipt",
                 "--reservations", "--provenance", "--nightly-request-file", "--nightly-request-sha256"):
        a.add_argument(flag)
    a.add_argument("--attempt", type=int)
    a.add_argument("--job-timeout-minutes", type=int)
    x = a.parse_args(argv[1:])
    try:
        if x.command == "project":
            q = _load(x.qualification) if x.qualification and os.path.exists(x.qualification) else None
            prov = _load(x.provenance) if x.provenance and os.path.exists(x.provenance) else None
            _write_private(x.out, project(_load(x.run_record), x.run_id, x.attempt, x.source_sha, x.tested_sha, q, x.request_sha256, prov))
            return 0
        if x.command == "provenance":
            _write_private(x.out, provenance_from_files(x.request, x.request_sha256, x.run_id, x.plan, x.build_receipt, x.reservations,
                                                        x.case_results, x.cases_dir, x.run_record, (x.cases or "").split(",")))
            return 0
        if x.command == "qualify":
            _write_private(x.out, qualify(x.plan, x.case_results, x.cases_dir, (x.cases or "").split(","), x.approval, x.code_manifest,
                                          x.snapshot_dir, x.coverage_mode, identities(x.request, x.config, x.request_sha256)))
            return 0
        if x.command == "window-check":
            check_window_remaining(admitted_request(x.request, x.request_sha256), datetime.now(timezone.utc), int(x.live_minutes or 0))
            return 0
        # Mask first: the whole bundle and every extracted value, before any refusal, output or environment export.
        if os.environ.get("GITHUB_ACTIONS") == "true":
            for command in mask_commands(mask_values(os.environ.get("CLOUD_TEST_LIVE_ACCOUNTS"))):
                print(command, flush=True)
        p = prepare(x, datetime.now(timezone.utc))
        os.makedirs(x.out, mode=0o700)
        os.chmod(x.out, 0o700)  # the private run-inputs directory is exactly 0700 whatever the umask
        facts_file, account_file = os.path.join(x.out, "facts.json"), os.path.join(x.out, "account-id")
        _write_private(facts_file, p["facts"])
        # Every consumer (runner, reservation, collector, window check, qualification) reads the ADMITTED bytes from this private copy.
        request_file = os.path.join(x.out, "request.json")
        fd = os.open(request_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(p["requestRaw"])
        fd = os.open(account_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(p["accountId"])
        # The role's email reaches the run stage under execute_run's allowlisted name only through the safe writer, after masking.
        # The validated bundle, canonical and private, for the per-case role consumers; its digest leaves only as an init step output.
        bundle_file = os.path.join(x.out, "live-accounts.json")
        fd = os.open(bundle_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(p["bundleBytes"])
        # The continuity checkpoint's exact bytes, private; the caller places these bytes (unchanged) as the stage runner's
        # reconciliation.json, and their digest leaves only as a step output for the byte-identity check before plan construction.
        reconciliation_file = os.path.join(x.out, "reconciliation.json")
        fd = os.open(reconciliation_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(p["reconciliationBytes"])
        env = {"CT_REQUEST": request_file, "CT_FACTS_FILE": facts_file, "CT_ACCOUNT_ID_FILE": account_file, "CT_LIVE_ACCOUNTS_FILE": bundle_file,
               **p["emails"]}
        if p["scope"]:
            scope_file = os.path.join(x.out, "evidence-scope.json")
            _write_private(scope_file, p["scope"])
            env.update(CT_EVIDENCE_SCOPE_FILE=scope_file, CT_EVIDENCE_SCOPE_SHA256=_sha(scope_file))
        write_env_file(x.env_file, env)
        with open(x.outputs, "a", encoding="utf-8") as f:
            f.write("route=%s\nroles=%s\nlive_minutes=%d\ncases=%s\ntested_sha=%s\nlineage=%s\ncoverage_mode=%s\nrequest_sha256=%s\nlive_accounts_sha256=%s\nreconciliation_sha256=%s\n" % (
                p["route"], ",".join(b["role"] for b in p["accounts"]), p["liveMinutes"], ",".join(p["cases"]), p["testedSha"], p["lineage"], p["coverageMode"],
                p["requestSha256"], hashlib.sha256(p["bundleBytes"]).hexdigest(), hashlib.sha256(p["reconciliationBytes"]).hexdigest()))
        return 0
    except (Refused, LR.Refused) as e:
        print("BLOCKED_SETUP: " + str(e), file=sys.stderr)
        return 78
    except (OSError, ValueError, TypeError, KeyError):
        print("BLOCKED_SETUP: run-inputs-unreadable", file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
