#!/usr/bin/env python3
"""Append-only bookkeeping on the ONE selected state ref (Sam 1793548444.540999, RETURN 1793549143.187519). SOURCE ONLY: this module never
creates the ref, never changes a permission, and is not wired into any workflow. The CLI refuses until REVIEWED_ROOT is pinned by review.

The ref's history is a single-parent chain from the pinned, independently reviewed root (an empty canonical ledger). Every commit's tree holds
exactly ledger.json, and every ledger is its parent's ledger plus EXACTLY ONE closed-schema, content-free event:

  propose  fetch the ref; validate the whole chain from the pinned root through the current head from RAW objects whose bytes hash to their
           ids; refuse unless the expected head is on that chain; build the deterministic one-event child of the expected head (identity and
           dates come from the event, so an identical proposal is the identical commit); journal the receipt BEFORE pushing; push with an
           exact expected-old-SHA lease (no '+', so never a rewrite; a lease on a missing ref never creates it); then reconcile against the
           persisted history whatever the push reported. An exact retry of an append that already landed recovers the original receipt; a
           new transition for the same key is a duplicate and refuses.
  verify   never trusts the receipt JSON: the fixed ref, the validated chain, newSha on it with previousSha its sole parent, the receipted
           ledger bytes, exactly the proposed event appended, and its canonical digest.

Git runs with no system/global config, no hooks, no replace objects, no prompts, one allowed transport, against exactly the approved URL
(used for both fetch and push), in a repository whose local config holds only the core defaults `git init` writes.
Exit 78 on every refusal; no value is printed.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (Python itself opens no socket; git is the only transport)
from reservations import CATS  # noqa: E402

SCHEMA = "speaksharp.cloud-test.state-ledger.v1"
LEDGER = "ledger.json"
STATE_REF = "refs/heads/cloud-test-state"
APPROVED_URL = "https://github.com/relativityE/speaksharp.git"
REVIEWED_ROOT = None  # pinned only by an independently reviewed change; until then the CLI refuses
OBSERVED = "refs/cloud-test-state/observed"
MAX_CHAIN = 10000
TYPES = ("reserve", "settle", "release")
EVENT_KEYS = {"type", "campaignId", "runId", "attempt", "allocation", "provenance", "atUtc"}
RECEIPT_KEYS = {"ref", "previousSha", "newSha", "ledgerBlobSha256", "proposalSha256"}
SAFE_CONFIG = {"core.repositoryformatversion", "core.filemode", "core.bare", "core.logallrefupdates", "core.ignorecase", "core.precomposeunicode"}
SHA40 = re.compile(r"[0-9a-f]{40}")
CAMPAIGN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}")
RUN_ID = re.compile(r"[1-9][0-9]{0,19}")
PROVENANCE = re.compile(r"approval:slack-[0-9]{10}\.[0-9]{6}|request-sha256:[0-9a-f]{64}|evidence-sha256:[0-9a-f]{64}")
UTC = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ")
IDENT = {"GIT_AUTHOR_NAME": "cloud-test-state", "GIT_AUTHOR_EMAIL": "cloud-test-state@invalid",
         "GIT_COMMITTER_NAME": "cloud-test-state", "GIT_COMMITTER_EMAIL": "cloud-test-state@invalid"}


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def _full(rx, v):
    return isinstance(v, str) and rx.fullmatch(v) is not None


def canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":")).encode()


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def _real_utc(v):
    if not _full(UTC, v):
        return False
    try:
        datetime.strptime(v, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return False
    return True


def validate_event(e):
    """Closed schema, content-free, full-string validated: attempt 1 only (reruns are refused upstream), typed provenance (a Slack approval
    reference or a request/evidence digest, never free text), a real UTC second."""
    _need(isinstance(e, dict) and set(e) == EVENT_KEYS, "event-shape")
    _need(e["type"] in TYPES, "event-type")
    _need(_full(CAMPAIGN, e["campaignId"]), "event-campaign")
    _need(_full(RUN_ID, e["runId"]), "event-run-id")
    _need(type(e["attempt"]) is int and e["attempt"] == 1, "event-attempt")
    a = e["allocation"]
    _need(isinstance(a, dict) and set(a) == set(CATS) and all(type(v) is int and v >= 0 for v in a.values()), "event-allocation")
    _need(_full(PROVENANCE, e["provenance"]), "event-provenance")
    _need(_real_utc(e["atUtc"]), "event-time")
    return e


def fold(events):
    """Transitions: reserve opens a (campaignId, runId, attempt) key once; settle or release closes an OPEN key once. A settle may not
    exceed its reservation in any dimension; a release returns exactly the reservation."""
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


def _transport(url, approved_url):
    """Exactly the approved destination, for fetch and push alike; never option-like; one transport."""
    _need(isinstance(url, str) and isinstance(approved_url, str) and url == approved_url and not url.startswith("-"), "remote-not-approved")
    if url.startswith("https://"):
        return "https"
    _need(os.path.isabs(url), "remote-not-approved")
    return "file"


def _git(repo, *args, data=None, scheme="file", extra=None):
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LC_ALL": "C", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
           "GIT_NO_REPLACE_OBJECTS": "1", "GIT_TERMINAL_PROMPT": "0", "GIT_ALLOW_PROTOCOL": scheme, **(extra or {})}
    cmd = ["git", "-c", "core.hooksPath=" + os.devnull, "-c", "core.fsmonitor=false", "-c", "fetch.fsckObjects=true", "-C", repo, *args]
    p = subprocess.run(cmd, input=data, capture_output=True, check=False, env=env)
    return p.returncode, p.stdout


def _out(repo, *args, data=None, extra=None):
    rc, out = _git(repo, *args, data=data, extra=extra)
    _need(rc == 0, "git-failed:" + args[0])
    return out.decode().strip()


def check_repo(repo):
    """The local repository adds nothing to Git's behaviour: only the core defaults `git init` writes (no remotes, url rewrites, hooks path,
    includes, filters or credential helpers)."""
    git_dir = _out(repo, "rev-parse", "--absolute-git-dir")
    rc, out = _git(repo, "config", "--file", os.path.join(git_dir, "config"), "--list", "--name-only")
    _need(rc == 0 and set(out.decode().split()) <= SAFE_CONFIG, "unsafe-git-config")


def _raw(repo, kind, sha):
    """The object's raw bytes, accepted only when they hash to its id (no replace object, no substituted store)."""
    rc, body = _git(repo, "cat-file", kind, sha)
    _need(rc == 0 and hashlib.sha1(b"%s %d\0" % (kind.encode(), len(body)) + body).hexdigest() == sha, "state-object-not-genuine")
    return body


