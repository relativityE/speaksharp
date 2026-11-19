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
import re
import stat
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, dump, parse_utc, now_utc  # noqa: E402

LEDGER = os.path.join(ROOT, "config", "history", "reservations.json")
CATS = ("requests", "identityReads", "starts", "takes", "coachingRequests", "runnerMinutes")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


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
            out[e["runId"]] = {"status": "reserved", "caps": e["caps"], "reservedUtc": e["atUtc"], "ref": e.get("ref"),
                               "requestConsumption": e.get("requestConsumption"), "reservationEntryHash": e.get("entryHash")}
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
    estimated_requests = (est.get("requests") or {}).get("runCap")
    approved_requests = (req.get("approvedLimits") or {}).get("runCapRequests")
    # A derived nightly request may enforce a standing-approved maximum above
    # its estimate. Reservations and cumulative admission must charge the same
    # maximum the browser guard can spend, never the lower estimate.
    requests = approved_requests if req.get("priority") == "nightly-regression" and type(approved_requests) is int else estimated_requests
    return {"requests": requests, "identityReads": est.get("identityReads"), "starts": est.get("starts"), "takes": est.get("takes"),
            "coachingRequests": (est.get("providerBillableRequests") or {}).get("coachingCap"), "runnerMinutes": est.get("githubRunnerMinutesMax")}


def consumed_request(path, expected_sha256):
    if not isinstance(path, str) or not os.path.isabs(path) or os.path.realpath(path) != path:
        sys.exit("BLOCKED_SETUP: request path must be absolute and canonical")
    if not SHA256.fullmatch(expected_sha256 or ""):
        sys.exit("BLOCKED_SETUP: admitted request digest is missing or malformed")
    with open(path, "rb") as stream:
        request_bytes = stream.read()
    actual = hashlib.sha256(request_bytes).hexdigest()
    if actual != expected_sha256:
        sys.exit("BLOCKED_SETUP: request changed since admission")
    try:
        request = json.loads(request_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError):
        sys.exit("BLOCKED_SETUP: admitted request is not valid JSON")
    return request


def request_consumption(req, expected_sha256, execution_run_id, attempt, stamp, caps):
    if not isinstance(execution_run_id, str) or not execution_run_id.isdecimal() or attempt != 1:
        sys.exit("BLOCKED_SETUP: exact execution run and strict attempt 1 required")
    if not isinstance(req.get("runId"), str) or not req["runId"]:
        sys.exit("BLOCKED_SETUP: request campaign is missing")
    return {"campaignId": req["runId"], "runId": execution_run_id, "attempt": 1, "consumer": "reservation",
            "requestSha256": expected_sha256, "consumedAtUtc": stamp, "allocation": caps}


class JournalRefused(ValueError):
    pass


def _jneed(ok, code):
    if not ok:
        raise JournalRefused(code)


def nightly_journal_request(request_raw, admitted_sha256):
    """The gate-admitted nightly request bytes, every cap a known integer. Returns (request, allocation). The run is held at its APPROVED
    per-run ceilings, the ones G5 and the builder enforce at runtime (approvedLimits.runCapRequests and identityCap), never the lower
    estimate: `requests` holds G5's charge, the approved run cap plus the approved identity reads."""
    _jneed(isinstance(request_raw, bytes) and isinstance(admitted_sha256, str) and SHA256.fullmatch(admitted_sha256)
           and hashlib.sha256(request_raw).hexdigest() == admitted_sha256, "reservation-request-not-admitted")
    try:
        req = json.loads(request_raw)
    except ValueError:
        raise JournalRefused("reservation-request-unreadable")
    _jneed(isinstance(req, dict) and req.get("priority") == "nightly-regression", "reservation-not-nightly")
    caps, lim = caps_of_request(req), req.get("approvedLimits") or {}
    caps.update(identityReads=lim.get("identityCap"))
    _jneed(type(lim.get("runCapRequests")) is int and all(type(caps[k]) is int and caps[k] >= 0 for k in CATS), "reservation-caps-unknown")
    return req, dict(caps, requests=lim["runCapRequests"] + caps["identityReads"])


def original_record_digest(raw, record_digest):
    """#1772 Code finding 4447377718: the journal binds a settlement to the ORIGINAL collector record. The scheduled route hands
    journal-settle the closed settle input (settle_input.py), whose own digest is a projection's; there the validated embedded recordSha256
    is the evidence. Bytes that are not a closed settle input (a collector record) keep their own digest."""
    import settle_input
    try:
        doc = json.loads(raw)
    except (TypeError, ValueError):
        return record_digest
    if not (isinstance(doc, dict) and set(doc) == settle_input.KEYS):
        return record_digest
    try:
        return settle_input.validate(raw)["recordSha256"]
    except settle_input.Refused as err:
        raise JournalRefused("reservation-" + str(err))


