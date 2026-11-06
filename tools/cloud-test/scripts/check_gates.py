#!/usr/bin/env python3
"""Evaluates the workflow's blocking gates G1-G11 for a run request and writes gate-status.json. Offline; reads files only.
Each gate is READY, NOT-READY, OWNER-INPUT-OPEN (the owner has not yet supplied what the gate needs) or DEFERRED-TO-RUNNER (G4 at the offline stage).
Overall GO only when every blocking gate is READY (or deferred). Runtime gates R1/R2 (live identity read, admission) belong to the harness.
G2 rejects UNVERIFIED DEPLOYMENT and UNREVIEWED customer-facing changes; it does not reject product changes: a customer-facing commit since the last
run passes when it is a verified deployed fix tied to a gap with expected-PASS criteria (scripts/verify_release.py).
Usage: check_gates.py --request R.json --config C.json --ledger L.json --workflow W.json --release-verification RV.json --reconciliation RC.json
                      [--validation V.json] [--offline-checks OC.json] [--stimulus-receipt S.json] [--stage preflight|final] [--now ISO] --base DIR --out gate-status.json"""
import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import load, dump, parse_utc, now_utc, ep_requirements, mode_limits, comparison_errors  # noqa: E402
from verify_receipts import verify_set  # noqa: E402
from recurring_usage import check_caps  # noqa: E402
from case_start_caps import own_reservation, reconcile_caps, request_caps

READY, NOTREADY, OWNER, DEFERRED = "READY", "NOT-READY", "OWNER-INPUT-OPEN", "DEFERRED-TO-RUNNER"
# A recurring nightly window may include GitHub's reviewed 30-minute trigger
# delay. Manual/full requests retain the package's 330-minute ceiling.
NIGHTLY_MAX_WINDOW_MINUTES = 360
R10_SMOKE_RUN_ID = "R10-3b040043-smoke15"
R10_END_TO_END_MINUTES = 80
R10_LIVE_MINUTES = 40


def canonical_sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("ascii")).hexdigest()


def file_sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def gate(gid, status, detail, needs=None):
    return {"id": gid, "status": status, "detail": detail, "needs": needs or []}


def occurrence_window_limit(req, lim, recurring, minutes):
    """Return the admitted occurrence ceiling and any fail-closed errors.

    `maxWindowMinutes` remains the live-execution ceiling.  A materialized one-off smoke occurrence may
    separately name its owner-approved end-to-end workflow envelope; both declarations must be present,
    internally exact, and keep the live portion inside the configured ceiling.  Ordinary and nightly
    requests retain their existing behavior.
    """
    if recurring:
        return NIGHTLY_MAX_WINDOW_MINUTES, []
    win, est = req.get("window") or {}, req.get("estimate") or {}
    end_to_end, live = win.get("endToEndMinutes"), win.get("liveMinutes")
    if end_to_end is None and live is None:
        return lim["maxWindowMinutes"], []
    errors = []
    r10 = (req.get("runId") == R10_SMOKE_RUN_ID and req.get("coverageMode") == req.get("sampleMode") == "smoke"
           and req.get("priority") == "journey-smoke" and req.get("createdUtc") == win.get("startUtc")
           and req.get("selectionApprovalRef") == win.get("approvalRef"))
    if not r10:
        errors.append("a separate end-to-end occurrence envelope is not admitted for this request")
    if end_to_end != R10_END_TO_END_MINUTES:
        errors.append("R10 end-to-end occurrence must be exactly %d minutes" % R10_END_TO_END_MINUTES)
    if live != R10_LIVE_MINUTES or live > lim["maxWindowMinutes"]:
        errors.append("R10 live execution must be exactly %d minutes and within the configured ceiling" % R10_LIVE_MINUTES)
    if isinstance(end_to_end, int) and not isinstance(end_to_end, bool) and end_to_end != minutes:
        errors.append("declared end-to-end occurrence %d min does not equal the %.0f-minute window" % (end_to_end, minutes))
    if est.get("githubRunnerMinutesMax") != R10_LIVE_MINUTES or est.get("githubRunnerMinutesMax") != live:
        errors.append("declared live minutes do not match the request estimate")
    return R10_END_TO_END_MINUTES if not errors else lim["maxWindowMinutes"], errors


