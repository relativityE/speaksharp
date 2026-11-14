"""One offline Start-allocation contract for requests, gates and both builder phases.

Hashes bind reviewed protected inputs; they do not confer operational authority.
Errors are closed codes so malformed private input never becomes diagnostic text.
"""
import hashlib
import json
import re
from datetime import datetime


class InputValidationError(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise InputValidationError(code)


CASE_IDS = tuple("AHT-%02d" % n for n in range(1, 16))
FULL_MINIMA = dict(zip(CASE_IDS, (4, 7, 4, 2, 2, 2, 2, 0, 3, 3, 4, 3, 3, 3, 0)))
FULL_TAKES = dict(zip(CASE_IDS, (4, 7, 4, 1, 2, 2, 2, 0, 2, 2, 2, 1, 1, 1, 0)))
MINIMAL_MINIMA = dict(zip(CASE_IDS, (2, 1, 1, 1, 1, 1, 1, 0, 1, 1, 3, 1, 1, 1, 0)))
MODES = {("partial", "minimal"): "minimal", ("partial", "full"): "selected-full", ("smoke", "smoke"): "smoke", ("full", "full"): "full"}
RUNTIMES = ("Claude SpeakSharp R4", "GitHub Actions SpeakSharp")
# The one campaign whose smoke run may select a subset: its admission binds the pinned one-off grant's exact selectedCases
# (init_run_inputs.one_off_grant).
R10_ONE_OFF_RUN_ID = "R10-3b040043-smoke15"


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
    require(mode in ("full", "smoke") or len(selection) <= 6, "selection-count")
    caps = {}
    minimum = MINIMAL_MINIMA if mode in ("minimal", "smoke") else FULL_MINIMA
    for index, row in enumerate(selection):
        obj(row, "selection-row")
        cid = row.get("case")
        require(type(cid) is str and cid in CASE_IDS and cid not in caps, "selection-id")
        require(type(row.get("order")) is int and row["order"] == index + 1, "selection-order")
        cap = integer(row.get("startPressCap"), "selection-cap")
        require(cap >= minimum[cid], "selection-minimum")
        integer(row.get("plannedRequests"), "selection-requests")
        caps[cid] = cap
    if mode == "full" or (mode == "smoke" and r.get("runId") != R10_ONE_OFF_RUN_ID):
        require(tuple(caps) == CASE_IDS, "full-selection")
    elif mode == "smoke":
        # the R10 one-off campaign's selected subset (its admission binds the pinned grant's exact selectedCases); catalog order only
        require(tuple(caps) == tuple(c for c in CASE_IDS if c in caps), "full-selection")
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


# accounting_rollup.G5_KEYS: the dimensions its openReservationsByRequest carries per held reservation (a test pins the equality).
OWN_DIMENSIONS = ("requests", "identityReads", "starts", "takes")


def own_reservation(reconciliation, request_sha256, campaign_id=None):
    """#1772 review 4446137335: THIS request's one open campaign reservation, which the accepted rollup already counts as used, as
    {requests, identityReads, starts, takes} (review 4447628949: all four G5 dimensions, `requests` being the reserved G5 charge of run cap
    plus identity reads); all zero when it holds none. Keyed by the admitted request digest (the reserve's provenance) and the request's own campaign
    (review 4446862226: a Case 10 observation reserve shares the provenance under its own .case10-observation campaign and is never this
    one), so another request's or another campaign's reservation is never returned; two open reservations of the same request and campaign
    are ambiguous and refuse. Every G5 consumer subtracts each dimension once, against its own counter."""
    rc = obj(reconciliation, "reconciliation-object")
    none = {k: 0 for k in OWN_DIMENSIONS}
    if request_sha256 is None or "openReservationsByRequest" not in rc:
        return none
    require(isinstance(campaign_id, str) and campaign_id, "own-reservation-campaign")
    by_campaign = obj(rc["openReservationsByRequest"], "reconciliation-open-reservations").get(request_sha256)
    if by_campaign is None:
        return none
    held = obj(by_campaign, "reconciliation-own-reservation").get(campaign_id)
    if held is None:
        return none
    held = obj(held, "reconciliation-own-reservation")
    require(integer(held.get("count"), "own-reservation-count") == 1, "own-reservation-ambiguous")
    return {k: integer(held.get(k), "own-reservation-" + k) for k in OWN_DIMENSIONS}


def reconcile_caps(request, reconciliation, *, execution=False, request_sha256=None):
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
    # The run's own already-counted reservation is replaced by its ask below, never charged twice (own_reservation).
    own = own_reservation(rc, request_sha256, request.get("runId"))["starts"]
    require(own <= used, "own-reservation-exceeds-counted")
    used -= own
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
    mode, caps = reconcile_caps(r, rc, execution=True, request_sha256=request_sha)
    approval = obj(obj(facts, "facts-object").get("actionApproval"), "action-approval")
    require(approval.get("schema") == "speaksharp.case-start-approval.v1", "action-schema")
    require(approval.get("requestSha256") == request_sha and approval.get("reconciliationSha256") == rc_sha, "action-digests")
    for key in ("approvalRef", "approvedBy"):
        require(text(approval.get(key), "action-reference") == text(r["approvedLimits"].get(key), "request-reference"), "action-reference-differs")
    require(text(approval.get("selectionApprovalRef"), "action-selection") == text(r.get("selectionApprovalRef"), "request-selection"), "action-selection-differs")
    require(env.get("BP_MODE") == mode, "mode-binding")
    require(env.get("BP_RUNTIME", RUNTIMES[0]) == r.get("executionRuntime", RUNTIMES[0]), "runtime-binding")
    for key, value in (("BP_CAMPAIGN", r["runId"]), ("BP_SOURCE_SHA", r["release"]["testedSha"]),
                       ("BP_T0", r["window"]["startUtc"]),
                       ("BP_SELECT_REF", r["selectionApprovalRef"]),
                       ("BP_SELECT", ",".join(str(int(cid[-2:])) for cid in caps))):
        require(env.get(key) == value, "environment-binding")
    # BP_T1 is the run's one execution deadline (init_run_inputs.execution_deadline via run_env.py), never later than the occurrence end.
    require(isinstance(env.get("BP_T1"), str) and utc(r["window"]["startUtc"]) < utc(env["BP_T1"]) <= utc(r["window"]["endUtc"]),
            "environment-binding")
    require(not env.get("BP_PRESS_EXTRA"), "press-extra-forbidden")
    return {"request": r, "reconciliation": rc, "mode": mode, "caps": caps,
            "requestSha256": request_sha, "reconciliationSha256": rc_sha, "approval": approval}


def case10_execution_bound(request, facts, account_id, request_sha256=None, run_id=None, now=None):
    """Verify the selected Case 10 projection without allocating more requests.

    The runtime ledger still charges every transmitted request and stops at the
    unchanged allowance of 240. This binds the component sum to the admitted
    request, source, account and exact projection bytes before builder output.
    A row that pins an observationContract (nightly design A) takes ONLY a fresh
    current-state observation, admitted by case10_observation for this request
    digest, run, attempt 1 and time; the legacy record is then refused.
    """
    selected = [row for row in request["selection"] if row["case"] == "AHT-10"]
    if not selected or request["sampleMode"] in ("minimal", "smoke"):
        return None
    row = selected[0]
    if "observationContract" in row:
        require("case10RequestBound" not in facts, "case10-observation-two-sources")
        record = obj(facts.get("case10Observation"), "case10-observation-missing")
        require(type(request_sha256) is str and type(run_id) is str and type(now) is str, "case10-observation-binding")
        import case10_observation
        try:
            report = case10_observation.admit(record, request, request_sha256, run_id, 1, account_id, utc(now))
        except case10_observation.Refused as e:
            raise InputValidationError(str(e)) from None
        return {"projectionSha256": report["recordSha256"], "transmittedBound": report["transmittedBound"],
                "allowance": report["allowance"], "evidenceRef": "case10-observation:" + report["recordSha256"]}
    require("case10Observation" not in facts, "case10-observation-not-applicable")
    record = obj(facts.get("case10RequestBound"), "case10-bound-missing")
    require(set(record) == {"schema", "runId", "sourceSha", "accountSubjectSha256", "evidenceRef", "projection"},
            "case10-bound-shape")
    require(record["schema"] == "speaksharp.cloud-test.case10-projection.v1", "case10-bound-schema")
    require(record["runId"] == request["runId"] and record["sourceSha"] == request["release"]["testedSha"],
            "case10-bound-identity")
    require(record["accountSubjectSha256"] == hashlib.sha256(account_id.encode("utf-8")).hexdigest(),
            "case10-bound-account")
    require(type(record["evidenceRef"]) is str
            and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:/-]{1,199}", record["evidenceRef"]),
            "case10-bound-evidence")
    encoded = json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    require(row.get("requestBoundSha256") == hashlib.sha256(encoded).hexdigest(), "case10-bound-digest")
    from case10_request_bound import ALLOWANCE, BoundRefused, compute
    try:
        report = compute(record["projection"])
    except BoundRefused:
        raise InputValidationError("case10-bound-projection") from None
    planned = integer(row.get("plannedRequests"), "case10-bound-planned")
    require(report["transmittedBound"] <= planned <= ALLOWANCE and report["fitsAllowance"],
            "case10-bound-over-allowance")
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
