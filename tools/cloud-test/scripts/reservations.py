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
import contextlib
import fcntl
import hashlib
import json
import os
import stat
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, parse_utc, now_utc  # noqa: E402

LEDGER = os.path.join(ROOT, "config", "history", "reservations.json")
CATS = ("requests", "identityReads", "starts", "takes", "coachingRequests", "runnerMinutes")


def _blocked(code):
    raise SystemExit("BLOCKED_SETUP: " + code)


def canonical_ledger(path):
    """One path identity for both the ledger and its stable sidecar lock.

    Resolving the complete path makes relative and symlink aliases serialize on
    the same lock. Hard-linked ledgers are refused because atomic replacement
    would split their identities.
    """
    if not isinstance(path, str) or not path or "\0" in path:
        _blocked("unsafe reservation ledger path")
    resolved = os.path.realpath(os.path.abspath(path))
    parent = os.path.dirname(resolved)
    if not os.path.isdir(parent) or os.path.islink(parent):
        _blocked("reservation ledger directory is unavailable")
    if os.path.exists(resolved):
        info = os.stat(resolved, follow_symlinks=False)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            _blocked("reservation ledger must be one regular file")
    return resolved


@contextlib.contextmanager
def ledger_transaction(path):
    """Exclusive, process-death-safe transaction lock for one ledger path."""
    ledger = canonical_ledger(path)
    lock_path = ledger + ".lock"  # stable inode; ledger publication never replaces it
    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(lock_path, flags, 0o600)
    except OSError:
        _blocked("reservation ledger lock is unavailable")
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            _blocked("reservation ledger lock is unsafe")
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield ledger
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


def atomic_dump(obj, path):
    """Durably replace the ledger with complete JSON while its lock is held."""
    body = (json.dumps(obj, indent=1, sort_keys=False) + "\n").encode("utf-8")
    parent, name = os.path.dirname(path), os.path.basename(path)
    mode = stat.S_IMODE(os.stat(path).st_mode) if os.path.exists(path) else 0o644
    fd, temporary = tempfile.mkstemp(prefix="." + name + ".", suffix=".partial", dir=parent)
    try:
        with os.fdopen(fd, "wb") as output:
            os.fchmod(output.fileno(), mode)
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        temporary = None
        directory = os.open(parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if temporary is not None:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass


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


def execute(x, now):
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
        atomic_dump(append(led, {"event": "release", "runId": x.run_id, "atUtc": stamp, "reason": x.reason, "ref": x.ref}), x.ledger)
        print("released", x.run_id)
        return
    from recurring_usage import check_caps
    req = load(x.request)
    if req.get("priority") != "nightly-regression":
        sys.exit("REFUSED: reservations are for nightly-regression requests")
    if req["runId"] in state(led):
        sys.exit("REFUSED: %s already has a reservation (no implicit replay)" % req["runId"])
    approval = load(x.approval)
    needs = check_caps(req, approval, load(x.index), led, now)
    if needs:
        print("REFUSED (BLOCKED_SETUP): a recurring cap is exhausted or the approval does not cover this run:")
        for n in needs:
            print(" -", n)
        sys.exit(78)
    atomic_dump(append(led, {"event": "reserve", "runId": req["runId"], "atUtc": stamp, "caps": caps_of_request(req), "ref": (approval or {}).get("approvalRef")}), x.ledger)
    print("reserved %s: %s" % (req["runId"], json.dumps(caps_of_request(req))))


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
    if x.command in ("reserve", "release"):
        with ledger_transaction(x.ledger) as ledger:
            x.ledger = ledger
            return execute(x, now)
    return execute(x, now)


if __name__ == "__main__":
    main()