# TEST-ONLY overrides of the authenticated journal source; production reads state_ref_writer.APPROVED_URL from the pinned REVIEWED_ROOT.
JOURNAL_URL = None
JOURNAL_ROOT = None


def authenticated_state_chain():
    """The whole validated approved state-ref chain from its reviewed root."""
    import subprocess
    import tempfile
    import state_ref_writer as W
    root = JOURNAL_ROOT or W.REVIEWED_ROOT
    url = JOURNAL_URL or W.APPROVED_URL
    if root is None:
        raise W.Refused("journal-not-activated")
    repo = tempfile.mkdtemp(prefix="g11-journal-")
    env = {"PATH": os.environ.get("PATH", ""), "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_TEMPLATE_DIR": ""}
    if subprocess.run(["git", "init", "-q", repo], capture_output=True, env=env).returncode != 0:
        raise W.Refused("journal-repo")
    return W.validate_chain(repo, W.fetch_head(repo, url, url), root)


def authenticated_chain():
    """(head, events) of the approved state ref, read through the producer's own boundary (reservations.py journal-snapshot): a fresh
    fetch of the approved URL into a private repository and whole-chain validation from the reviewed root. Refuses while unpinned."""
    chain = authenticated_state_chain()
    return chain[-1][0], chain[-1][1]


def authenticated_parent_transition(parent_head, current_head, current_events):
    """Authenticate the exact parent->current transition of a manual run.

    The current commit must add exactly one final event to the approved parent's
    event list.  The receiver separately proves that event is this execution's
    one open reserve.
    """
    import state_ref_writer as W
    chain = authenticated_state_chain()
    if (len(chain) < 2 or chain[-1][0] != current_head or chain[-1][1] != current_events
            or chain[-2][0] != parent_head or chain[-2][1] != current_events[:-1]):
        raise W.Refused("journal-parent-transition")
    return chain[-2][0], chain[-2][1]


def admitted_snapshot(reservations, req, request_sha256, execution_run_id=None):
    """(chain, problems) for a state-ref journal snapshot (Sam 1793592133.133339 / 1793592813.582869): (None, []) when the reservations are
    not a snapshot. Admitted only when (1) every event passes state_ref_writer.validate_event and the ledger folds; (2) its head AND its
    ledger are exactly the approved state ref as authenticated now through the producer's own boundary (authenticated_chain), so a
    well-formed but fabricated, reduced or stale ledger never counts; and (3) it holds THIS execution's open reserve: the request's campaign,
    the current GitHub run id, attempt 1, and the admitted request digest."""
    from recurring_usage import snapshot_chain
    try:
        chain = snapshot_chain(reservations)
    except ValueError:
        return [], ["journal snapshot: malformed"]
    if chain is None:
        return None, []
    import state_ref_writer as W
    head, events = chain[0][0], chain[0][1]
    if not (isinstance(head, str) and W.SHA40.fullmatch(head)):
        return [], ["journal snapshot: head is not a commit id"]
    try:
        state = W.fold(events)
    except W.Refused as e:
        return [], ["journal snapshot: invalid ledger (%s)" % e]
    if not (isinstance(request_sha256, str) and len(request_sha256) == 64):
        return [], ["journal snapshot: the admitted request digest is unknown"]
    if not (isinstance(execution_run_id, str) and W.RUN_ID.fullmatch(execution_run_id)):
        return [], ["journal snapshot: the current execution run id is unknown"]
    try:
        auth_head, auth_events = authenticated_chain()
    except (W.Refused, OSError) as e:
        return [], ["journal snapshot: the approved state ref could not be authenticated (%s)" % e]
    if head != auth_head or events != auth_events:
        return [], ["journal snapshot: not the authenticated state ref (fabricated, reduced or stale)"]
    key = (req.get("runId"), execution_run_id, 1)
    held = [e for e in events if e["type"] == "reserve" and (e["campaignId"], e["runId"], e["attempt"]) == key
            and e["provenance"] == "request-sha256:" + request_sha256 and state.get(key, ("",))[0] == "open"]
    if len(held) != 1:
        return [], ["journal snapshot: no open reserve for this execution and admitted request"]
    return chain, []


