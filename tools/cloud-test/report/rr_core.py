"""rr_core: offline loading, verification and prior-vs-current classification for SpeakSharp cloud-test runs.

Everything here is computed from the run directories (plus two optional JSON inputs: comparability facts and an
analyst/owner overlay). Nothing is hard-coded to a particular campaign. No network, no credentials.

Vocabulary
  verdict   : PASS | FAIL | NOT RUN                       (as emitted by the run, never changed here)
  class     : improved | regressed | unchanged | inconclusive   (the report's comparison classes)
  row       : one assertion of one journey; a requirement row is a ledger entry; a journey is one AHT case.
"""
import collections
import hashlib
import json
import os
import re

VERDICTS = ("PASS", "FAIL", "NOT RUN")
PF = ("PASS", "FAIL")
CLASSES = ("improved", "regressed", "unchanged", "inconclusive")

# ---------------------------------------------------------------------------------------------------------------------
# Policy constants (visible in the report; override through the facts/overlay inputs where noted)
# ---------------------------------------------------------------------------------------------------------------------
# evidence "facts" keys that mean "the stimulus never happened" when they are False
STIMULUS_FALSE_KEYS = ("pendingObserved", "fired", "deniedAtBoundary")
# assertion ids that are run bookkeeping, not product behaviour (used only to separate "behavioural" from "control")
CONTROL_IDS = ("owner-bound", "start-press-budget", "owned-pages-closed", "navigation-ready",
               "feedback-readback-preflight", "completion-attempts")
# guard rule ids whose requests are coaching calls (status codes are reported as observed backend signals)
COACHING_RULE_IDS = ("fn-coaching",)
# evidence-file keys ignored when comparing the observation schema of one row across runs
SCHEMA_IGNORED_KEYS = ("sanitizer", "contentSafe", "caseId")

DEFAULT_EXPECT = {"requirements": 151, "journeys": 15, "assertions": 204}

DEFAULT_RULES = {
    "denominators": True,            # D : 151 requirement rows / 15 journeys / 204 assertions are checked
    "coverage_lost": True,           # C : NOT RUN replacing PASS/FAIL is coverage lost, inconclusive
    "gate_stimulus": True,           # S : stimulus not established (either run) -> inconclusive
    "gate_observer": True,           # O : observer / oracle / harness / driver changed or unproven -> inconclusive
    "gate_media": True,              # M : capture-device / media binding differs -> inconclusive
    "gate_omitted_allowance": True,  # A : omitted by design or interrupted by an allowance -> inconclusive
    "gate_receipt": True,            # R : prior (or current) original receipt not in the bundle -> inconclusive
    "disputed_fail_never_regression": True,  # F : unchanged disputed-oracle FAIL is never a regression
}

RULE_TEXT = [
    ("improved", "A row is IMPROVED only when a previously FAIL or NOT RUN row now PASSes AND the stimulus was established in both "
                 "runs, the observer, oracle, driver and harness are the same (or attested the same) in both runs, the media / "
                 "capture binding is the same, the row was not omitted by design or interrupted, and both original receipts are in the bundle."),
    ("regressed", "A row is REGRESSED only when a previously PASS row now FAILs under the same valid conditions. A FAIL that was already a FAIL "
                  "is never a regression, and an unchanged FAIL on an oracle the owner or analyst disputes is reported as 'not scored'."),
    ("unchanged", "A journey or area is UNCHANGED when every row that has a verdict in either run has the same verdict in both runs "
                  "and no condition below applies. NOT RUN in both runs means no signal in either run: it is shown as unresolved, not as a pass."),
    ("inconclusive", "INCONCLUSIVE means not comparable. It applies whenever the stimulus was not established in either run, the observer, "
                     "oracle, harness or driver changed or cannot be shown to be the same, the media / capture binding differs, the row was omitted "
                     "by design or interrupted by an allowance, the run's original receipt or binding manifest is not in the bundle, or the "
                     "row is not in both runs."),
    ("coverage lost", "NOT RUN replacing a PASS or FAIL is COVERAGE LOST. It is inconclusive and never an improvement, even though the FAIL count falls."),
    ("precedence", "Journey class: regressed if any row regressed; otherwise inconclusive if any changed row is inconclusive or any journey-level condition applies; "
                   "otherwise improved if any row improved; otherwise unchanged. Area class uses the same precedence over the area's requirement rows that have a "
                   "verdict in either run; an area with no such row is inconclusive (no signal)."),
]

CAUSE_LABEL = {
    "omitted-by-design": "omitted by design",
    "allowance-interrupted": "interrupted by the request allowance",
    "evidence-reader-unavailable": "evidence reader unavailable",
    "setup-blocked": "setup-blocked (stimulus or precondition not established)",
    "after-fail": "not reached after a recorded FAIL",
    "blocked-by-error": "blocked by an observed backend error",
    "case-incomplete": "case incomplete (bookkeeping row)",
    "interrupted-other": "interrupted (not by the allowance)",
    "not-established": "not established (no cause recorded in the receipt)",
}


class ReportError(Exception):
    """The generator refuses rather than guesses."""


