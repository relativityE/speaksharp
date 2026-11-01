#!/usr/bin/env python3
"""Manual-dispatch reservation integration (Sam 1793556225.890759): the reserve / settle / release events a MANUAL (non-nightly) run would
append to the state-ref journal, so the accepted rollup counts it. SOURCE ONLY and not wired into any workflow: the writer is not activated
(REVIEWED_ROOT is None), no bootstrap is accepted and no period scope is approved, so nothing here can append today. Nightly runs keep their
own path (reservations.py); this module refuses them.

  reserve   identity {campaignId: the request runId, runId: GITHUB_RUN_ID, attempt 1}; the allocation is the ADMITTED request's caps
            (reservations.caps_of_request on exactly the admitted bytes) with `request-sha256:` provenance. An unknown cap refuses, never 0.
            Admission requires the accepted-rollup output read at the same chain head the reserve is proposed on, and every G5 dimension of
            the allocation within that output's current headroom.
  settle    closes the reservation with the run's measured usage, `evidence-sha256:` provenance. A dimension whose actual is unknown settles
            at its reserved cap (never under-counted); an actual above the reservation refuses, leaving the reservation open and counted.
  release   only for a run that never started, under an owner approval reference; it returns exactly the reservation.
Exit 78 on every refusal; no value is printed.
"""
import argparse
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline)
import state_ref_writer  # noqa: E402
from reservations import CATS, caps_of_request  # noqa: E402

G5_KEYS = ("requests", "identityReads", "starts", "takes")
SHA256 = re.compile(r"[0-9a-f]{64}")
APPROVAL = re.compile(r"slack-[0-9]{10}\.[0-9]{6}")


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
    """The admitted request bytes, a manual priority, and every cap a known non-negative integer."""
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
    return req, caps


def reserve(request_raw, admitted_sha256, github_run_id, rollup, expected_head, at_utc):
    """The reserve event, or a refusal. `rollup` is accounting_rollup.receive output; it must describe `expected_head`, the head the
    reserve will be proposed on, so the headroom is not stale."""
    req, caps = manual_request(request_raw, admitted_sha256)
    _need(isinstance(rollup, dict) and rollup.get("source") == "accepted-rollup", "manual-reservation-rollup")
    _need(isinstance(expected_head, str) and rollup.get("headSha") == expected_head, "manual-reservation-rollup-stale")
    room = rollup.get("currentHeadroom")
    _need(isinstance(room, dict) and all(type(room.get(k)) is int for k in G5_KEYS), "manual-reservation-rollup")
    _need(all(caps[k] <= room[k] for k in G5_KEYS), "manual-reservation-exceeds-headroom")
    identity = {"campaignId": req.get("runId"), "runId": github_run_id, "attempt": 1}
    return _event("reserve", identity, caps, "request-sha256:" + admitted_sha256, at_utc)


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


def release(reserved, started, approval_ref, at_utc):
    """Only for a run that never started; an owner approval reference (slack-<ts>) is required."""
    identity = _identity(reserved)
    _need(started is False, "manual-release-run-started")
    _need(isinstance(approval_ref, str) and APPROVAL.fullmatch(approval_ref) is not None, "manual-release-approval")
    return _event("release", identity, reserved["allocation"], "approval:" + approval_ref, at_utc)


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("reserve", "settle", "release"))
    a.parse_args(argv[1:2])
    # Not wired: appending needs the activated writer (REVIEWED_ROOT) and an accepted rollup; neither exists.
    print("BLOCKED_SETUP: manual-reservation-not-activated", file=sys.stderr)
    return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
