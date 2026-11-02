#!/usr/bin/env python3
"""Validates a run request (v2) against the versioned config, the workflow, the gap-ledger definitions, the release verification (git) and the
cumulative reconciliation (sealed ledgers against owner counters). Offline.
Checks (gate G9 and structure): purpose; priority; targeted gaps exist and carry expected-PASS criteria defined before the window; a
prove-deployed-fix run needs a targeted, NON-candidate product fix whose deployment is cloud-verified; every selected case ties to a targeted gap
(no broad reruns); estimate arithmetic; limits proposed against the reconciled cumulative usage (a ceiling above the current one is a flagged owner
decision, never silent); costs: only authorized paid actions are budgeted ($0 cap), no dollar figure is asserted as a cost.
Modes: coverageMode partial (targeted, minimal sample, at most six cases) or full (all 15 journeys, every required assertion, own limits, derived budget, owner decision). The request names it; nothing defaults.
Usage: validate_run_request.py --request R.json --config C.json --ledger L.json --workflow W.json --release-verification RV.json
                               --reconciliation RC.json --out validation.json
Exit 0 when valid; 1 otherwise. Missing owner approvals are not errors here; check_gates.py reports them."""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import load, dump, parse_utc, is_sha40, ep_requirements, ep_cases, request_mode, mode_limits, sha256_file, ROOT  # noqa: E402
from case_start_caps import reconcile_caps, InputValidationError

CASE_RE = re.compile(r"^AHT-(0[1-9]|1[0-5])$")
LEGACY_COST_KEYS = ("costUsd", "costCapUsd", "actualCostUsd")