def read_state_commit(repo, sha):
    """A state commit: tree, at most one parent, author, committer, message; its tree is exactly one 100644 ledger.json blob. Returns
    (parents, ledger bytes)."""
    _need(_full(SHA40, sha), "state-commit-id")
    head, _, _ = _raw(repo, "commit", sha).partition(b"\n\n")
    lines = head.decode().split("\n")
    _need(len(lines) >= 3 and lines[0].startswith("tree ") and lines[-2].startswith("author ") and lines[-1].startswith("committer "),
          "state-commit-headers")
    parents = [ln[7:] for ln in lines[1:-2]]
    _need(all(ln.startswith("parent ") for ln in lines[1:-2]) and len(parents) <= 1 and all(_full(SHA40, p) for p in parents),
          "state-commit-has-several-parents" if len(parents) > 1 else "state-commit-headers")
    tree = _raw(repo, "tree", lines[0][5:])
    prefix = b"100644 " + LEDGER.encode() + b"\0"
    _need(len(tree) == len(prefix) + 20 and tree.startswith(prefix), "state-tree-shape")
    return parents, _raw(repo, "blob", tree[len(prefix):].hex())


def fetch_head(repo, url, approved_url):
    """The selected ref's current head as the approved remote has it; refuses when the ref does not exist (never created here)."""
    scheme = _transport(url, approved_url)
    rc, _ = _git(repo, "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--", url, "+%s:%s" % (STATE_REF, OBSERVED), scheme=scheme)
    _need(rc == 0, "state-ref-unavailable")
    return _out(repo, "rev-parse", "--verify", "--quiet", OBSERVED + "^{commit}")


