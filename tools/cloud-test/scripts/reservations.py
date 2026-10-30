#!/usr/bin/env python3
"""Append-only reservation ledger for recurring runs. A reservation is taken BEFORE a run spends anything and holds that run's caps against the period until the
run is sealed into the history index (then the sealed actuals replace it) or the owner releases it with a reason. A run that started but was never sealed therefore
stays counted at its reserved caps: unaccounted usage is never silently forgotten.
config/history/reservations.json is a hash chain of EVENTS (reserve, release); state is folded from them. Nothing is edited or deleted.
Usage: reservations.py reserve --request R.json --approval A.json --index I.json [--ledger L.json] [--now ISO]      appends a reservation, or refuses (exit 78) when any cap is exhausted
       reservations.py release --run-id ID --reason TEXT --ref REF [--ledger L.json] [--now ISO]                    the owner releases a reservation of a run that never started
       reservations.py require --run-id ID [--ledger L.json]                                                         exit 78 unless the run holds an open reservation (the run stage calls it)
       reservations.py verify [--ledger L.json]"""
import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, dump, parse_utc, now_utc  # noqa: E402

LEDGER = os.path.join(ROOT, "config", "history", "reservations.json")
CATS = ("requests", "identityReads", "starts", "takes", "coachingRequests", "runnerMinutes")


def canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":")).encode()


def ehash(e):
    return hashlib.sha256(canon({k: v for k, v in e.items() if k != "entryHash"})).hexdigest()


def empty():
    return {"schema": "speaksharp.cloud-test.reservations.v1", "rule": "append-only hash chain of reserve and release events; a reservation holds its caps against the period until the run is sealed or the owner releases it", "events": [], "headHash": "0" * 64}


def verify(led):
    errs, prev = [], "0" * 64
    for i, e in enumerate(led.get("events", [])):
        if e.get("prevHash") != prev:
            errs.append("event %d: the chain is broken" % (i + 1))
        if ehash(e) != e.get("entryHash"):
            errs.append("event %d: its hash does not match its content" % (i + 1))
        prev = e.get("entryHash")
    if led.get("events") and led.get("headHash") != led["events"][-1]["entryHash"]:
        errs.append("headHash is not the last event's hash")
    return errs


def state(led):
    """Fold the events: runId -> {status, caps, reservedUtc, releasedUtc, reason}."""
    out = {}
    for e in led.get("events", []):
        if e["event"] == "reserve":
            out[e["runId"]] = {"status": "reserved", "caps": e["caps"], "reservedUtc": e["atUtc"], "ref": e.get("ref")}
        elif e["event"] == "release" and e["runId"] in out:
            out[e["runId"]].update(status="released", releasedUtc=e["atUtc"], reason=e.get("reason"), releaseRef=e.get("ref"))
    return out


def append(led, event):
    e = dict(event)
    e["seq"] = len(led["events"]) + 1
    e["prevHash"] = led["headHash"]
    e["entryHash"] = ehash(e)
    led["events"].append(e)
    led["headHash"] = e["entryHash"]
    return led


def caps_of_request(req):
    est = req.get("estimate") or {}
    return {"requests": (est.get("requests") or {}).get("runCap"), "identityReads": est.get("identityReads"), "starts": est.get("starts"), "takes": est.get("takes"),
            "coachingRequests": (est.get("providerBillableRequests") or {}).get("coachingCap"), "runnerMinutes": est.get("githubRunnerMinutesMax")}


def main():
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=["reserve", "release", "verify", "require"])
    a.add_argument("--request")
    a.add_argument("--approval", default=os.path.join(ROOT, "config", "recurring-approval.json"))
    a.add_argument("--index", default=os.path.join(ROOT, "config", "history", "index.json"))
    a.add_argument("--ledger", default=LEDGER)
    a.add_argument("--run-id")
    a.add_argument("--reason")
    a.add_argument("--ref")
    a.add_argument("--now")
    x = a.parse_args()
    now = parse_utc(x.now) if x.now else now_utc()
    led = load(x.ledger) if os.path.exists(x.ledger) else empty()
    errs = verify(led)
    if errs:
        sys.exit("BLOCKED_SETUP: the reservation ledger does not verify: " + "; ".join(errs[:3]))
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    if x.command == "verify":
        print("reservation ledger VERIFIED: %d event(s), head %s" % (len(led["events"]), led["headHash"][:12]))
        return
    if x.command == "require":
        st = state(led).get(x.run_id)
        if not st or st["status"] != "reserved":
            sys.exit("BLOCKED_SETUP: %s has no open reservation: reserve its caps before the run (stage reserve)" % x.run_id)
        print("reservation present for %s" % x.run_id)
        return
    if x.command == "release":
        st = state(led).get(x.run_id)
        if not st or st["status"] != "reserved" or not x.reason or not x.ref:
            sys.exit("REFUSED: release needs an open reservation, a reason and the owner's reference")
        dump(append(led, {"event": "release", "runId": x.run_id, "atUtc": stamp, "reason": x.reason, "ref": x.ref}), x.ledger)
        print("released", x.run_id)
        return
    from recurring_usage import check_caps
    req = load(x.request)
    if req.get("priority") != "nightly-regression":
        sys.exit("REFUSED: reservations are for nightly-regression requests")
    if req["runId"] in state(led):
        sys.exit("REFUSED: %s already has a reservation (no implicit replay)" % req["runId"])
    needs = check_caps(req, load(x.approval), load(x.index), led, now)
    if needs:
        print("REFUSED (BLOCKED_SETUP): a recurring cap is exhausted or the approval does not cover this run:")
        for n in needs:
            print(" -", n)
        sys.exit(78)
    dump(append(led, {"event": "reserve", "runId": req["runId"], "atUtc": stamp, "caps": caps_of_request(req), "ref": (load(x.approval) or {}).get("approvalRef")}), x.ledger)
    print("reserved %s: %s" % (req["runId"], json.dumps(caps_of_request(req))))


if __name__ == "__main__":
    main()
