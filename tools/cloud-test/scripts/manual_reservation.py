#!/usr/bin/env python3
"""Manual-dispatch reservation integration (Sam 1793556225.890759, RETURN 1793556820.561729): the reserve / settle / release events a MANUAL
(non-nightly) run would append to the state-ref journal, so the accepted rollup counts it. SOURCE ONLY and not wired into any workflow: the
writer is not activated (REVIEWED_ROOT is None), and no bootstrap or period scope is accepted, so nothing here can append today. Nightly
runs keep their own path (reservations.py); this module refuses them.

  reserve   identity {campaignId: the request runId, runId: GITHUB_RUN_ID, attempt 1}, `request-sha256:` provenance. The allocation is the
            ADMITTED request's caps (reservations.caps_of_request on exactly the admitted bytes), with `requests` holding G5's request CHARGE:
            the run cap PLUS the identity reads (check_gates.py G5 charges both against the request ceiling), so an open reservation counts
            exactly what G5 would charge. An unknown cap refuses, never 0. Admission needs every G5 dimension within the headroom of the
            accepted rollup recomputed at the same chain head the reserve is appended on.
  settle    closes the reservation from the collector's run-record BYTES: their digest is the `evidence-sha256:` provenance, and their
            execution identity and admitted request must be the reservation's. Measured requests already include identity reads, so they
            count as measured. A dimension the record does not measure settles at its reserved cap (never under-counted); an actual above
            the reservation refuses, leaving the reservation open and counted.
  release   returns exactly the reservation, under an owner approval reference, only for a run that never started. The integrated path
            refuses every release until a verifier of never-started evidence exists (`started=False` alone is not evidence).
  execute   the integrated path: accepted scope BYTES (pinned digest, not a nonempty approvalRef), the chain verified from the accepted root,
            the rollup recomputed at that head, the reserve AND the settle inside the approved period BEFORE they are appended (a late
            settle is refused and the reservation stays held until an explicit cross-period disposition), and settle finding its
            reservation ON the chain; then the writer's journaled propose.
  CLI       refuses `manual-reservation-not-activated` before reading any input until the writer root, the accepted bootstrap and the
            accepted scope are pinned to the same journal.
Exit 78 on every refusal; no value is printed.
"""
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline)
import accounting_rollup  # noqa: E402
import state_ref_writer  # noqa: E402
from reservations import CATS, caps_of_request  # noqa: E402

G5_KEYS = ("requests", "identityReads", "starts", "takes")
SHA256 = re.compile(r"[0-9a-f]{64}")
APPROVAL = re.compile(r"slack-[0-9]{10}\.[0-9]{6}")
RUN_RECORD_SCHEMA = "speaksharp.cloud-test.run-record.v1"
# The independently accepted period-scope bytes, pinned by a reviewed change together with the bootstrap and the writer root. None today.
ACCEPTED_SCOPE_SHA256 = None


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def _event(kind, identity, allocation, provenance, at_utc):
    e = {"type": kind, "campaignId": identity["campaignId"], "runId": identity["runId"], "attempt": identity["attempt"],
         "allocation": dict(allocation), "provenance": provenance, "atUtc": at_utc}
    try:
        return state_ref_writer.validate_event(e)
    except state_ref_writer.Refused as err:
        raise Refused("manual-reservation-" + str(err))


def manual_request(request_raw, admitted_sha256):
    """The admitted request bytes, a manual priority, and every cap a known non-negative integer. Returns (request, allocation) with
    `requests` as G5's charge: run cap + identity reads."""
    _need(isinstance(request_raw, bytes) and isinstance(admitted_sha256, str) and SHA256.fullmatch(admitted_sha256)
          and hashlib.sha256(request_raw).hexdigest() == admitted_sha256, "manual-reservation-request-not-admitted")
    try:
        req = json.loads(request_raw)
    except ValueError:
        raise Refused("manual-reservation-request-unreadable")
    _need(isinstance(req, dict) and isinstance(req.get("priority"), str), "manual-reservation-request-unreadable")
    _need(req["priority"] != "nightly-regression", "manual-reservation-nightly")
    caps = caps_of_request(req)
    _need(all(type(caps[k]) is int and caps[k] >= 0 for k in CATS), "manual-reservation-caps-unknown")
    return req, dict(caps, requests=caps["requests"] + caps["identityReads"])


def reserve(request_raw, admitted_sha256, github_run_id, rollup, expected_head, at_utc):
    """The reserve event, or a refusal. `rollup` is accounting_rollup.receive output recomputed at `expected_head`, the head the reserve will
    be appended on."""
    req, allocation = manual_request(request_raw, admitted_sha256)
    _need(isinstance(rollup, dict) and rollup.get("source") == "accepted-rollup", "manual-reservation-rollup")
    _need(isinstance(expected_head, str) and rollup.get("headSha") == expected_head, "manual-reservation-rollup-stale")
    room = rollup.get("currentHeadroom")
    _need(isinstance(room, dict) and all(type(room.get(k)) is int for k in G5_KEYS), "manual-reservation-rollup")
    _need(all(allocation[k] <= room[k] for k in G5_KEYS), "manual-reservation-exceeds-headroom")
    identity = {"campaignId": req.get("runId"), "runId": github_run_id, "attempt": 1}
    return _event("reserve", identity, allocation, "request-sha256:" + admitted_sha256, at_utc)


