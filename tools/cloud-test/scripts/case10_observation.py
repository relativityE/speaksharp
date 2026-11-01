"""Case 10 nightly current-state observation (Sam 1793570217.800529, design A). INACTIVE: no reader is trusted today.

A nightly occurrence's Case 10 projection must come from a fresh read of the bound account's current state, never a historical projection
relabelled with a new runId. The admitted request's AHT-10 row pins the observation contract (reader, record schema, allowed projection keys,
freshness). observe() asks a READER for the projection and binds it to the admitted request digest, campaign/run/attempt, source, account
and observation time; admit() is the check prepare applies (the builder applies its own variant). Only synthetic readers exist here: no
credentials, no network and no live read. reserve_then_read() (Sam 1793570557.244339) reserves the read's pinned budget on the SAME
state-ref journal through the reviewed writer's propose BEFORE invoking any reader; a failed or partial read leaves that reservation open,
so the accepted rollup keeps counting it.
"""
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline: every network call fails and is counted)
from case10_request_bound import ALLOWANCE, INPUTS, BoundRefused, compute  # noqa: E402
import state_ref_writer as W  # noqa: E402

CONTRACT_SCHEMA = "speaksharp.cloud-test.case10-observation-contract.v1"
RECORD_SCHEMA = "speaksharp.cloud-test.case10-observation.v1"
CONTRACT_KEYS = {"schema", "reader", "recordSchema", "projectionKeys", "maxAgeSeconds", "readBudget"}
# The observation's own reservation key: distinct from the run's reservation (campaignId = the request runId) on the same journal.
RESERVATION_SUFFIX = ".case10-observation"
MAX_READ_BUDGET = {"requests": 50, "identityReads": 2}
RECORD_KEYS = {"schema", "requestSha256", "campaignId", "runId", "attempt", "sourceSha", "accountSubjectSha256", "reader", "observedAtUtc",
               "projection"}
# The reviewed reader identities. EMPTY today, so admit() refuses every record in production until a reviewed reader is pinned.
TRUSTED_READERS = frozenset()
MAX_AGE_SECONDS = 3600
READER_ID = re.compile(r"[a-z0-9][a-z0-9.:@/-]{2,99}")
SHA40 = re.compile(r"[0-9a-f]{40}")
SHA64 = re.compile(r"[0-9a-f]{64}")


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def _utc(value, code):
    _need(isinstance(value, str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value) is not None, code)
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def canon(doc):
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def contract_of(req):
    """The observation contract the admitted request pins on its AHT-10 row: exactly the full projection input set, bounded freshness."""
    rows = [r for r in (req.get("selection") or []) if isinstance(r, dict) and r.get("case") == "AHT-10"]
    _need(len(rows) == 1, "case10-observation-not-selected")
    c = rows[0].get("observationContract")
    _need(isinstance(c, dict) and set(c) == CONTRACT_KEYS and c["schema"] == CONTRACT_SCHEMA and c["recordSchema"] == RECORD_SCHEMA
          and isinstance(c["reader"], str) and READER_ID.fullmatch(c["reader"]) is not None
          and c["projectionKeys"] == sorted(INPUTS) and type(c["maxAgeSeconds"]) is int and 0 < c["maxAgeSeconds"] <= MAX_AGE_SECONDS
          and isinstance(c["readBudget"], dict) and set(c["readBudget"]) == set(MAX_READ_BUDGET)
          and all(type(v) is int and 0 < v <= MAX_READ_BUDGET[k] for k, v in c["readBudget"].items()), "case10-observation-contract")
    return c


def observe(reader, req, request_sha256, run_id, attempt, account_id, now):
    """One read through `reader` (a callable given the allowed projection keys), bound to this admitted request and attempt."""
    c = contract_of(req)
    _need(isinstance(request_sha256, str) and SHA64.fullmatch(request_sha256) is not None, "case10-observation-request")
    return {"schema": RECORD_SCHEMA, "requestSha256": request_sha256, "campaignId": req["runId"], "runId": run_id, "attempt": attempt,
            "sourceSha": req["release"]["testedSha"], "accountSubjectSha256": hashlib.sha256(account_id.encode("utf-8")).hexdigest(),
            "reader": c["reader"], "observedAtUtc": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "projection": reader(list(c["projectionKeys"]))}


