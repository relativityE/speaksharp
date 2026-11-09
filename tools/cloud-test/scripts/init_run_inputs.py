"""Inputs and qualification of the GitHub live caller . Offline; never prints a value or identifier.

prepare selects a COMMITTED, reviewed run request by repository path (never generated, never a test fixture or template, byte-identical to the
          tested commit), refuses a synthetic or Claude-runtime request, binds its tested release to this source by request-only lineage
          (or an explicit approved older-release diagnostic), its approval and window, checks per-run request, identity, paid and TIME
          ceilings (sum of the selected cases' caseMaxMs plus admission, inter-case, cleanup, setup and collect reserves, inside the job
          timeout AND before the approved window closes), binds the account role to its credential names, account ID and history, translates
          the bounded facts input into the builder's real facts schema, and only then checks the CUMULATIVE request and identity caps against
          the verified continuity checkpoint's prior usage and reservations. It writes CT_* bindings for
          execute_run.sh; it computes nothing that the stage runner or gates own.
qualify after collect: freezes EVERY verifier input into a new private snapshot, runs the REAL verify_run_binding on the snapshot only
          (exit 0, fresh output, zero failures), and then, separately and from the same frozen bytes, the builder's 15-row denominator with
          every selected case dispatched and every required assertion PASS exactly once. Its result is bound to the campaign, release and
          plan/results digests. Verifier success alone is never PASS.
project run-record.json -> the closed latest record the publisher accepts; statuses and counts only. `passed` also needs the qualify
          output for exactly the recorded cases (passed as --qualification); without it the record is `failed` with code not-qualified.

Continuity (Increment I): the cumulative checkpoint is the ACCEPTED ROLLUP
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
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline)
import accounting_rollup  # noqa: E402
import manual_reservation  # noqa: E402
import publish_latest_record as LR  # noqa: E402
import state_ref_writer  # noqa: E402
import reservation_binding as RB  # noqa: E402  (the one schema; consumers verify with RB.verify)

RUNTIME = "GitHub Actions SpeakSharp"
PRODUCER_CASES = {"AHT-01", "AHT-02", "AHT-03", "AHT-07", "AHT-08"}
SMOKE_OCCURRENCE_WINDOW_MINUTES = 100
# The single active one-off grant : ONE attempt of the R10 smoke campaign over an
# explicitly selected case subset. The all-15 grant (R10-3b040043-one-off-grant.json, e501e203) was consumed by run 42483030590 and stays
# in the tree as history only. The grant names `selectedCases`; the request (the reviewer-owned bytes) must be the SEMANTIC subset of the committed
# all-15 template for exactly those cases with the caps re-derived here (subset_estimate) -- never defaulted to fifteen. Until the reviewed
# grant bytes are pinned, every one-off admission refuses `one-off-grant-not-the-reviewed-bytes`.
ONE_OFF_GRANT_PATH = "tools/cloud-test/config/runs/R10-3b040043-aht01-grant.json"
ONE_OFF_GRANT_SHA256 = "cdc2edbede0967a419baedbd3bec4dc55a9ec8eb5d7a713e0150fd379863038a"   # the AHT-01 grant, opaque approval codes and role token
ONE_OFF_TEMPLATE_PATH = "tools/cloud-test/config/runs/R10-3b040043-aht01.json"
ONE_OFF_BASE_TEMPLATE_PATH = "tools/cloud-test/config/runs/R10-3b040043-all15.json"
ONE_OFF_BASE_TEMPLATE_SHA256 = "18ae0b8ec0c45ab4fc97f8dc1c82cb3709efc00c2e71651a445d979d06caf07e"
R10_ONE_OFF_RUN_ID = "R10-3b040043-smoke15"
ONE_OFF_GRANT_STATUSES = {"APPROVED", "AWAITING_OWNER_DECISION"}
ONE_OFF_GRANT_KEYS = {"schema", "status", "approvalRef", "scopeApprovalRef", "approvedBy", "runId", "attempt", "requestTemplateSha256",
                      "testedSha", "backendSha", "periodScopeSha256", "preReserveStateHead", "notBeforeUtc", "expiresUtc",
                      "limits", "olderReleaseDiagnostic", "selectedCases"}
# , PO go-ahead 2026-11-08: two exact closed shapes. A window extended past the originally approved expiry must
# name the actual source of the new timing as `windowSourceRef` (provenance only, no timezone asserted; it is never read as the approval,
# which stays `approvalRef`). The original window carries none.
ONE_OFF_APPROVED_EXPIRES_UTC = "2026-11-09T00:00:00Z"
ONE_OFF_WINDOW_SOURCE_KEY = "windowSourceRef"
# Public-repository rule: nothing a dispatch publishes to GitHub (the committed grant/request, the materialized request, the dispatch
# facts input) may identify a person or a chat message. Approvals are carried as opaque codes (`approval-<32 hex>`, the code -> source
# record map is held privately) and the approver as a role token; the approval check itself is unchanged: a valid reference is still
# required and must equal the request's own. A chat-message reference, a chat user id or a personal name anywhere in those documents
# refuses with a closed code.
APPROVER_ROLE = "product-owner"
REVIEWER_ROLES = frozenset({"release-reviewer"})
APPROVAL_CODE = re.compile(r"approval-[0-9a-f]{32}")
NOT_PUBLISHABLE = re.compile(
    r"(?i)(?:^|[^a-z0-9])(?:slack|chatgpt)(?:[:_./\\-]|$)"         # slack:/slack-/slack_/slack./slack/ references (pooledSlack stays fine)
    r"|slack\.com|chat\.openai\.com|chatgpt\.com"                 # any chat host, e.g. a permalink https://x.slack.com/archives/...
    r"|/archives/[a-z0-9]{6,}(?:/|$)"                               # a chat permalink path
    r"|(?<![0-9])p[0-9]{16}(?![0-9])"                               # a permalink message id (p + seconds and microseconds)
    r"|(?<![0-9.])1[0-9]{9}[.][0-9]{6}(?![0-9])"                    # a chat message timestamp (epoch seconds . microseconds)
    r"|(?<![A-Za-z0-9])[UW]0[A-Z0-9]{8,}(?![A-Za-z0-9])"            # a chat user id
    r"|(?<![A-Za-z0-9])(?-i:[CDG]0[A-Z0-9]{8,})(?![A-Za-z0-9])"     # a chat channel id; case-sensitive so a hex digest like c0de... passes
    r"|[a-z0-9._%+-]+@[a-z0-9-]+(?:[.][a-z0-9-]+)*[.][a-z]{2,}(?![a-z0-9])"   # an email address (needs a dotted domain)
    r"|(?<![a-z])(?:akin|sam|sam-i-am|elon|jensen|bezos)(?![a-z])")


def publishable(doc, depth=0):
    """True when no string (key or value) anywhere in doc names a person, a chat message or a chat user."""
    if depth > 32:
        return False
    if isinstance(doc, str):
        return NOT_PUBLISHABLE.search(doc) is None
    if isinstance(doc, dict):
        return all(publishable(k, depth + 1) and publishable(v, depth + 1) for k, v in doc.items())
    if isinstance(doc, list):
        return all(publishable(v, depth + 1) for v in doc)
    return True
# The time envelope is NOT resized from estimates : the reviewed 100-minute occurrence and 60-minute live ceiling stay.
ONE_OFF_WINDOW = {"endToEndMinutes": 100, "liveMinutes": 60}
CALLER_AUTHORITY_FIELDS = {"occurrenceApproval", "actionApproval", "olderReleaseDiagnostic"}


def _regular_file(path):
    """A regular, non-symlink file (the one seam the one-off grant reads use, so its tests can serve reviewed-shape bytes)."""
    return os.path.isfile(path) and not os.path.islink(path)


def _canonical_cases(cases):
    """A non-empty, duplicate-free list of case ids in catalog order, or a refusal. Never defaulted."""
    order = ["AHT-%02d" % n for n in range(1, 16)]
    _need(isinstance(cases, list) and cases and all(isinstance(c, str) and c in order for c in cases) and len(set(cases)) == len(cases)
          and cases == [c for c in order if c in cases], "one-off-selected-cases")
    return list(cases)


def subset_estimate(base, selected, budget_model, smoke_catalog):
    """The selected subset's caps, re-derived from the committed all-15 template's own per-case rows and the reviewed budget model
    (full_coverage_budget.compute): per-case ceiling = harness_ceiling(plannedRequests, allowancePct); cleanup = cleanupReservePerCase per
    selected case; run cap = ceilings + cleanup; identity reads = 2 per case + 2; Starts = takes = the selected startPressCaps; coaching cap =
    ceil(takes x (100 + coachingRetryAllowancePct)%); runner minutes kept from the template (never resized from estimates). Takes are the
    smoke catalog's per-case minimumTakes, never assumed equal to Starts (AHT-11 is 3 Starts / 1 take)."""
    rows = {r.get("case"): r for r in base.get("selection") or [] if isinstance(r, dict)}
    _need(all(c in rows for c in selected), "one-off-subset-case")
    planned = [rows[c]["plannedRequests"] for c in selected]
    _need(all(type(v) is int and v > 0 for v in planned), "one-off-subset-case")
    pct, per_case, retry = budget_model["allowancePct"], budget_model["cleanupReservePerCase"], budget_model["coachingRetryAllowancePct"]
    ceilings = sum(((v * pct + 99) // 100 + 9) // 10 * 10 for v in planned)
    cleanup = per_case * len(selected)
    run_cap = ceilings + cleanup
    starts = sum(rows[c]["startPressCap"] for c in selected)
    catalog_cases = smoke_catalog.get("cases") if isinstance(smoke_catalog, dict) else None
    _need(isinstance(catalog_cases, dict) and all(isinstance(catalog_cases.get(c), dict) and type(catalog_cases[c].get("minimumTakes")) is int
                                                  and catalog_cases[c]["minimumTakes"] >= 0 for c in selected), "one-off-subset-takes")
    takes = sum(catalog_cases[c]["minimumTakes"] for c in selected)
    return {"requests": {"planned": sum(planned), "cleanupReserve": cleanup, "pooledSlack": run_cap - sum(planned) - cleanup, "runCap": run_cap},
            "identityReads": 2 * len(selected) + 2, "starts": starts, "takes": takes,
            "coachingCap": -(-takes * (100 + retry) // 100), "githubRunnerMinutesMax": base["estimate"]["githubRunnerMinutesMax"]}


def one_off_limits(derived):
    return {"endToEndMinutes": ONE_OFF_WINDOW["endToEndMinutes"], "liveMinutes": ONE_OFF_WINDOW["liveMinutes"],
            "requestsIncludingIdentity": derived["requests"]["runCap"] + derived["identityReads"], "identityReads": derived["identityReads"],
            "starts": derived["starts"], "takes": derived["takes"], "coachingCalls": derived["coachingCap"], "retries": 0}


# Fields of the selected request that must be the committed all-15 template's own (free text, approval references and the window may differ).
SUBSET_SAME_KEYS = ("schema", "runId", "coverageMode", "sampleMode", "priority", "executionRuntime", "workflowVersion", "configVersion",
                    "release", "synthetic", "proposal", "evidenceScope", "approvedOmissions", "deviations", "cleanupConditions")


def check_subset_template(base, template, selected, derived, scope_ceilings):
    """The selected request is the SEMANTIC subset of the all-15 template: the same campaign, release, harness pin and modes; exactly the
    selected rows in catalog order, each the template's own row (only `reason` may differ, `order` renumbered 1..n); the estimate, run cap,
    Start caps and coaching cap exactly the re-derived values; the cumulative limits exactly the accepted period ceilings. Anything else --
    another selection, order, estimate, cap or release -- refuses."""
    _need(isinstance(base, dict) and isinstance(template, dict), "one-off-subset-shape")
    _need(all(template.get(k) == base.get(k) for k in SUBSET_SAME_KEYS), "one-off-subset-not-the-template")
    bh, th = dict(base.get("harness") or {}), dict(template.get("harness") or {})
    bh.pop("ownerApprovalRef", None), th.pop("ownerApprovalRef", None)
    _need(bh == th, "one-off-subset-harness")
    rows = {r.get("case"): r for r in base.get("selection") or [] if isinstance(r, dict)}
    sel = template.get("selection")
    _need(isinstance(sel, list) and [r.get("case") if isinstance(r, dict) else None for r in sel] == selected, "one-off-subset-selection")
    strip = lambda r: {k: v for k, v in r.items() if k not in ("reason", "order")}  # noqa: E731
    _need(all(r.get("order") == i + 1 and isinstance(r.get("reason"), str) and strip(r) == strip(rows[r["case"]]) for i, r in enumerate(sel)),
          "one-off-subset-selection")
    est, best = template.get("estimate"), base.get("estimate") or {}
    _need(isinstance(est, dict) and set(est) == set(best) and est.get("requests") == derived["requests"]
          and est.get("identityReads") == derived["identityReads"] and est.get("starts") == derived["starts"]
          and est.get("takes") == derived["takes"] and est.get("paidActionsAuthorizedUsd") == 0
          and est.get("githubRunnerMinutesMax") == derived["githubRunnerMinutesMax"]
          and isinstance(est.get("providerBillableRequests"), dict)
          and set(est["providerBillableRequests"]) == set(best.get("providerBillableRequests") or {})
          and est["providerBillableRequests"].get("coachingCap") == derived["coachingCap"], "one-off-subset-estimate")
    caps = {c: rows[c]["startPressCap"] for c in selected}
    lim, blim = template.get("approvedLimits"), base.get("approvedLimits") or {}
    _need(isinstance(lim, dict) and set(lim) == set(blim) and lim.get("runCapRequests") == derived["requests"]["runCap"]
          and lim.get("startPressCaps") == caps and lim.get("cumulativeCeilingRequests") == scope_ceilings["requests"]
          and lim.get("identityCap") == scope_ceilings["identityReads"] and lim.get("startsCap") == scope_ceilings["starts"]
          and lim.get("takesCap") == scope_ceilings["takes"], "one-off-subset-approved-limits")
    prop = template.get("proposedLimits")
    _need(isinstance(prop, dict) and prop.get("runCapRequests") == derived["requests"]["runCap"] and prop.get("startPressCaps") == caps
          and (prop.get("guardCaps") or {}).get("coaching", derived["coachingCap"]) == derived["coachingCap"], "one-off-subset-proposed-limits")
    return True


def one_off_grant(repo, template=None, initiation=None, reconciliation_bytes=None, chain=None, selection=None):
    """The reviewed, content-addressed PO grant for exactly one R10 attempt over its explicit `selectedCases`.

    Dispatch facts are evidence references, never authority.  The grant binds the committed template, deployed release, accepted accounting
    scope, pre-reserve journal head and every one-run cap.  The only value supplied at execution is GitHub's authenticated run start.
    """
    path = os.path.join(repo, ONE_OFF_GRANT_PATH)
    _need(_regular_file(path), "one-off-grant-unreadable")
    raw = _read(path)
    _need(hashlib.sha256(raw).hexdigest() == ONE_OFF_GRANT_SHA256, "one-off-grant-not-the-reviewed-bytes")
    try:
        grant = json.loads(raw)
    except ValueError:
        raise Refused("one-off-grant-unreadable")
    _need(isinstance(grant, dict) and set(grant) - {ONE_OFF_WINDOW_SOURCE_KEY} == ONE_OFF_GRANT_KEYS
          and grant.get("schema") == "speaksharp.cloud-test.one-off-grant.v1" and grant.get("status") in ONE_OFF_GRANT_STATUSES,
          "one-off-grant-shape")
    extended = grant.get("expiresUtc") != ONE_OFF_APPROVED_EXPIRES_UTC
    _need(_ref(grant.get(ONE_OFF_WINDOW_SOURCE_KEY)) if extended else ONE_OFF_WINDOW_SOURCE_KEY not in grant, "one-off-grant-window-source")
    # a grant whose proposed scope grew past its recorded owner decision is committed AWAITING_OWNER_DECISION and cannot
    # admit a dispatch; only a reviewed change pinning the owner's new decision sets APPROVED (and re-pins ONE_OFF_GRANT_SHA256).
    _need(grant.get("status") == "APPROVED", "one-off-grant-not-approved")
    _need(publishable(grant), "one-off-grant-not-publishable")
    _need(APPROVAL_CODE.fullmatch(str(grant.get("approvalRef"))) is not None and APPROVAL_CODE.fullmatch(str(grant.get("scopeApprovalRef"))) is not None
          and grant.get("approvedBy") == APPROVER_ROLE
          and grant.get("runId") == R10_ONE_OFF_RUN_ID and grant.get("attempt") == 1,
          "one-off-grant-reference")
    selected = _canonical_cases(grant.get("selectedCases"))
    if selection is not None:
        _need(list(selection) == selected, "one-off-grant-selection-differs")
    template_path = os.path.join(repo, ONE_OFF_TEMPLATE_PATH)
    _need(_regular_file(template_path)
          and hashlib.sha256(_read(template_path)).hexdigest() == grant.get("requestTemplateSha256"),
          "one-off-grant-not-the-request")
    committed = json.loads(_read(template_path))
    base_path = os.path.join(repo, ONE_OFF_BASE_TEMPLATE_PATH)
    _need(_regular_file(base_path), "one-off-grant-base-template")
    base_raw = _read(base_path)
    _need(hashlib.sha256(base_raw).hexdigest() == ONE_OFF_BASE_TEMPLATE_SHA256, "one-off-grant-base-template")
    base = json.loads(base_raw)
    cfg = json.loads(_read(os.path.join(repo, "tools/cloud-test/config/test-config.v1.json")))
    smoke_catalog = json.loads(_read(os.path.join(repo, "tools/cloud-test/config/smoke-assertion-catalog.json")))
    derived = subset_estimate(base, selected, cfg["modes"]["full"]["budgetModel"], smoke_catalog)
    if template is not None:
        _need(template.get("runId") == grant["runId"]
              and (template.get("release") or {}).get("testedSha") == grant.get("testedSha")
              and ((template.get("release") or {}).get("backend") or {}).get("sha") == grant.get("backendSha"),
              "one-off-grant-release")
    _need(grant.get("limits") == one_off_limits(derived) and grant.get("olderReleaseDiagnostic") is True,
          "one-off-grant-limits")
    scope_path = os.path.join(repo, CONTINUITY_DIR, CONTINUITY_SCOPE)
    _need(os.path.isfile(scope_path) and not os.path.islink(scope_path), "one-off-grant-accounting")
    try:
        accepted_scope = manual_reservation.accepted_scope(_read(scope_path), manual_reservation.ACCEPTED_SCOPE_SHA256)
    except manual_reservation.Refused:
        raise Refused("one-off-grant-accounting")
    check_subset_template(base, committed, selected, derived, accepted_scope["ceilings"])
    _need(grant.get("periodScopeSha256") == manual_reservation.ACCEPTED_SCOPE_SHA256
          and grant.get("scopeApprovalRef") == accepted_scope.get("approvalRef")
          and isinstance(grant.get("preReserveStateHead"), str) and LR.SHA40.match(grant["preReserveStateHead"]),
          "one-off-grant-accounting")
    if initiation is not None:
        start = _utc(initiation)
        _need(_utc(grant.get("notBeforeUtc")) <= start
              and start + timedelta(minutes=SMOKE_OCCURRENCE_WINDOW_MINUTES) <= _utc(grant.get("expiresUtc")),
              "one-off-grant-expired")
    if reconciliation_bytes is not None:
        try:
            checkpoint = json.loads(reconciliation_bytes)
        except (TypeError, ValueError):
            raise Refused("one-off-grant-checkpoint")
        _need(isinstance(checkpoint, dict) and checkpoint.get("scopeApprovalRef") == grant.get("scopeApprovalRef")
              and (checkpoint.get("headSha") == grant.get("preReserveStateHead") or _setup_failures_only(checkpoint, grant, chain)
                   or _setup_failures_since_pin(checkpoint, grant, chain, repo, accepted_scope)),
              "one-off-grant-checkpoint")
    return grant


# The grant's single attempt must reach the cases. An attempt that stopped in setup before any product request (R10 runs 41933223835 and
# 41960376782) is reserved and then settled from evidence with zero product usage, which moves the journal head without consuming the grant.
# Past the pinned head, a checkpoint is admitted only when the verified chain the checkpoint was computed on adds,
# after that pinned head, nothing but complete reserve -> settle pairs of one attempt each whose settle carries zero on all five product
# counters (runner minutes stay counted), and the accepted rollup agrees: rooted at that head, no open reservation, no product or unknown
# usage in the period. A release, an executed attempt, an open reservation or any doubt refuses, so the grant still authorizes exactly one
# attempt that runs. The settles' evidence is validated by the reviewed writer when it appends; the digest shape here is not proof.
SETUP_FAILURE_ZERO_KEYS = ("requests", "identityReads", "starts", "takes", "coachingRequests")
# A setup failure in which only the prerequisite preflight ran settles at its bounded charge (unexecuted_attempt_evidence preflight-bound):
# at most this many campaign requests, still no identity read, Start, take or coaching call. Nothing larger is a setup-only failure.
SETUP_FAILURE_MAX_REQUESTS = 10


def _setup_failure_pairs(chain, anchor, head):
    if not (isinstance(chain, list) and len(chain) >= 2 and chain[0][0] == anchor and chain[-1][0] == head and chain[0][1] == []):
        return False
    events = chain[-1][1]
    if not events or len(events) % 2:
        return False
    pairs = 0
    for reserved, settled in zip(events[0::2], events[1::2]):
        same = all(reserved.get(k) == settled.get(k) for k in ("campaignId", "runId", "attempt"))
        held, used = reserved.get("allocation") or {}, settled.get("allocation") or {}
        pairs += 1
        if not (reserved.get("type") == "reserve" and settled.get("type") == "settle" and same
                and all(type(used.get(k)) is int and used[k] == 0 for k in SETUP_FAILURE_ZERO_KEYS if k != "requests")
                and type(used.get("requests")) is int and 0 <= used["requests"] <= SETUP_FAILURE_MAX_REQUESTS
                and type(used.get("runnerMinutes")) is int and 0 <= used["runnerMinutes"] <= held.get("runnerMinutes", -1)
                and re.fullmatch(r"evidence-sha256:[0-9a-f]{64}", str(settled.get("provenance"))) is not None):
            return False
    return pairs


def _setup_failures_only(checkpoint, grant, chain):
    period = checkpoint.get("period")
    unknown = checkpoint.get("unknown")
    pairs = _setup_failure_pairs(chain, grant.get("preReserveStateHead"), checkpoint.get("headSha"))
    return (bool(pairs)
            and checkpoint.get("source") == "accepted-rollup"
            and checkpoint.get("root") == grant.get("preReserveStateHead") == accounting_rollup.ACCEPTED_ROOT
            and isinstance(checkpoint.get("headSha"), str) and LR.SHA40.match(checkpoint["headSha"]) is not None
            and type(checkpoint.get("outstandingReservations")) is int and checkpoint["outstandingReservations"] == 0
            and checkpoint.get("openReservationsByRequest") == {}
            and isinstance(period, dict) and all(type(period.get(k)) is int and period[k] == 0 for k in SETUP_FAILURE_ZERO_KEYS if k != "requests")
            and type(period.get("requests")) is int and 0 <= period["requests"] <= SETUP_FAILURE_MAX_REQUESTS * pairs
            and type(period.get("runnerMinutes")) is int and period["runnerMinutes"] >= 0
            and isinstance(unknown, dict) and unknown and not any(unknown.values()))


def _setup_failures_since_pin(checkpoint, grant, chain, repo, accepted_scope):
    """R10 run 42406851270 (PO: a run rejected before it ran anything must never block the next one). The same rule as _setup_failures_only,
    for a grant pinned at a LATER journal head (one already carrying earlier runs' usage): after that pinned head the verified chain adds
    nothing but complete reserve -> settle pairs whose settles carry zero identity reads, Starts, takes and coaching calls and at most the
    preflight's bounded requests, and the checkpoint is exactly the accepted rollup recomputed at the pinned head plus those settles. No
    reservation may be open at either point; any release, executed attempt, open reservation or doubt refuses. So the grant still authorizes
    exactly one attempt that runs."""
    anchor = grant.get("preReserveStateHead")
    if anchor == accounting_rollup.ACCEPTED_ROOT or not isinstance(chain, list) or len(chain) < 2:
        return False
    at = [i for i, node in enumerate(chain) if isinstance(node, (list, tuple)) and node and node[0] == anchor]
    if len(at) != 1 or at[0] == len(chain) - 1:
        return False
    base, tail = chain[at[0]][1], chain[-1][1]
    if not (isinstance(base, list) and isinstance(tail, list) and len(tail) > len(base) and tail[:len(base)] == base):
        return False
    added = tail[len(base):]
    if not _setup_failure_pairs([(anchor, []), (chain[-1][0], added)], anchor, checkpoint.get("headSha")):
        return False
    try:
        bootstrap = _read(os.path.join(repo, CONTINUITY_DIR, CONTINUITY_BOOTSTRAP))
        before = json.loads(accounting_rollup.checkpoint_bytes(accounting_rollup.receive(bootstrap, accepted_scope, chain[:at[0] + 1])))
    except (accounting_rollup.Refused, OSError, ValueError, TypeError, KeyError):
        return False
    period, prior = checkpoint.get("period"), before.get("period")
    if not (isinstance(period, dict) and isinstance(prior, dict) and set(period) == set(prior)
            and all(type(v) is int for v in list(period.values()) + list(prior.values()))):
        return False
    settles = [e for e in added if e.get("type") == "settle"]
    expected = {k: prior[k] + sum(int((e.get("allocation") or {}).get(k, 0)) for e in settles) for k in prior}
    unknown = checkpoint.get("unknown")
    return (period == expected
            and before.get("outstandingReservations") == 0 and before.get("openReservationsByRequest") == {}
            and checkpoint.get("source") == "accepted-rollup" and checkpoint.get("root") == accounting_rollup.ACCEPTED_ROOT
            and checkpoint.get("headSha") == chain[-1][0]
            and type(checkpoint.get("outstandingReservations")) is int and checkpoint["outstandingReservations"] == 0
            and checkpoint.get("openReservationsByRequest") == {}
            and isinstance(unknown, dict) and unknown and not any(unknown.values()))


def materialize_authoritative_smoke_occurrence(repo, template, initiation):
    approval = one_off_grant(repo, template, initiation,
                             selection=[s.get("case") for s in (template or {}).get("selection") or [] if isinstance(s, dict)])
    return materialize_smoke_occurrence(template, initiation, approval["approvalRef"], approval["scopeApprovalRef"], approval["approvedBy"],
                                        approval["testedSha"], approval["backendSha"], approval["selectedCases"])


def materialize_smoke_occurrence(template, initiation, approval_ref, scope_approval_ref, approved_by, tested_sha, backend_sha, selected_cases):
    """Create the exact one-run bytes for an owner-selected R10 initiation.

    The 100-minute occurrence is the bounded end-to-end workflow envelope:
    5 minutes to record, 3 to reserve, the 85-minute live-job bound
    (15 setup + 60 live + 10 collect; PO 60-minute signal run), and 5 for the parallel settle/record completion jobs,
    with two minutes of structural slack. It is not a measured runtime. The
    caller must subsequently authorize these exact occurrence/release bytes
    and bind the ordinary action-approval envelope.
    """
    _need(template.get("coverageMode") == template.get("sampleMode") == "smoke", "smoke-occurrence-mode")
    _need(template.get("runId") == R10_ONE_OFF_RUN_ID and isinstance(template.get("selection"), list)
          and [s.get("case") if isinstance(s, dict) else None for s in template["selection"]] == _canonical_cases(selected_cases),
          "smoke-occurrence-selection")
    _need(isinstance(initiation, str) and LR.UTC.match(initiation), "smoke-occurrence-initiation")
    _need(_ref(approval_ref) and _ref(scope_approval_ref) and isinstance(approved_by, str) and approved_by.strip(), "smoke-occurrence-approval")
    _need(isinstance(tested_sha, str) and LR.SHA40.match(tested_sha) and isinstance(backend_sha, str) and LR.SHA40.match(backend_sha),
          "smoke-occurrence-release")
    start = _utc(initiation)
    out = json.loads(json.dumps(template))
    out["proposal"] = False
    out["createdUtc"] = initiation
    out["window"] = {"startUtc": initiation,
                     "endUtc": (start + timedelta(minutes=SMOKE_OCCURRENCE_WINDOW_MINUTES)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                     "endToEndMinutes": ONE_OFF_WINDOW["endToEndMinutes"],
                     "liveMinutes": ONE_OFF_WINDOW["liveMinutes"],
                     "approvalRef": approval_ref,
                     "basis": "actual initiation + 5m record + 3m reserve + 85m live-job ceiling (15 setup + 60 live + 10 collect) + 5m parallel settlement/record completion + 2m structural slack; live ceiling 60m; not measured runtime"}
    out["selectionApprovalRef"] = approval_ref
    # The one-off grant selects this occurrence. The accepted period scope,
    # independently, owns cumulative accounting.
    out["approvedLimits"]["approvalRef"] = scope_approval_ref
    out["approvedLimits"]["approvedBy"] = approved_by
    out["harness"]["ownerApprovalRef"] = approval_ref
    out["release"]["testedSha"] = tested_sha
    out["release"]["backend"]["sha"] = backend_sha
    return out


def select_manual_occurrence(repo, template_rel, occurrence_file, occurrence_sha256, source_sha, workflow_start_utc=None):
    """Admit an exact, approver-bound smoke occurrence derived from one committed template.

    The occurrence bytes travel unchanged through reservation and preparation.  They are never generated after the reserve, and they are
    accepted only when re-materializing the committed template from the occurrence's own selected initiation/release fields yields the
    identical document.  The caller separately binds these exact bytes and the pre-reserve reconciliation in actionApproval.
    """
    _template_path, template_blob, template_raw = select_request(repo, template_rel, source_sha)
    _need(isinstance(occurrence_file, str) and os.path.isfile(occurrence_file) and not os.path.islink(occurrence_file),
          "manual-occurrence-unreadable")
    raw = _read(occurrence_file)
    _need(isinstance(occurrence_sha256, str) and SHA64.match(occurrence_sha256) and hashlib.sha256(raw).hexdigest() == occurrence_sha256,
          "manual-occurrence-not-the-selected-bytes")
    try:
        template, occurrence = json.loads(template_raw), json.loads(raw)
    except ValueError:
        raise Refused("manual-occurrence-unreadable")
    _need(isinstance(workflow_start_utc, str) and occurrence.get("createdUtc") == workflow_start_utc,
          "manual-occurrence-not-the-workflow-start")
    expected = materialize_authoritative_smoke_occurrence(repo, template, workflow_start_utc)
    _need(occurrence == expected, "manual-occurrence-not-the-template-materialization")
    return occurrence_file, hashlib.sha1(b"blob %d\0" % len(raw) + raw).hexdigest(), raw, template_blob
# NIGHTLY facts (pending the reviewer's content/pin decision): a scheduled run has no operator facts input, so its facts are
# the committed file below, admitted only when its bytes hash to the reviewed pin. None today: every nightly prepare refuses.
NIGHTLY_FACTS_PATH = "tools/cloud-test/config/nightly/facts.json"
NIGHTLY_FACTS_SHA256 = None
# Option A (design only): the owner's recurring approval may carry an explicit per-occurrence Start/take grant, from
# which a nightly occurrence's action envelope is DERIVED. Its bytes are admitted only when they hash to this reviewed pin. None today: every
# derivation refuses, so the mechanics stay inactive until an actual owner grant and accepted inputs exist.
RECURRING_APPROVAL_PATH = "tools/cloud-test/config/recurring-approval.json"
RECURRING_APPROVAL_SHA256 = None
STANDING_GRANT_KEYS = {"scope", "cases", "grantRef"}
STANDING_GRANT_SCOPE = "per-occurrence-start-take"
STANDING_PERIOD_DIMENSIONS = ("requests", "identityReads", "starts", "takes")
ALL_CASES = ["AHT-%02d" % n for n in range(1, 16)]
# build_plan.py binds ONE account id for the whole plan and labels AHT-15 maintained-read-only (line 179), so roles never mix in one run.
ROLE = {**{c: "existing-disposable" for c in ALL_CASES[:14]}, "AHT-15": "maintained-read-only"}
ROLE_CREDENTIALS = {"existing-disposable": {"email": "THROWAWAY_TEST_EMAIL", "password": "THROWAWAY_TEST_PASSWORD"},
                    "maintained-read-only": {"email": "FREE_TEST_EMAIL", "password": "FREE_TEST_PASSWORD"}}
# The private CLOUD_TEST_LIVE_ACCOUNTS bundle : configuration only (emails and account ids, never a password or
# token), validated exactly as scripts/verify-test-users.mjs does, in the same order and with the same codes (shared vectors).
BUNDLE_ROLES = ("existing-disposable", "maintained-read-only")
BUNDLE_LIMIT = 4096
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
UUID_V4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
PROJECT_REF = re.compile(r"^[a-z0-9]{20}$")
# One explicit shared email contract : printable ASCII without space or "@" on both sides of exactly one "@", at
# most 254 characters; CONTROL stays for the environment-file writer.
EMAIL_ASCII = re.compile(r"^[\x21-\x3f\x41-\x7e]+@[\x21-\x3f\x41-\x7e]+$")
ENV_NAME = re.compile(r"^[A-Z_][A-Z0-9_]*$")
REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/#-]{2,159}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
RECEIPT_KEYS = {"pre", "rls", "analytics", "disp", "fence", "review"}  # build_plan.py 55
BACKEND_KEYS = {"manifestRef", "generation", "completion", "migration129"}
FACT_REQUIRED = {"ownerApprovalReference", "approvedBy", "reviewer", "receipts", "accounts"}
FACT_OPTIONAL = {"producerReviewReference", "providerEvidenceReferences", "backend", "olderReleaseDiagnostic", "actionApproval",
                 "occurrenceApproval", "case10RequestBound"}
# A manual run's builder Start/take action approval (case_start_caps.bind_inputs) is supplied by its approver.  A scheduled run instead
# derives the occurrence-bound envelope from the exact request emitted by the credential-free nightly gate and the admitted reconciliation;
# the standing approval already bound into that request remains the authority.  No reusable committed facts file can predict a future
# occurrence digest.
ACTION_APPROVAL_SCHEMA = "speaksharp.case-start-approval.v1"
ACTION_APPROVAL_KEYS = {"schema", "requestSha256", "reconciliationSha256", "approvalRef", "approvedBy", "selectionApprovalRef"}
# The ONE reviewed location for live run requests (the reviewer RETURN 3e0279d6 finding 1); nothing else counts as request-only lineage.
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
# (design a): ONE execution deadline, computed once at init and bound unchanged as the plan's deadlineAt (BP_T1),
# the guard policy's deadline, admission's approvedDeadlineAt and the producer scope's deadlineAt. The workflow kills the run step at
# step start + live minutes; init runs before that step starts, so init time + live minutes is never later than the kill. The stage's own
# post-campaign exit (ownership return) keeps this reserve; the campaign's cleanup reserve is subtracted once, by campaign-core, not here.
RUN_STAGE_EXIT_RESERVE_SECONDS = 60


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
    """NIGHTLY mode : the request is exactly the bytes the credential-free nightly gate derived and admitted, delivered
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
    # the run-request contract's notTargeted: a list of {gap, why}, refused BEFORE reservation (run 42494152179 crashed its report on bare ids)
    nt = req.get("notTargeted", [])
    _need(isinstance(nt, list) and all(isinstance(n, dict) and set(n) == {"gap", "why"} and isinstance(n["gap"], str)
                                       and re.fullmatch(r"GAP-\d\d", n["gap"]) is not None
                                       and isinstance(n["why"], str) and len(n["why"].strip()) >= 10 for n in nt), "request-not-targeted")
    _need(req.get("coverageMode") in ("partial", "smoke", "full"), "coverage-mode")
    if req["coverageMode"] == "full":
        _need(sorted(cases) == ALL_CASES, "full-mode-needs-all-fifteen")
    if req["coverageMode"] == "smoke":
        # A smoke SUBSET only for the R10 one-off campaign, whose admission binds the pinned grant's exact selectedCases (one_off_grant).
        _need(sorted(cases) == ALL_CASES or (req.get("runId") == R10_ONE_OFF_RUN_ID and cases == [c for c in ALL_CASES if c in cases]),
              "smoke-mode-needs-all-fifteen")
        _need(req.get("sampleMode") == "smoke", "smoke-mode-needs-smoke-sampling")
    else:
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
    coverage_mode = req["coverageMode"]
    mode = cfg["modes"][coverage_mode]["limits"] if coverage_mode in ("smoke", "full") else cfg["limits"]
    _need(len(cases) <= mode["maxSelectedCases"], "selection-exceeds-mode-cap")
    lim, est = req["approvedLimits"], req.get("estimate") or {}
    # runCapRequests is per run; identityCap and cumulativeCeilingRequests are CUMULATIVE and are checked against verified prior usage.
    _need(lim["runCapRequests"] <= mode["maxRunCapRequests"], "approved-limit-above-mode-cap")
    reqs = est.get("requests") or {}
    _need(_int(reqs.get("runCap")) and reqs["runCap"] <= lim["runCapRequests"], "estimate-exceeds-approved-run-cap")
    _need(_int(est.get("identityReads")) and est["identityReads"] <= mode["maxIdentityReadsPerRun"], "estimate-exceeds-per-run-identity-cap")
    _need(cfg["limits"]["maxPaidActionsUsd"] == 0 and est.get("paidActionsAuthorizedUsd") == 0, "paid-actions-refused")
    w = cfg["modes"].get(coverage_mode, {}).get("window") or cfg["modes"]["full"]["window"]
    case_limits = cfg["modes"].get(coverage_mode, {}).get("caseMaxMs") or cfg["modes"]["full"]["caseMaxMs"]
    case_minutes = math.ceil(sum(case_limits[c] for c in cases) / 60000)
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


def execution_deadline(req, now, live_minutes):
    """The one runtime safety bound for this run: min(occurrence end, init time + live minutes - the stage exit reserve), whole seconds.
    Never later than the occurrence end and never later than the run step's kill; it is not a calendar window and never extends one."""
    w = req["window"]
    start, end = _utc(w["startUtc"]), _utc(w["endUtc"])
    _need(_int(live_minutes) and live_minutes > 0, "live-minutes")
    step_bound = now.replace(microsecond=0) + timedelta(minutes=live_minutes) - timedelta(seconds=RUN_STAGE_EXIT_RESERVE_SECONDS)
    deadline = min(end, step_bound)
    _need(start <= now < deadline, "execution-deadline-not-open")
    return deadline.strftime("%Y-%m-%dT%H:%M:%SZ")


def check_execution_deadline(req, now, live_minutes, deadline):
    """Immediately before the run step: the init-bound deadline is well formed, inside the occurrence, still open, and not later than this
    step's kill less the exit reserve (the step starts no earlier than now, so its kill is no earlier than now + live minutes)."""
    _need(isinstance(deadline, str) and LR.UTC.match(deadline) is not None, "execution-deadline-missing")
    _need(_int(live_minutes) and live_minutes > 0, "live-minutes")
    w = req["window"]
    d = _utc(deadline)
    _need(_utc(w["startUtc"]) < d <= _utc(w["endUtc"]), "execution-deadline-outside-occurrence")
    _need(now < d, "execution-deadline-passed")
    _need(d <= now + timedelta(minutes=live_minutes) - timedelta(seconds=RUN_STAGE_EXIT_RESERVE_SECONDS), "execution-deadline-after-step-kill")


def completion_within_occurrence(raw, now):
    """Return whether R10 completed inside its reviewed 100-minute envelope.

    Accounting may settle later inside the approved period so held usage is
    reconciled safely, but a late workflow is incomplete rather than an
    in-envelope terminal result.
    """
    try:
        req = json.loads(raw)
    except (TypeError, ValueError):
        raise Refused("completion-occurrence-unreadable")
    w = req.get("window") if isinstance(req, dict) else None
    _need(req.get("runId") == "R10-3b040043-smoke15" and req.get("createdUtc") == (w or {}).get("startUtc")
          and all(isinstance((w or {}).get(k), str) and LR.UTC.match(w[k]) for k in ("startUtc", "endUtc")),
          "completion-occurrence-unreadable")
    start, end = _utc(w["startUtc"]), _utc(w["endUtc"])
    _need((end - start).total_seconds() == 60 * SMOKE_OCCURRENCE_WINDOW_MINUTES, "completion-occurrence-window")
    return now <= end


def check_release_lineage(repo, req, request_rel, source_sha, request_blob, cases, diagnostic, template_keys, grant=None):
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
    if grant is not None:
        _need(diagnostic is None and grant.get("olderReleaseDiagnostic") is True
              and grant.get("testedSha") == tested and grant.get("runId") == req.get("runId"),
              "source-changes-product-beyond-request")
        return "reviewed-one-off-older-release-diagnostic"
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
    """The VALIDATED minimum binding document as the exact file bytes both runtimes agree on : UTF-8 JSON with
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
    literal dots and no URL parser : HTTP, any userinfo or "@", another port, another or suffixed domain, any path,
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


def account_bindings(cfg, cases, facts_accounts, bundle, first_observation_run=None):
    """Every role the selection needs (the CLI developer's I1'/I2' contract: AHT-01..14 existing-disposable, AHT-15 maintained-read-only, so an all-15 run
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
        first = fa["idSha256"] == "FIRST-DISCOVERY"
        if first:
            # The one authorized R10 first-use route derives the subject digest
            # inside the protected job from the already owner-selected bundle.
            # It does not pretend that a prior campaign supplied history: the
            # adapter retains the bounded first observation before dependent
            # actions and links it from the case result.
            _need(first_observation_run == "R10-3b040043-smoke15", "account-first-discovery-not-authorized")
            _need(fa["historyRef"] == "first-observation:%s@%s" % (role, first_observation_run),
                  "account-first-discovery-reference")
        else:
            _need(isinstance(fa["idSha256"], str) and SHA64.match(fa["idSha256"]) and
                  hashlib.sha256(account_id.encode()).hexdigest() == fa["idSha256"], "account-id-not-the-approved-account")
            _need(_ref(fa["historyRef"]), "account-history-reference")
        out.append({"role": role, "credentials": dict(names), "historyRef": fa["historyRef"]})
    return out


def translate_facts(facts, req, route):
    """The bounded facts input -> exactly the builder's facts schema (build_plan.py 51-60, 143, 242, 374). References only."""
    _need(isinstance(facts, dict) and FACT_REQUIRED <= set(facts) <= FACT_REQUIRED | FACT_OPTIONAL, "facts-shape")
    # Run 42226498611: the plan builder requires the backend identity (build_plan.py `obj(FACTS.get('backend'), 'facts-backend')`), so facts
    # without it must refuse here, in prepare, with a named code, never later inside the stage runner after the reserve and preflight.
    _need("backend" in facts, "facts-backend-missing")
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


def compose_scope(req, facts, account_id, cases, route, deadline):
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
    # The run's one execution deadline (execution_deadline), never the occurrence end: the plan's deadlineAt is the same value (bootstrap).
    _need(isinstance(deadline, str) and LR.UTC.match(deadline) is not None and _utc(w["startUtc"]) < _utc(deadline) <= _utc(w["endUtc"]),
          "execution-deadline-missing")
    tested = req["release"]["testedSha"]
    return {"campaignId": req["runId"], "sourceSha": tested, "servedSha": tested, "notBefore": w["startUtc"], "deadlineAt": deadline,
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


def check_case10_bound(req, facts, cases, entries, request_sha256=None, run_id=None, now=None, observation=None):
    """item 2: the Case 10 request-bound projection the builder consumes is admitted only when the builder's own
    validator (case_start_caps.case10_execution_bound: shape, schema, run/source/account binding, evidence reference, the request row's
    requestBoundSha256 over the exact record bytes, and the unchanged 240 allowance) accepts it for the admitted request and the Case 10
    role's account. A row pinning an observationContract (design A) takes only the fresh `observation` record,
    admitted for this request digest, run and time. A record supplied when Case 10 needs none refuses. Returns the bound report, or None."""
    import case_start_caps as CS
    account = entries[ROLE["AHT-10"]]["accountId"] if "AHT-10" in cases else ""
    bound_facts = facts if observation is None else dict(facts, case10Observation=observation)
    try:
        bound = CS.case10_execution_bound(req, bound_facts, account, request_sha256, run_id,
                                          now.strftime("%Y-%m-%dT%H:%M:%SZ") if now is not None else None)
    except CS.InputValidationError as e:
        raise Refused(str(e))
    _need(bound is not None or ("case10RequestBound" not in facts and observation is None), "case10-bound-not-applicable")
    return bound


def read_case10_observation(path):
    """The Case 10 observation record the reader step placed privately: one regular JSON object file, or None when no path was given."""
    if not isinstance(path, str):
        return None
    _need(os.path.isfile(path) and not os.path.islink(path), "case10-observation-unreadable")
    try:
        record = json.loads(_read(path))
    except ValueError:
        raise Refused("case10-observation-unreadable")
    _need(isinstance(record, dict), "case10-observation-unreadable")
    return record


def check_action_approval(approval, request_sha256, reconciliation_bytes, req):
    """RETURN #1: the builder's Start/take action approval, as SUPPLIED in the facts by its approver, admitted only when it
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


def reserved_occurrences(chain, own=None):
    """Campaign ids already reserved on the verified state-ref chain (the same journal the continuity checkpoint received). the reviewer RETURN
     #2: `own` = (campaignId, runId, attempt, requestSha256) of THIS execution. journal-reserve appends its reserve before the
    live job prepares, so that one verified, still-open reserve (exact campaign, run, attempt and request digest) is not a replay. Any other
    reserve of the occurrence (another run, another attempt, another request, or this reserve once settled) still makes it replayed."""
    events = chain[-1][1]
    _own_open(events, own)  # an ambiguous own reserve refuses here too, never silently filtered
    return frozenset(e["campaignId"] for e in events if e["type"] == "reserve" and not _is_own_open(e, events, own))


def _is_own_open(e, events, own):
    # A settle OR a release closes a reserve (state_ref_writer.TYPES; accounting_rollup drops the open reservation on either).
    closed = {(x["campaignId"], x["runId"], x["attempt"]) for x in events if x["type"] in ("settle", "release")}
    return (own is not None and e["type"] == "reserve" and (e["campaignId"], e["runId"], e["attempt"]) == tuple(own[:3])
            and e.get("provenance") == "request-sha256:" + own[3] and tuple(own[:3]) not in closed)


def _own_open(events, own):
    """This execution's own open reserves; more than one is ambiguous and refuses (the CLI developer's review of 7ab42417) rather than falling back."""
    found = [e for e in events if _is_own_open(e, events, own)]
    _need(len(found) <= 1, "action-approval-own-reserve-ambiguous")
    return found


def manual_approval_chain(chain, own):
    """#1772 review 4446137323: a manual dispatch's reserve is appended by the authenticated journal-reserve writer job BEFORE the read-only
    live job prepares, while its approver's action approval names the continuity checkpoint the approver saw, i.e. the one before that
    reserve. The verified head must therefore add exactly this execution's own open reserve (campaign, run, attempt and admitted request
    digest) to its parent and nothing else; the checkpoint is computed at that parent. Anything else (no own reserve, a later event, another
    run's reserve) refuses, so a stale approval is never admitted against a changed journal."""
    events = chain[-1][1]
    _need(len(chain) >= 2 and events and _is_own_open(events[-1], events, own) and chain[-2][1] == events[:-1], "manual-reserve-not-at-head")
    _own_open(events, own)  # a second own open reserve is ambiguous and refuses
    return chain[:-1]




def reservation_binding_doc(chain, own, reconciliation_bytes, harness_source_sha, tested_sha):
    """the authoritative reservation a manual run executes under, derived from the SAME validated state-ref chain
    prepare read (reviewed root -> head) and the EXACT manual own tuple (campaign, run, attempt, admitted request digest) manual_approval_chain
    admitted: the head must add exactly this run's one open own reserve to its parent, and that parent must be the reconciliation checkpoint's
    head (an independently produced, byte-checked artifact). Three distinct heads are recorded: the harness/workflow source, the tested served
    release and the journal. Nothing in it refers to the plan, so binding it into the plan is not self-referential."""
    manual_approval_chain(chain, own)                      # own reserve exactly at head, unique, open; anything else refuses
    event = chain[-1][1][-1]
    _need(_is_own_open(event, chain[-1][1], own), "reservation-binding-not-own-open")
    alloc = event.get("allocation")
    _need(isinstance(alloc, dict) and type(alloc.get("identityReads")) is int and alloc["identityReads"] >= 0, "reservation-binding-allocation")
    try:
        checkpoint = json.loads(reconciliation_bytes)
    except (TypeError, ValueError):
        raise Refused("reservation-binding-reconciliation")
    _need(isinstance(checkpoint, dict) and checkpoint.get("headSha") == chain[-2][0], "reservation-binding-reconciliation-head")
    canon = lambda o: json.dumps(o, sort_keys=True, separators=(",", ":")).encode()
    return {"schema": RB.SCHEMA, "campaignId": own[0], "runId": own[1], "attempt": own[2], "requestSha256": own[3],
            "journalRootSha": chain[0][0], "reconciliationHeadSha": chain[-2][0], "journalHeadSha": chain[-1][0],
            "reserveEventSha256": hashlib.sha256(canon(event)).hexdigest(), "allocationSha256": hashlib.sha256(canon(alloc)).hexdigest(),
            "identityReads": alloc["identityReads"], "harnessSourceSha": harness_source_sha, "testedSha": tested_sha}


def own_held_allocation(chain, own):
    """the reviewer RETURN : the allocation THIS execution's verified, still-open reserve holds (None when there is none). The rollup
    already charges an open reserve against period headroom, so an admitted run is checked against what it holds, never charged twice."""
    held = _own_open(chain[-1][1], own)
    return dict(held[0]["allocation"]) if held else None


def _standing_raw(repo, pin):
    pinned = RECURRING_APPROVAL_SHA256 if pin is None else pin
    _need(pinned is not None, "action-approval-standing-not-pinned")
    path = os.path.join(repo, RECURRING_APPROVAL_PATH)
    _need(os.path.isfile(path) and not os.path.islink(path), "action-approval-standing-unreadable")
    raw = _read(path)
    _need(hashlib.sha256(raw).hexdigest() == pinned, "action-approval-standing-not-the-pinned-bytes")
    return raw, pinned


def standing_grant_in_force(repo, pin=None):
    """True only when the pinned recurring approval carries a grant clause; an unset pin means no grant can be in force."""
    if (RECURRING_APPROVAL_SHA256 if pin is None else pin) is None:
        return False
    raw, _ = _standing_raw(repo, pin)
    try:
        doc = json.loads(raw)
    except ValueError:
        raise Refused("action-approval-standing-unreadable")
    return isinstance(doc, dict) and "startTakeGrant" in doc


def standing_envelope(repo, req, request_sha256, reconciliation_bytes, scope, cases, cfg, now, attempt, prior, pin=None, held=None):
    """Option A : a nightly occurrence's action envelope, DERIVED only under the owner's explicit standing grant in the
    pinned recurring approval, never from data equality alone. The approval, attempt, occurrence (and its replay), cases, window, per-run
    and period limits and references are all checked BEFORE the envelope exists; the unchanged check_action_approval then admits it, and
    case_start_caps.bind_inputs re-checks it against the bytes it reads. `pin` is TEST-ONLY."""
    import nightly_request as N  # lazy: nightly_request imports this module
    raw, pinned = _standing_raw(repo, pin)
    n = req.get("nightly") or {}
    _need(n.get("approvalSha256") == pinned, "action-approval-standing-not-the-request-approval")
    try:
        ap = N.check_approval(raw, now, cfg)
    except N.Refused as e:
        raise Refused("action-approval-standing-" + str(e))
    grant = ap.get("startTakeGrant")
    _need(grant is not None, "action-approval-standing-not-granted")
    _need(isinstance(grant, dict) and set(grant) == STANDING_GRANT_KEYS and grant["scope"] == STANDING_GRANT_SCOPE and _ref(grant["grantRef"])
          and isinstance(grant["cases"], list) and grant["cases"] and all(isinstance(c, str) for c in grant["cases"])
          and grant["cases"] == sorted(set(grant["cases"])) and set(grant["cases"]) <= set(ALL_CASES), "action-approval-standing-grant-shape")
    _need(attempt == 1 and type(n.get("attempt")) is int and n["attempt"] == 1, "action-approval-standing-attempt")
    slot = _utc(n.get("occurrence"))
    try:
        key = N.occurrence_id(ap, slot)
    except N.Refused:
        raise Refused("action-approval-standing-occurrence")
    _need(key == req.get("runId") == n.get("occurrenceId"), "action-approval-standing-occurrence")
    _need(isinstance(prior, (set, frozenset)) and key not in prior, "action-approval-standing-occurrence-replayed")
    _need(set(cases) <= set(grant["cases"]), "action-approval-standing-case")
    caps, period = ap["perRunCaps"], ap["periodCaps"]
    p_start, p_end = N.period_bounds(ap)
    w = req.get("window") or {}
    start, end = _utc(w.get("startUtc")), _utc(w.get("endUtc"))
    _need(start == slot and (end - start).total_seconds() == 60 * caps["windowMinutes"] and _utc(ap["validFromUtc"]) <= start
          and end <= _utc(ap["expiresUtc"]) and p_start <= start and end <= p_end and start <= now < end, "action-approval-standing-window")
    proposed, lim, est = req.get("proposedLimits") or {}, req.get("approvedLimits") or {}, req.get("estimate") or {}
    run_cap = (est.get("requests") or {}).get("runCap")
    # The standing approval's per-run request cap is a ceiling.  This occurrence
    # reserves the smaller admitted allocation, but every request document view
    # of that allocation must agree exactly so unused standing headroom cannot be
    # substituted into the envelope later.
    _need(_int(lim.get("runCapRequests")) and proposed.get("runCapRequests") == lim["runCapRequests"] == run_cap
          and run_cap <= caps["runCapRequests"] and lim.get("identityCap") == caps["identityReads"]
          and _int(est.get("identityReads")) and est["identityReads"] <= caps["identityReads"]
          and _int(est.get("starts")) and est["starts"] <= caps["starts"] and _int(est.get("takes")) and est["takes"] <= caps["takes"],
          "action-approval-standing-per-run")
    # RETURN : the verified checkpoint's accounting period and every period ceiling are the standing approval's own, and
    # the remaining headroom in each dimension still holds this run, so a different accounting scope can never extend the standing grant.
    rc = json.loads(reconciliation_bytes)
    _need(lim.get("cumulativeCeilingRequests") == period["requests"] and isinstance(scope, dict)
          and _utc(scope.get("periodStartUtc")) == p_start and _utc(scope.get("periodEndUtc")) == p_end
          and rc.get("scopeApprovalRef") == ap["approvalRef"]
          and all(rc["ceilings"].get(k) == period[k] for k in STANDING_PERIOD_DIMENSIONS), "action-approval-standing-period")
    need = {"requests": lim["runCapRequests"], "identityReads": lim["identityCap"], "starts": est["starts"], "takes": est["takes"]}
    for k in STANDING_PERIOD_DIMENSIONS:
        if held is not None:  # this run's own open reserve is already counted: it must hold the request, not consume headroom again
            _need(_int(held.get(k)) and held[k] >= need[k], "action-approval-standing-held-insufficient:" + k)
        else:
            _need(_int(rc["currentHeadroom"].get(k)) and rc["currentHeadroom"][k] >= need[k], "action-approval-standing-exhausted:" + k)
    _need(lim.get("approvalRef") == ap["approvalRef"] and lim.get("approvedBy") == ap["approvedBy"]
          and req.get("selectionApprovalRef") == ap["approvalRef"] and n.get("standingApprovalRef") == ap["approvalRef"],
          "action-approval-standing-reference")
    envelope = {"schema": ACTION_APPROVAL_SCHEMA, "requestSha256": request_sha256,
                "reconciliationSha256": hashlib.sha256(reconciliation_bytes).hexdigest(), "approvalRef": ap["approvalRef"],
                "approvedBy": ap["approvedBy"], "selectionApprovalRef": req["selectionApprovalRef"]}
    return check_action_approval(envelope, request_sha256, reconciliation_bytes, req)


def occurrence_action_approval(facts, request_sha256, reconciliation_bytes, req, nightly=False, standing=None, repo=None, chain=None):
    """Return the exact builder envelope for this occurrence.

    Manual dispatches retain the approver-supplied, byte-bound envelope. Scheduled executions must not carry a reusable envelope in their
    pinned facts. D1(a) : a nightly envelope is derived ONLY through `standing` (standing_envelope), which checks the
    pinned standing grant, attempt, occurrence and replay, cases, window, per-run limits, period headroom and references BEFORE the envelope
    exists; the derived envelope is the request/reconciliation-bound one, and the ordinary checker validates it for both routes.
    """
    supplied = facts.get("actionApproval")
    if nightly:
        _need(supplied is None, "nightly-action-approval-must-be-derived")
        _need(standing is not None, "action-approval-standing-not-pinned")
        envelope = standing()
        lim = req.get("approvedLimits") or {}
        _need(envelope.get("requestSha256") == request_sha256 and envelope.get("approvalRef") == lim.get("approvalRef")
              and envelope.get("approvedBy") == lim.get("approvedBy") and envelope.get("selectionApprovalRef") == req.get("selectionApprovalRef"),
              "action-approval-standing-reference")
        return envelope
    if req.get("runId") == "R10-3b040043-smoke15":
        _need(not (set(facts) & CALLER_AUTHORITY_FIELDS), "one-off-caller-authority-refused")
        _need(isinstance(repo, str), "one-off-grant-unreadable")
        approval = one_off_grant(repo, None, req.get("createdUtc"), reconciliation_bytes, chain,
                                 selection=[s.get("case") for s in req.get("selection") or [] if isinstance(s, dict)])
        window = req.get("window") or {}
        _need(req.get("createdUtc") == window.get("startUtc")
              and (_utc(window.get("endUtc")) - _utc(window.get("startUtc"))).total_seconds()
              == 60 * SMOKE_OCCURRENCE_WINDOW_MINUTES,
              "relative-occurrence-request-window")
        release = req.get("release") or {}
        _need(release.get("testedSha") == approval["testedSha"]
              and (release.get("backend") or {}).get("sha") == approval["backendSha"],
              "relative-occurrence-request-release")
        envelope = {"schema": ACTION_APPROVAL_SCHEMA, "requestSha256": request_sha256,
                    "reconciliationSha256": hashlib.sha256(reconciliation_bytes).hexdigest(),
                    "approvalRef": approval["scopeApprovalRef"], "approvedBy": approval["approvedBy"],
                    "selectionApprovalRef": approval["approvalRef"]}
        return check_action_approval(envelope, request_sha256, reconciliation_bytes, req)
    return check_action_approval(supplied, request_sha256, reconciliation_bytes, req)


def checkpoint_and_scope(repo, req, pins=None, chain_reader=None, own=None):
    """The continuity checkpoint: the canonical bytes of the accepted rollup, bound to this request, with the accepted period scope they were
    received under (the standing derivation binds its period), or a continuity-* refusal. `pins` and
    `chain_reader` are TEST-ONLY overrides; production uses continuity_pins (all None today) and the real state-ref journal."""
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
        chain = (chain_reader or state_chain)(pins["reviewed_root"])
        rc = accounting_rollup.receive(raws[CONTINUITY_BOOTSTRAP], scope, chain, pins["accepted_sha256"],
                                       pins["accepted_root"])
    except (accounting_rollup.Refused, manual_reservation.Refused, state_ref_writer.Refused) as e:
        raise Refused("continuity-" + str(e))
    lim = req.get("approvedLimits") or {}
    _need(isinstance(lim.get("approvalRef"), str) and scope["approvalRef"] == lim["approvalRef"], "continuity-approval-not-the-request")
    # the reviewer RETURN #2: the whole execution window lies inside the accepted period (no future or expired period admits it).
    window = req.get("window") or {}
    _need(_utc(scope["periodStartUtc"]) <= _utc(window.get("startUtc")) and _utc(window.get("endUtc")) <= _utc(scope["periodEndUtc"]),
          "continuity-window-outside-period")
    nightly = req.get("priority") == "nightly-regression"
    for ceiling, limit in CONTINUITY_CEILINGS:
        if nightly and limit == "identityCap":
            # RETURN #3: a nightly request's identityCap is its PER-RUN cap (nightly_request.derive), not the period ceiling; it must fit
            # the period's remaining identity headroom instead of equalling the period ceiling.
            held = own_held_allocation(chain, own) if own is not None else None
            if held is not None:  # already counted in the rollup: it must cover the cap, not be charged a second time
                _need(_int(lim.get(limit)) and lim[limit] <= held["identityReads"], "continuity-run-identity-exceeds-held")
            else:
                _need(_int(lim.get(limit)) and lim[limit] <= rc["currentHeadroom"]["identityReads"], "continuity-run-identity-exceeds-period")
            continue
        # Applicable = stated by the admitted request; the cumulative request and identity ceilings are always stated (check_request).
        if lim.get(limit) is not None or limit in ("cumulativeCeilingRequests", "identityCap"):
            _need(_int(lim.get(limit)) and rc["ceilings"][ceiling] == lim[limit], "continuity-ceiling-not-the-request:" + ceiling)
    return accounting_rollup.checkpoint_bytes(rc), scope


def verified_checkpoint(repo, req, pins=None, chain_reader=None):
    """The checkpoint bytes alone (see checkpoint_and_scope); `pins` and `chain_reader` are TEST-ONLY overrides."""
    return checkpoint_and_scope(repo, req, pins, chain_reader)[0]


def prepare(x, now):
    repo = os.path.realpath(x.repo)
    _need(isinstance(x.run_id, str) and LR.RUN_ID.match(x.run_id) and x.attempt == 1, "run-identity")
    _need(isinstance(x.source_sha, str) and LR.SHA40.match(x.source_sha), "source-sha")
    nightly_file = getattr(x, "nightly_request_file", None)
    nightly_sha = getattr(x, "nightly_request_sha256", None)
    occurrence_file = getattr(x, "manual_occurrence_file", None)
    occurrence_sha = getattr(x, "manual_occurrence_sha256", None)
    workflow_start_utc = getattr(x, "workflow_start_utc", None)
    nightly = any(isinstance(v, str) and v for v in (nightly_file, nightly_sha))
    manual_occurrence = any(isinstance(v, str) and v for v in (occurrence_file, occurrence_sha))
    _need(not (nightly and x.request) and not (nightly and manual_occurrence), "request-source-ambiguous")
    _need(not manual_occurrence or (x.request and isinstance(occurrence_file, str) and occurrence_file
                                    and isinstance(occurrence_sha, str) and occurrence_sha), "manual-occurrence-inputs")
    _need(_git(repo, "rev-parse", "HEAD") == x.source_sha, "checkout-not-at-source")
    if nightly:
        req_path, req_blob, req_raw = nightly_request(nightly_file, nightly_sha, x.run_id, x.source_sha)
    elif manual_occurrence:
        try:
            manual_facts = json.loads(x.facts or "null")
        except ValueError:
            raise Refused("facts-shape")
        _need(isinstance(manual_facts, dict), "facts-shape")
        req_path, req_blob, req_raw, _template_blob = select_manual_occurrence(repo, x.request, occurrence_file,
                                                                               occurrence_sha, x.source_sha, workflow_start_utc)
    else:
        req_path, req_blob, req_raw = select_request(repo, x.request, x.source_sha)
    req, cfg, template_keys = json.loads(req_raw), _load(os.path.join(repo, x.config)), _request_keys()
    cases = check_request(req, now, template_keys, nightly)
    route = "github-producer" if set(cases) & PRODUCER_CASES else "github-direct"
    live_minutes = check_ceilings(cfg, req, cases, x.job_timeout_minutes)
    check_window_fit(req, now, live_minutes)
    deadline = execution_deadline(req, now, live_minutes)
    _need(not (nightly and x.facts), "nightly-facts-input-refused")
    facts = nightly_facts(repo) if nightly else (manual_facts if manual_occurrence else json.loads(x.facts or "null"))
    _need(isinstance(facts, dict), "facts-shape")
    if not nightly:     # a dispatch's facts input and its request are published in the public repository's run
        _need(publishable(facts), "facts-not-publishable")
        _need(isinstance(facts.get("ownerApprovalReference"), str) and APPROVAL_CODE.fullmatch(facts["ownerApprovalReference"]) is not None,
              "facts-approval-not-opaque")
        _need(facts.get("approvedBy") == APPROVER_ROLE and facts.get("reviewer") in REVIEWER_ROLES, "facts-approver-not-a-role")
        _need(publishable(req), "request-not-publishable")
    grant = None
    if req.get("runId") == "R10-3b040043-smoke15":
        _need(not (set(facts) & CALLER_AUTHORITY_FIELDS), "one-off-caller-authority-refused")
        grant = one_off_grant(repo, None, req.get("createdUtc"),
                              selection=[s.get("case") for s in req.get("selection") or [] if isinstance(s, dict)])
    lineage = check_release_lineage(repo, req, x.request, x.source_sha, req_blob, cases, facts.get("olderReleaseDiagnostic"), template_keys, grant)
    bundle = parse_live_accounts_bundle(os.environ.get("CLOUD_TEST_LIVE_ACCOUNTS"))
    accounts = account_bindings(cfg, cases, facts.get("accounts"), bundle,
                                req.get("runId") if req.get("runId") == "R10-3b040043-smoke15" else None)
    entries = {b["role"]: role_account(bundle, b["role"], os.environ.get("SUPABASE_URL")) for b in accounts}
    observation = read_case10_observation(getattr(x, "case10_observation", None))
    chains, approval_chains = [], []

    request_sha256 = hashlib.sha256(req_raw).hexdigest()
    own = (req["runId"], x.run_id, x.attempt, request_sha256) if nightly else None

    def read_chain(root):
        chains.append(state_chain(root))
        # #1772 review 4446137323: a manual run's reserve is appended by the journal-reserve writer job before this read-only job prepares,
        # so its approver's action approval names the checkpoint immediately before that reserve (manual_approval_chain).
        approval_chains.append(chains[-1] if nightly else manual_approval_chain(chains[-1], (req["runId"], x.run_id, x.attempt, request_sha256)))
        return approval_chains[-1]
    reconciliation, accepted_scope = checkpoint_and_scope(repo, req, chain_reader=read_chain, own=own)
    action_approval = occurrence_action_approval(
        facts, request_sha256, reconciliation, req, nightly,
        standing=lambda: standing_envelope(repo, req, request_sha256, reconciliation, accepted_scope, cases, cfg, now, x.attempt,
                                           reserved_occurrences(chains[-1], own), held=own_held_allocation(chains[-1], own)), repo=repo,
        chain=approval_chains[-1] if approval_chains else None)
    facts = dict(facts, actionApproval=action_approval)
    check_case10_bound(req, facts, cases, entries, request_sha256, x.run_id, now, observation)
    # The producer route's cases (01/02/03/07/08) all run as existing-disposable; it is also the primary id for the account-id file.
    primary = "existing-disposable" if "existing-disposable" in entries else "maintained-read-only"
    account_id = entries[primary]["accountId"]
    builder_facts = translate_facts(facts, req, route)
    if observation is not None:
        builder_facts = dict(builder_facts, case10Observation=observation)  # the builder re-admits it (case10_execution_bound)
    scope = compose_scope(req, builder_facts, entries["existing-disposable"]["accountId"] if route == "github-producer" else account_id, cases, route,
                          deadline)
    # a MANUAL run's binding comes from its exact verified own reserve (never own=None); a nightly run binds none (unshared).
    reservation_binding = None
    if manual_occurrence:
        _need(bool(chains), "reservation-binding-chain-unread")
        reservation_binding = reservation_binding_doc(chains[-1], (req["runId"], x.run_id, x.attempt, request_sha256), reconciliation,
                                                      x.source_sha, req["release"]["testedSha"])
    # Cumulative request/identity/Starts/takes caps are G5's (check_gates.py 131-170, run by execute_run gate-and-validate with --enforce-go
    # before reserve or run); the caller supplies G5's verified inputs and never re-derives its formula.
    return {"request": req_path, "requestBlob": req_blob, "requestRaw": req_raw, "bundleBytes": canonical_bundle_bytes(bundle),
            "reconciliationBytes": reconciliation, "requestSha256": hashlib.sha256(req_raw).hexdigest(),
            "testedSha": req["release"]["testedSha"], "lineage": lineage, "cases": cases,
            "accountId": account_id, "emails": {b["credentials"]["email"]: entries[b["role"]]["email"] for b in accounts},
            "coverageMode": req["coverageMode"], "route": route, "liveMinutes": live_minutes, "executionDeadline": deadline,
            "accounts": accounts, "facts": builder_facts, "scope": scope, "reservationBinding": reservation_binding}


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
    cfg = _load(config_path)
    mode = request.get("coverageMode")
    pin = cfg["modes"]["smoke" if mode == "smoke" else "full"]["assertionCatalog"]
    catalog = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(config_path))), pin["file"])
    raw = _read(catalog)
    _need(hashlib.sha256(raw).hexdigest() == pin["sha256"], "assertion-catalog-not-pinned")
    cases = json.loads(raw)["cases"]
    return {"requestSha256": admitted_sha256, "request": request, "catalogSha256": pin["sha256"],
            "catalog": {cid: list(c["requiredAssertions"]) for cid, c in cases.items()}}


def projection_catalog(request_raw, request_sha256, config_path, qualification=None):
    """The assertion catalog the projection builds row verdicts from: the PINNED catalog of the admitted request's depth (smoke ->
    smoke-assertion-catalog, otherwise the full catalog), digest-checked exactly as identities does for qualification (the CLI hardcoded the full catalog, so a smoke run's 15-row AHT-01 verdict was built against 20 full rows and the
    publisher refused row-verdicts). The request must be the admitted bytes; a qualification, when present, must name the same catalog."""
    _need(isinstance(request_raw, bytes) and hashlib.sha256(request_raw).hexdigest() == request_sha256, "request-not-the-admitted-bytes")
    mode = json.loads(request_raw).get("coverageMode")
    pin = _load(config_path)["modes"]["smoke" if mode == "smoke" else "full"]["assertionCatalog"]
    raw = _read(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(config_path))), pin["file"]))
    _need(hashlib.sha256(raw).hexdigest() == pin["sha256"], "assertion-catalog-not-pinned")
    if isinstance(qualification, dict) and qualification.get("qualified") and qualification.get("catalogSha256") is not None:
        _need(qualification["catalogSha256"] == pin["sha256"], "projection-catalog-not-the-qualified-catalog")
    return json.loads(raw)