def _identity(reserved):
    _need(isinstance(reserved, dict) and reserved.get("type") == "reserve", "manual-reservation-not-reserved")
    try:
        state_ref_writer.validate_event(reserved)
    except state_ref_writer.Refused as err:
        raise Refused("manual-reservation-" + str(err))
    return {k: reserved[k] for k in ("campaignId", "runId", "attempt")}


def settle(reserved, usage, evidence_sha256, at_utc):
    """`usage` is the run's measured usage per category: a non-negative integer, or None when not measured."""
    identity = _identity(reserved)
    _need(isinstance(usage, dict) and set(usage) == set(CATS)
          and all(v is None or (type(v) is int and v >= 0) for v in usage.values()), "manual-settle-usage")
    _need(isinstance(evidence_sha256, str) and SHA256.fullmatch(evidence_sha256) is not None, "manual-settle-evidence")
    held = reserved["allocation"]
    _need(all(usage[k] is None or usage[k] <= held[k] for k in CATS), "manual-settle-exceeds-reservation")
    allocation = {k: held[k] if usage[k] is None else usage[k] for k in CATS}
    return _event("settle", identity, allocation, "evidence-sha256:" + evidence_sha256, at_utc)


def usage_from_record(record_raw, reserved):
    """(usage, evidence sha256) from the collector's run-record BYTES, bound to the reservation: the record's campaign, its execution
    provenance's campaign/run/attempt and admitted request digest must all be the reservation's. Only what the record measures is used;
    coaching requests and runner minutes are not measured there and stay None (settled at the reserved cap)."""
    identity = _identity(reserved)
    _need(isinstance(record_raw, bytes), "manual-settle-record")
    try:
        rec = json.loads(record_raw)
    except ValueError:
        raise Refused("manual-settle-record")
    _need(isinstance(rec, dict) and rec.get("schema") == RUN_RECORD_SCHEMA and rec.get("runId") == identity["campaignId"], "manual-settle-record")
    prov = rec.get("executionProvenance")
    _need(isinstance(prov, dict) and prov.get("campaignId") == identity["campaignId"] and prov.get("runId") == identity["runId"]
          and type(prov.get("attempt")) is int and prov["attempt"] == identity["attempt"]
          and "request-sha256:" + str(prov.get("requestSha256")) == reserved["provenance"], "manual-settle-record-identity")
    spend = rec.get("spend")
    _need(isinstance(spend, dict), "manual-settle-record")
    usage = {k: None for k in CATS}
    for k in G5_KEYS:
        v = spend.get(k)
        _need(v is None or (type(v) is int and v >= 0), "manual-settle-usage")
        usage[k] = v
    return usage, hashlib.sha256(record_raw).hexdigest()


def release(reserved, started, approval_ref, at_utc):
    """The release event for a run that never started; an owner approval reference (slack-<ts>) is required. The integrated path does not
    call this until never-started evidence can be verified."""
    identity = _identity(reserved)
    _need(started is False, "manual-release-run-started")
    _need(isinstance(approval_ref, str) and APPROVAL.fullmatch(approval_ref) is not None, "manual-release-approval")
    return _event("release", identity, reserved["allocation"], "approval:" + approval_ref, at_utc)


def _reserved_on_chain(chain, campaign_id, run_id):
    """The reserve event for this identity, read from the VERIFIED chain (never from a file the caller hands over)."""
    found = [e for e in chain[-1][1] if e["type"] == "reserve" and (e["campaignId"], e["runId"], e["attempt"]) == (campaign_id, run_id, 1)]
    _need(len(found) == 1, "manual-reservation-not-reserved")
    return found[0]


def accepted_scope(scope_raw, accepted_scope_sha256):
    """The period scope from its independently accepted BYTES (a pinned digest), parsed by the rollup's own scope parser."""
    _need(accepted_scope_sha256 is not None, "manual-reservation-scope-not-accepted")
    _need(isinstance(scope_raw, bytes) and hashlib.sha256(scope_raw).hexdigest() == accepted_scope_sha256, "manual-reservation-scope-not-accepted")
    try:
        return accounting_rollup.parse_scope(json.loads(scope_raw))
    except ValueError:
        raise Refused("manual-reservation-scope-not-accepted")


def _in_period(scope, at_utc, code):
    """The transition's time is inside the accepted period, checked BEFORE the append (the rollup refuses any event outside it)."""
    _need(accounting_rollup._utc(scope["periodStartUtc"]) <= accounting_rollup._utc(at_utc) < accounting_rollup._utc(scope["periodEndUtc"]), code)