def validate_chain(repo, head, root):
    """[(sha, events, ledger bytes)] from the pinned root to head: every commit single-parent, the root parentless with an empty canonical
    ledger, every ledger canonical and exactly its parent's plus one event. A replaced root or a rewritten descendant fails here."""
    _need(_full(SHA40, root), "state-root-not-pinned")
    chain, sha = [], head
    while True:
        parents, raw = read_state_commit(repo, sha)
        chain.append((sha, parse_ledger(raw), raw))
        if not parents:
            _need(sha == root and chain[-1][1] == [], "state-root-replaced")
            break
        _need(sha != root, "state-root-has-parent")
        _need(len(chain) < MAX_CHAIN, "state-chain-too-long")
        sha = parents[0]
    chain.reverse()
    for (_, prev, _), (_, now, _) in zip(chain, chain[1:]):
        _need(len(now) == len(prev) + 1 and now[:-1] == prev, "ledger-not-append-only")
    return chain


def _child(repo, parent, events, event):
    """The deterministic one-event child: identical inputs give the identical commit id."""
    new = ledger_bytes(events + [event])
    blob = _out(repo, "hash-object", "-w", "--stdin", data=new)
    tree = _out(repo, "mktree", data=("100644 blob %s\t%s\n" % (blob, LEDGER)).encode())
    msg = "cloud-test-state: %s %s %s/%d\n" % (event["type"], event["campaignId"], event["runId"], event["attempt"])
    dates = {"GIT_AUTHOR_DATE": event["atUtc"], "GIT_COMMITTER_DATE": event["atUtc"]}
    return _out(repo, "commit-tree", tree, "-p", parent, data=msg.encode(), extra={**IDENT, **dates}), new


def _push(repo, url, new, expected, scheme):
    """Exact expected-old-SHA lease and no '+': lands only when the ref is exactly `expected` (never on a missing, deleted or rewound ref),
    and `new`'s sole parent is `expected`, so the update is always an append."""
    rc, _ = _git(repo, "push", "--quiet", "--no-verify", "--force-with-lease=%s:%s" % (STATE_REF, expected), "--", url,
                 "%s:%s" % (new, STATE_REF), scheme=scheme)
    return rc


def _landed(chain, new, expected):
    shas = [c[0] for c in chain]
    return new in shas and shas.index(new) >= 1 and shas[shas.index(new) - 1] == expected


def write_journal(path, receipt):
    """Preflight record written BEFORE the push (O_EXCL). An identical journal is an exact retry; any other is a different operation."""
    body = canon(receipt)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        with open(path, "rb") as f:
            _need(f.read() == body, "journal-conflict")
        return
    with os.fdopen(fd, "wb") as f:
        f.write(body)
        f.flush()
        os.fsync(f.fileno())


def propose(repo, url, expected, event, root, approved_url=APPROVED_URL, journal=None):
    check_repo(repo)
    scheme = _transport(url, approved_url)
    _need(_full(SHA40, expected), "expected-head")
    validate_event(event)
    chain = validate_chain(repo, fetch_head(repo, url, approved_url), root)
    shas = [c[0] for c in chain]
    _need(expected in shas, "stale-head")
    prev = chain[shas.index(expected)][1]
    fold(prev + [event])
    new, raw = _child(repo, expected, prev, event)
    receipt = {"ref": STATE_REF, "previousSha": expected, "newSha": new, "ledgerBlobSha256": sha256(raw), "proposalSha256": sha256(canon(event))}
    if shas[-1] != expected:
        # Only an exact earlier landing of THIS proposal on THIS expected head is recoverable; anything else is stale.
        _need(_landed(chain, new, expected), "stale-head")
        return receipt
    if journal:
        write_journal(journal, receipt)
    rc = _push(repo, url, new, expected, scheme)
    # Reconcile against persisted history whatever the push reported (a lost response, a timeout, a crash on the remote side).
    if _landed(validate_chain(repo, fetch_head(repo, url, approved_url), root), new, expected):
        return receipt
    _need(rc != 0, "state-ref-push-unconfirmed")
    raise Refused("state-ref-push-rejected")