def qualify(plan_path, case_results_path, cases_dir, selected, approval, code_manifest, snapshot_dir, coverage_mode, ids,
            run_verifier=_run_verifier):
    """Freeze every verifier input, run the REAL verifier on the frozen snapshot only (fresh --out, exit 0, zero failures for exactly the
    frozen plan and results), then decide from the same frozen bytes: the builder's 15-row denominator with the dispatch subset in
    plan.selection, every selected case dispatched with a case result consistent with its rows, every required assertion present exactly
    once, and every evidence digest and summary matching the frozen bytes. EXECUTION and OUTCOME are separate :
    coverage is full/batch only when every selected required row was executed (PASS or FAIL), otherwise incomplete; the outcome is passed
    only when every one is PASS. A FAIL never weakens a binding check. The result binds the campaign, releases, plan/results digests,
    request, assertion catalog and harness CODE manifest."""
    selected = sorted(selected)
    _need(selected and all(c in ROLE for c in selected) and len(set(selected)) == len(selected), "case-selection")
    _need(coverage_mode in ("partial", "smoke", "full"), "coverage-mode")
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
    # The committed request is THIS campaign's: its runId, selection, tested release, mode and harness CODE pin are what ran (the reviewer RETURN
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
    elif coverage_mode == "smoke":
        _need((selected == ALL_CASES or req.get("runId") == R10_ONE_OFF_RUN_ID) and plan.get("coverageMode") == "smoke"
              and plan.get("assertionDepth") == "smoke", "plan-not-an-all-fifteen-smoke-plan")
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
            # Keep the request/plan denominator independent of execution completeness. In particular, a smoke run with one NOT RUN row
            # has coverage=incomplete, but it is still smoke-depth diagnostic evidence and must never enter full/nightly history.
            "coverageMode": coverage_mode, "assertionDepth": "smoke" if coverage_mode == "smoke" else "full",
            "coverage": ("full" if coverage_mode == "full" else "smoke" if coverage_mode == "smoke" else "batch") if executed else "incomplete",
            "outcome": "passed" if executed and counts["FAIL"] == 0 and all(o == "PASS" for o in case_outcomes) else "failed",
            "requestSha256": ids["requestSha256"], "catalogSha256": ids["catalogSha256"], "codeManifestSha256": digest(frozen["packet/CODE.sha256"]),
            "planCases": len(rows), "requiredRows": sum(counts.values()), "passRows": counts["PASS"], "failRows": counts["FAIL"],
            "notRunRows": counts["NOT RUN"]}