def journal_reserve(request_raw, admitted_sha256, github_run_id, attempt, approval, rollup, chain, expected_head, at_utc):
    """The nightly campaign's reserve event for the state-ref journal (RETURN ), or a refusal: attempt 1; the accepted
    rollup recomputed at exactly `expected_head` (the head it will be appended on) holds G5's charge; and G11's standing-approval limits
    (per run, cadence, period caps) hold over the SAME journal's period usage."""
    import manual_reservation as M
    from recurring_usage import check_caps
    _jneed(attempt == 1, "reservation-attempt")
    req, allocation = nightly_journal_request(request_raw, admitted_sha256)
    _jneed(isinstance(rollup, dict) and rollup.get("source") == "accepted-rollup" and rollup.get("headSha") == expected_head
           and chain[-1][0] == expected_head, "reservation-rollup-stale")
    room = rollup.get("currentHeadroom") or {}
    _jneed(all(type(room.get(k)) is int and allocation[k] <= room[k] for k in M.G5_KEYS), "reservation-exceeds-headroom")
    needs = check_caps(req, approval, None, None, parse_utc(at_utc), journal_chain=chain)
    _jneed(not needs, "reservation-standing-limit")
    try:
        return M._event("reserve", {"campaignId": req["runId"], "runId": github_run_id, "attempt": 1}, allocation,
                        "request-sha256:" + admitted_sha256, at_utc)
    except M.Refused as e:
        raise JournalRefused("reservation-" + str(e))


def journal_execute(command, inputs, repo, url, root, journal, out, pins, approval, approved_url=None):
    """One nightly transition on the state ref the continuity rollup reads: `reserve` (then the reserve must be persisted at the receipt's
    commit on a fresh chain read) or `settle` (from the collector's run-record bytes, bound to the reservation found ON the chain).
    `pins` are the accepted bootstrap digest, its root and the accepted scope digest; `root` must be that root."""
    import accounting_rollup
    import manual_reservation as M
    import state_ref_writer as W
    approved_url = approved_url or W.APPROVED_URL
    _jneed(root is not None and root == pins.get("accepted_root"), "reservation-root-mismatch")
    try:
        head = W.fetch_head(repo, url, approved_url)
        chain = W.validate_chain(repo, head, root)
        scope = M.accepted_scope(inputs["scope"], pins.get("accepted_scope_sha256"))
        M._in_period(scope, inputs["atUtc"], "reservation-outside-period")
        if command == "reserve":
            rollup = accounting_rollup.receive(inputs["bootstrap"], scope, chain, pins.get("accepted_sha256"), pins.get("accepted_root"))
            event = journal_reserve(inputs["request"], inputs["admittedSha256"], inputs["runId"], inputs["attempt"], approval, rollup, chain,
                                    head, inputs["atUtc"])
        else:
            _jneed(command == "settle", "reservation-command")
            reserved = M._reserved_on_chain(chain, inputs["campaignId"], inputs["runId"])
            usage, evidence = M.usage_from_record(inputs["record"], reserved)
            evidence = original_record_digest(inputs["record"], evidence)
            event = M.settle(reserved, usage, evidence, inputs["atUtc"])
        W.propose_to_files(repo, url, head, event, root, journal, out, approved_url)
        persisted = W.validate_chain(repo, W.fetch_head(repo, url, approved_url), root)
    except (W.Refused, accounting_rollup.Refused, M.Refused) as err:
        raise JournalRefused("reservation-" + str(err))
    _jneed(any(events and events[-1] == event for _, events, _ in persisted), "reservation-not-persisted")
    return event


def journal_require(chain, campaign_id, github_run_id, admitted_sha256):
    """The run stage proceeds only when THIS campaign/run/attempt holds an open reserve for exactly the admitted request ON the chain."""
    state = {}
    for e in chain[-1][1]:
        key = (e["campaignId"], e["runId"], e["attempt"])
        state[key] = e if e["type"] == "reserve" else None
    e = state.get((campaign_id, github_run_id, 1))
    _jneed(e is not None and e["provenance"] == "request-sha256:" + str(admitted_sha256), "reservation-not-held")
    return e


