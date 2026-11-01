#!/usr/bin/env python3
"""Append-only bookkeeping on refs/heads/cloud-test-state (Sam 1793548444.540999). SOURCE ONLY: this module never creates the ref, never
changes a permission, and is not wired into any workflow until separately selected.

The ref's tree holds exactly one file, ledger.json: {"schema", "events"} with closed-schema, content-free events (no account data, no
credential, no private receipt history). Each write appends EXACTLY ONE event:

  propose  fetch the ref; refuse unless its head is the expected head; verify that head's ledger; validate the event and the resulting
           transitions (reserve -> settle|release, once per campaignId/runId/attempt); write a new blob, a one-file tree and a commit whose
           SOLE parent is the expected head; then a NON-force push. The push is the compare-and-swap: a stale head or a racing writer is
           rejected as non-fast-forward and nothing is rewritten. Returns the persistence receipt
           {ref, previousSha, newSha, ledgerBlobSha256, proposalSha256}.
  verify   never trusts the receipt JSON: fetches the ref, requires newSha to be on it, its sole parent to be previousSha, its tree to be
           exactly ledger.json with the receipted bytes, the previous ledger to be an exact prefix plus exactly the proposed event, and
           that event's canonical digest to equal proposalSha256.
Exit 78 on every refusal; no value is printed.
Usage: state_ref_writer.py propose --repo R --remote origin --ref refs/heads/cloud-test-state --expected SHA --event E.json --out RECEIPT.json
       state_ref_writer.py verify  --repo R --remote origin --ref refs/heads/cloud-test-state --receipt RECEIPT.json --event E.json
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (Python itself opens no socket; git is the only transport)
from reservations import CATS  # noqa: E402

SCHEMA = "speaksharp.cloud-test.state-ledger.v1"
LEDGER = "ledger.json"
DEFAULT_REF = "refs/heads/cloud-test-state"
TYPES = ("reserve", "settle", "release")
EVENT_KEYS = {"type", "campaignId", "runId", "attempt", "allocation", "provenance", "atUtc"}
SHA40 = re.compile(r"^[0-9a-f]{40}$")
CAMPAIGN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
RUN_ID = re.compile(r"^[1-9][0-9]{0,19}$")
REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/#-]{2,159}$")
UTC = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":")).encode()


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def validate_event(e):
    """Closed schema, content-free: a reserve carries the six allocation caps, a settle the evidence-backed actual usage, a release the
    released allocation; provenance is a reference (approval or evidence digest), never a value."""
    _need(isinstance(e, dict) and set(e) == EVENT_KEYS, "event-shape")
    _need(e["type"] in TYPES, "event-type")
    _need(isinstance(e["campaignId"], str) and CAMPAIGN.match(e["campaignId"]), "event-campaign")
    _need(isinstance(e["runId"], str) and RUN_ID.match(e["runId"]), "event-run-id")
    _need(type(e["attempt"]) is int and e["attempt"] >= 1, "event-attempt")
    a = e["allocation"]
    _need(isinstance(a, dict) and set(a) == set(CATS) and all(type(v) is int and v >= 0 for v in a.values()), "event-allocation")
    _need(isinstance(e["provenance"], str) and REF.match(e["provenance"]), "event-provenance")
    _need(isinstance(e["atUtc"], str) and UTC.match(e["atUtc"]), "event-time")
    return e


def fold(events):
    """Transitions: reserve opens a (campaignId, runId, attempt) key once; settle or release closes an OPEN key once. A settle may not
    exceed its reservation in any dimension (unknown overrun is not silently absorbed)."""
    state = {}
    for e in events:
        validate_event(e)
        key = (e["campaignId"], e["runId"], e["attempt"])
        if e["type"] == "reserve":
            _need(key not in state, "duplicate-transition")
            state[key] = ("open", e["allocation"])
        else:
            _need(key in state and state[key][0] == "open", "transition-without-open-reservation")
            if e["type"] == "settle":
                _need(all(e["allocation"][k] <= state[key][1][k] for k in CATS), "settle-exceeds-reservation")
            else:
                _need(e["allocation"] == state[key][1], "release-differs-from-reservation")
            state[key] = (e["type"], e["allocation"])
    return state


def ledger_bytes(events):
    return canon({"schema": SCHEMA, "events": events})


def parse_ledger(raw):
    """Only canonical bytes of a valid ledger are accepted, so the same events always persist as the same blob."""
    try:
        doc = json.loads(raw)
    except ValueError:
        raise Refused("ledger-not-json")
    _need(isinstance(doc, dict) and set(doc) == {"schema", "events"} and doc["schema"] == SCHEMA and isinstance(doc["events"], list), "ledger-shape")
    fold(doc["events"])
    _need(ledger_bytes(doc["events"]) == raw, "ledger-not-canonical")
    return doc["events"]


def _git(repo, *args, data=None, env=None):
    p = subprocess.run(["git", "-C", repo, *args], input=data, capture_output=True, check=False, env=env)
    return p.returncode, p.stdout


def _out(repo, *args, data=None, env=None):
    rc, out = _git(repo, *args, data=data, env=env)
    _need(rc == 0, "git-failed:" + args[0])
    return out.decode().strip()


def fetch_head(repo, remote, ref):
    """The ref's current head as the remote has it; refuses when the ref does not exist (this module never creates it)."""
    rc, _ = _git(repo, "fetch", "--quiet", "--no-tags", remote, "+%s:refs/cloud-test-state/observed" % ref)
    _need(rc == 0, "state-ref-unavailable")
    return _out(repo, "rev-parse", "refs/cloud-test-state/observed")