def verify(repo, url, receipt, event, root, approved_url=APPROVED_URL):
    """Persisted-bytes verification of one receipt; the receipt JSON itself is never trusted (its ref must be the selected ref)."""
    check_repo(repo)
    _need(isinstance(receipt, dict) and set(receipt) == RECEIPT_KEYS, "receipt-shape")
    _need(receipt["ref"] == STATE_REF, "state-ref-not-selected")
    _need(all(_full(SHA40, receipt[k]) for k in ("previousSha", "newSha")), "receipt-shas")
    validate_event(event)
    chain = validate_chain(repo, fetch_head(repo, url, approved_url), root)
    shas = [c[0] for c in chain]
    _need(receipt["newSha"] in shas, "receipt-commit-not-on-state-ref")
    i = shas.index(receipt["newSha"])
    _need(i >= 1 and shas[i - 1] == receipt["previousSha"], "receipt-parent-mismatch")
    _need(sha256(chain[i][2]) == receipt["ledgerBlobSha256"], "receipt-ledger-bytes-mismatch")
    _need(chain[i][1][-1] == event and sha256(canon(event)) == receipt["proposalSha256"], "receipt-event-mismatch")
    return {"verified": True, "ref": STATE_REF, "newSha": receipt["newSha"], "events": len(chain[i][1])}


def publish_receipt(path, receipt):
    """Atomic, never overwriting: a private temp file linked into place; an existing identical receipt is the same operation."""
    body = canon(receipt)
    tmp = "%s.tmp-%d" % (path, os.getpid())
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(body)
            f.flush()
            os.fsync(f.fileno())
        try:
            os.link(tmp, path)
        except FileExistsError:
            with open(path, "rb") as f:
                _need(f.read() == body, "receipt-conflict")
    finally:
        os.unlink(tmp)


def propose_to_files(repo, url, expected, event, root, journal, out, approved_url=APPROVED_URL):
    """The CLI's propose: journal before the push, receipt after reconciliation. Re-running the identical command after a crash at any
    point recovers the identical receipt and appends nothing more."""
    _need(isinstance(journal, str) and isinstance(out, str) and journal != out, "journal-and-receipt-paths")
    publish_receipt(out, propose(repo, url, expected, event, root, approved_url, journal))


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("propose", "verify"))
    for flag in ("--repo", "--remote", "--root", "--expected", "--event", "--out", "--journal", "--receipt"):
        a.add_argument(flag)
    a.add_argument("--ref", default=STATE_REF)
    x = a.parse_args(argv[1:])
    try:
        _need(x.ref == STATE_REF, "state-ref-not-selected")
        _need(REVIEWED_ROOT is not None and x.root == REVIEWED_ROOT, "state-root-not-pinned")
        with open(x.event, encoding="utf-8") as f:
            event = json.load(f)
        if x.command == "propose":
            propose_to_files(x.repo, x.remote, x.expected, event, x.root, x.journal, x.out)
            return 0
        with open(x.receipt, encoding="utf-8") as f:
            verify(x.repo, x.remote, json.load(f), event, x.root)
        return 0
    except Refused as e:
        print("BLOCKED_SETUP: " + str(e), file=sys.stderr)
        return 78
    except (OSError, ValueError, TypeError, KeyError):
        print("BLOCKED_SETUP: state-ref-unreadable", file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