def journal_main(x, url=None, root=None, pins=None):
    """The nightly CLI on the state-ref journal. Refuses `reservation-journal-not-activated` (exit 78) before any read until the reviewed writer
    root, the accepted bootstrap and the accepted scope are pinned to the same journal. `url`, `root`, `pins` are TEST-ONLY overrides."""
    import tempfile
    import init_run_inputs as I
    import state_ref_writer as W
    from recurring_usage import JOURNAL_SNAPSHOT_SCHEMA
    pins = pins or I.continuity_pins()
    root = root or W.REVIEWED_ROOT
    url = url or W.APPROVED_URL
    try:
        _jneed(root is not None and all(pins.get(k) is not None for k in ("accepted_sha256", "accepted_root", "accepted_scope_sha256"))
               and pins["accepted_root"] == root, "reservation-journal-not-activated")
        repo = tempfile.mkdtemp(prefix="nightly-journal-")
        import subprocess
        _jneed(subprocess.run(["git", "init", "-q", repo], capture_output=True, env={"PATH": os.environ.get("PATH", ""), "GIT_CONFIG_NOSYSTEM": "1",
               "GIT_CONFIG_GLOBAL": os.devnull, "GIT_TEMPLATE_DIR": ""}).returncode == 0, "reservation-journal-repo")
        chain = W.validate_chain(repo, W.fetch_head(repo, url, url), root)
        if x.command == "journal-snapshot":
            _jneed(x.out and not os.path.lexists(x.out), "reservation-output")
            dump({"schema": JOURNAL_SNAPSHOT_SCHEMA, "headSha": chain[-1][0], "events": chain[-1][1]}, x.out)
            return 0
        req_raw = open(x.request, "rb").read() if x.request else b""
        if x.command == "journal-require":
            req, _ = nightly_journal_request(req_raw, x.request_sha256)
            journal_require(chain, req["runId"], x.execution_run_id, x.request_sha256)
            return 0
        aggregate = os.path.join(x.repo, I.CONTINUITY_DIR)
        inputs = {"scope": open(os.path.join(aggregate, I.CONTINUITY_SCOPE), "rb").read(),
                  "bootstrap": open(os.path.join(aggregate, I.CONTINUITY_BOOTSTRAP), "rb").read(),
                  "atUtc": now_utc().strftime("%Y-%m-%dT%H:%M:%SZ")}
        if x.command == "journal-reserve":
            inputs.update(request=req_raw, admittedSha256=x.request_sha256, runId=x.execution_run_id, attempt=x.attempt)
        else:
            req, _ = nightly_journal_request(req_raw, x.request_sha256)
            inputs.update(campaignId=req["runId"], runId=x.execution_run_id, record=open(x.record, "rb").read())
        journal_execute(x.command[len("journal-"):], inputs, repo, url, root, x.journal, x.out, pins, load(x.approval), url)
        return 0
    except (JournalRefused, W.Refused, OSError, ValueError) as e:
        code = str(e) if isinstance(e, JournalRefused) else "reservation-" + str(e) if isinstance(e, W.Refused) else "reservation-journal-input"
        print("BLOCKED_SETUP: " + code, file=sys.stderr)
        return 78


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
        expected = {"campaignId": x.run_id, "runId": x.execution_run_id, "attempt": x.attempt,
                    "consumer": "reservation", "requestSha256": x.request_sha256}
        consumption = st.get("requestConsumption") or {}
        if x.attempt != 1 or any(consumption.get(key) != value for key, value in expected.items()):
            sys.exit("BLOCKED_SETUP: reservation does not bind this admitted request/execution")
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
    req = consumed_request(x.request, x.request_sha256)
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
    caps = caps_of_request(req)
    consumption = request_consumption(req, x.request_sha256, x.execution_run_id, x.attempt, stamp, caps)
    atomic_dump(append(led, {"event": "reserve", "runId": req["runId"], "atUtc": stamp, "caps": caps,
                             "requestConsumption": consumption, "ref": (approval or {}).get("approvalRef")}), x.ledger)
    print("reserved %s: %s" % (req["runId"], json.dumps(caps)))


def main():
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=["reserve", "release", "verify", "require", "journal-snapshot", "journal-reserve", "journal-require",
                                       "journal-settle"])
    a.add_argument("--repo")
    a.add_argument("--record")
    a.add_argument("--out")
    a.add_argument("--journal")
    a.add_argument("--request")
    a.add_argument("--request-sha256")
    a.add_argument("--execution-run-id")
    a.add_argument("--attempt", type=int)
    a.add_argument("--approval", default=os.path.join(ROOT, "config", "recurring-approval.json"))
    a.add_argument("--index", default=os.path.join(ROOT, "config", "history", "index.json"))
    a.add_argument("--ledger", default=LEDGER)
    a.add_argument("--run-id")
    a.add_argument("--reason")
    a.add_argument("--ref")
    a.add_argument("--now")
    x = a.parse_args()
    if x.command.startswith("journal-"):
        sys.exit(journal_main(x))
    now = parse_utc(x.now) if x.now else now_utc()
    if x.command in ("reserve", "release"):
        with ledger_transaction(x.ledger) as ledger:
            x.ledger = ledger
            return execute(x, now)
    return execute(x, now)


if __name__ == "__main__":
    main()