def commit_ledger(repo, sha):
    """A state commit: at most one parent and a tree that is exactly ledger.json. Returns (parents, ledger bytes, blob id)."""
    parents = _out(repo, "rev-list", "--parents", "-n", "1", sha).split()[1:]
    _need(len(parents) <= 1, "state-commit-has-several-parents")
    entries = _out(repo, "ls-tree", sha).splitlines()
    _need(len(entries) == 1 and entries[0].split("\t")[1] == LEDGER and entries[0].split()[:2] == ["100644", "blob"], "state-tree-shape")
    blob = entries[0].split()[2]
    rc, raw = _git(repo, "cat-file", "blob", blob)
    _need(rc == 0, "state-blob-unreadable")
    return parents, raw, blob


def propose(repo, remote, ref, expected, event):
    _need(isinstance(expected, str) and SHA40.match(expected), "expected-head")
    head = fetch_head(repo, remote, ref)
    _need(head == expected, "stale-head")
    _, raw, _ = commit_ledger(repo, expected)
    events = parse_ledger(raw) + [validate_event(event)]
    fold(events)
    new = ledger_bytes(events)
    blob = _out(repo, "hash-object", "-w", "--stdin", data=new)
    tree = _out(repo, "mktree", data=("100644 blob %s\t%s\n" % (blob, LEDGER)).encode())
    ident = {"GIT_AUTHOR_NAME": "cloud-test-state", "GIT_AUTHOR_EMAIL": "cloud-test-state@invalid", "GIT_AUTHOR_DATE": event["atUtc"],
             "GIT_COMMITTER_NAME": "cloud-test-state", "GIT_COMMITTER_EMAIL": "cloud-test-state@invalid", "GIT_COMMITTER_DATE": event["atUtc"]}
    msg = "cloud-test-state: %s %s %s/%d\n" % (event["type"], event["campaignId"], event["runId"], event["attempt"])
    commit = _out(repo, "commit-tree", tree, "-p", expected, data=msg.encode(), env={**os.environ, **ident})
    # NON-force: the remote accepts only a fast-forward from exactly the expected head, so a stale or raced write is rejected.
    rc, _ = _git(repo, "push", "--quiet", remote, "%s:%s" % (commit, ref))
    _need(rc == 0, "state-ref-push-rejected")
    return {"ref": ref, "previousSha": expected, "newSha": commit, "ledgerBlobSha256": sha256(new), "proposalSha256": sha256(canon(event))}


def verify(repo, remote, receipt, event):
    """Persisted-bytes verification of one receipt; the receipt JSON itself is never trusted."""
    _need(isinstance(receipt, dict) and set(receipt) == {"ref", "previousSha", "newSha", "ledgerBlobSha256", "proposalSha256"}, "receipt-shape")
    _need(all(SHA40.match(str(receipt[k])) for k in ("previousSha", "newSha")), "receipt-shas")
    head = fetch_head(repo, remote, receipt["ref"])
    _need(_git(repo, "merge-base", "--is-ancestor", receipt["newSha"], head)[0] == 0, "receipt-commit-not-on-state-ref")
    parents, raw, _ = commit_ledger(repo, receipt["newSha"])
    _need(parents == [receipt["previousSha"]], "receipt-parent-mismatch")
    _need(sha256(raw) == receipt["ledgerBlobSha256"], "receipt-ledger-bytes-mismatch")
    _, prev_raw, _ = commit_ledger(repo, receipt["previousSha"])
    prev, now = parse_ledger(prev_raw), parse_ledger(raw)
    _need(now[:-1] == prev and len(now) == len(prev) + 1, "ledger-not-append-only")
    _need(now[-1] == validate_event(event) and sha256(canon(event)) == receipt["proposalSha256"], "receipt-event-mismatch")
    return {"verified": True, "ref": receipt["ref"], "newSha": receipt["newSha"], "events": len(now)}


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("propose", "verify"))
    for flag in ("--repo", "--remote", "--expected", "--event", "--out", "--receipt"):
        a.add_argument(flag)
    a.add_argument("--ref", default=DEFAULT_REF)
    x = a.parse_args(argv[1:])
    try:
        with open(x.event, encoding="utf-8") as f:
            event = json.load(f)
        if x.command == "propose":
            receipt = propose(x.repo, x.remote, x.ref, x.expected, event)
            fd = os.open(x.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(receipt, f, sort_keys=True)
            return 0
        with open(x.receipt, encoding="utf-8") as f:
            verify(x.repo, x.remote, json.load(f), event)
        return 0
    except Refused as e:
        print("BLOCKED_SETUP: " + str(e), file=sys.stderr)
        return 78
    except (OSError, ValueError, TypeError, KeyError):
        print("BLOCKED_SETUP: state-ref-unreadable", file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