def walk_keys(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items():
            yield path + "." + k, k
            yield from walk_keys(v, path + "." + k)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk_keys(v, "%s[%d]" % (path, i))


def validate_ledger(ledger):
    """Executable expected-PASS requirements must cover every case the gap observed, and be well formed."""
    errs = []
    for g in ledger["gaps"]:
        reqs = ep_requirements(g.get("expectedPass") or {})
        if not reqs:
            errs.append("%s has no executable expectedPass.requirements" % g["id"])
        for r in reqs:
            if not r.get("case") or not r.get("assertions"):
                errs.append("%s: every requirement needs a case and at least one assertion" % g["id"])
        cases = {r.get("case") for r in reqs}
        for ob in g.get("observations", []):
            if "case" in ob and ob["case"] not in cases:
                errs.append("%s observed %s but its expected PASS does not require that case" % (g["id"], ob["case"]))
    return errs


def validate(req, cfg, ledger, wf, rv, rc, budget=None):
    errs, warns = [], []
    try:
        reconcile_caps(req, rc)
    except InputValidationError as error:
        messages = {"mode-pair": "coverageMode must be partial or full with a matching sampleMode",
                    "selection-count": "selection exceeds the configured maximum 6",
                    "full-selection": "full coverage selects all 15 journeys exactly once in order",
                    "cumulative-starts": "Starts would exceed the cumulative cap"}
        return [messages.get(str(error), "invalid per-case Start allocation or input structure")], warns
    except (ValueError, TypeError, KeyError):
        return ["invalid per-case Start allocation or input structure"], warns
    E = errs.append
    for e in validate_ledger(ledger):
        E("gap ledger: " + e)
    lim = mode_limits(cfg, req)
    mode = request_mode(req)
    modes = cfg.get("modes") or {}
    full = mode == "full"
    if mode not in ("partial", "full"):
        E("coverageMode must be partial or full; there is no default (a run is exactly one mode)")
    elif req.get("sampleMode") not in modes[mode].get("allowedSampleModes", [modes[mode]["sampleMode"]]):
        E("sampleMode %r does not match the %s mode (%s); the mode is passed to the plan builder, never defaulted" % (req.get("sampleMode"), mode, modes[mode]["sampleMode"]))
    if req.get("executionRuntime", "Claude SpeakSharp R4") not in ("Claude SpeakSharp R4", "GitHub Actions SpeakSharp"):
        E("executionRuntime must be an explicitly supported runtime")
    if req.get("schema") != "speaksharp.cloud-test.run-request.v2":
        E("schema is not speaksharp.cloud-test.run-request.v2")
    if not req.get("runId"):
        E("runId missing")
    if req.get("workflowVersion") != wf["version"]:
        E("workflowVersion %r does not equal the workflow in this package (%s); state a deviation or update the request" % (req.get("workflowVersion"), wf["version"]))
    if req.get("configVersion") != cfg["configVersion"]:
        E("configVersion %r does not equal %s" % (req.get("configVersion"), cfg["configVersion"]))
    for path, k in walk_keys(req):
        if k in LEGACY_COST_KEYS:
            E("%s: a dollar figure is not accepted as a request value; costs are reported as measured or unknown (see spend report)" % path)
    purpose = (req.get("purpose") or "").strip()
    if len(purpose) < lim["minPurposeChars"]:
        E("purpose must state the reason for this run (at least %d characters)" % lim["minPurposeChars"])
    if req.get("priority") not in cfg["allowedPriorities"]:
        E("priority must be one of %s (no run for the sake of another report)" % cfg["allowedPriorities"])
    if full and req.get("priority") not in ("full-coverage", "nightly-regression"):
        E("a full-mode request must have priority full-coverage or nightly-regression")
    if not full and req.get("priority") in ("full-coverage", "nightly-regression"):
        E("priority %s is only for coverageMode full" % req.get("priority"))
    gaps = {g["id"]: g for g in ledger["gaps"]}
    targeted = req.get("targetedGaps") or []
    if not targeted:
        E("targetedGaps is empty")
    if len(set(targeted)) != len(targeted):
        E("targetedGaps has duplicates")
    if full and set(targeted) != set(gaps):
        E("a full-coverage run evaluates every tracked gap: targetedGaps must be exactly %s" % sorted(gaps))
    win = req.get("window") or {}
    wstart = parse_utc(win.get("startUtc"))
    created = parse_utc(req.get("createdUtc"))
    for gid in targeted:
        g = gaps.get(gid)
        if not g:
            E("targeted gap %s is not in the gap ledger" % gid)
            continue
        ep = g.get("expectedPass") or {}
        for k in ("requirements", "stimulus", "observer", "criteria", "definedAtUtc"):
            if not ep.get(k):
                E("%s expectedPass.%s is missing; define it before testing" % (gid, k))
        d = parse_utc(ep.get("definedAtUtc"))
        if ep.get("definedAtUtc") and d is None:
            E("%s expectedPass.definedAtUtc is not a UTC time" % gid)
        if d and created and d > created:
            E("%s expectedPass was defined after the run request was created" % gid)
        if d and wstart and d >= wstart:
            E("%s expectedPass was defined at or after the window start" % gid)
    fixes = (rv or {}).get("fixes", {})
    if req.get("priority") == "prove-deployed-fix":
        ok = [g for g in targeted if gaps.get(g, {}).get("kind") == "product-fix" and not (gaps[g].get("fix") or {}).get("candidate") and fixes.get(g, {}).get("inclusion") == "cloud-verified"]
        if not ok:
            E("priority prove-deployed-fix needs a targeted product-fix gap whose (non-candidate) fix has cloud-verified deployed inclusion; an undeployed or unverified fix cannot be proven")
    if req.get("priority") == "restore-missing-evidence":
        if not any(gaps.get(g, {}).get("kind") in ("evidence-restoration", "harness-correction") for g in targeted):
            E("priority restore-missing-evidence needs at least one evidence-restoration or harness-correction gap")
    sel = req.get("selection") or []
    if not sel:
        E("selection is empty")
    if len(sel) > lim["maxSelectedCases"]:
        E("%d selected cases exceeds the configured maximum %d (broad rerun); a larger run is a config change with owner approval" % (len(sel), lim["maxSelectedCases"]))
    if full and sorted(s.get("case") for s in sel) != ["AHT-%02d" % n for n in range(1, 16)]:
        E("a full-coverage run selects all 15 journeys, AHT-01..AHT-15, exactly once; a subset is a partial run")
    if [s.get("order") for s in sel] != list(range(1, len(sel) + 1)):
        E("selection order must be 1..n in run order")
    cases = [s.get("case") for s in sel]
    if len(set(cases)) != len(cases):
        E("a case is selected twice")
    for s in sel:
        c = s.get("case")
        if not CASE_RE.match(str(c)):
            E("selected case %r is not AHT-01..AHT-15" % c)
        if s.get("role") not in (("coverage", "target", "prerequisite") if full else ("target", "prerequisite")):
            E("%s role must be %s" % (c, "coverage, target or prerequisite" if full else "target or prerequisite"))
        sg = s.get("gaps") or []
        if s.get("role") == "target" and not (sg and all(x in targeted for x in sg)):
            E("%s is a target but is not tied to a targeted gap" % c)
        if s.get("role") == "prerequisite" and not s.get("prerequisiteFor"):
            E("%s is a prerequisite but names no case it serves" % c)
        if not s.get("reason"):
            E("%s has no reason" % c)
        gate = s.get("gate")
        if gate:
            gc = gate.split(":")[0]
            if gc not in cases or cases.index(gc) >= cases.index(c):
                E("%s gate %r must point at an earlier selected case" % (c, gate))
    for gid in targeted:
        missing = [c for c in ep_cases(gaps.get(gid, {}).get("expectedPass") or {}) if c not in cases]
        if missing:
            E("targeted %s requires every one of its cases, but %s %s not selected (one case never closes a multi-case gap)" % (gid, ", ".join(missing), "is" if len(missing) == 1 else "are"))
    est = req.get("estimate") or {}
    rq = est.get("requests") or {}
    for k in ("planned", "cleanupReserve", "pooledSlack", "runCap"):
        if not isinstance(rq.get(k), int) or rq[k] < 0:
            E("estimate.requests.%s must be a non-negative integer" % k)
    for k in ("identityReads", "starts", "takes"):
        if not isinstance(est.get(k), int) or est[k] < 0:
            E("estimate.%s must be a non-negative integer" % k)
    pa = est.get("paidActionsAuthorizedUsd")
    if pa is None or pa > lim["maxPaidActionsUsd"]:
        E("estimate.paidActionsAuthorizedUsd must be present and at most %s (no payments)" % lim["maxPaidActionsUsd"])
    pb = est.get("providerBillableRequests") or {}
    if not isinstance(pb.get("coachingCap"), int) or not pb.get("basis"):
        E("estimate.providerBillableRequests needs an integer coachingCap (enforced by the guard) and a basis; provider cost itself is reported as unknown unless measured")
    if not errs or all("estimate" not in e for e in errs):
        if sum(s.get("plannedRequests", 0) for s in sel) != rq["planned"]:
            E("estimate.requests.planned (%s) does not equal the sum of the selected cases (%s)" % (rq["planned"], sum(s.get("plannedRequests", 0) for s in sel)))
        if rq["planned"] + rq["cleanupReserve"] + rq["pooledSlack"] != rq["runCap"]:
            E("planned + cleanup reserve + pooled slack must equal the run cap")
        if rq["runCap"] > lim["maxRunCapRequests"]:
            E("run cap %s exceeds the configured maximum %s" % (rq["runCap"], lim["maxRunCapRequests"]))
        if est["identityReads"] != 2 * len(sel) + 2:
            E("identityReads must be 2k+2 = %d for %d selected cases" % (2 * len(sel) + 2, len(sel)))
        if est["identityReads"] > lim["maxIdentityReadsPerRun"]:
            E("identity reads exceed the configured maximum")
        if est.get("githubRunnerMinutesMax", 0) > cfg["githubActions"]["maxRunnerMinutes"]:
            E("githubRunnerMinutesMax exceeds the configured bound")
        if full:
            if budget is None:
                E("the full-coverage budget could not be derived (sealed receipts, assertion catalog or reconciliation missing)")
            else:
                bq = budget["requests"]
                for key, mine, theirs in (("planned", rq["planned"], bq["plannedSumOfEstimates"]), ("cleanupReserve", rq["cleanupReserve"], bq["cleanupReserve"]),
                                          ("pooledSlack", rq["pooledSlack"], bq["pooledSlack"]), ("runCap", rq["runCap"], bq["runCap"])):
                    if mine != theirs:
                        E("estimate.requests.%s is %s but the derived full-coverage budget is %s (full_coverage_budget.py; change the model parameters in the config, not the request)" % (key, mine, theirs))
                per = {p["case"]: p for p in budget["perCase"]}
                for s_ in sel:
                    if s_.get("case") in per and s_.get("plannedRequests") != per[s_["case"]]["estimate"]:
                        E("%s plannedRequests %s differs from the derived estimate %s" % (s_["case"], s_.get("plannedRequests"), per[s_["case"]]["estimate"]))
                if est["starts"] != budget["actions"]["startsMinimum"] or est["takes"] != budget["actions"]["takesMinimum"]:
                    E("estimate.starts/takes must equal the harness minimums for every row (%d Starts, %d takes)" % (budget["actions"]["startsMinimum"], budget["actions"]["takesMinimum"]))
                if pb.get("coachingCap") != budget["coaching"]["cap"]:
                    E("estimate.providerBillableRequests.coachingCap must equal the derived coaching cap %d" % budget["coaching"]["cap"])
            if budget is not None:
                w = est.get("window") or {}
                for key, theirs in (("expectedMinutes", budget["window"]["expectedMinutes"]), ("worstCaseMinutes", budget["window"]["worstCaseMinutes"]), ("proposedMinutes", budget["window"]["proposedWindowMinutes"])):
                    if w.get(key) != theirs:
                        E("estimate.window.%s is %s but the derived window is %s" % (key, w.get(key), theirs))
            if rq.get("runCap", 0) > lim["maxRunCapRequests"]:
                E("run cap exceeds the full-mode structural maximum")
    prop = req.get("proposedLimits") or {}
    appr = req.get("approvedLimits") or {}
    if rc:
        cur = rc["ceilings"]
        used_starts, used_takes = rc["starts"]["ownerCounted"], rc["takes"]["ownerCounted"]
        try:
            need = rc["requests"]["conservativeUsed"] + rq["runCap"] + cur["protectedReserveRequests"] + est["identityReads"]
            pc = prop.get("cumulativeCeilingRequests")
            if pc is None or need > pc:
                E("proposed cumulative ceiling %s is below the reconciled requirement %s (conservative used %s + run cap %s + protected reserve %s + identity reads %s)" % (pc, need, rc["requests"]["conservativeUsed"], rq["runCap"], cur["protectedReserveRequests"], est["identityReads"]))
            if pc is not None and pc > cur["requests"]:
                if not prop.get("ceilingIncreaseJustification"):
                    E("proposed ceiling %s exceeds the current ceiling %s without ceilingIncreaseJustification" % (pc, cur["requests"]))
                else:
                    warns.append("ceiling increase requested (%s to %s): an owner decision" % (cur["requests"], pc))
            ic = prop.get("identityCap")
            need_id = rc["identityReads"]["conservativeUsed"] + est["identityReads"]
            if ic is None or need_id > ic:
                E("proposed identity cap %s is below the reconciled requirement %s" % (ic, need_id))
            if ic is not None and ic > cur["identityReads"] and not prop.get("identityIncreaseJustification"):
                E("proposed identity cap %s exceeds the current cap %s without identityIncreaseJustification" % (ic, cur["identityReads"]))
            for label, used_, planned_, cur_, pk, jk in (("Starts", used_starts, est["starts"], cur["starts"], "startsCap", "startsIncreaseJustification"),
                                                         ("takes", used_takes, est["takes"], cur["takes"], "takesCap", "takesIncreaseJustification")):
                need_ = used_ + planned_
                pcap = prop.get(pk, cur_)
                if need_ > pcap:
                    E("%s would exceed the cumulative cap: %d used + %d planned = %d against %s (propose %s with %s, an owner decision)" % (label, used_, planned_, need_, pcap, pk, jk))
                elif pcap > cur_:
                    if not prop.get(jk):
                        E("proposedLimits.%s %s exceeds the current cap %s without %s" % (pk, pcap, cur_, jk))
                    else:
                        warns.append("%s cap increase requested (%s to %s): an owner decision" % (label, cur_, pcap))
        except (KeyError, TypeError):
            E("estimate or proposedLimits are incomplete")
        if prop.get("runCapRequests") != rq.get("runCap"):
            E("proposedLimits.runCapRequests must equal estimate.requests.runCap")
        if prop.get("paidActionsUsd") != 0:
            E("proposedLimits.paidActionsUsd must be 0")
        if (prop.get("guardCaps") or {}).get("coaching") != pb.get("coachingCap"):
            E("proposedLimits.guardCaps.coaching must equal estimate.providerBillableRequests.coachingCap (the guard enforces it)")
    else:
        E("cumulative reconciliation not supplied")
    if full:
        cat = budget and budget.get("_catalog")
        om = req.get("approvedOmissions")
        if not isinstance(om, list):
            E("approvedOmissions must be a list (empty means no row may be left NOT RUN)")
        else:
            known = {(c, a) for c, v in ((cat or {}).get("cases") or {}).items() for a in v["requiredAssertions"]}
            for o in om:
                if not (o.get("case") and o.get("assertion") and o.get("reason") and o.get("approvalRef")):
                    E("every approved omission needs case, assertion, reason and approvalRef")
                elif cat and (o["case"], o["assertion"]) not in known:
                    E("approved omission %s/%s is not an assertion in the catalog" % (o["case"], o["assertion"]))
            if om:
                warns.append("%d approved omission(s): they stay visible as incomplete coverage and the run can not be a full %d-row pass or a full live run" % (len(om), (cat or {}).get("totalAssertions", 204)))
    for k in ("cumulativeCeilingRequests", "identityCap", "runCapRequests", "startsCap", "takesCap"):
        if appr.get(k) is not None and prop.get(k) is not None and appr[k] > prop[k]:
            E("approvedLimits.%s exceeds what the request proposed" % k)
    rel = req.get("release") or {}
    if not is_sha40(rel.get("testedSha")) or not is_sha40(rel.get("lastRunTestedSha")):
        E("release.testedSha and release.lastRunTestedSha must be full 40-character SHAs")
    if "commitsSinceLastRun" in rel:
        E("release.commitsSinceLastRun is not accepted: commits are classified mechanically from git (verify_release.py)")
    if not isinstance(req.get("deviations"), list):
        E("deviations must be a list (possibly empty)")
    h = req.get("harness") or {}
    if h.get("codeManifestSha256") != cfg["harness"]["expectedCodeManifestSha256"]:
        E("harness.codeManifestSha256 does not equal the hash fixed in the config")
    labels = [r.get("label") for r in (req.get("priorRuns") or [])]
    if labels != cfg["history"]["comparisonBaselines"]:
        E("priorRuns must be the last two compared runs %s (found %s)" % (cfg["history"]["comparisonBaselines"], labels))
    return errs, warns


def derive_budget(cfg, rc, receipts_root):
    """The full-coverage budget, derived from the sealed receipts, the hash-pinned assertion catalog and the reconciliation. None when an input is unusable."""
    try:
        from derive_case_costs import derive_run
        from full_coverage_budget import compute
        spec = cfg["modes"]["full"]["assertionCatalog"]
        path = os.path.join(ROOT, spec["file"])
        if sha256_file(path) != spec["sha256"]:
            return None
        cat = load(path)
        costs = {"runs": {lab: derive_run(receipts_root, lab) for lab in cfg["modes"]["full"]["budgetModel"]["basisRuns"]}}
        out = compute(cfg, costs, cat, rc)
        out["_catalog"] = cat
        return out
    except (KeyError, OSError, ValueError, StopIteration):
        return None


def main():
    a = argparse.ArgumentParser()
    for k in ("request", "config", "ledger", "workflow", "release-verification", "reconciliation", "out"):
        a.add_argument("--" + k, required=True)
    a.add_argument("--receipts-root", default=os.path.join(ROOT, "config", "history", "receipts"))
    x = a.parse_args()
    req, cfg, rc = load(x.request), load(x.config), load(x.reconciliation)
    budget = derive_budget(cfg, rc, x.receipts_root) if request_mode(req) == "full" else None
    errs, warns = validate(req, cfg, load(x.ledger), load(x.workflow), load(x.release_verification), rc, budget)
    out = {"schema": "speaksharp.cloud-test.request-validation.v2", "request": os.path.basename(x.request), "valid": not errs, "errors": errs, "warnings": warns}
    dump(out, x.out)
    for e in errs:
        print("ERROR:", e)
    for w in warns:
        print("WARNING:", w)
    print("run request", "VALID" if not errs else "INVALID (%d errors)" % len(errs))
    sys.exit(0 if not errs else 1)


if __name__ == "__main__":
    main()