# I4' receiving contract, bound to the CLI developer's producers at 75b47b2c . Every request reader records
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
    manual/accepted-rollup reservation design lands ; then it becomes required here too."""
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
    """The nightly reservation's request-consumption record for this campaign: from a verified state-ref journal snapshot (the reserve stage
    writes it right after its reserve lands; the journal's own reserve event is the record), or from a legacy reservation ledger's reserve
    events. Exactly one either way."""
    if isinstance(ledger, dict) and ledger.get("schema") == "speaksharp.cloud-test.journal-snapshot.v1":
        found = [e for e in ledger.get("events") or [] if isinstance(e, dict) and e.get("type") == "reserve" and e.get("campaignId") == campaign_id]
        _need(len(found) == 1 and isinstance(found[0].get("provenance"), str) and found[0]["provenance"].startswith("request-sha256:"),
              "request-reader-record:reservation")
        e = found[0]
        return {"campaignId": e["campaignId"], "runId": e["runId"], "attempt": e["attempt"], "consumer": "reservation",
                "requestSha256": e["provenance"][len("request-sha256:"):], "consumedAtUtc": e["atUtc"]}
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


CASE_CODE = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
MAX_CASE_CODES = 8


def diagnostic_codes(diag):
    """Closed per-case codes for the published record from one closed case diagnostic (published-report propagation):
    a non-normal guard stop, the driver stage at interruption, a guard-refused navigation (guard-refused-<deny>|cap-<cap>|other),
    the exact net error, each guard upstream reason, and an absent egress proxy under env-proxy. Built only from the closed vocabularies above; at most MAX_CASE_CODES."""
    if not isinstance(diag, dict):
        return []
    out = []
    stop = diag.get("stopCode")
    if isinstance(stop, str) and stop not in ("completed", "unknown"):
        out.append("stop-" + stop)
    di = diag.get("driverInterruption") if isinstance(diag.get("driverInterruption"), dict) else {}
    if isinstance(di.get("stage"), str) and di["stage"] in DRIVER_STAGES:
        out.append("stage-" + di["stage"])
    if isinstance(di.get("stopReason"), str) and di["stopReason"] in GUARD_STOP_REASONS:
        out.append("guard-refused-" + di["stopReason"][len(GUARD_STOP_PREFIX):].replace(":", "-"))
    err = di.get("error") if isinstance(di.get("error"), dict) else {}
    if isinstance(err.get("netError"), str) and err["netError"] in DRIVER_NET_ERRORS:
        out.append("net-" + err["netError"].lower().replace("_", "-"))
    guard = diag.get("guard") if isinstance(diag.get("guard"), dict) else {}
    for reason in sorted(guard.get("upstreamReasons") or {}):
        if reason in GUARD_UPSTREAM_REASONS:
            out.append("upstream-" + reason)
    if guard.get("upstreamMode") == "env-proxy" and guard.get("proxyConfigured") is False:
        out.append("egress-proxy-absent")
    seen = []
    for code in out:
        if CASE_CODE.fullmatch(code) and code not in seen:
            seen.append(code)
    return seen[:MAX_CASE_CODES]


def project(run_record, run_id, attempt, source_sha, tested_sha, qualification=None, request_sha256=None, provenance=None, case_results_raw=None,
            catalog=None, request_raw=None, media_manifest_raw=None, case_codes=None):
    """run-record.json (the real collector keeps all 15 rows) -> the closed latest record. Qualification counts only when it is bound to THIS
    record and THIS admission: the same case-results digest, tested release, observed served release and admitted request digest. Then the selected rows keep their results, the others
    are NOT SELECTED, and coverage says batch or full truthfully. `passed` needs that binding and every selected row PASS; anything else is
    `failed` with code not-qualified."""
    _need(isinstance(run_record, dict) and run_record.get("schema") == "speaksharp.cloud-test.run-record.v1", "run-record-schema")
    rel = run_record.get("release") or {}
    _need(isinstance(tested_sha, str) and LR.SHA40.match(tested_sha) and rel.get("testedSha") == tested_sha, "run-record-for-another-release")
    q = qualification if isinstance(qualification, dict) else {}
    if run_record.get("result") == "INCOMPLETE":
        q = {}                                   # the reviewer N1: an incomplete record can never be qualified, whatever is supplied
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
                 q.get("coverageMode") in ("partial", "smoke", "full") and
                 q.get("assertionDepth") == ("smoke" if q.get("coverageMode") == "smoke" else "full") and
                 (q.get("coverage") in ("batch", "smoke", "incomplete") or (q.get("coverage") == "full" and sorted(q.get("cases") or []) == ALL_CASES)) and
                 isinstance(q.get("cases"), list) and set(q["cases"]) <= {c.get("case") for c in run_record.get("cases") or [] if isinstance(c, dict)})
    if qualified and q["coverage"] in ("batch", "smoke", "full"):
        # The qualification and the record derive from the same digest-bound case results; their outcomes must agree or neither counts.
        chosen = [c for c in run_record.get("cases") or [] if isinstance(c, dict) and c.get("case") in q["cases"]]
        qualified = (q["outcome"] == "passed") == (bool(chosen) and all(c.get("result") == "PASS" for c in chosen))
    cases = []
    for c in run_record.get("cases") or []:
        a = c.get("assertions") or {}
        unselected = qualified and c.get("case") not in q["cases"]
        codes = [c["outcomeClass"]] if not unselected and isinstance(c.get("outcomeClass"), str) and LR.CODE.match(c["outcomeClass"]) else []
        if not unselected and isinstance(case_codes, dict):
            for code in case_codes.get(c.get("case")) or []:
                if isinstance(code, str) and CASE_CODE.fullmatch(code) and code not in codes:
                    codes.append(code)
        cases.append({"caseId": c.get("case"), "result": "NOT SELECTED" if unselected else c.get("result"),
                      "rows": {"pass": 0, "fail": 0, "notRun": 0} if unselected else {"pass": a.get("PASS"), "fail": a.get("FAIL"), "notRun": a.get("NOT RUN")},
                      "codes": codes[:MAX_CASE_CODES]})
    selected = [c for c in cases if c["result"] != "NOT SELECTED"]
    row_verdicts = None
    if qualified and case_results_raw is not None and catalog is not None:
        # G7 rows: per-row verdicts in catalog order, only from the case results the qualification bound by digest
        _need(hashlib.sha256(case_results_raw).hexdigest() == q.get("caseResultsSha256"), "case-results-not-the-qualified-bytes")
        results = {c.get("caseId"): {a.get("id"): a.get("result") for a in c.get("assertions") or [] if isinstance(a, dict)}
                   for c in (json.loads(case_results_raw).get("cases") or []) if isinstance(c, dict)}
        code = {"PASS": "P", "FAIL": "F"}
        row_verdicts = {c["caseId"]: "".join(code.get(results.get(c["caseId"], {}).get(aid), "N")
                                             for aid in catalog["cases"][c["caseId"]]["requiredAssertions"])
                        for c in selected if c["caseId"] in catalog.get("cases", {})}
    rec = {"runId": run_id, "attempt": attempt, "sourceSha": source_sha, "testedSha": tested_sha, "servedSha": rel.get("servedShaAtAdmission"),
           "campaignId": q.get("campaignId") if qualified else None, "coverage": q["coverage"] if qualified else "unqualified",
           "startedUtc": run_record.get("startedUtc"), "endedUtc": run_record.get("endedUtc"),
           "requestSha256": q.get("requestSha256") if qualified else None, "catalogSha256": q.get("catalogSha256") if qualified else None,
           "outcome": "passed" if qualified and q["outcome"] == "passed" and selected and all(c["result"] == "PASS" for c in selected) else "failed",
           "cases": cases, "codes": ([] if qualified else ["not-qualified"]) + (["incomplete-run"] if run_record.get("result") == "INCOMPLETE" else [])}
    if qualified:
        rec.update(coverageMode=q["coverageMode"], assertionDepth=q["assertionDepth"])
    if row_verdicts:
        rec["rowVerdicts"] = row_verdicts
    if row_verdicts and request_raw is not None and media_manifest_raw is not None:
        # comparability: the identities this run's row verdicts were produced under, from the admitted request bytes (digest-checked)
        _need(hashlib.sha256(request_raw).hexdigest() == request_sha256, "request-not-the-admitted-bytes")
        admitted = json.loads(request_raw)
        rec["evidence"] = {"planSha256": q.get("planSha256"), "caseResultsSha256": q.get("caseResultsSha256")}
        comp = {"codeManifestSha256": q.get("codeManifestSha256") or (admitted.get("harness") or {}).get("codeManifestSha256"),
                "packetManifestSha256": (admitted.get("harness") or {}).get("packetManifestSha256"),
                "mediaManifestSha256": hashlib.sha256(media_manifest_raw).hexdigest(),
                "backendSha": ((admitted.get("release") or {}).get("backend") or {}).get("sha")}
        if all(isinstance(v, str) for v in comp.values()):
            rec["comparability"] = comp  # an identity that is not known leaves the rows not comparable, never a guessed match
    try:
        return LR.sanitize_record(rec, require_source=True)
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


def first_observation_export(cases_dir, selected):
    """Return the two content-safe first inventories, only when the case result links their exact bytes.

    The case directory itself is ephemeral. This closed projection is safe to retain and can become the next run's history reference; a
    present-but-unlinked or substituted observation refuses rather than silently disappearing when the runner is destroyed.
    """
    # Consultant P2-2 (runs 42423408284, 42494152179, 42615792133): a run that stopped before any case never creates the cases directory.
    # That is a closed, retained "no case reached" record, not a refusal (and a refused export then also failed the upload step). Anything
    # present at that path must still be a real directory.
    _need(isinstance(cases_dir, str) and (not os.path.lexists(cases_dir) or (os.path.isdir(cases_dir) and not os.path.islink(cases_dir))),
          "first-observation-cases-dir")
    _need(isinstance(selected, list) and selected and len(selected) == len(set(selected))
          and all(re.fullmatch(r"AHT-(?:0[1-9]|1[0-5])", x or "") for x in selected), "first-observation-selection")
    if not os.path.lexists(cases_dir):
        return {"schema": "speaksharp-first-observations-v1", "contentSafe": True, "selectedCases": selected, "observations": [],
                "notObserved": [{"caseId": c, "status": "NOT OBSERVED", "reason": "CASE NOT REACHED"} for c in ("AHT-01", "AHT-15") if c in selected]}
    expected = {"AHT-01": ("aht-01-first-observation.json", "existing-disposable"),
                "AHT-15": ("aht-15-first-observation.json", "maintained-read-only")}
    observations, not_observed = [], []
    keys = {"contentSafe", "kind", "inventoryStatus", "role", "accountSubjectSha256", "sourceBindingSha256", "sourceSha",
            "servedSha", "observedAtUtc", "rowCount", "completedCount", "readableCompletedCount", "readableHistoryAvailable",
            "inventoryComplete", "readLimit", "sanitizer"}
    for case_id in [x for x in ("AHT-01", "AHT-15") if x in selected]:
        candidate = os.path.join(cases_dir, case_id)
        if not os.path.lexists(candidate):
            not_observed.append({"caseId": case_id, "status": "NOT OBSERVED", "reason": "CASE NOT REACHED"})
            continue
        _need(not os.path.islink(candidate), "first-observation-case-dir")
        case_dir = os.path.realpath(candidate)
        _need(case_dir.startswith(os.path.realpath(cases_dir) + os.sep) and os.path.isdir(case_dir), "first-observation-case-dir")
        result_file, (ref, role) = os.path.join(case_dir, "case-result.json"), expected[case_id]
        observation_file = os.path.join(case_dir, ref)
        if not os.path.lexists(observation_file):
            not_observed.append({"caseId": case_id, "status": "NOT OBSERVED", "reason": "OBSERVATION NOT PRODUCED"})
            continue
        _need(os.path.isfile(result_file) and not os.path.islink(result_file) and os.path.isfile(observation_file)
              and not os.path.islink(observation_file), "first-observation-regular-files")
        raw = _read(observation_file)
        _need(len(raw) <= 8192, "first-observation-size")
        try:
            result, observation = json.loads(_read(result_file)), json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            raise Refused("first-observation-json")
        linked = {r for row in result.get("assertions", []) if isinstance(row, dict)
                  for r in row.get("evidenceRefs", []) if isinstance(r, str)}
        digests = result.get("evidenceDigests")
        _need(ref in linked and isinstance(digests, dict) and digests.get(ref) == hashlib.sha256(raw).hexdigest(),
              "first-observation-not-linked")
        _need(isinstance(observation, dict) and set(observation) == keys and observation.get("contentSafe") is True
              and observation.get("kind") == "first-account-observation" and observation.get("role") == role
              and observation.get("inventoryStatus") in ("OBSERVED", "UNKNOWN") and observation.get("readLimit") == 100
              and isinstance(observation.get("sanitizer"), dict) and observation["sanitizer"] == {"blockedStrings": 0, "droppedKeys": 0, "truncated": 0}
              and re.fullmatch(r"[a-f0-9]{64}", observation.get("accountSubjectSha256", ""))
              and re.fullmatch(r"[a-f0-9]{64}", observation.get("sourceBindingSha256", ""))
              and re.fullmatch(r"[a-f0-9]{40}", observation.get("sourceSha", ""))
              and observation.get("servedSha") == observation.get("sourceSha"), "first-observation-shape")
        try:
            _utc(observation.get("observedAtUtc"))
        except (Refused, TypeError, ValueError):
            raise Refused("first-observation-time")
        counts = (observation.get("rowCount"), observation.get("completedCount"), observation.get("readableCompletedCount"))
        if observation["inventoryStatus"] == "OBSERVED":
            _need(all(type(v) is int and 0 <= v <= 100 for v in counts) and counts[2] <= counts[1] <= counts[0]
                  and observation.get("readableHistoryAvailable") is (counts[2] > 0) and observation.get("inventoryComplete") is True,
                  "first-observation-counts")
        else:
            _need(counts == (None, None, None) and observation.get("readableHistoryAvailable") is None
                  and observation.get("inventoryComplete") is False, "first-observation-unknown")
        observations.append({"caseId": case_id, "evidenceRef": ref, "sha256": hashlib.sha256(raw).hexdigest(),
                             "observation": observation})
    return {"schema": "speaksharp-first-observations-v1", "contentSafe": True, "selectedCases": selected,
            "observations": observations, "notObserved": not_observed}


def case_timing_export(cases_dir, case_results_file, selected):
    """Project content-free per-case wall timings from the digest-bound supervisor summaries.

    Full case directories remain private. This projection preserves the measurements needed to replace provisional ceilings without
    publishing account, request, browser, assertion, or error content.
    """
    _need(isinstance(cases_dir, str) and os.path.isdir(cases_dir) and not os.path.islink(cases_dir), "case-timing-cases-dir")
    _need(isinstance(selected, list) and selected and len(selected) == len(set(selected))
          and all(re.fullmatch(r"AHT-(?:0[1-9]|1[0-5])", x or "") for x in selected), "case-timing-selection")
    results = _load(case_results_file)
    rows = results.get("cases") if isinstance(results, dict) else None
    _need(isinstance(rows, list) and len(rows) == 15, "case-timing-results")
    by_id = _unique(rows, "caseId", "case-timing-duplicate")
    out = []
    for case_id in selected:
        row = by_id.get(case_id)
        _need(isinstance(row, dict) and row.get("result") in ("PASS", "FAIL", "NOT RUN"), "case-timing-result")
        receipt = row.get("executionReceipt")
        if not isinstance(receipt, dict):
            _need(row["result"] == "NOT RUN", "case-timing-missing-receipt")
            out.append({"caseId": case_id, "result": row["result"], "timingStatus": "NOT OBSERVED",
                        "startedAtUtc": None, "endedAtUtc": None, "durationMs": None})
            continue
        summary = os.path.join(os.path.realpath(cases_dir), case_id, "summary.json")
        _need("summarySha256" in receipt, "case-timing-summary-digest")
        if receipt.get("summarySha256") is None:
            _need(not os.path.lexists(summary), "case-timing-summary")
            out.append({"caseId": case_id, "result": row["result"], "timingStatus": "NOT OBSERVED",
                        "startedAtUtc": None, "endedAtUtc": None, "durationMs": None})
            continue
        _need(os.path.isfile(summary) and not os.path.islink(summary), "case-timing-summary")
        raw = _read(summary)
        _need(hashlib.sha256(raw).hexdigest() == receipt.get("summarySha256"), "case-timing-summary-digest")
        try:
            doc = json.loads(raw)
            stamps = (doc.get("startedAt"), doc.get("endedAt"))
            _need(all(isinstance(v, str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z", v)
                      for v in stamps), "case-timing-time")
            started, ended = (datetime.fromisoformat(v.replace("Z", "+00:00")) for v in stamps)
        except (ValueError, TypeError, Refused):
            raise Refused("case-timing-time")
        duration = round((ended - started).total_seconds() * 1000)
        _need(0 <= duration <= 40 * 60 * 1000, "case-timing-duration")
        out.append({"caseId": case_id, "result": row["result"], "timingStatus": "OBSERVED",
                    "startedAtUtc": doc["startedAt"], "endedAtUtc": doc["endedAt"], "durationMs": duration})
    return {"schema": "speaksharp-case-timings-v1", "contentSafe": True, "selectedCases": selected, "cases": out}


STAGE_NAMES = ("install-tools", "build-plan", "stimulus-preflight", "build-plan-with-receipt", "gate-and-validate", "reserve",
               "manual-reserve", "run", "collect", "settle", "manual-settle")


def stage_trace_rows(trace_file):
    """The content-free stage trace execute_run.sh's run_stage appends (stage, start, end, exit code), validated row by row; [] when absent."""
    if not (isinstance(trace_file, str) and os.path.lexists(trace_file)):
        return []
    _need(os.path.isfile(trace_file) and not os.path.islink(trace_file), "stage-trace")
    rows = []
    for line in _read(trace_file).decode("utf-8").splitlines():
        parts = line.split("\t")
        _need(len(parts) == 4 and parts[0] in STAGE_NAMES and re.fullmatch(r"\d{1,3}", parts[3])
              and all(re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", v) for v in parts[1:3]), "stage-trace")
        start, end = _utc(parts[1]), _utc(parts[2])
        _need(end >= start, "stage-trace")
        rows.append({"stage": parts[0], "startedAtUtc": parts[1], "endedAtUtc": parts[2],
                     "durationMs": int((end - start).total_seconds() * 1000), "exitCode": int(parts[3])})
    _need(len(rows) <= 64, "stage-trace")
    return rows


ALL_AHT = tuple("AHT-%02d" % n for n in range(1, 16))
TRACE_SCOPE = ("stage-trace rows cover each run_stage WRAPPED command (start, end, exit code); a refusal raised before the command "
               "(stage-environment checks, BLOCKED_SETUP) has no row, and steps outside execute_run.sh are not traced")


def selection_from_request(request_file):
    """The selected cases from the committed or admitted request itself (used when init never ran, so its `cases` output is absent)."""
    doc = _load(request_file)
    sel = doc.get("selection") if isinstance(doc, dict) else None
    _need(isinstance(sel, list) and sel and all(isinstance(r, dict) and isinstance(r.get("case"), str) for r in sel), "case-timing-request")
    return [r["case"] for r in sel]


def _unknown_row(case_id, reason):
    return {"caseId": case_id, "result": "UNKNOWN", "evidence": reason, "timingStatus": "NOT OBSERVED",
            "startedAtUtc": None, "endedAtUtc": None, "durationMs": None}


TS = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z")


# Run 42483030590 : every case FAILED in ~1.1 s and the public timing table could not say why. Each bound row now carries a
# CLOSED, content-free diagnostic: the guard's stop code (from the digest-verified summary, mapped into this enumeration), its exit code,
# and the first non-passing assertion id when that id is a reviewed catalog id. A guard that exited before writing a summary (usage exit 2,
# setup refusal 78 before stop, a crash) is classified from the receipt's exit code; anything else is "unknown". No raw stderr,
# free-text reason, path or credential is ever projected.
STOP_CODES = {"completed", "deadline", "allowance-exhausted", "parent-lost", "sandbox-check-failed", "step-error", "guard-fatal"}
STOP_PREFIXED = {"fatal:uncaughtException": "fatal-uncaught-exception", "fatal:unhandledRejection": "fatal-unhandled-rejection",
                 "signal:SIGTERM": "signal-sigterm", "signal:SIGINT": "signal-sigint", "signal:SIGHUP": "signal-sighup"}
HARNESS_ROW_IDS = {"owned-pages-closed", "start-press-budget", "no-cloud-stt"}
ASSERTION_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")


def _catalog_assertion_ids():
    ids = set(HARNESS_ROW_IDS)
    for name in ("smoke-assertion-catalog.json", "assertion-catalog.json"):
        try:
            doc = json.loads(_read(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", name)))
        except (OSError, ValueError, Refused):
            continue
        cases = doc.get("cases") if isinstance(doc, dict) else None
        for case in (cases.values() if isinstance(cases, dict) else []):
            for key in ("requiredAssertions", "assertions"):
                for item in (case.get(key) or []) if isinstance(case, dict) else []:
                    aid = item.get("id") if isinstance(item, dict) else item
                    if isinstance(aid, str) and ASSERTION_ID.fullmatch(aid):
                        ids.add(aid)
    return ids


# Closed vocabularies only : a value outside these exact reviewed sets is `other` or dropped, never echoed. A format regex
# is not a vocabulary: `password-huntertwo` and `secret.token` are format-valid. DRIVER_STAGES is the driver's own STAGES set
# (harness/draft-adapters/browser-actions.cjs); DRIVER_TEST_IDS the exact data-testid values the reviewed adapters address;
# DRIVER_APIS the Playwright calls they make. tests/test_init_run_inputs.py pins all three to those sources.
DRIVER_STAGES = frozenset({
    "idle", "signin-navigate", "start-select", "start-press", "start-pressed", "retry-setup-wait", "start-recording-wait", "products-trigger-wait",
    "products-menu-wait", "products-trigger-click", "products-open-wait", "products-item-click", "stop-press", "stop-clicked",
    "stop-release-wait", "save-wait", "save-readback", "save-complete", "focus-dialog-wait", "focus-dialog-focus-wait", "focus-dialog-close",
    "focus-dialog-hidden-wait", "focus-intent-clear-wait"})
DRIVER_TEST_IDS = frozenset({
    "ai-suggestions-card", "ai-suggestions-pair", "email-input", "feedback-session-select", "feedback-type-broke", "focus-points-edit",
    "focus-points-legend", "focus-points-new-set", "focus-points-rail", "focus-points-rail-list", "issue-report-description",
    "issue-report-dialog", "issue-report-submit", "live-transcript", "mic-card", "mic-download", "mic-retry", "mic-start", "mic-status",
    "nav-account-avatar", "nav-analytics-link", "nav-mobile-products-button", "nav-products-button", "nav-report-issue-button",
    "nav-sign-out-button", "objective-add-point", "objective-goal-input", "objective-goal-select", "objective-pace-value",
    "objective-point-label-2", "objective-setup-dialog", "objective-setup-submit", "password-input", "practice-root",
    "progress-attempt-values", "progress-direction", "progress-loading", "progress-panel", "recorder-bar", "recorder-stop",
    "repeat-practice-target", "restored-review-retry", "review-evidence", "review-transcript", "review-try-next", "review-what-went-well",
    "saved-review", "saved-review-practice", "saved-session-return", "session-recovery-actions", "session-recovery-dismiss",
    "session-recovery-message", "session-retry-save", "session-unresolved-message", "session-unresolved-recovery", "sign-in-submit",
    "sign-out-button", "stt-mode-private", "stt-mode-select", "transcript-container"})
DRIVER_APIS = frozenset({
    "page.goto", "page.goBack", "page.reload", "page.evaluate", "page.waitForFunction", "page.waitForTimeout", "page.waitForURL",
    "page.addInitScript", "page.close", "locator.click", "locator.fill", "locator.press", "locator.check", "locator.selectOption",
    "locator.waitFor", "locator.textContent", "locator.innerText", "locator.getAttribute", "locator.inputValue", "locator.isVisible",
    "locator.isEnabled", "locator.evaluate", "locator.focus", "locator.hover", "locator.scrollIntoViewIfNeeded", "locator.count",
    "locator.boundingBox", "locator.dispatchEvent", "locator.pressSequentially"})
# The exact Chromium net error (browser-actions.cjs NET_ERRORS) and the guard's closed upstream reasons (guard-proxy.cjs UPSTREAM_REASONS),
# run 42496837188's page.goto network-error and the guard's upstream-error carried neither. Pinned to those sources by test.
DRIVER_NET_ERRORS = frozenset({
    "ERR_HTTP_RESPONSE_CODE_FAILURE", "ERR_CONNECTION_REFUSED", "ERR_CONNECTION_RESET", "ERR_CONNECTION_CLOSED", "ERR_CONNECTION_TIMED_OUT",
    "ERR_TIMED_OUT", "ERR_NAME_NOT_RESOLVED", "ERR_INTERNET_DISCONNECTED", "ERR_ADDRESS_UNREACHABLE", "ERR_PROXY_CONNECTION_FAILED",
    "ERR_TUNNEL_CONNECTION_FAILED", "ERR_CERT_AUTHORITY_INVALID", "ERR_CERT_COMMON_NAME_INVALID", "ERR_CERT_DATE_INVALID",
    "ERR_SSL_PROTOCOL_ERROR", "ERR_ABORTED", "ERR_FAILED", "ERR_EMPTY_RESPONSE", "ERR_BLOCKED_BY_CLIENT", "ERR_TOO_MANY_REDIRECTS",
    "ERR_NETWORK_CHANGED", "other"})
GUARD_UPSTREAM_REASONS = frozenset({"proxy-not-configured", "proxy-invalid", "proxy-connect-status", "test-only-trust", "no-test-override",
                                    "aborted", "dns", "connect-refused", "timeout", "reset", "tls", "other"})
GUARD_UPSTREAM_MODES = frozenset({"env-proxy", "direct", "override"})
# A navigation refused by the egress guard: the driver's code-owned closed stopReason
# (browser-actions.cjs GUARD_DENY_WORDS / GUARD_CAPS / guardDenyCode), pinned to that source by test. Only an exact member is carried.
GUARD_DENY_WORDS = frozenset({"policy", "host", "unknown-host", "upstream-error", "deadline", "deadline-passed", "closing", "concurrency-wait",
                              "websocket", "plain-http", "malformed", "host-mismatch"})
GUARD_CAPS = frozenset({"total", "navigations", "case-allowance", "case-takes", "account-closure", "auth", "coaching", "model", "preflight",
                        "public", "signed-in", "telemetry"})
GUARD_STOP_PREFIX = "guard-refused-navigation:"
GUARD_STOP_REASONS = frozenset({GUARD_STOP_PREFIX + w for w in GUARD_DENY_WORDS} | {GUARD_STOP_PREFIX + "cap:" + c for c in GUARD_CAPS}
                               | {GUARD_STOP_PREFIX + "other"})
# The driver's ordered navigation/sign-in trail (browser-actions.cjs TRAIL_EVENTS / TRAIL_ROUTES), closed and bounded; pinned by test.
TRAIL_EVENTS = frozenset({"nav-start", "nav-response", "nav-error", "auth-form-visible", "sign-in-submit", "sign-in-done", "sign-in-error"})
TRAIL_ROUTES = frozenset({"route-signin", "route-practice", "route-analytics", "route-session", "route-other"})
TRAIL_STATUS = frozenset({"status-1xx", "status-2xx", "status-3xx", "status-4xx", "status-5xx"})
TRAIL_MAX = 24


def _trail(raw):
    """The driver trail in order, each entry closed or dropped whole; never more than TRAIL_MAX."""
    out = []
    for e in raw[-TRAIL_MAX:] if isinstance(raw, list) else []:
        if not (isinstance(e, dict) and isinstance(e.get("event"), str) and e["event"] in TRAIL_EVENTS):
            continue
        ms = e.get("ms")
        out.append({"event": e["event"], "route": _closed(e.get("route"), TRAIL_ROUTES, "route-other"),
                    "statusClass": _closed(e.get("statusClass"), TRAIL_STATUS, None), "netError": _closed(e.get("netError"), DRIVER_NET_ERRORS, None),
                    "ms": ms if type(ms) is int and 0 <= ms <= 3600000 else None})
    return out
ERROR_NAMES = frozenset({"TimeoutError", "Error", "TypeError"})
ERROR_CODES = frozenset({"NOT_RUN", "AUTH_REJECTED", "START_PRESS_CAP", "START_CONTROL_NOT_READY", "PRODUCT_FAIL", "EVIDENCE_READER_UNAVAILABLE"})
ERROR_KINDS = frozenset({"timeout", "target-closed", "control-not-ready", "strict-mode", "network-error", "other"})
INTERRUPTION_MAX_BYTES = 65536
INTERRUPTION_REF = re.compile(r"aht-(0[1-9]|1[0-5])-interruption\.json")
_UNREAD = {"stage": "unknown", "step": None, "error": None, "trail": []}


def _closed(value, vocabulary, default):
    return value if isinstance(value, str) and value in vocabulary else default


def _bound_file(case_dir, name):
    """The bytes of `name` directly inside `case_dir`, or None. The ORIGINAL path is checked for a symlink before anything is resolved, and
    the resolved file must sit directly in the resolved directory (no escape, no nested path)."""
    if not (isinstance(case_dir, str) and isinstance(name, str)) or os.sep in name or name in (".", ".."):
        return None
    path = os.path.join(case_dir, name)
    if os.path.islink(case_dir) or os.path.islink(path) or not os.path.isfile(path):
        return None
    if os.path.dirname(os.path.realpath(path)) != os.path.realpath(case_dir) or os.path.getsize(path) > INTERRUPTION_MAX_BYTES * 16:
        return None
    try:
        return _read(path)
    except (OSError, Refused):
        return None


def driver_interruption(case_dir, case_id, row, receipt, allowed_ids):
    """the driver catches early page/observer/navigation/login errors, records an owner-bound FAIL and returns
    normally, so the guard's stop code can be `completed`. Its content-safe interruption evidence (source-adapters retainInterruptionEvidence)
    is projected only when BOUND to this case and its retained receipt: the row names exactly one interruption ref, `<case>-interruption.json`
    for this case; the case's `case-result.json` hashes to the receipt's caseResultSha256 and lists that ref in evidenceDigests with the file's
    exact sha256; the document's own caseId is this case. Every field then passes through the reviewed vocabularies above; anything else is
    `other` or dropped. None when the row names no interruption; `unknown` when one is named but cannot be bound."""
    refs = set()
    for a in row.get("assertions") if isinstance(row.get("assertions"), list) else []:
        for r in (a.get("evidenceRefs") if isinstance(a, dict) and isinstance(a.get("evidenceRefs"), list) else []):
            if isinstance(r, str) and "interruption" in r:
                refs.add(r)
    if not refs:
        return None
    name = case_id.lower() + "-interruption.json"
    if refs != {name} or not INTERRUPTION_REF.fullmatch(name) or not isinstance(receipt, dict):
        return dict(_UNREAD)
    result_raw, raw = _bound_file(case_dir, "case-result.json"), _bound_file(case_dir, name)
    want = receipt.get("caseResultSha256")
    if result_raw is None or raw is None or len(raw) > INTERRUPTION_MAX_BYTES or not isinstance(want, str) \
            or hashlib.sha256(result_raw).hexdigest() != want:
        return dict(_UNREAD)
    try:
        result, doc = json.loads(result_raw), json.loads(raw)
    except (ValueError, UnicodeDecodeError, RecursionError):
        return dict(_UNREAD)
    digests = result.get("evidenceDigests") if isinstance(result, dict) else None
    if not (isinstance(digests, dict) and digests.get(name) == hashlib.sha256(raw).hexdigest()):
        return dict(_UNREAD)
    if not (isinstance(doc, dict) and doc.get("kind") == "interruption-diagnostic" and doc.get("caseId") == case_id):
        return dict(_UNREAD)
    step, err = doc.get("step"), doc.get("error")
    out = {"stage": _closed(doc.get("stage"), DRIVER_STAGES, "other"),
           "step": (step if step in allowed_ids else "unlisted") if isinstance(step, str) else None, "error": None,
           "trail": _trail(doc.get("trail"))}
    if isinstance(doc.get("stopReason"), str) and doc["stopReason"] in GUARD_STOP_REASONS:
        out["stopReason"] = doc["stopReason"]           # exact reviewed member only; anything else is dropped, never echoed
    if isinstance(err, dict):
        t, ids = err.get("timeoutMs"), err.get("testIds")
        out["error"] = {"name": _closed(err.get("name"), ERROR_NAMES, "Error"), "code": _closed(err.get("code"), ERROR_CODES, None),
                        "kind": _closed(err.get("kind"), ERROR_KINDS, "other"), "api": _closed(err.get("api"), DRIVER_APIS, None),
                        "timeoutMs": t if type(t) is int and 0 <= t <= 3600000 else None,
                        "testIds": sorted({x for x in ids if isinstance(x, str) and x in DRIVER_TEST_IDS})[:5] if isinstance(ids, list) else [],
                        "netError": _closed(err.get("netError"), DRIVER_NET_ERRORS, None)}
    return out


UNKNOWN_DIAGNOSTIC = {"stopCode": "unknown", "exitCode": None, "firstNonPassingAssertion": None, "driverInterruption": None, "guard": None}


def guard_upstream(summary_doc):
    """The guard's egress configuration and upstream-failure reasons from the DIGEST-VERIFIED case summary, closed: the upstream mode, the
    proxy presence/validity/NO_PROXY booleans (never values) and the count per closed upstream reason. None when the summary has no guard."""
    guard = summary_doc.get("guard") if isinstance(summary_doc, dict) else None
    if not isinstance(guard, dict):
        return None
    cfg = guard.get("upstreamConfig") if isinstance(guard.get("upstreamConfig"), dict) else {}
    counters = guard.get("counters") if isinstance(guard.get("counters"), dict) else {}
    reasons = counters.get("upstreamReasons") if isinstance(counters.get("upstreamReasons"), dict) else {}
    flag = lambda v: v if type(v) is bool else None  # noqa: E731
    return {"upstreamMode": _closed(cfg.get("mode"), GUARD_UPSTREAM_MODES, None),
            "proxyConfigured": flag(cfg.get("proxyConfigured")), "proxyValid": flag(cfg.get("proxyValid")),
            "noProxyMatched": flag(cfg.get("noProxyMatched")),
            "upstreamReasons": {r: n for r, n in sorted(reasons.items())
                                if isinstance(r, str) and r in GUARD_UPSTREAM_REASONS and type(n) is int and 0 <= n <= 100000}}


def case_diagnostic(case_id, row, receipt, summary_doc, allowed_ids, case_dir=None):
    """{stopCode, exitCode, firstNonPassingAssertion, driverInterruption} from closed sources only. Never raises: a malformed input yields
    UNKNOWN for THIS row's diagnostic only, never the loss of the whole artifact ."""
    try:
        return _case_diagnostic(case_id, row, receipt, summary_doc, allowed_ids, case_dir)
    except Exception:  # noqa: BLE001  (display-only projection; any malformed shape is UNKNOWN, never a crash)
        return dict(UNKNOWN_DIAGNOSTIC)


def _case_diagnostic(case_id, row, receipt, summary_doc, allowed_ids, case_dir):
    if not (isinstance(row, dict) and isinstance(case_id, str) and case_id in ALL_AHT):
        return dict(UNKNOWN_DIAGNOSTIC)
    code = receipt.get("exitCode") if isinstance(receipt, dict) else None
    exit_code = code if type(code) is int and 0 <= code <= 255 else None
    if isinstance(summary_doc, dict):
        reason = summary_doc.get("reason")
        if reason is None:
            stop = "unknown"
        elif isinstance(reason, str):
            stop = reason if reason in STOP_CODES else STOP_PREFIXED.get(reason, "other")
        else:
            stop = "other"
    elif exit_code == 2:
        stop = "guard-usage-refused"
    elif exit_code == 78:
        stop = "guard-refused-before-start"
    elif exit_code is not None:
        stop = "guard-exited-without-summary"
    else:
        stop = "unknown"
    first = None
    for a in row.get("assertions") if isinstance(row.get("assertions"), list) else []:
        if isinstance(a, dict) and isinstance(a.get("result"), str) and a["result"] in ("FAIL", "NOT RUN"):
            aid = a.get("id")
            first = {"id": aid if isinstance(aid, str) and aid in allowed_ids else "unlisted", "result": a["result"]}
            break
    return {"stopCode": stop, "exitCode": exit_code, "firstNonPassingAssertion": first,
            "driverInterruption": driver_interruption(case_dir, case_id, row, receipt, allowed_ids), "guard": guard_upstream(summary_doc)}


def isolated_case_rows(cases_dir, case_results_file, selected, run_id):
    """Per-case isolated display rows (the reviewer B3-B9). Never raises on input:
    corrupt or ambiguous TOP-LEVEL results make every selected row UNKNOWN (nothing credited); a malformed, unbound or unverifiable CASE makes
    only that row UNKNOWN with null measurements and a closed reason, keeping valid peers. A verdict survives only when its row is
    well-formed and its receipt is bound to this run and case; a timing only when its summary digest, times and duration all verify.
    Display only: qualification and accounting never read this."""
    try:
        doc = json.loads(_read(case_results_file))
    except (OSError, ValueError, UnicodeDecodeError, Refused):
        return {c: _unknown_row(c, "case-results-unreadable") for c in selected}, "results-invalid"
    rows = doc.get("cases") if isinstance(doc, dict) else None
    if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
        return {c: _unknown_row(c, "case-results-shape") for c in selected}, "results-invalid"
    by, ambiguous = {}, set()
    for r in rows:
        cid = r.get("caseId")
        if not (isinstance(cid, str) and cid in ALL_AHT):
            return {c: _unknown_row(c, "case-results-shape") for c in selected}, "results-invalid"
        if cid in by:
            ambiguous.add(cid)
        by[cid] = r
    out = {}
    allowed_ids = _catalog_assertion_ids()
    for c in selected:
        r = by.get(c)
        if c in ambiguous:
            out[c] = _unknown_row(c, "duplicate-case"); continue
        if r is None:
            out[c] = _unknown_row(c, "case-row-missing"); continue
        result, receipt = r.get("result"), r.get("executionReceipt")
        if result not in ("PASS", "FAIL", "NOT RUN"):
            out[c] = _unknown_row(c, "case-result-invalid"); continue
        if receipt is None:
            out[c] = (dict(_unknown_row(c, "harness-not-run"), result="NOT RUN") if result == "NOT RUN"
                      else _unknown_row(c, "missing-receipt"))
            continue
        if not (isinstance(receipt, dict) and receipt.get("caseId") == c and str(receipt.get("runId")) == str(run_id)
                and "summarySha256" in receipt):
            out[c] = _unknown_row(c, "receipt-not-bound"); continue
        digest = receipt.get("summarySha256")
        base = {"caseId": c, "result": result, "evidence": "bound-case-receipt"}
        if digest is None:                      # the guard exited before a summary: the verdict stands, the timing was not observed
            out[c] = dict(base, timingStatus="NOT OBSERVED", startedAtUtc=None, endedAtUtc=None, durationMs=None,
                          diagnostic=case_diagnostic(c, r, receipt, None, allowed_ids,
                                                     os.path.join(cases_dir, c) if isinstance(cases_dir, str) else None)); continue
        summary = os.path.join(os.path.realpath(cases_dir), c, "summary.json") if isinstance(cases_dir, str) else ""
        try:
            raw = _read(summary) if os.path.isfile(summary) and not os.path.islink(summary) else None
        except OSError:
            raw = None
        if raw is None or not isinstance(digest, str) or hashlib.sha256(raw).hexdigest() != digest:
            out[c] = _unknown_row(c, "summary-digest"); continue
        try:
            sd = json.loads(raw)
            stamps = (sd.get("startedAt"), sd.get("endedAt")) if isinstance(sd, dict) else (None, None)
            ok = all(isinstance(v, str) and TS.fullmatch(v) for v in stamps)
            started, ended = (datetime.fromisoformat(v.replace("Z", "+00:00")) for v in stamps) if ok else (None, None)
        except (ValueError, TypeError):
            ok = False
        if not ok:
            out[c] = _unknown_row(c, "case-timing-invalid"); continue
        duration = round((ended - started).total_seconds() * 1000)
        if not 0 <= duration <= 40 * 60 * 1000:
            out[c] = _unknown_row(c, "case-timing-invalid"); continue
        out[c] = dict(base, timingStatus="OBSERVED", startedAtUtc=stamps[0], endedAtUtc=stamps[1], durationMs=duration,
                      diagnostic=case_diagnostic(c, r, receipt, sd, allowed_ids, os.path.join(cases_dir, c)))
    return out, "results"


def run_timing_export(cases_dir, case_results_file, selected, started_file, trace_file, binding):
    """The one-page table's data, ALWAYS (the reviewer concept).
    Every one of the fifteen cases has a row bound to this run, attempt and head:
      NOT SELECTED - not in this run's selection;
      NOT RUN - selected, with AFFIRMATIVE evidence it never ran: no started.txt, which the run stage writes before admission and
                       before any case;
      UNKNOWN - selected, the run stage started, but no case results exist: a case may have run, so nothing is claimed;
      PASS/FAIL/... - from the digest-bound case results, exactly as case_timing_export projects them.
    Plus the measured stages (content-free trace), the stage where setup stopped, and the workflow-start and run-start times, so queue,
    setup and run time are preserved. Content-free throughout."""
    _need(isinstance(binding, dict) and re.fullmatch(r"[1-9][0-9]{0,19}", str(binding.get("runId") or "")) is not None
          and re.fullmatch(r"[1-9][0-9]{0,3}", str(binding.get("runAttempt") or "")) is not None
          and LR.SHA40.match(str(binding.get("headSha") or "")) is not None
          and (binding.get("workflowStartUtc") in (None, "") or re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", binding["workflowStartUtc"])),
          "case-timing-binding")
    _need(isinstance(selected, list) and selected and len(selected) == len(set(selected)) and all(x in ALL_AHT for x in selected),
          "case-timing-selection")
    started_at = None
    if isinstance(started_file, str) and os.path.lexists(started_file):
        _need(os.path.isfile(started_file) and not os.path.islink(started_file), "case-timing-started")
        started_at = _read(started_file).decode("ascii", "replace").strip()
        _need(re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", started_at) is not None, "case-timing-started")
    has_results = isinstance(case_results_file, str) and os.path.lexists(case_results_file)
    if started_at is None:
        _need(not has_results, "case-timing-results-without-run")
        outcome, rows = "not-started", {c: {"caseId": c, "result": "NOT RUN", "evidence": "run-stage-never-started"} for c in selected}
    elif not has_results:
        outcome, rows = "started-without-results", {c: {"caseId": c, "result": "UNKNOWN", "evidence": "started-without-case-results"} for c in selected}
    else:
        rows, outcome = isolated_case_rows(cases_dir, case_results_file, selected, binding["runId"])
    cases = []
    for c in ALL_AHT:
        if c not in selected:
            cases.append({"caseId": c, "result": "NOT SELECTED", "evidence": "not-in-selection", "timingStatus": "NOT APPLICABLE",
                          "startedAtUtc": None, "endedAtUtc": None, "durationMs": None})
            continue
        row = rows[c]
        cases.append({"caseId": c, "result": row["result"], "evidence": row["evidence"],
                      "timingStatus": row.get("timingStatus", "NOT OBSERVED"), "startedAtUtc": row.get("startedAtUtc"),
                      "endedAtUtc": row.get("endedAtUtc"), "durationMs": row.get("durationMs"),
                      **({"diagnostic": row["diagnostic"]} if "diagnostic" in row else {})})
    stages = stage_trace_rows(trace_file)
    wstart = binding.get("workflowStartUtc") or None
    # Out-of-order times are refused, never reported as a negative or misleading duration : the run stage cannot
    # start before the workflow, no traced stage can start before the workflow, and traced stages are appended in time order.
    if wstart:
        _need(started_at is None or _utc(started_at) >= _utc(wstart), "case-timing-out-of-order")
        _need(all(_utc(r["startedAtUtc"]) >= _utc(wstart) for r in stages), "case-timing-out-of-order")
    _need(all(_utc(a["startedAtUtc"]) <= _utc(b["startedAtUtc"]) for a, b in zip(stages, stages[1:])), "case-timing-out-of-order")
    setup_ms = int((_utc(started_at) - _utc(wstart)).total_seconds() * 1000) if (started_at and wstart) else None
    return {"schema": "speaksharp-case-timings-v2", "contentSafe": True,
            "binding": {"runId": str(binding["runId"]), "runAttempt": int(binding["runAttempt"]), "headSha": binding["headSha"]},
            "outcome": outcome, "runStarted": started_at is not None, "selectedCases": selected, "cases": cases,
            "timings": {"workflowStartUtc": wstart, "runStageStartedAtUtc": started_at, "workflowStartToRunStageMs": setup_ms},
            "stages": stages, "stoppedAtStage": next((r["stage"] for r in stages if r["exitCode"] != 0), None), "traceScope": TRACE_SCOPE}



CASE_LOG_RESULTS = ("PASS", "FAIL", "NOT RUN", "UNKNOWN", "NOT SELECTED", "BLOCKED", "BLOCKED_SETUP", "INCOMPLETE", "HARNESS_LIMITED")
CASE_LOG_ASSERTION = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,79}")


def case_log_lines(timings):
    """Consultant P1-2: the run log names why each selected case ended, one line per case, from the case-timings projection's closed values
    only (result, the closed diagnostic codes, the first non-passing assertion id from the reviewed catalog, the stage where setup stopped).
    Free text, paths, messages and identifiers never reach the log: anything outside a closed vocabulary prints as `other`."""
    _need(isinstance(timings, dict) and timings.get("schema") == "speaksharp-case-timings-v2" and timings.get("contentSafe") is True,
          "case-log-input")
    stopped = timings.get("stoppedAtStage")
    stopped = stopped if stopped is None or stopped in STAGE_NAMES else "other"
    lines = ["RUN outcome=%s stoppedAtStage=%s" % (_closed(timings.get("outcome"), ("not-started", "started-without-results", "results", "results-invalid"), "other"),
                                                   stopped or "none")]
    for row in timings.get("cases") or []:
        if not isinstance(row, dict) or row.get("caseId") not in ALL_AHT or row.get("result") == "NOT SELECTED":
            continue
        diag = row.get("diagnostic") if isinstance(row.get("diagnostic"), dict) else None
        codes = diagnostic_codes(diag) if diag else []
        first = (diag or {}).get("firstNonPassingAssertion") if diag else None
        first_id = first.get("id") if isinstance(first, dict) and isinstance(first.get("id"), str) else None
        evidence = row.get("evidence")
        parts = ["CASE", row["caseId"], _closed(row.get("result"), CASE_LOG_RESULTS, "other"),
                 "codes=" + (",".join(codes) if codes else "none"),
                 "first=" + (first_id if first_id and CASE_LOG_ASSERTION.fullmatch(first_id) else "none"),
                 "evidence=" + (evidence if isinstance(evidence, str) and CASE_CODE.fullmatch(evidence) else "none")]
        lines.append(" ".join(parts))
    return lines

def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("prepare", "qualify", "provenance", "project", "first-observations", "case-timings", "window-check", "occurrence-check",
                                       "occurrence-materialize", "completion-deadline", "case-log"))
    for flag in ("--repo", "--config", "--request", "--facts", "--checkpoint", "--run-id", "--source-sha", "--out", "--execution-deadline",
                 "--env-file", "--outputs", "--plan", "--case-results", "--cases-dir", "--cases", "--run-record", "--tested-sha", "--approval", "--qualification",
                 "--code-manifest", "--snapshot-dir", "--coverage-mode", "--live-minutes", "--request-sha256", "--build-receipt",
                 "--reservations", "--provenance", "--nightly-request-file", "--nightly-request-sha256", "--case10-observation",
                 "--manual-occurrence-file", "--manual-occurrence-sha256", "--workflow-start-utc", "--now", "--started-file", "--stage-trace", "--run-attempt",
                 "--case-timings"):
        a.add_argument(flag)
    a.add_argument("--attempt", type=int)
    a.add_argument("--job-timeout-minutes", type=int)
    x = a.parse_args(argv[1:])
    try:
        if x.command == "first-observations":
            _write_private(x.out, first_observation_export(x.cases_dir, (x.cases or "").split(",")))
            return 0
        if x.command == "case-log":
            for line in case_log_lines(_load(x.case_timings)):
                print(line)
            return 0
        if x.command == "case-timings":
            selected = [c for c in (x.cases or "").split(",") if c] or selection_from_request(x.request)
            binding = {"runId": x.run_id, "runAttempt": x.run_attempt, "headSha": x.source_sha, "workflowStartUtc": x.workflow_start_utc}
            _write_private(x.out, run_timing_export(x.cases_dir, x.case_results, selected, x.started_file, x.stage_trace, binding))
            return 0
        if x.command == "completion-deadline":
            now = _utc(x.now) if x.now else datetime.now(timezone.utc)
            return 0 if completion_within_occurrence(_read(x.manual_occurrence_file), now) else 79
        if x.command == "project":
            q = _load(x.qualification) if x.qualification and os.path.exists(x.qualification) else None
            prov = _load(x.provenance) if x.provenance and os.path.exists(x.provenance) else None
            cr = _read(x.case_results) if x.case_results and os.path.exists(x.case_results) else None
            here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            if x.request:
                catalog = projection_catalog(_read(x.request), x.request_sha256, os.path.join(here, "config", "test-config.v1.json"), q)
            else:
                catalog = _load(os.path.join(here, "config", "assertion-catalog.json"))
            media = os.path.join(x.repo or ".", "tests", "fixtures", "rwt", "rwt-fixtures.manifest.json")
            # Closed diagnostic codes per case from the digest-bound case directories (the same projection as the case-timings table).
            case_codes = None
            if x.cases_dir and x.case_results:
                rows, _ = isolated_case_rows(x.cases_dir, x.case_results, list(ALL_CASES), x.run_id)
                case_codes = {cid: diagnostic_codes(r.get("diagnostic")) for cid, r in rows.items()}
            _write_private(x.out, project(_load(x.run_record), x.run_id, x.attempt, x.source_sha, x.tested_sha, q, x.request_sha256, prov, cr, catalog,
                                          _read(x.request) if x.request else None, _read(media) if x.request and os.path.isfile(media) else None,
                                          case_codes))
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
            req, now = admitted_request(x.request, x.request_sha256), datetime.now(timezone.utc)
            check_window_remaining(req, now, int(x.live_minutes or 0))
            check_execution_deadline(req, now, int(x.live_minutes or 0), x.execution_deadline)
            return 0
        if x.command == "occurrence-check":
            repo = os.path.realpath(x.repo)
            _path, _blob, raw, _template_blob = select_manual_occurrence(
                repo, x.request, x.manual_occurrence_file,
                x.manual_occurrence_sha256, x.source_sha, x.workflow_start_utc)
            req = json.loads(raw)
            cases = check_request(req, datetime.now(timezone.utc), _request_keys())
            cfg = _load(os.path.join(repo, x.config))
            live = check_ceilings(cfg, req, cases, x.job_timeout_minutes)
            check_window_fit(req, datetime.now(timezone.utc), live)
            return 0
        if x.command == "occurrence-materialize":
            repo = os.path.realpath(x.repo)
            _path, _blob, template_raw = select_request(repo, x.request, x.source_sha)
            try:
                template = json.loads(template_raw)
            except ValueError:
                raise Refused("manual-occurrence-unreadable")
            occurrence = materialize_authoritative_smoke_occurrence(repo, template, x.workflow_start_utc)
            _write_private(x.out, occurrence)
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
        if p["reservationBinding"]:
            # private, immutable (O_EXCL) and digest-bound; consumers verify the digest AND its fields against independent inputs
            binding_file = os.path.join(x.out, "reservation-binding.json")
            _write_private(binding_file, p["reservationBinding"])
            env.update(CT_RESERVATION_BINDING_FILE=binding_file, CT_RESERVATION_BINDING_SHA256=_sha(binding_file))
        write_env_file(x.env_file, env)
        with open(x.outputs, "a", encoding="utf-8") as f:
            f.write("execution_deadline=%s\n" % p["executionDeadline"])
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