def execute(command, inputs, repo, url, root, journal, out, pins, approved_url=state_ref_writer.APPROVED_URL):
    """One manual transition on the state ref; returns the appended event. `pins` holds the accepted bootstrap digest, its root and the
    accepted scope digest; `root` must be that accepted root, so the journal appended to is the one the rollup reads."""
    _need(root is not None and root == pins.get("accepted_root"), "manual-reservation-root-mismatch")
    _need(command != "release", "manual-release-never-started-unverified")
    try:
        head = state_ref_writer.fetch_head(repo, url, approved_url)
        chain = state_ref_writer.validate_chain(repo, head, root)
        scope = accepted_scope(inputs["scope"], pins.get("accepted_scope_sha256"))
        if command == "reserve":
            _in_period(scope, inputs["atUtc"], "manual-reservation-outside-period")
            request, allocation = manual_request(inputs["request"], inputs["admittedSha256"])
            event = _event("reserve", {"campaignId": request.get("runId"), "runId": inputs["runId"], "attempt": 1}, allocation,
                           "request-sha256:" + inputs["admittedSha256"], inputs["atUtc"])
        else:
            _need(command == "settle", "manual-reservation-command")
            # Sam 1793557361.926929: a late settle is refused before the append; the reservation stays held (counted at its caps) until an
            # explicit cross-period disposition.
            _in_period(scope, inputs["atUtc"], "manual-settle-outside-period")
            reserved = _reserved_on_chain(chain, inputs["campaignId"], inputs["runId"])
            usage, evidence = usage_from_record(inputs["record"], reserved)
            event = settle(reserved, usage, evidence, inputs["atUtc"])
        # A retry after the remote accepted the transition must recover the
        # original receipt, not construct a duplicate transition at the new
        # head.  The exact event and its sole parent are recovered only from
        # the verified append-only chain.
        matches = [(index, row) for index, (_, rows, _) in enumerate(chain) for row in rows[-1:]
                   if row == event]
        _need(len(matches) <= 1, "manual-reservation-transition-duplicated")
        if matches and os.path.isfile(journal) and os.path.isfile(out):
            index, _ = matches[0]
            _need(index > 0, "manual-reservation-transition-parent")
            expected = chain[index - 1][0]
        else:
            expected = head
            if command == "reserve":
                rollup = accounting_rollup.receive(inputs["bootstrap"], scope, chain, pins.get("accepted_sha256"), pins.get("accepted_root"))
                # Admission and headroom are checked immediately before the
                # first append.  A recovered exact transition was already
                # checked at its original parent and is reverified below.
                event = reserve(inputs["request"], inputs["admittedSha256"], inputs["runId"], rollup, head, inputs["atUtc"])
        state_ref_writer.propose_to_files(repo, url, expected, event, root, journal, out, approved_url)
    except (state_ref_writer.Refused, accounting_rollup.Refused) as err:
        raise Refused("manual-reservation-" + str(err))
    return event


def activated():
    """Production activation: the reviewed writer root, the accepted bootstrap and the accepted scope are pinned to the same journal."""
    return (state_ref_writer.REVIEWED_ROOT is not None and accounting_rollup.ACCEPTED_BOOTSTRAP_SHA256 is not None
            and ACCEPTED_SCOPE_SHA256 is not None and accounting_rollup.ACCEPTED_ROOT == state_ref_writer.REVIEWED_ROOT)


def _read(path):
    with open(path, "rb") as f:
        return f.read()


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("reserve", "settle", "release"))
    for flag in ("--repo", "--journal", "--out", "--request", "--admitted-sha256", "--run-id", "--bootstrap", "--scope", "--campaign-id",
                 "--record", "--now"):
        a.add_argument(flag)
    x = a.parse_args(argv[1:])
    try:
        # Decided FIRST, before any input is read: nothing is appended until the writer root, bootstrap and scope are pinned by review.
        _need(activated(), "manual-reservation-not-activated")
        at = x.now or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        if x.command == "reserve":
            inputs = {"request": _read(x.request), "admittedSha256": x.admitted_sha256, "runId": x.run_id, "bootstrap": _read(x.bootstrap),
                      "scope": _read(x.scope), "atUtc": at}
        elif x.command == "settle":
            inputs = {"campaignId": x.campaign_id, "runId": x.run_id, "record": _read(x.record), "scope": _read(x.scope), "atUtc": at}
        else:
            inputs = {}
        pins = {"accepted_sha256": accounting_rollup.ACCEPTED_BOOTSTRAP_SHA256, "accepted_root": accounting_rollup.ACCEPTED_ROOT,
                "accepted_scope_sha256": ACCEPTED_SCOPE_SHA256}
        execute(x.command, inputs, x.repo, state_ref_writer.APPROVED_URL, state_ref_writer.REVIEWED_ROOT, x.journal, x.out, pins)
        return 0
    except Refused as e:
        print("BLOCKED_SETUP: " + str(e), file=sys.stderr)
        return 78
    except (OSError, ValueError, TypeError, KeyError):
        print("BLOCKED_SETUP: manual-reservation-inputs-unreadable", file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