def recurring_gate(req, cfg, base, index, now, reservations=None, approval_path=None, request_sha256=None, execution_run_id=None):
    """G11: a nightly-regression request runs under the owner's STANDING approval of recurring cost. Not applicable to any other request."""
    if req.get("priority") != "nightly-regression":
        return gate("G11", READY, "not a recurring run: no standing approval is needed")
    # first: the same verified journal its reservation is appended to; a forged snapshot is refused whatever the approval's state
    chain, refused = admitted_snapshot(reservations, req, request_sha256, execution_run_id)
    if refused:
        return gate("G11", NOTREADY, "the state-ref journal snapshot is not admissible", refused)
    ncfg = cfg.get("nightly") or {}
    path = approval_path or os.path.join(base, ncfg.get("approvalFile") or "config/recurring-approval.json")
    if not os.path.exists(path):
        return gate("G11", NOTREADY, "the recurring approval file is missing", ["config/recurring-approval.json is part of the package"])
    ap = load(path)
    est = req.get("estimate") or {}
    miss = ["recurring approval: %s not given" % k for k in ("approvedBy", "approvalRef", "approvedAtUtc", "validFromUtc", "expiresUtc", "periodStartUtc") if not ap.get(k)]
    runs = (ap.get("cadence") or {}).get("runsPerPeriod")
    if not isinstance(runs, int) or runs < 1:
        miss.append("recurring approval: cadence.runsPerPeriod not given")
    for grp in ("perRunCaps", "periodCaps"):
        for k, v in (ap.get(grp) or {}).items():
            if v is None:
                miss.append("recurring approval: %s.%s not given" % (grp, k))
    if miss:
        return gate("G11", OWNER, "no standing approval of recurring cost", miss)
    need = []
    t0, t1, ts = parse_utc(ap["validFromUtc"]), parse_utc(ap["expiresUtc"]), parse_utc(ap["periodStartUtc"])
    if not (t0 and t1 and ts):
        need.append("approval times are not valid UTC times")
    elif not (t0 <= now < t1):
        need.append("the standing approval is not in force now (valid %s to %s)" % (ap["validFromUtc"], ap["expiresUtc"]))
    pr = ap["perRunCaps"]
    if pr.get("paidActionsUsd") != 0 or (ap["periodCaps"].get("paidActionsUsd") != 0):
        need.append("paid actions must stay at $0 in a recurring approval")
    # every cap, from history: sealed runs (measured actuals) and open reservations count, not just requests and identity reads
    from recurring_usage import journal_usage, snapshot_chain, usage, PERRUN, PERIOD
    need += check_caps(req, ap, index, None if chain is not None else reservations, now, journal_chain=chain)
    if runs and ts:
        for k in PERRUN:
            if runs * pr[PERRUN[k]] > ap["periodCaps"][PERIOD[k]]:
                need.append("the cadence (%d runs) at the per-run cap %s exceeds the period cap %s for %s: the approval contradicts itself" % (runs, pr[PERRUN[k]], ap["periodCaps"][PERIOD[k]], k))
    u = journal_usage(ap, chain, exclude_run=req.get("runId")) if chain is not None else usage(ap, index, reservations, now, exclude_run=req.get("runId"))
    used = u["used"]
    return gate("G11", READY if not need else NOTREADY, "within the standing approval of recurring cost (period usage so far: %d run(s), %s requests, %s Starts, %s takes, %s coaching calls, %s runner minutes; %d open reservation(s))" % (u["runs"], used["requests"], used["starts"], used["takes"], used["coachingRequests"], used["runnerMinutes"], len(u["openReservations"])) if not need else "outside the standing approval of recurring cost", need)