# ---------------------------------------------------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------------------------------------------------
def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def _read_text(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _first(base, rels):
    for r in rels:
        p = os.path.join(base, r)
        if os.path.isfile(p):
            return p
    return None


def locate_case_dir(base, cid):
    for d in ("run/cases", "cases", ""):
        p = os.path.join(base, d, cid)
        if os.path.isfile(os.path.join(p, "case-result.json")):
            return p
    return None


def find_file(dirs, cid, fname):
    """Return (path, is_supplement) for an evidence file of a case, searching the primary run first."""
    for i, d in enumerate(dirs):
        cd = locate_case_dir(d, cid)
        if cd and os.path.isfile(os.path.join(cd, fname)):
            return os.path.join(cd, fname), i > 0
    return None, False


def short(sha, n=8):
    return (sha or "")[:n] if sha else "-"


# ---------------------------------------------------------------------------------------------------------------------
# loading one run
# ---------------------------------------------------------------------------------------------------------------------
def load_run(base, label, supplements=(), code_manifest=None, extra_binding=(), expect=None, rules=None):
    """Load a run directory (several layouts are accepted) into a plain dict. Never mutates the source."""
    rules = rules or DEFAULT_RULES
    expect = expect or DEFAULT_EXPECT
    run = {"label": label, "base": os.path.abspath(base), "problems": [], "notes": [], "files": {}}
    if not os.path.isdir(base):
        raise ReportError("run directory not found: %s" % base)
    cr_path = _first(base, ("case-results.json", "run/case-results.json"))
    if not cr_path:
        raise ReportError("case-results.json not found under %s" % base)
    camp = read_json(cr_path)
    run["campaign_results_path"] = cr_path
    run["campaign_results_sha256"] = sha256_file(cr_path)
    for k in ("campaignId", "sourceSha", "servedSha", "result", "fullAcceptance"):
        run[k] = camp.get(k)
    run["files"]["case-results.json"] = cr_path

    # ---- binding files
    plan_p = _first(base, ("campaign-plan.json", "cfg/campaign-plan.json"))
    plansha_p = _first(base, ("plan.sha", "cfg/plan.sha"))
    appr_p = _first(base, ("security-approval.json", "cfg/security-approval.json"))
    adm_p = _first(base, ("admission-receipt.json", "run/admission/admission-receipt.json", "admission/admission-receipt.json"))
    pol_p = _first(base, ("policy.json", "cfg/policy.json"))
    cled_p = _first(base, ("campaign-ledger.json", "ledgers/campaign-ledger.json"))
    iled_p = _first(base, ("identity-ledger.json", "ledgers/identity-ledger.json"))
    for name, p in (("campaign-plan.json", plan_p), ("plan.sha", plansha_p), ("security-approval.json", appr_p),
                    ("admission-receipt.json", adm_p), ("policy.json", pol_p), ("campaign-ledger.json", cled_p),
                    ("identity-ledger.json", iled_p)):
        if p:
            run["files"][name] = p
    plan = read_json(plan_p) if plan_p else None
    appr = read_json(appr_p) if appr_p else None
    adm = read_json(adm_p) if adm_p else camp.get("admission")
    binding = {"plan_present": bool(plan), "plan_sha256": sha256_file(plan_p) if plan_p else None,
               "plan_sha_file": _read_text(plansha_p).strip() if plansha_p else None,
               "approval_present": bool(appr), "admission_present": bool(adm_p),
               "policy_sha256": sha256_file(pol_p) if pol_p else None,
               "code_manifest_file": None, "code_manifest_sha256": None, "checks": []}

    def chk(name, ok, detail=""):
        binding["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
        if not ok:
            run["problems"].append("binding check failed: " + name)

    if plan_p and plansha_p:
        chk("plan.sha equals sha256(campaign-plan.json)", binding["plan_sha_file"] == binding["plan_sha256"], binding["plan_sha256"])
    elif plan_p:
        binding["checks"].append({"name": "plan.sha file not present; sha256 computed from the plan", "ok": True, "detail": binding["plan_sha256"]})
    if plan:
        chk("plan campaignId equals report campaignId", plan.get("campaignId") == camp.get("campaignId"), str(plan.get("campaignId")))
        chk("plan servedSha equals report servedSha", plan.get("servedSha") == camp.get("servedSha"), short(plan.get("servedSha")))
    if code_manifest:
        binding["code_manifest_file"] = code_manifest
        binding["code_manifest_sha256"] = sha256_file(code_manifest)
        run["files"]["CODE.sha256"] = code_manifest
        if appr:
            chk("as-run code manifest sha256 equals approval reviewedCodeManifestSha256",
                binding["code_manifest_sha256"] == appr.get("reviewedCodeManifestSha256"), short(binding["code_manifest_sha256"], 12))
    if appr and adm:
        a1 = [s for s in (adm.get("steps") or []) if s.get("id") == "A1.bundle"]
        if a1:
            chk("admission A1.bundle codeManifestSha256 equals approval reviewedCodeManifestSha256",
                (a1[0].get("detail") or {}).get("codeManifestSha256") == appr.get("reviewedCodeManifestSha256"), "")
    if pol_p and adm:
        pol_bound = None
        b = adm.get("binding") or {}
        pol_bound = b.get("policySha256")
        if not pol_bound:
            for s in adm.get("steps") or []:
                if s.get("id") == "A0.config":
                    pol_bound = (s.get("detail") or {}).get("policySha256")
        if pol_bound:
            chk("policy.json sha256 equals the admission policy binding", pol_bound == binding["policy_sha256"], short(pol_bound))
    run["extra_binding"] = [os.path.abspath(p) for p in extra_binding if p and os.path.isfile(p)]
    run["binding"] = binding
    run["binding_ok"] = bool(plan and appr) and all(c["ok"] for c in binding["checks"])
    run["plan"] = plan
    run["approval"] = appr
    run["admission"] = adm

    # ---- code/harness identity
    code_sha = (appr or {}).get("reviewedCodeManifestSha256")
    if not code_sha and adm:
        for s in adm.get("steps") or []:
            if s.get("id") == "A1.bundle":
                code_sha = (s.get("detail") or {}).get("codeManifestSha256")
    run["identity"] = {
        "servedSha": camp.get("servedSha"), "sourceSha": camp.get("sourceSha"),
        "codeManifestSha256": code_sha, "stepManifestSha256": (plan or {}).get("stepManifestSha256"),
        "admissionConfigSha256": (plan or {}).get("admissionConfigSha256"), "planSha256": binding["plan_sha256"],
        "policySha256": binding["policy_sha256"], "runtime": (plan or {}).get("runtime") or camp.get("admission", {}).get("runtime"),
        "campaignId": camp.get("campaignId"), "targetUrlHost": _host((plan or {}).get("targetUrl")),
        "approvedWindow": [(appr or {}).get("notBefore"), (appr or {}).get("expiresAt")],
        "admissionStartedAt": (adm or {}).get("startedAt"), "admissionEndedAt": (adm or {}).get("endedAt"),
        "admissionResult": (adm or {}).get("result"),
        "costCeilingUsd": (plan or {}).get("costCeilingUsd"),
        "identityCap": (plan or {}).get("identityCap"),
    }

    # ---- identity receipts
    recs = list(camp.get("identityReceipts") or [])
    if camp.get("finalIdentityReceipt"):
        recs.append(camp["finalIdentityReceipt"])
    seen, uniq = set(), []
    for r in recs:  # identityReceipts may already contain admission/final; de-duplicate by phase
        key = (r.get("phase"), r.get("identityGetsUsed"))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(r)
    for c in camp.get("cases") or []:
        for r in (c.get("identityBefore"), c.get("identityAfter")):
            if r and (r.get("phase"), r.get("identityGetsUsed")) not in seen:
                seen.add((r.get("phase"), r.get("identityGetsUsed")))
                uniq.append(r)
    run["identity_reads"] = {
        "count": len(uniq), "all_match": bool(uniq) and all(r.get("result") == "MATCH" for r in uniq),
        "served_shas": sorted({r.get("servedSha") for r in uniq if r.get("servedSha")}),
        "body_sha256": sorted({r.get("bodySha256") for r in uniq if r.get("bodySha256")}),
        "gets_used": max([r.get("identityGetsUsed") or 0 for r in uniq] or [0]), "cap": (uniq[-1].get("cap") if uniq else None),
        "final": camp.get("finalIdentity"),
    }

    # ---- cases
    cases = {}
    camp_cases = {c["caseId"]: c for c in camp.get("cases") or []}
    dirs = [base] + [s for s in supplements if s]
    for cid in sorted(camp_cases):
        cases[cid] = _load_case(run, cid, camp_cases[cid], dirs, plan, rules)
    run["cases"] = cases
    run["case_order"] = sorted(cases)

    # ---- requirement rows (mapping: the AHT-NN requirement row takes its journey's verdict; every other row keeps the run's value)
    reqs = []
    for r in camp.get("validationRequirements") or []:
        rid = r.get("requirementId")
        if rid in cases:
            verdict, basis = cases[rid]["result"], "journey verdict (requirement row = its AHT journey)"
        else:
            verdict, basis = r.get("result"), "run ledger value (no assertion mapped)"
        reqs.append({"id": rid, "title": r.get("title"), "category": r.get("categoryId"), "layer": r.get("layer"),
                     "verdict": verdict, "basis": basis, "reason": r.get("reason") if rid not in cases else None})
    run["requirements"] = reqs

    # ---- denominators
    n_assert = sum(len(c["rows"]) for c in cases.values())
    run["denominators"] = {"requirements": len(reqs), "requirements_unique": len({r["id"] for r in reqs}),
                           "journeys": len(cases), "assertions": n_assert}
    if rules.get("denominators", True):
        if (len(reqs), len({r["id"] for r in reqs})) != (expect["requirements"],) * 2:
            raise ReportError("%s: requirement denominator is %d (%d unique), expected %d" % (label, len(reqs), len({r["id"] for r in reqs}), expect["requirements"]))
        if len(cases) != expect["journeys"]:
            raise ReportError("%s: journey denominator is %d, expected %d" % (label, len(cases), expect["journeys"]))
        if n_assert != expect["assertions"]:
            raise ReportError("%s: assertion denominator is %d, expected %d" % (label, n_assert, expect["assertions"]))
    run["tallies"] = {
        "assertions": dict(collections.Counter(r["verdict"] for c in cases.values() for r in c["rows"])),
        "journeys": dict(collections.Counter(c["result"] for c in cases.values())),
        "requirements": dict(collections.Counter(r["verdict"] for r in reqs)),
    }
    # code-level facts used for factors
    run["sample_mode"] = "minimal" if any((r["flags"]["omitted_by"] or "") for c in cases.values() for r in c["rows"]
                                          if "minimal" in (r["flags"]["omitted_by"] or "")) else "full"
    run["omitted_markers"] = sorted({r["flags"]["omitted_by"] for c in cases.values() for r in c["rows"] if r["flags"]["omitted_by"]})
    run["per_case_allowance"] = any(c["budget"]["allowance"] is not None for c in cases.values())
    ends = [c["summary"].get("endedAt") for c in cases.values() if c["summary"].get("endedAt")]
    run["last_case_ended_at"] = max(ends) if ends else None
    run["campaign_ledger"] = read_json(cled_p) if cled_p else None
    run["identity_ledger_summary"] = None
    if iled_p:
        il = read_json(iled_p)
        run["identity_ledger_summary"] = {"identityGets": il.get("identityGets"), "cap": il.get("cap"), "expectedSha": il.get("expectedSha")}
    return run


def _host(url):
    if not url:
        return None
    try:
        return url.split("//", 1)[1].split("/", 1)[0]
    except Exception:
        return None


def _load_case(run, cid, camp_case, dirs, plan, rules):
    cdir = None
    for d in dirs:
        cdir = locate_case_dir(d, cid)
        if cdir:
            break
    case = {"id": cid, "dir": cdir, "result": camp_case.get("result"), "problems": [], "receipt": {}}
    pc = {}
    if plan:
        for e in plan.get("cases") or []:
            if (e.get("id") or e.get("caseId")) == cid:
                pc = e
    case["plan"] = {"driverSha256": pc.get("driverSha256"), "configSha256": pc.get("configSha256"),
                    "mediaSha256": pc.get("mediaSha256") or None,
                    "mediaName": os.path.basename(pc.get("mediaFile") or "") or None, "maxMs": pc.get("maxMs"),
                    "oracleFile": os.path.basename(pc.get("caseOracleFile") or "") or None}
    case["campaign_entry"] = {k: camp_case.get(k) for k in ("requestsUsed", "plannedRequests", "requestAllowance")}
    case["identity_before"] = camp_case.get("identityBefore")
    case["identity_after"] = camp_case.get("identityAfter")
    rb = (plan or {}).get("requestBudget") or {}
    summary, guard = {}, None
    cr = None
    if not cdir:
        case["problems"].append("case-result.json not found")
        case["rows"], case["order"] = _rows_from_campaign(camp_case), None
        case["receipt"] = {"case_result_present": False, "verified": False, "problems": ["case receipts not found"]}
        case["summary"], case["budget"], case["guard"], case["interruption"] = {}, _budget(case, rb, cid, {}), None, None
        return case
    cr = read_json(os.path.join(cdir, "case-result.json"))
    case["case_result_sha256"] = sha256_file(os.path.join(cdir, "case-result.json"))
    case["interruption"] = cr.get("interruption")
    # per-case receipt verification
    digests = cr.get("evidenceDigests") or {}
    rec = {"case_result_present": True, "problems": [], "digest_ok": {}, "digest_missing": [], "digest_bad": [], "supplemented": []}
    for fname, dg in digests.items():
        found, supp = find_file(dirs, cid, fname)
        if not found:
            rec["digest_missing"].append(fname)
            continue
        if supp:
            rec["supplemented"].append(fname)
        ok = sha256_file(found) == dg
        rec["digest_ok"][fname] = ok
        if not ok:
            rec["digest_bad"].append(fname)
    sp = os.path.join(cdir, "summary.json")
    if os.path.isfile(sp):
        summary = read_json(sp)
        case["summary_sha256"] = sha256_file(sp)
        want = (camp_case.get("executionReceipt") or {}).get("summarySha256")
        rec["summary_hash_ok"] = (want == case["summary_sha256"]) if want else None
        if want and want != case["summary_sha256"]:
            rec["problems"].append("summary.json sha256 differs from the campaign executionReceipt")
    gp = os.path.join(cdir, "guard.jsonl")
    if os.path.isfile(gp):
        guard = _guard_counts(gp)
        guard["source_sha256"] = sha256_file(gp)
    case["summary"] = _summary_fields(summary)
    case["guard"] = guard
    case["budget"] = _budget(case, rb, cid, summary)
    # campaign vs case-result consistency
    if cr.get("result") != camp_case.get("result"):
        rec["problems"].append("case-result.json result %s differs from campaign result %s" % (cr.get("result"), camp_case.get("result")))
    camp_v = {a["id"]: a["result"] for a in camp_case.get("assertions") or []}
    case_v = {a["id"]: a["result"] for a in cr.get("assertions") or []}
    if camp_v != case_v:
        rec["problems"].append("assertion verdicts differ between the campaign report and case-result.json")
    case["result"] = cr.get("result")
    rows, order = [], []
    interruption = cr.get("interruption") or {}
    for idx, a in enumerate(cr.get("assertions") or []):
        facts, refs_status = {}, []
        for ref in a.get("evidenceRefs") or []:
            if ref == "summary.json":
                continue
            found, supp = find_file(dirs, cid, ref)
            st = {"ref": ref, "present": bool(found), "digest_listed": ref in digests,
                  "digest_ok": bool(found) and ref in digests and rec["digest_ok"].get(ref, False), "path": found, "supplemented": bool(supp)}
            refs_status.append(st)
            if found:
                try:
                    e = read_json(found)
                    f = e.get("facts") if isinstance(e.get("facts"), dict) else {k: v for k, v in e.items() if k not in ("sanitizer", "contentSafe", "caseId")}
                    facts.update(f)
                except Exception:
                    rec["problems"].append("evidence file unreadable: " + ref)
        row = {"id": a["id"], "verdict": a["result"], "index": idx, "detail": a.get("detail"),
               "refs": [s_["ref"] for s_ in refs_status], "refs_status": refs_status, "facts": facts,
               "receipt_ok": all(s_["digest_ok"] for s_ in refs_status) if refs_status else (a["result"] == "NOT RUN"),
               "interruptedBy": a.get("interruptedBy"), "case": cid}
        row["flags"] = _flags(a, facts, interruption)
        rows.append(row)
        order.append(a["id"])
    case["rows"], case["order"] = rows, order
    _assign_causes(case)
    rec["verified"] = (not rec["digest_bad"]) and (not rec["digest_missing"]) and not rec["problems"]
    case["receipt"] = rec
    return case


def _rows_from_campaign(camp_case):
    rows = []
    for idx, a in enumerate(camp_case.get("assertions") or []):
        rows.append({"id": a["id"], "verdict": a["result"], "index": idx, "detail": a.get("detail"), "refs": [], "refs_status": [],
                     "facts": {}, "receipt_ok": False, "interruptedBy": a.get("interruptedBy"), "case": camp_case["caseId"],
                     "flags": _flags(a, {}, {}), "cause": None})
    return rows


def _flags(a, facts, interruption):
    interrupted = bool(facts.get("interrupted") or a.get("interruptedBy"))
    kind = a.get("interruptedBy") or ((interruption or {}).get("kind") if facts.get("interrupted") else None)
    return {
        "omitted_by": facts.get("omittedBy"),
        "not_reached": bool(facts.get("notReached")),
        "not_attempted": bool(facts.get("notAttempted")),
        "incomplete": bool(facts.get("incomplete")),
        "interrupted": interrupted, "interrupt_kind": kind,
        "reader_unavailable": any(k.endswith("Unavailable") and v is True for k, v in facts.items()) or facts.get("reason") == "authorized-evidence-reader-unavailable",
        "precondition_not_met": bool(facts.get("preconditionNotMet")),
        "stimulus_unestablished": [k for k in STIMULUS_FALSE_KEYS if facts.get(k) is False],
    }


def _own_cause(row):
    f = row["flags"]
    if f["omitted_by"]:
        return ("omitted-by-design", "omitted by design (%s)" % f["omitted_by"])
    if f["interrupted"]:
        if f["interrupt_kind"] == "request-allowance":
            return ("allowance-interrupted", "interrupted by the per-case request allowance")
        return ("interrupted-other", "interrupted by a harness wait or step failure (not the allowance)")
    if f["reader_unavailable"]:
        return ("evidence-reader-unavailable", "authorized evidence reader unavailable")
    if f["stimulus_unestablished"]:
        return ("setup-blocked", "stimulus not established (%s false)" % ", ".join(f["stimulus_unestablished"]))
    if f["precondition_not_met"]:
        return ("setup-blocked", "precondition not met")
    return None


_REF_NUM = re.compile(r"-(\d+)\.json$")


def chrono_order(rows):
    """Rows in execution order. The assertion list order is not always the execution order, but the evidence files are numbered
    aht-NN-K.json in execution order; rows whose evidence has no number (oracle files) keep the position of the preceding numbered row."""
    keys, last = [], 0.0
    for i, r in enumerate(rows):
        k = None
        for ref in r.get("refs") or []:
            m = _REF_NUM.search(ref)
            if m and ref.lower().startswith("aht-"):
                k = float(m.group(1))
                break
        if k is None:
            k = last + 0.01
        last = k
        keys.append((k, i))
    return [rows[i] for _, i in sorted(keys)]


def _assign_causes(case):
    rows = case["rows"]
    seq = chrono_order(rows)
    g = case.get("guard") or {}
    case_coaching_err = any((s or 0) >= 500 for s in g.get("coaching_statuses") or [])
    interruption = case.get("interruption") or {}

    def case_level():
        if interruption.get("kind") == "request-allowance":
            return ("allowance-interrupted", "interrupted by the per-case request allowance")
        if case_coaching_err:
            return ("blocked-by-error", "blocked by an observed coaching HTTP 5xx (cause undiagnosed)")
        return None

    for i, r in enumerate(seq):
        if r["verdict"] != "NOT RUN":
            r["cause"] = None
            continue
        c = _own_cause(r)
        if c:
            r["cause"] = {"code": c[0], "text": c[1], "via": r["id"]}
            continue
        f = r["flags"]
        root = None
        if f["not_reached"] or f["incomplete"] or f["not_attempted"]:
            for j in range(i - 1, -1, -1):
                p = seq[j]
                if p["verdict"] == "PASS":
                    continue
                if p["verdict"] == "FAIL":
                    root = ("after-fail", "not reached after %s FAIL" % p["id"], p["id"])
                    break
                oc = _own_cause(p)
                if oc:
                    root = (oc[0], oc[1], p["id"])
                    break
                if not (p["flags"]["not_reached"] or p["flags"]["incomplete"]):
                    cl = case_level()
                    if cl:
                        root = (cl[0], cl[1], p["id"])
                        break
        if root is None:
            cl = case_level()
            if cl:
                root = (cl[0], cl[1], None)
        if root is None:
            if f["incomplete"]:
                root = ("case-incomplete", "case incomplete (bookkeeping row)", None)
            elif f["not_reached"]:
                root = ("not-established", "not reached; no upstream cause recorded", None)
            else:
                root = ("not-established", "not established; the receipt records no cause", None)
        r["cause"] = {"code": root[0], "text": root[1], "via": root[2]}


def _summary_fields(s):
    g = (s.get("guard") or {})
    ab = s.get("actionBudget") or {}
    return {"reason": s.get("reason"), "exitCode": s.get("exitCode"), "startedAt": s.get("startedAt"), "endedAt": s.get("endedAt"),
            "ownedProcessesRemaining": s.get("ownedProcessesRemaining"), "authenticationRejected": s.get("authenticationRejected"),
            "fatal": g.get("fatal"), "caseAllowance": g.get("caseAllowance"),
            "forwarded": (g.get("counters") or {}).get("forwarded"), "attempted": (g.get("counters") or {}).get("attempted"),
            "denied": (g.get("counters") or {}).get("denied"), "ledgerUsedTotal": (g.get("ledgerUsed") or {}).get("total"),
            "limits": ab.get("limits"), "used": ab.get("used"), "exceeded": ab.get("exceeded")}


def _budget(case, rb, cid, summary):
    ce = case.get("campaign_entry") or {}
    sm = case.get("summary") or _summary_fields(summary)
    used = ce.get("requestsUsed")
    src = "campaign case-results.requestsUsed"
    if used is None:
        used = (case.get("guard") or {}).get("ledger_delta")
        src = "guard ledger total at stop minus at start" if used is not None else None
    if used is None:
        used = sm.get("forwarded")
        src = "summary.guard.counters.forwarded" if used is not None else None
    planned = ce.get("plannedRequests")
    if planned is None:
        planned = (rb.get("estimates") or {}).get(cid)
    allow = ce.get("requestAllowance")
    if allow is None:
        allow = (sm.get("caseAllowance") or {}).get("allowance") if sm.get("caseAllowance") else (rb.get("ceilings") or {}).get(cid)
    lim, usd = sm.get("limits") or {}, sm.get("used") or {}
    return {"requests_used": used, "requests_source": src, "planned": planned, "allowance": allow,
            "allowance_exhausted": bool((sm.get("caseAllowance") or {}).get("exhausted")),
            "start_presses": usd.get("startPresses"), "start_limit": lim.get("startPresses"),
            "take_attempts": usd.get("takeAttempts"), "take_limit": lim.get("takeAttempts"),
            "identity_gets_before": (case.get("identity_before") or {}).get("identityGetsUsed"),
            "identity_gets_after": (case.get("identity_after") or {}).get("identityGetsUsed")}


def _guard_counts(path):
    rules, outcomes, media, coaching = collections.Counter(), collections.Counter(), [], []
    start_total = stop_total = None
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            try:
                o = json.loads(line)
            except Exception:
                continue
            k = o.get("kind")
            if k == "request":
                rules[o.get("rule") or "unclassified-or-denied"] += 1
                outcomes[o.get("outcome") or o.get("decision") or "unknown"] += 1
                if o.get("rule") in COACHING_RULE_IDS:
                    coaching.append(o.get("status"))
            elif k == "media":
                media.append(o.get("sha256"))
            elif k == "start" and start_total is None:
                start_total = (o.get("ledgerUsed") or {}).get("total")
            elif k == "stop":
                stop_total = ((o.get("summary") or {}).get("ledgerUsed") or {}).get("total")
    return {"requests_by_rule": dict(sorted(rules.items())), "outcomes": dict(sorted(outcomes.items())),
            "model_requests": rules.get("local-private-model", 0), "coaching_requests": rules.get("fn-coaching", 0),
            "coaching_statuses": coaching, "media_records": len(media), "media_sha256": sorted(set(m for m in media if m)),
            "ledger_delta": (stop_total - start_total) if (start_total is not None and stop_total is not None) else None}


# ---------------------------------------------------------------------------------------------------------------------
# comparison
# ---------------------------------------------------------------------------------------------------------------------
def _overlay_match(entries, run_key, cid, aid):
    out = []
    for e in entries or []:
        if e.get("case") != cid:
            continue
        if e.get("assertion") not in (aid, "*", None):
            continue
        if e.get("run") in (None, "both", run_key):
            out.append(e)
    return out


def _schema_keys(row):
    return sorted(k for k in (row or {}).get("facts", {}) if k not in SCHEMA_IGNORED_KEYS)


def compare_runs(prev, cur, facts=None, overlay=None, rules=None, traceability=None):
    """Compute the whole comparison as a JSON-serialisable dict."""
    rules = dict(DEFAULT_RULES, **(rules or {}))
    facts, overlay = facts or {}, overlay or {}
    row_cls = overlay.get("rowClassifications") or []
    obs_changes = overlay.get("observerChanges") or []
    attest = facts.get("observerAttestations") or []
    case_ids = sorted(set(prev["cases"]) | set(cur["cases"]))
    packet_differs = (prev["identity"]["codeManifestSha256"] != cur["identity"]["codeManifestSha256"]) or \
                     (prev["identity"]["stepManifestSha256"] != cur["identity"]["stepManifestSha256"])
    binding_missing = {"previous": not prev["binding_ok"], "current": not cur["binding_ok"]}

    journeys, changes, all_rows = [], [], []
    for cid in case_ids:
        pc, cc = prev["cases"].get(cid), cur["cases"].get(cid)
        ctx = _case_context(pc, cc, packet_differs, binding_missing, rules)
        prows = {r["id"]: r for r in (pc["rows"] if pc else [])}
        crows = {r["id"]: r for r in (cc["rows"] if cc else [])}
        ids = list(crows) + [i for i in prows if i not in crows]
        rowres = []
        for aid in ids:
            p, c = prows.get(aid), crows.get(aid)
            rr = _compare_row(cid, aid, p, c, ctx, rules, row_cls, obs_changes, attest, packet_differs, prev, cur)
            rowres.append(rr)
        j = _journey(cid, pc, cc, ctx, rowres, rules, prev, cur)
        for rr in rowres:
            rr["reasons"] = [{"code": a, "text": b} for a, b in rr["reasons"]]
        journeys.append(j)
        all_rows.extend(rowres)
        changes.extend(r for r in rowres if r["kind"] != "same")
    areas = _areas(prev, cur, journeys, traceability)
    req_by = {r["id"]: r for r in cur["requirements"]}
    related = (traceability or {}).get("related_journeys") or {}
    for j in journeys:
        rq = req_by.get(j["id"])
        j["title"] = rq["title"] if rq else None
        j["primary_area"] = rq["category"] if rq else None
        j["related_areas"] = sorted(cat for cat, ids in related.items() if j["id"] in ids and cat != j["primary_area"])
    return {"journeys": journeys, "rows": all_rows, "changes": changes, "areas": areas, "rules": rules,
            "packet_differs": packet_differs, "binding_missing": binding_missing}


def _case_context(pc, cc, packet_differs, binding_missing, rules):
    ctx = {"gates": [], "prev_stim": [], "cur_stim": [], "prev_interrupt": False, "cur_interrupt": False,
           "media_differs": False, "driver_differs": False, "packet_differs": packet_differs}
    if pc is None or cc is None:
        ctx["gates"].append(("journey-not-in-both-runs", "journey is not present in both runs"))
        return ctx
    ctx["prev_stim"] = sorted({k for r in pc["rows"] for k in r["flags"]["stimulus_unestablished"]})
    ctx["cur_stim"] = sorted({k for r in cc["rows"] for k in r["flags"]["stimulus_unestablished"]})
    ctx["prev_interrupt"] = (pc.get("interruption") or {}).get("kind") == "request-allowance" or any(r["flags"]["interrupt_kind"] == "request-allowance" for r in pc["rows"])
    ctx["cur_interrupt"] = (cc.get("interruption") or {}).get("kind") == "request-allowance" or any(r["flags"]["interrupt_kind"] == "request-allowance" for r in cc["rows"])
    pm, cm = pc["plan"]["mediaSha256"], cc["plan"]["mediaSha256"]
    ctx["media_differs"] = pm != cm
    ctx["media"] = (pm, cm)
    ctx["driver_differs"] = pc["plan"]["driverSha256"] != cc["plan"]["driverSha256"]
    g = ctx["gates"]
    if rules["gate_receipt"]:
        if not pc["receipt"].get("case_result_present") or binding_missing["previous"]:
            g.append(("prior-receipt-missing", "the prior run's original case receipt or binding manifest is not in the bundle"))
        if not cc["receipt"].get("case_result_present") or binding_missing["current"]:
            g.append(("current-receipt-missing", "the current run's original case receipt or binding manifest is not in the bundle"))
    if rules["gate_media"] and ctx["media_differs"]:
        g.append(("media-binding-differs", "media / capture-device binding differs (%s vs %s)" % (
            "bound " + short(pm) if pm else "none bound", "bound " + short(cm) if cm else "none bound")))
    if rules["gate_observer"] and ctx["driver_differs"]:
        g.append(("driver-changed", "the case driver differs between the runs"))
    if rules["gate_stimulus"] and (ctx["prev_stim"] or ctx["cur_stim"]):
        who = []
        if ctx["prev_stim"]:
            who.append("prior (%s)" % ", ".join(ctx["prev_stim"]))
        if ctx["cur_stim"]:
            who.append("current (%s)" % ", ".join(ctx["cur_stim"]))
        g.append(("stimulus-not-established", "stimulus not established in " + " and ".join(who)))
    if rules["gate_omitted_allowance"] and (ctx["prev_interrupt"] or ctx["cur_interrupt"]):
        g.append(("allowance-interrupted", "stopped by the request allowance in %s" % (
            "both runs" if ctx["prev_interrupt"] and ctx["cur_interrupt"] else "the current run" if ctx["cur_interrupt"] else "the prior run")))
    return ctx


def _compare_row(cid, aid, p, c, ctx, rules, row_cls, obs_changes, attest, packet_differs, prev, cur):
    pv = p["verdict"] if p else None
    cv = c["verdict"] if c else None
    out = {"case": cid, "id": aid, "key": "%s/%s" % (cid, aid), "prev": pv, "cur": cv,
           "prev_cause": (p or {}).get("cause"), "cur_cause": (c or {}).get("cause"),
           "prev_refs": [s["ref"] for s in (p or {}).get("refs_status", [])], "cur_refs": [s["ref"] for s in (c or {}).get("refs_status", [])],
           "prev_receipt_ok": (p or {}).get("receipt_ok"), "cur_receipt_ok": (c or {}).get("receipt_ok"),
           "reasons": [], "reason_code": None, "reason_text": None, "class": None, "flags": [], "disputed": False,
           "control": aid in CONTROL_IDS, "fail_class": {}, "supplemented": False}
    # overlay classifications (FAIL attribution, disputed oracle)
    for rk, row, verdict in (("previous", p, pv), ("current", c, cv)):
        if verdict == "FAIL":
            ents = _overlay_match(row_cls, rk, cid, aid)
            cls = ents[-1]["class"] if ents else "unclassified"
            out["fail_class"][rk] = {"class": cls, "note": ents[-1].get("note") if ents else None, "source": ents[-1].get("source") if ents else None}
            if cls == "disputed-oracle":
                out["disputed"] = True
    obs_pos = []
    for e in obs_changes:
        if e.get("case") == cid and e.get("assertion") in (aid, "*", None):
            obs_pos.append(e.get("note") or "analyst-declared observer change")
    schema_delta = None
    if p and c and pv in PF and cv in PF and all(x["present"] for x in p["refs_status"] + c["refs_status"]):
        a, b = set(_schema_keys(p)), set(_schema_keys(c))
        if a != b:
            schema_delta = {"added": sorted(b - a), "removed": sorted(a - b)}
    attested = any(e.get("case") == cid and e.get("assertion") in (aid, "*", None) for e in attest)
    out["observer"] = {"changed_signals": obs_pos + (["evidence schema differs (+%s / -%s)" % (",".join(schema_delta["added"]) or "none", ",".join(schema_delta["removed"]) or "none")] if schema_delta else []),
                       "packet_differs": packet_differs, "attested_same": attested, "schema_delta": schema_delta}
    if p is None or c is None:
        out.update(kind="changed", reason_code="unexplained", reason_text="row is not present in both runs", **{"class": "inconclusive"})
        out["reasons"].append(("row-not-in-both-runs", "row is not present in both runs"))
        return out
    if pv == cv:
        out["kind"] = "same"
        if pv == "NOT RUN":
            out["class"] = "no-signal"
        elif pv == "PASS":
            out["class"] = "unchanged"
        else:
            out["class"] = "unchanged"
            if out["disputed"]:
                out["flags"].append("disputed oracle: unchanged FAIL, not scored, never a regression")
                if not rules["disputed_fail_never_regression"]:
                    out["class"] = "regressed"
        if rules["gate_receipt"] and pv in PF:
            if not p["receipt_ok"]:
                out["reasons"].append(("prior-receipt-missing", "an evidence file behind the prior verdict is not in the bundle or does not match its digest"))
            if not c["receipt_ok"]:
                out["reasons"].append(("current-receipt-missing", "an evidence file behind the current verdict is not in the bundle or does not match its digest"))
            if out["reasons"]:
                out["class"] = "inconclusive"
        return out
    # ---- changed verdict
    out["kind"] = "lost" if (pv in PF and cv == "NOT RUN") else ("gained" if (cv in PF and pv == "NOT RUN") or (pv == "FAIL" and cv == "PASS") else "changed")  # PASS -> FAIL is "changed"
    gates = list(ctx["gates"])
    if rules["gate_receipt"]:
        if pv in PF and not p["receipt_ok"]:
            gates.append(("prior-receipt-missing", "an evidence file behind the prior verdict is not in the bundle or does not match its digest"))
        if cv in PF and not c["receipt_ok"]:
            gates.append(("current-receipt-missing", "an evidence file behind the current verdict is not in the bundle or does not match its digest"))
    lost = pv in PF and cv == "NOT RUN"
    if lost and rules["coverage_lost"]:
        gates.append(("coverage-lost", "NOT RUN replaced a %s: coverage lost, not an improvement" % pv))
    for who, row in (("prior", p), ("current", c)):
        if row["verdict"] != "NOT RUN":
            continue
        cs = row.get("cause") or {}
        code = cs.get("code")
        txt = "%s row: %s" % (who, cs.get("text", "not established"))
        if code in ("omitted-by-design", "allowance-interrupted"):
            if rules["gate_omitted_allowance"]:
                gates.append((code, txt))
        elif code == "evidence-reader-unavailable":
            if rules["gate_observer"]:
                gates.append(("observer-changed", txt + " (reader availability differs)"))
        elif code and not lost:
            # a prior NOT RUN row that never got a stimulus or observation cannot anchor an improvement.
            # (for a lost row the gate is coverage-lost; its cause is explained in the reason text)
            if rules["gate_stimulus"]:
                gates.append(("stimulus-not-established", txt))
    if rules["gate_observer"]:
        if out["observer"]["changed_signals"]:
            gates.append(("observer-changed", "; ".join(out["observer"]["changed_signals"])))
        elif packet_differs and not attested:
            gates.append(("observer-unproven", "the harness packet differs between the runs and nothing attests that this row's observer is unchanged"))
    # dedupe by code+text
    seen, g2 = set(), []
    for g in gates:
        if g not in seen:
            seen.add(g)
            g2.append(g)
    out["reasons"] = g2
    if g2:
        out["class"] = "inconclusive"
    else:
        if cv == "PASS":
            out["class"] = "improved"
        elif cv == "FAIL" and pv == "PASS":
            out["class"] = "regressed"
        elif cv == "FAIL":
            out["class"] = "inconclusive"
            out["reasons"].append(("no-prior-verdict", "a new FAIL with no prior verdict is not a regression"))
        elif lost:  # coverage_lost rule disabled (mutation): the classic mistake
            out["class"] = "improved" if pv == "FAIL" else "regressed"
        else:
            out["class"] = "inconclusive"
    _row_reason(out, p, c, packet_differs)
    return out


def _row_reason(out, p, c, packet_differs):
    pv, cv = out["prev"], out["cur"]
    codes = [r[0] for r in out["reasons"]]
    fc = out["fail_class"]
    if cv == "PASS":  # gained: FAIL -> PASS or NOT RUN -> PASS
        if "observer-changed" in codes or "observer-unproven" in codes or packet_differs:
            code = "observer-changed"
        else:
            code = (p.get("cause") or {}).get("code") or "unexplained"
        bits = []
        if p["verdict"] == "NOT RUN":
            bits.append("prior row: " + (p["cause"] or {}).get("text", "not established"))
        if p["verdict"] == "FAIL":
            bits.append("prior FAIL (%s)" % fc.get("previous", {}).get("class", "unclassified"))
        bits += [r[1] for r in out["reasons"] if r[0] in ("observer-changed", "observer-unproven")]
        out["reason_code"], out["reason_text"] = _map_code(code), "; ".join(bits) or "gained"
        return
    if out["kind"] == "lost":
        cs = c.get("cause") or {}
        code = cs.get("code") or "unexplained"
        out["reason_code"] = _map_code(code)
        out["reason_text"] = "current row: %s; prior verdict was %s" % (cs.get("text", "not established"), pv)
        return
    cls = (fc.get("current") or {}).get("class", "unclassified")
    out["reason_code"] = {"product": "product", "harness": "harness", "disputed-oracle": "harness"}.get(cls, "unexplained")
    out["reason_text"] = "current FAIL classified %s" % cls


def _map_code(code):
    return {"omitted-by-design": "omitted-by-design", "allowance-interrupted": "allowance-interrupted",
            "evidence-reader-unavailable": "evidence-reader-unavailable", "setup-blocked": "setup-blocked",
            "observer-changed": "observer-changed", "harness": "harness", "product": "product",
            "blocked-by-error": "product", "case-incomplete": "case-incomplete", "after-fail": "unexplained",
            "interrupted-other": "harness", "not-established": "unexplained"}.get(code, code)


def _journey(cid, pc, cc, ctx, rowres, rules, prev, cur):
    changed = [r for r in rowres if r["kind"] != "same"]
    classes = collections.Counter(r["class"] for r in rowres)
    reasons = list(ctx["gates"])
    for r in changed:
        for g in r["reasons"]:
            if g not in reasons:
                reasons.append(g)
    row_reg = [r for r in rowres if r["class"] == "regressed"]
    row_imp = [r for r in rowres if r["class"] == "improved"]
    row_inc = [r for r in rowres if r["class"] == "inconclusive"]
    if row_reg:
        klass = "regressed"
    elif ctx["gates"] or row_inc:
        klass = "inconclusive"
    elif row_imp:
        klass = "improved"
    else:
        klass = "unchanged"
    pres, cres = (pc or {}).get("result"), (cc or {}).get("result")
    beh = [r for r in rowres if not r["control"] and (r["prev"] in PF or r["cur"] in PF)]
    unresolved = klass == "unchanged" and not beh
    disputed = [r for r in rowres if r["disputed"] and r["kind"] == "same" and r["prev"] == "FAIL"]
    retained = [r for r in rowres if r["prev"] in PF and r["cur"] in PF]
    retained_same = all(r["prev"] == r["cur"] for r in retained)
    def cnt(c):
        t = collections.Counter(r["verdict"] for r in (c["rows"] if c else []))
        return {"PASS": t.get("PASS", 0), "FAIL": t.get("FAIL", 0), "NOT RUN": t.get("NOT RUN", 0), "total": sum(t.values())}
    j = {"id": cid, "prev": pres, "cur": cres, "prev_counts": cnt(pc), "cur_counts": cnt(cc), "class": klass,
         "validity": "valid" if klass in ("improved", "regressed", "unchanged") else "not comparable",
         "reasons": [{"code": a, "text": b} for a, b in reasons], "unresolved": unresolved,
         "disputed_rows": [r["key"] for r in disputed], "retained_rows": len(retained), "retained_same": retained_same,
         "n_changed": len(changed), "n_lost": sum(1 for r in changed if r["kind"] == "lost"),
         "n_gained": sum(1 for r in changed if r["kind"] == "gained"),
         "row_classes": dict(classes), "media": {"prev": (pc or {}).get("plan", {}).get("mediaSha256"), "cur": (cc or {}).get("plan", {}).get("mediaSha256")},
         "title": None}
    return j


def _areas(prev, cur, journeys, traceability):
    tr = traceability or {}
    cat_names = tr.get("category_names") or {}
    related = tr.get("related_journeys") or {}
    jc = {j["id"]: j for j in journeys}
    cur_req = {r["id"]: r for r in cur["requirements"]}
    prev_req = {r["id"]: r for r in prev["requirements"]}
    cats = sorted({r["category"] for r in cur["requirements"] if r["category"]} | {r["category"] for r in prev["requirements"] if r["category"]})
    areas = []
    for cat in cats:
        ids = [r["id"] for r in cur["requirements"] if r["category"] == cat]
        rows = []
        for rid in ids:
            pr, cr = prev_req.get(rid), cur_req.get(rid)
            pv, cv = (pr or {}).get("verdict"), cr["verdict"]
            j = jc.get(rid)
            has = (pv in PF) or (cv in PF)
            if j is not None and has:
                cls = j["class"]
            elif has:
                cls = "unchanged" if pv == cv else "inconclusive"
            else:
                cls = "no-verdict"
            rows.append({"id": rid, "title": cr["title"], "prev": pv, "cur": cv, "class": cls, "has_verdict": has,
                         "journey": rid if j is not None else None})
        verd = [r for r in rows if r["has_verdict"]]
        c = collections.Counter(r["class"] for r in verd)
        if c.get("regressed"):
            klass = "regressed"
        elif c.get("inconclusive"):
            klass = "inconclusive"
        elif c.get("improved"):
            klass = "improved"
        elif c.get("unchanged"):
            klass = "unchanged"
        else:
            klass = "inconclusive"
        prim = [r["journey"] for r in rows if r["journey"]]
        rel = sorted(set(related.get(cat) or []) - set(prim))
        areas.append({"id": cat, "name": cat_names.get(cat), "class": klass, "n_rows": len(rows), "rows": rows,
                      "verdict_rows": len(verd), "journeys": prim, "related_journeys": rel,
                      "no_signal": not verd, "disputed": [r["id"] for r in verd if jc.get(r["id"]) and jc[r["id"]]["disputed_rows"]]})
    return areas


# ---------------------------------------------------------------------------------------------------------------------
# factors, breakdown, fates
# ---------------------------------------------------------------------------------------------------------------------
def build_factors(prev, cur, cmpres, facts):
    facts = facts or {}
    f = []
    pi, ci = prev["identity"], cur["identity"]

    def add(id_, label, p, c, status, known, detail=""):
        f.append({"id": id_, "label": label, "previous": p, "current": c, "status": status, "known": known, "detail": detail})

    add("release", "Served frontend release", short(pi["servedSha"]), short(ci["servedSha"]),
        "differs" if pi["servedSha"] != ci["servedSha"] else "same", "verified by Cloud",
        "%d counted identity reads %s (previous), %d reads %s (current). Full SHAs: %s vs %s" % (
            prev["identity_reads"]["count"], "all MATCH" if prev["identity_reads"]["all_match"] else "NOT all MATCH",
            cur["identity_reads"]["count"], "all MATCH" if cur["identity_reads"]["all_match"] else "NOT all MATCH", pi["servedSha"], ci["servedSha"]))
    bk = facts.get("backend") or {}
    pb, cb = bk.get("previous") or {}, bk.get("current") or {}
    pid, cid_ = pb.get("identity"), cb.get("identity")
    known_b = "owner-stated" if (pb.get("verification") or cb.get("verification")) else "not recorded"
    add("backend", "Backend / deployment state", pb.get("short") or (pid or "not recorded")[:60], cb.get("short") or (cid_ or "not recorded")[:60],
        "unknown" if not (pid and cid_) else ("differs" if pid != cid_ else "same"), known_b,
        "previous: %s [%s]. current: %s [%s]. %s %s" % (pid or "not recorded", pb.get("verification") or "not recorded", cid_ or "not recorded", cb.get("verification") or "not recorded", pb.get("note") or "", cb.get("note") or ""))
    add("harness", "Harness packet / runner code", short(pi["codeManifestSha256"]), short(ci["codeManifestSha256"]),
        "differs" if pi["codeManifestSha256"] != ci["codeManifestSha256"] else "same", "verified (original approval and admission receipts)",
        "reviewed code manifest %s vs %s; step manifest %s vs %s" % (pi["codeManifestSha256"], ci["codeManifestSha256"], short(pi["stepManifestSha256"], 12), short(ci["stepManifestSha256"], 12)))
    drv_same = sum(1 for cid in cur["cases"] if cid in prev["cases"] and prev["cases"][cid]["plan"]["driverSha256"] == cur["cases"][cid]["plan"]["driverSha256"])
    add("drivers", "Per-journey driver file hash", "%d of %d identical" % (drv_same, len(cur["cases"])), "same file" if drv_same == len(cur["cases"]) else "differs",
        "same" if drv_same == len(cur["cases"]) else "differs", "verified (plan binding of each run)",
        "Identical driver hashes do not prove that the shared harness libraries and oracles are identical; see the harness packet row.")
    add("sample", "Sample mode", prev["sample_mode"], cur["sample_mode"], "differs" if prev["sample_mode"] != cur["sample_mode"] else "same", "derived from receipts",
        "Rows marked omittedBy: previous %s; current %s" % (", ".join(prev["omitted_markers"]) or "none", ", ".join(cur["omitted_markers"]) or "none"))
    mdiff = [j["id"] for j in cmpres["journeys"] if j["media"]["prev"] != j["media"]["cur"]]
    pm = sum(1 for c in prev["cases"].values() if c["plan"]["mediaSha256"])
    cm = sum(1 for c in cur["cases"].values() if c["plan"]["mediaSha256"])
    add("media", "Media / capture-device binding", "%d of %d bound" % (pm, len(prev["cases"])), "%d of %d bound" % (cm, len(cur["cases"])),
        "differs" if mdiff else "same", "verified (plan binding and guard media records)",
        ("Differs for %s." % ", ".join(mdiff)) if mdiff else "Identical media binding for every journey.")
    obs_rows = [r for r in cmpres["rows"] if r["observer"]["changed_signals"] and r["kind"] != "same"]
    add("observer", "Observer / oracle", "-", ("%d changed row%s" % (len(obs_rows), "" if len(obs_rows) == 1 else "s")) if obs_rows else "-", "differs" if obs_rows else "same", "derived from receipts and analyst overlay",
        ("Changed on: %s." % ", ".join(r["key"] for r in obs_rows)) if obs_rows else "No changed row shows an observer change.")
    add("allowance", "Per-case request allowance", "per-case allowance" if prev["per_case_allowance"] else "run-level cap only",
        "per-case allowance" if cur["per_case_allowance"] else "run-level cap only",
        "differs" if prev["per_case_allowance"] != cur["per_case_allowance"] else "same", "derived from receipts",
        "Journeys stopped by the allowance: previous %s; current %s" % (
            ", ".join(c["id"] for c in prev["cases"].values() if (c.get("interruption") or {}).get("kind") == "request-allowance") or "none",
            ", ".join(c["id"] for c in cur["cases"].values() if (c.get("interruption") or {}).get("kind") == "request-allowance") or "none"))
    add("window", "Run date", (pi["admissionStartedAt"] or "")[:10], (ci["admissionStartedAt"] or "")[:10],
        "differs" if (pi["admissionStartedAt"] or "")[:10] != (ci["admissionStartedAt"] or "")[:10] else "same", "derived from admission receipts", "")
    for x in facts.get("factors") or []:
        add(x.get("id") or "extra", x.get("label"), x.get("previous"), x.get("current"), x.get("status") or "unknown", x.get("known") or "owner-stated", (x.get("verification") or "") + " " + (x.get("detail") or x.get("source") or ""))
    return f


def prior_fail_fates(cmpres):
    fates = []
    for r in cmpres["rows"]:
        if r["prev"] != "FAIL":
            continue
        if r["cur"] == "FAIL":
            fate = "still FAIL on a disputed oracle" if r["disputed"] else "still FAIL"
        elif r["cur"] == "PASS":
            fate = "now PASS under a changed observer" if r["class"] == "inconclusive" and r["observer"]["changed_signals"] else ("now PASS (valid)" if r["class"] == "improved" else "now PASS (not comparable)")
        else:
            fate = "lost to NOT RUN"
        fates.append({"key": r["key"], "case": r["case"], "id": r["id"], "fate": fate, "cur": r["cur"], "class": r["class"], "reason_code": r["reason_code"]})
    return fates


CANONICAL_BUCKETS = ("PASS: behavioural observation", "PASS: control / bookkeeping row", "FAIL: product failure", "FAIL: harness failure",
                     "FAIL: disputed oracle (not scored)", "FAIL: undetermined (product vs harness)", "FAIL: unclassified (no overlay classification)",
                     "NOT RUN: setup-blocked (stimulus / precondition not established)", "NOT RUN: missing evidence (authorized reader unavailable)",
                     "NOT RUN: deliberately omitted coverage (minimal sample)", "NOT RUN: allowance-interrupted",
                     "NOT RUN: blocked by an observed backend error (cause undiagnosed)", "NOT RUN: not reached after a recorded FAIL",
                     "NOT RUN: case-incomplete bookkeeping row", "NOT RUN: interrupted (harness step failure, not the allowance)", "NOT RUN: not established (no cause recorded)")


def outcome_breakdown(run, rowres, which, facts_overlay=None):
    """Bucket every assertion of one run. which = 'previous' | 'current'."""
    key = "prev" if which == "previous" else "cur"
    buckets = collections.OrderedDict((k, []) for k in CANONICAL_BUCKETS)

    def add(b, r):
        buckets.setdefault(b, []).append(r["key"])
    for r in rowres:
        v = r[key]
        if v is None:
            continue
        if v == "PASS":
            add("PASS: control / bookkeeping row" if r["control"] else "PASS: behavioural observation", r)
        elif v == "FAIL":
            cls = (r["fail_class"].get(which) or {}).get("class", "unclassified")
            label = {"product": "FAIL: product failure", "harness": "FAIL: harness failure", "disputed-oracle": "FAIL: disputed oracle (not scored)",
                     "undetermined": "FAIL: undetermined (product vs harness)"}.get(cls, "FAIL: unclassified (no overlay classification)")
            add(label, r)
        else:
            cs = r["prev_cause"] if which == "previous" else r["cur_cause"]
            code = (cs or {}).get("code") or "not-established"
            label = {"setup-blocked": "NOT RUN: setup-blocked (stimulus / precondition not established)",
                     "evidence-reader-unavailable": "NOT RUN: missing evidence (authorized reader unavailable)",
                     "omitted-by-design": "NOT RUN: deliberately omitted coverage (minimal sample)",
                     "allowance-interrupted": "NOT RUN: allowance-interrupted",
                     "blocked-by-error": "NOT RUN: blocked by an observed backend error (cause undiagnosed)",
                     "after-fail": "NOT RUN: not reached after a recorded FAIL",
                     "case-incomplete": "NOT RUN: case-incomplete bookkeeping row",
                     "interrupted-other": "NOT RUN: interrupted (harness step failure, not the allowance)",
                     "not-established": "NOT RUN: not established (no cause recorded)"}.get(code, "NOT RUN: " + code)
            add(label, r)
    return buckets


def receipts_index_problems(run):
    out = []
    for cid, c in run["cases"].items():
        for p in c["receipt"].get("problems", []):
            out.append("%s: %s" % (cid, p))
        for f in c["receipt"].get("digest_missing", []):
            out.append("%s: referenced evidence file %s is not in the receipts" % (cid, f))
        for f in c["receipt"].get("digest_bad", []):
            out.append("%s: evidence file %s does not match its recorded digest" % (cid, f))
    return out