def admit(record, req, request_sha256, run_id, attempt, account_id, now, trusted=None):
    """Admits a record only from a trusted reader, for exactly this request, campaign, run, attempt, source and account, observed inside
    this run's window and within the contract's freshness, with exactly the allowed projection, whose bound fits the Case 10 row and the
    fixed 240 allowance. `trusted` is TEST-ONLY; production uses TRUSTED_READERS (empty today)."""
    c = contract_of(req)
    _need(c["reader"] in (TRUSTED_READERS if trusted is None else trusted), "case10-observation-reader-not-trusted")
    _need(isinstance(record, dict) and set(record) == RECORD_KEYS and record["schema"] == RECORD_SCHEMA, "case10-observation-shape")
    _need(record["reader"] == c["reader"], "case10-observation-foreign")
    _need(record["requestSha256"] == request_sha256, "case10-observation-not-this-request")
    _need(record["campaignId"] == req["runId"] and record["runId"] == run_id and type(record["attempt"]) is int
          and record["attempt"] == attempt == 1, "case10-observation-replayed")
    _need(isinstance(record["sourceSha"], str) and SHA40.fullmatch(record["sourceSha"]) is not None
          and record["sourceSha"] == req["release"]["testedSha"]
          and record["accountSubjectSha256"] == hashlib.sha256(account_id.encode("utf-8")).hexdigest(), "case10-observation-foreign")
    observed = _utc(record["observedAtUtc"], "case10-observation-time")
    _need(_utc(req["window"]["startUtc"], "case10-observation-time") <= observed <= now
          and now - observed <= timedelta(seconds=c["maxAgeSeconds"]), "case10-observation-stale")
    _need(isinstance(record["projection"], dict) and sorted(record["projection"]) == c["projectionKeys"], "case10-observation-projection")
    try:
        report = compute(record["projection"])
    except BoundRefused:
        raise Refused("case10-observation-projection")
    row = next(r for r in req["selection"] if r["case"] == "AHT-10")
    planned = row.get("plannedRequests")
    _need(type(planned) is int and report["fitsAllowance"] and report["transmittedBound"] <= planned <= ALLOWANCE,
          "case10-observation-over-allowance")
    return {"recordSha256": hashlib.sha256(canon(record)).hexdigest(), "transmittedBound": report["transmittedBound"], "allowance": ALLOWANCE}


def reservation_event(req, request_sha256, run_id, attempt, now):
    """The observation's reserve: the contract's pinned read budget, keyed apart from the run's own reservation, provenance = the request."""
    c = contract_of(req)
    allocation = {k: 0 for k in W.CATS}
    allocation.update(c["readBudget"])
    event = {"type": "reserve", "campaignId": req["runId"] + RESERVATION_SUFFIX, "runId": run_id, "attempt": attempt, "allocation": allocation,
             "provenance": "request-sha256:" + request_sha256, "atUtc": now.strftime("%Y-%m-%dT%H:%M:%SZ")}
    try:
        return W.validate_event(event)
    except W.Refused:
        raise Refused("case10-observation-reservation-shape")


def reserve_then_read(reader, propose, headroom, req, request_sha256, run_id, attempt, account_id, now):
    """Reserve BEFORE read. `propose` is the reviewed writer's journaled propose bound to the same state-ref journal the continuity checkpoint
    verifies (state_ref_writer.propose: an exact expected-head lease, reconciled against persisted history); it returns a receipt only once
    the reserve has landed. `headroom` is the accepted rollup's current headroom at that head. No receipt for exactly this event, no read.
    A reader failure after the reserve raises with the reservation still open, so the rollup keeps counting it."""
    event = reservation_event(req, request_sha256, run_id, attempt, now)
    _need(isinstance(headroom, dict) and all(type(headroom.get(k)) is int and headroom[k] >= v for k, v in contract_of(req)["readBudget"].items()),
          "case10-observation-no-headroom")
    try:
        receipt = propose(event)
    except Exception:  # any writer refusal or transport failure: the read never happens
        raise Refused("case10-observation-reserve-failed")
    _need(isinstance(receipt, dict) and set(receipt) == W.RECEIPT_KEYS and receipt["proposalSha256"] == W.sha256(W.canon(event)),
          "case10-observation-reserve-not-accepted")
    try:
        record = observe(reader, req, request_sha256, run_id, attempt, account_id, now)
    except Refused:
        raise
    except Exception:
        raise Refused("case10-observation-read-failed")
    return record, event, receipt