def nightly_history_gate(req, prior_state):
    """G7 for a nightly run (Sam 1793573813.598689): from the third night the comparison basis is the carried-forward history in the verified
    latest record (two or more occurrences); it must verify (closed shape, order, bounds, row/occurrence bindings) or G7 is NOT READY. Nights
    one and two (fewer occurrences) return None, so the committed bootstrap receipts are verified instead. Never applies to other runs."""
    if req.get("priority") != "nightly-regression" or prior_state is None:
        return None
    from publish_latest_record import Refused as RecordRefused, sanitize_history
    try:
        h = sanitize_history((prior_state or {}).get("history"))
    except RecordRefused as e:
        return gate("G7", NOTREADY, "the carried-forward history does not verify", ["latest-record history: %s" % e])
    from publish_latest_record import qualified_comparable
    from select_baselines import current_identities
    usable = qualified_comparable(h, current_identities(req))
    if len(usable) < 2:
        return None  # unqualified, row-empty or incomparable occurrences never clear G7: the verified bootstrap receipts decide
    return gate("G7", READY, "carried-forward history verified: %d qualified, comparable nightly occurrence(s) of %d, sequence %d; every row is compared with its last executed verdict" % (len(usable), len(h["occurrences"]), h["sequence"]), [])


def evaluate(req, cfg, ledger, wf, validation, offline_checks, receipt, base, stage="final", rv=None, rc=None, now=None, receipts_root=None, index=None, reservations=None, approval_path=None, offline_proof=None, prior_verification=None, prior_comparison=None, receiver_receipt=None, request_sha256=None, receiver_verified=False, prior_state=None, execution_run_id=None):
    G = []
    now = now or now_utc()
    try:
        request_caps(req)
    except (ValueError, TypeError, KeyError):
        return {"schema": "speaksharp.cloud-test.gate-status.v2", "decision": "NO-GO", "stage": stage,
                "gates": [gate("G5", NOTREADY, "invalid request binding structure")],
                "blockingOpen": ["G5"], "ownerInputsOpen": [], "deferred": []}
    lim = mode_limits(cfg, req)
    h = req.get("harness") or {}
    appr = req.get("approvedLimits") or {}
    est = req.get("estimate") or {}
    win = req.get("window") or {}
    gaps = {g["id"]: g for g in ledger["gaps"]}
    sel = req.get("selection") or []
    # G1
    pr = (req.get("ownerInputs") or {}).get("prDocsCloseout") or {}
    if pr.get("status") == "closed" and pr.get("evidence"):
        G.append(gate("G1", READY, "PR and docs closeout recorded as closed with evidence"))
    else:
        G.append(gate("G1", OWNER, "product PR and docs closeout is %s" % pr.get("status", "unrecorded"), ["owner: close out or explicitly defer the open product PRs and docs; record evidence in ownerInputs.prDocsCloseout"]))
    # G2: verified deployment, mechanically classified changes
    need = list((rv or {}).get("needs", [])) if rv else ["release verification not run"]
    if rv:
        be = rv.get("backend") or {}
        touches_backend = any(f.get("touchesBackend") for g in (req.get("targetedGaps") or []) for f in [rv["fixes"].get(g, {})])
        if touches_backend and not be.get("verified"):
            need.append("a targeted fix touches backend paths and the backend deployment is %s (needs cloud-verified source, time, evidence reference and the tested SHA)" % (be.get("source") or "undeclared"))
    G.append(gate("G2", READY if not need else NOTREADY,
                  "deployment of the tested SHA verified; %d change(s) since the last run, each allowed" % len((rv or {}).get("sinceLastRun") or []) if not need else "release or deployment not verified", need))
    # G3
    need = []
    op = offline_proof or os.path.join(base, h.get("offlineProofFile") or "")
    if not op or not os.path.exists(op):
        need.append("offline proof file missing")
    else:
        proof = load(op)
        bad = [c.get("id") for c in proof.get("corrections", []) if c.get("result") != "PASS"]
        if not proof.get("corrections"):
            need.append("offline proof lists no corrections")
        if bad:
            need.append("offline proof not PASS for: " + ", ".join(map(str, bad)))
        if proof.get("codeManifestSha256") and proof["codeManifestSha256"] != h.get("codeManifestSha256"):
            need.append("offline proof was produced on a different harness hash")
    if h.get("codeManifestSha256") != cfg["harness"]["expectedCodeManifestSha256"]:
        need.append("request harness hash differs from the config")
    approval_missing = not h.get("ownerApprovalRef")
    if approval_missing:
        need.append("owner approval of the exact harness hash is not recorded")
    st = OWNER if (approval_missing and len(need) == 1) else (READY if not need else NOTREADY)
    G.append(gate("G3", st, "harness verified and approved" if st == READY else "harness proof or approval incomplete", need))
    # G4
    need = []
    if stage == "preflight" and receipt is None:
        G.append(gate("G4", DEFERRED, "produced in the run environment by the stimulus-preflight stage; evaluated again at stage final before any product request"))
    else:
        if receipt is None:
            need.append("stimulus preflight receipt not supplied")
        else:
            if receipt.get("productTraffic") != 0:
                need.append("receipt shows product traffic")
            t = parse_utc(receipt.get("createdAt"))
            if not t or (now - t).total_seconds() > lim["stimulusReceiptMaxAgeMinutes"] * 60:
                need.append("receipt is older than %d minutes or has no time" % lim["stimulusReceiptMaxAgeMinutes"])
            if receipt.get("codeManifestSha256") != h.get("codeManifestSha256"):
                need.append("receipt was produced for a different harness hash")
            for s in sel:
                if s.get("needsCaptureDevice") and not ((receipt.get("cases") or {}).get(s["case"]) or {}).get("ready"):
                    need.append("%s is not ready in the receipt" % s["case"])
        G.append(gate("G4", READY if not need else NOTREADY, "stimulus preflight ready" if not need else "stimulus preflight not ready", need))
    # G5: limits against the RECONCILED cumulative usage (a recurring nightly run is limited by the STANDING approval instead: gate G11)
    need, owner_missing = [], []
    try:
        reconcile_caps(req, rc, request_sha256=request_sha256)
    except (ValueError, TypeError, KeyError):
        need.append("exact per-case Start allocations are missing, invalid or unreconciled")
    recurring = req.get("priority") == "nightly-regression"
    if appr.get("startPressCaps") is None and not recurring:
        owner_missing.append("approvedLimits.startPressCaps not approved")
    for k in ("cumulativeCeilingRequests", "identityCap", "runCapRequests"):
        if appr.get(k) is None and not recurring:
            owner_missing.append("approvedLimits.%s not approved" % k)
    prop = req.get("proposedLimits") or {}
    for k, cur_k in (("startsCap", "starts"), ("takesCap", "takes")):
        if rc and not recurring and prop.get(k) is not None and prop[k] > rc["ceilings"][cur_k] and appr.get(k) is None:
            owner_missing.append("approvedLimits.%s not approved (proposed %s above the current %s)" % (k, prop[k], rc["ceilings"][cur_k]))
    if not appr.get("approvalRef") and not recurring:
        owner_missing.append("approval reference missing")
    if not parse_utc(win.get("startUtc")) or not parse_utc(win.get("endUtc")) or not win.get("approvalRef"):
        owner_missing.append("run window (start, end, approval reference) not set")
    else:
        mins = (parse_utc(win["endUtc"]) - parse_utc(win["startUtc"])).total_seconds() / 60
        window_limit, window_errors = occurrence_window_limit(req, lim, recurring, mins)
        need.extend(window_errors)
        if mins <= 0 or mins > window_limit:
            need.append("window length %.0f min is outside 1..%d" % (mins, window_limit))
        if parse_utc(win["endUtc"]) <= now:
            need.append("window has ended")
        wm = (est.get("window") or {}).get("worstCaseMinutes")
        if req.get("coverageMode") == "full" and wm and mins < wm and not win.get("acceptedShortWindowRisk"):
            need.append("window %.0f min is shorter than the worst case %d min of the full-coverage budget; a case cut by the clock makes the run not a full live run (record window.acceptedShortWindowRisk with the owner's reference to accept that risk)" % (mins, wm))
    if rc and not owner_missing and not recurring:
        rq = (est.get("requests") or {})
        # #1772 review 4446137335 (Jensen 1793644594.204599): this request's own open reservation is already in the reconciled usage, so it
        # is replaced by the plan here exactly as in reconcile_caps; another request's reservation still counts in full. Review 4447628949:
        # all four dimensions, so its held requests (run cap + identity charge) and identity reads are not charged a second time either.
        try:
            own = own_reservation(rc, request_sha256, req.get("runId"))
        except (ValueError, TypeError, KeyError):
            own = None
            need.append("this request's own open reservation is ambiguous or invalid in the reconciliation")
        if own is not None:
            counted = {k: rc[k][counter] for k, counter in (("requests", "conservativeUsed"), ("identityReads", "conservativeUsed"),
                                                             ("starts", "ownerCounted"), ("takes", "ownerCounted"))}
            excess = ["%s own reservation %d exceeds the reconciled count %d" % (k, own[k], counted[k]) for k in counted if own[k] > counted[k]]
            need.extend(excess)
            used = {k: counted[k] - own[k] for k in counted}
            if not excess:
                required = used["requests"] + appr["runCapRequests"] + rc["ceilings"]["protectedReserveRequests"] + est["identityReads"]
                if required > appr["cumulativeCeilingRequests"]:
                    need.append("reconciled used %s (own held %s excluded) + run cap %s + protected reserve %s + identity reads %s = %s exceeds the approved ceiling %s" % (used["requests"], own["requests"], appr["runCapRequests"], rc["ceilings"]["protectedReserveRequests"], est["identityReads"], required, appr["cumulativeCeilingRequests"]))
                if used["identityReads"] + est["identityReads"] > appr["identityCap"]:
                    need.append("reconciled identity used %d (own held %d excluded) + reads %d exceeds the approved identity cap %s" % (used["identityReads"], own["identityReads"], est["identityReads"], appr["identityCap"]))
                for k, label in (("starts", "Starts"), ("takes", "takes")):
                    cap_ = appr.get(k + "Cap") if appr.get(k + "Cap") is not None else rc["ceilings"][k]
                    if used[k] + est[k] > cap_:
                        need.append("%s used %d + planned %d exceeds the approved cap %s" % (label, used[k], est[k], cap_))
        if appr["runCapRequests"] < rq.get("runCap", 0):
            need.append("approved run cap is below the estimated cap")
    if rc is None:
        need.append("cumulative reconciliation not supplied")
    st = READY if not need and not owner_missing else (NOTREADY if need else OWNER)
    G.append(gate("G5", st, ("window set; the run's limits come from the standing approval (G11)" if recurring else "limits reconciled and approved") if st == READY else "limits or window not approved", owner_missing + need))
    # G6
    need = []
    created = parse_utc(req.get("createdUtc"))
    wstart = parse_utc(win.get("startUtc"))
    for gid in req.get("targetedGaps") or []:
        ep = (gaps.get(gid) or {}).get("expectedPass") or {}
        d = parse_utc(ep.get("definedAtUtc"))
        if not d or not all(ep.get(k) for k in ("criteria", "stimulus", "observer", "requirements")):
            need.append("%s expected PASS incomplete" % gid)
        elif wstart and d >= wstart:
            need.append("%s expected PASS defined after the window start" % gid)
        elif created and d > created:
            need.append("%s expected PASS defined after the request" % gid)
        if not ep.get("confirmedByOwner"):
            need.append("%s expected PASS not yet confirmed by the owner" % gid)
    only_owner = need and all("confirmed by the owner" in n for n in need)
    G.append(gate("G6", READY if not need else (OWNER if only_owner else NOTREADY), "expected PASS defined before testing for every targeted gap" if not need else "expected PASS not final", need))
    # G7: sealed, hash-pinned receipts of the compared runs and their binding verification
    need = []
    if prior_verification is not None:
        rows = prior_verification.get("runs") if isinstance(prior_verification, dict) else None
        expected = [p.get("label") for p in req.get("priorRuns") or []]
        rr = receiver_receipt if isinstance(receiver_receipt, dict) else {}
        # A legacy manual v1 receipt names the request at its top level. A nightly or approved full-coverage manual v2 receipt binds it only
        # through its authenticated occurrence envelope, which names this request, campaign and genuinely verified tested release.
        occurrence = rr.get("occurrence") if isinstance(rr.get("occurrence"), dict) else {}
        if rr.get("schema") == "speaksharp.cloud-test.aggregate-receiver-receipt.v1":
            bound = "occurrence" not in rr and rr.get("requestSha256") == request_sha256
        elif rr.get("schema") == "speaksharp.cloud-test.aggregate-receiver-receipt.v2":
            bound = ("requestSha256" not in rr and req.get("priority") in ("nightly-regression", "full-coverage")
                     and occurrence.get("schema") == "speaksharp.cloud-test.aggregate-receiver.v2-occurrence"
                     and occurrence.get("requestSha256") == request_sha256 and occurrence.get("campaignId") == req.get("runId")
                     and occurrence.get("testedSha") == (req.get("release") or {}).get("testedSha"))
        else:
            bound = False
        if not receiver_verified or not bound or not request_sha256 or rr.get("sourceSha") != (req.get("release") or {}).get("testedSha"):
            need.append("accepted prior-run inputs are not bound to the reviewed receiver receipt")
        if prior_verification.get("schema") != "speaksharp.cloud-test.prior-run-verification.v1" or not isinstance(rows, list) or \
                [r.get("label") for r in rows] != expected or not all(r.get("passed") is True for r in rows):
            need.append("accepted prior-run verification does not cover the request")
        errors = comparison_errors(prior_comparison, cfg["history"]["comparisonBaselines"])
        if errors:
            need.append("accepted comparison is incomplete: " + "; ".join(errors[:3]))
    else:
        root = receipts_root or os.path.join(base, "config", "history", "receipts")
        runs = {r["label"]: r for r in cfg["history"]["runs"]}
        for pr_ in req.get("priorRuns") or []:
            lab = pr_.get("label")
            if lab not in runs:
                need.append("%s is not in the config history" % lab)
                continue
            errs, n = verify_set(os.path.join(root, lab), runs[lab].get("receiptsManifestSha256"))
            if errs:
                need.append("%s receipts: %s" % (lab, "; ".join(errs[:2])))
            bf = os.path.join(base, pr_.get("bindingFile") or "")
            if not pr_.get("bindingFile") or not os.path.exists(bf):
                need.append("%s binding verification missing" % lab)
            else:
                b = load(bf)
                if b.get("failed") != 0 or not b.get("passed"):
                    need.append("%s binding verification has %s failed checks" % (lab, b.get("failed")))
    history_g7 = nightly_history_gate(req, prior_state)
    if history_g7 is not None and prior_verification is not None and need:
        # a verified carried-forward history never masks receiver-accepted prior-run inputs that do not verify
        history_g7 = gate("G7", NOTREADY, "accepted prior-run inputs do not verify alongside the carried-forward history", need)
    G.append(history_g7 or gate("G7", READY if not need else NOTREADY, "last two runs' sealed receipts verified against their pinned hashes and bindings" if not need else "prior-run receipts not verified", need))
    # G8
    need = []
    if req.get("workflowVersion") != wf["version"]:
        need.append("request names workflow %s, package is %s" % (req.get("workflowVersion"), wf["version"]))
    if not isinstance(req.get("deviations"), list):
        need.append("deviations list missing")
    G.append(gate("G8", READY if not need else NOTREADY, "workflow version named and deviations declared (%d)" % len(req.get("deviations") or []) if not need else "workflow version or deviations missing", need))
    # G9
    v = validation or {}
    G.append(gate("G9", READY if v.get("valid") else NOTREADY, "purpose, targeted gaps and estimate accepted" if v.get("valid") else "run request validation failed", v.get("errors") or ([] if v else ["validation not run"])))
    # G10
    oc = offline_checks or {}
    ok = oc.get("passed") is True
    G.append(gate("G10", READY if ok else NOTREADY, "offline checks passed" if ok else "offline checks not recorded as passed", [] if ok else ["run the offline checks (package tests, report tests, offline-proof index)"]))
    # G11
    G.append(recurring_gate(req, cfg, base, index, now, reservations, approval_path, request_sha256, execution_run_id))
    blocking = [g for g in G if g["status"] not in (READY, DEFERRED)]
    return {"schema": "speaksharp.cloud-test.gate-status.v2", "runId": req.get("runId"), "workflowVersion": wf["version"], "evaluatedUtc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "stage": stage, "decision": "GO" if not blocking else "NO-GO", "deferred": [g["id"] for g in G if g["status"] == DEFERRED], "gates": G,
            "blockingOpen": [g["id"] for g in blocking], "ownerInputsOpen": [g["id"] for g in G if g["status"] == OWNER]}


