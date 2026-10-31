"""One offline Start-allocation contract for requests, gates and both builder phases.

Hashes bind reviewed protected inputs; they do not confer operational authority.
Errors are closed codes so malformed private input never becomes diagnostic text.
"""
import hashlib
import json
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: E402,F401 -- every control-plane script keeps the existing fail-closed network guard


class InputValidationError(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise InputValidationError(code)


CASE_IDS = tuple("AHT-%02d" % n for n in range(1, 16))
FULL_MINIMA = dict(zip(CASE_IDS, (4, 7, 4, 2, 2, 2, 2, 0, 3, 3, 4, 3, 3, 3, 0)))
FULL_TAKES = dict(zip(CASE_IDS, (4, 7, 4, 1, 2, 2, 2, 0, 2, 2, 2, 1, 1, 1, 0)))
MINIMAL_MINIMA = dict(zip(CASE_IDS, (2, 1, 1, 1, 1, 1, 1, 0, 1, 1, 3, 1, 1, 1, 0)))
MODES = {("partial", "minimal"): "minimal", ("partial", "full"): "selected-full", ("full", "full"): "full"}
RUNTIMES = ("Claude SpeakSharp R4", "GitHub Actions SpeakSharp")


def obj(value, code):
    require(type(value) is dict, code)
    return value


def integer(value, code):
    require(type(value) is int and value >= 0, code)
    return value


def text(value, code):
    require(type(value) is str and bool(value.strip()), code)
    return value


def utc(value):
    text(value, "window")
    require(re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z", value), "window")
    return datetime.fromisoformat(value[:-1] + "+00:00")


def request_caps(request, *, execution=False):
    r = obj(request, "request-object")
    require(r.get("schema") == "speaksharp.cloud-test.run-request.v2", "request-schema")
    mode = MODES.get((r.get("coverageMode"), r.get("sampleMode")))
    require(mode is not None, "mode-pair")
    require(r.get("executionRuntime", RUNTIMES[0]) in RUNTIMES, "runtime")
    for k in ("estimate", "proposedLimits", "approvedLimits", "window", "release", "harness"):
        obj(r.get(k), "request-" + k)
    est, proposed, approved = r["estimate"], r["proposedLimits"], r["approvedLimits"]
    for k in ("requests", "providerBillableRequests"):
        obj(est.get(k), "estimate-" + k)
    for parent, key in ((est, "window"), (proposed, "guardCaps"), (r["release"], "backend")):
        if key in parent:
            obj(parent[key], "optional-" + key)
    selection = r.get("selection")
    require(type(selection) is list and len(selection) > 0, "selection")
    require(mode == "full" or len(selection) <= 6, "selection-count")
    caps = {}
    minimum = MINIMAL_MINIMA if mode == "minimal" else FULL_MINIMA
    for index, row in enumerate(selection):
        obj(row, "selection-row")
        cid = row.get("case")
        require(type(cid) is str and cid in CASE_IDS and cid not in caps, "selection-id")
        require(type(row.get("order")) is int and row["order"] == index + 1, "selection-order")
        cap = integer(row.get("startPressCap"), "selection-cap")
        require(cap >= minimum[cid], "selection-minimum")
        integer(row.get("plannedRequests"), "selection-requests")
        caps[cid] = cap
    if mode == "full":
        require(tuple(caps) == CASE_IDS, "full-selection")
    for name, group in (("proposed", proposed), ("approved", approved)):
        value = group.get("startPressCaps")
        if name == "approved" and value is None and not execution:
            continue
        obj(value, name + "-caps")
        require(set(value) == set(caps), name + "-cap-keys")
        for cid, cap in value.items():
            integer(cap, name + "-cap-integer")
            require(cap == caps[cid], name + "-cap-differs")
    require(integer(est.get("starts"), "estimate-starts") == sum(caps.values()), "estimate-starts-sum")
    text(r.get("runId"), "campaign")
    if execution:
        require(type(r["release"].get("testedSha")) is str and re.fullmatch(r"[0-9a-f]{40}", r["release"]["testedSha"]), "source")
    win = r["window"]
    if execution or (win.get("startUtc") is not None and win.get("endUtc") is not None):
        require(utc(win.get("startUtc")) < utc(win.get("endUtc")), "window-order")
    return mode, caps


def reconcile_caps(request, reconciliation, *, execution=False):
    mode, caps = request_caps(request, execution=execution)
    rc = obj(reconciliation, "reconciliation-object")
    starts = obj(rc.get("starts"), "reconciliation-starts")
    ceilings = obj(rc.get("ceilings"), "reconciliation-ceilings")
    for key in ("requests", "identityReads", "takes"):
        if key in rc:
            group = obj(rc[key], "reconciliation-" + key)
            for name in ("ownerCounted", "conservativeUsed"):
                if name in group:
                    integer(group[name], "reconciliation-counter")
    for value in ceilings.values():
        integer(value, "reconciliation-ceiling")
    used = integer(starts.get("ownerCounted"), "starts-used")
    current = integer(ceilings.get("starts"), "starts-ceiling")
    cap = request["approvedLimits"].get("startsCap")
    # A proposal can request a separately justified ceiling; validation is not
    # permission to execute it. Actual execution never falls back to proposed.
    if cap is None and not execution:
        cap = request["proposedLimits"].get("startsCap")
    if cap is None:
        cap = current
    cap = integer(cap, "approved-starts-ceiling")
    require(used + sum(caps.values()) <= cap, "cumulative-starts")
    return mode, caps


def read_json(path):
    with open(path, "rb") as source:
        raw = source.read()
    return json.loads(raw.decode("utf-8")), hashlib.sha256(raw).hexdigest()


def bind_inputs(env, facts):
    r, request_sha = read_json(text(env.get("BP_REQUEST_FILE"), "request-file"))
    rc, rc_sha = read_json(text(env.get("BP_RECONCILIATION_FILE"), "reconciliation-file"))
    require(request_sha == env.get("BP_REQUEST_SHA256"), "request-digest")
    require(rc_sha == env.get("BP_RECONCILIATION_SHA256"), "reconciliation-digest")
    mode, caps = reconcile_caps(r, rc, execution=True)
    approval = obj(obj(facts, "facts-object").get("actionApproval"), "action-approval")
    require(approval.get("schema") == "speaksharp.case-start-approval.v1", "action-schema")
    require(approval.get("requestSha256") == request_sha and approval.get("reconciliationSha256") == rc_sha, "action-digests")
    for key in ("approvalRef", "approvedBy"):
        require(text(approval.get(key), "action-reference") == text(r["approvedLimits"].get(key), "request-reference"), "action-reference-differs")
    require(text(approval.get("selectionApprovalRef"), "action-selection") == text(r.get("selectionApprovalRef"), "request-selection"), "action-selection-differs")
    require(env.get("BP_MODE") == mode, "mode-binding")
    require(env.get("BP_RUNTIME", RUNTIMES[0]) == r.get("executionRuntime", RUNTIMES[0]), "runtime-binding")
    for key, value in (("BP_CAMPAIGN", r["runId"]), ("BP_SOURCE_SHA", r["release"]["testedSha"]),
                       ("BP_T0", r["window"]["startUtc"]), ("BP_T1", r["window"]["endUtc"]),
                       ("BP_SELECT_REF", r["selectionApprovalRef"]),
                       ("BP_SELECT", ",".join(str(int(cid[-2:])) for cid in caps))):
        require(env.get(key) == value, "environment-binding")
    require(not env.get("BP_PRESS_EXTRA"), "press-extra-forbidden")
    return {"request": r, "reconciliation": rc, "mode": mode, "caps": caps,
            "requestSha256": request_sha, "reconciliationSha256": rc_sha, "approval": approval}


def case10_execution_bound(request, facts, account_id):
    """Admit the selected projection, never allocate more requests or infer missing facts.

    This is a bound for the reviewed schedule, not a prediction of future traffic.
    The runtime ledger still charges every actual attempt and stops at 240.
    The projection digest is inside the approved request, so replacing only the
    facts file cannot substitute a different account, schedule or component sum.
    """
    selected = [row for row in request["selection"] if row["case"] == "AHT-10"]
    if not selected or request["sampleMode"] == "minimal":
        return None
    row = selected[0]
    record = obj(facts.get("case10RequestBound"), "case10-bound-missing")
    require(set(record) == {"schema", "runId", "sourceSha", "accountSubjectSha256", "evidenceRef", "projection"}, "case10-bound-shape")
    require(record["schema"] == "speaksharp.cloud-test.case10-projection.v1", "case10-bound-schema")
    require(record["runId"] == request["runId"] and record["sourceSha"] == request["release"]["testedSha"], "case10-bound-identity")
    require(record["accountSubjectSha256"] == hashlib.sha256(account_id.encode("utf-8")).hexdigest(), "case10-bound-account")
    require(type(record["evidenceRef"]) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:/-]{1,199}", record["evidenceRef"]), "case10-bound-evidence")
    encoded = json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    require(row.get("requestBoundSha256") == hashlib.sha256(encoded).hexdigest(), "case10-bound-digest")
    from case10_request_bound import compute, BoundRefused, ALLOWANCE
    try:
        report = compute(record["projection"])
    except BoundRefused:
        raise InputValidationError("case10-bound-projection") from None
    planned = integer(row.get("plannedRequests"), "case10-bound-planned")
    require(report["transmittedBound"] <= planned <= ALLOWANCE and report["fitsAllowance"], "case10-bound-over-allowance")
    return {"projectionSha256": row["requestBoundSha256"], "transmittedBound": report["transmittedBound"],
            "allowance": ALLOWANCE, "evidenceRef": record["evidenceRef"]}


def verified_contracts(value):
    rows = obj(value, "contracts-object").get("cases") if type(value) is dict else value
    require(type(rows) is list, "contracts-cases")
    result = {}
    for row in rows:
        obj(row, "contract-row")
        cid = row.get("caseId")
        require(type(cid) is str and cid in CASE_IDS and cid not in result, "contract-id")
        require(integer(row.get("requiredStartPressCap"), "contract-minimum") == FULL_MINIMA[cid], "contract-minimum-differs")
        require(integer(row.get("minimumAuthorizedStartPresses"), "contract-minimum") == FULL_MINIMA[cid], "contract-minimum-differs")
        require(integer(row.get("minimumAuthorizedTakes"), "contract-takes") == FULL_TAKES[cid], "contract-takes-differs")
        require(integer(row.get("requiredTakeCap"), "contract-takes") == FULL_TAKES[cid], "contract-takes-differs")
        assertions = row.get("requiredAssertions")
        require(type(assertions) is list and all(type(a) is str and a for a in assertions)
                and len(assertions) == len(set(assertions)), "contract-assertions")
        result[cid] = row
    require(set(result) == set(CASE_IDS), "contracts-incomplete")
    return result