def main():
    a = argparse.ArgumentParser()
    for k in ("request", "config", "ledger", "workflow", "release-verification", "reconciliation", "base", "out"):
        a.add_argument("--" + k, required=True)
    for k in ("validation", "offline-checks", "offline-proof", "stimulus-receipt", "now", "history-index", "reservations", "receipts-root", "approval", "prior-verification", "prior-comparison", "receiver-receipt", "receiver-manifest", "accepted-input-dir", "prior-state", "execution-run-id",
              "journal-snapshot", "occurrence-reconciliation", "occurrence-release-verification"):
        a.add_argument("--" + k)
    a.add_argument("--stage", choices=["preflight", "final"], default="final")
    x = a.parse_args()
    req = load(x.request)
    if req.get("priority") == "nightly-regression":
        # a verified journal snapshot carries G11's usage itself (journal_usage); only a legacy reservation file also needs the history index
        from recurring_usage import snapshot_chain
        try:
            snapshot = bool(x.reservations) and os.path.isfile(x.reservations) and snapshot_chain(load(x.reservations)) is not None
        except ValueError:
            snapshot = True  # snapshot-shaped but malformed: G11 refuses it below (admitted_snapshot), it never needs the index
        if not (x.reservations and x.approval and (x.history_index or snapshot)):
            a.error("recurring gates require explicit --reservations and --approval inputs, and --history-index unless the reservations are "
                    "a verified journal snapshot")
    rec = load(x.stimulus_receipt) if x.stimulus_receipt and os.path.exists(x.stimulus_receipt) else None
    cfg = load(x.config)
    verified = False
    verified_docs = None
    prior = load(x.prior_verification) if x.prior_verification else None
    comparison = load(x.prior_comparison) if x.prior_comparison else None
    receiver = load(x.receiver_receipt) if x.receiver_receipt else None
    if any((x.prior_verification, x.prior_comparison, x.receiver_receipt, x.receiver_manifest, x.accepted_input_dir)):
        if not all((x.prior_verification, x.prior_comparison, x.receiver_receipt, x.receiver_manifest, x.accepted_input_dir)):
            a.error("received prior-run inputs require --receiver-manifest and --accepted-input-dir")
        import aggregate_receiver
        try:
            occurrence = aggregate_receiver.read_occurrence(x.journal_snapshot, x.occurrence_reconciliation,
                                                            x.occurrence_release_verification)
            docs, _, receiver = aggregate_receiver.verified_accepted(x.receiver_manifest, x.request, x.accepted_input_dir, cfg, occurrence)
        except aggregate_receiver.Refused as err:
            print("BLOCKED_SETUP: " + str(err), file=sys.stderr)
            sys.exit(78)
        verified_docs = docs
        prior, comparison, verified = docs["prior-run-verification"], docs["comparison-prior"], True
    # A verified receiver admission covers every retained gate input, not only
    # the prior-run pair.  Never pair a genuine receiver receipt with arbitrary
    # caller paths for the current gap ledger, release or reconciliation.
    ledger = verified_docs["gap-ledger"] if verified_docs else load(x.ledger)
    release = verified_docs["release-verification"] if verified_docs else load(x.release_verification)
    reconciliation = verified_docs["reconciliation"] if verified_docs else load(x.reconciliation)
    out = evaluate(req, cfg, ledger, load(x.workflow), load(x.validation) if x.validation else None,
                   load(x.offline_checks) if x.offline_checks else None, rec, x.base, x.stage, release, reconciliation,
                   parse_utc(x.now) if x.now else None, x.receipts_root, load(x.history_index) if x.history_index else None,
                   load(x.reservations) if x.reservations else None, x.approval, x.offline_proof,
                   prior, comparison, receiver, file_sha(x.request), verified,
                   prior_state=load(x.prior_state) if x.prior_state else None, execution_run_id=x.execution_run_id)
    dump(out, x.out)
    print("decision:", out["decision"], "| blocking open:", ",".join(out["blockingOpen"]) or "none")


if __name__ == "__main__":
    main()
