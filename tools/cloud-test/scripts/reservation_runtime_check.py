#!/usr/bin/env python3
"""Runtime authority for the plan's reservation binding (Sam RETURN 1794116817 on 0aefd32d).

reservation_binding.verify (run_env / build_plan) proves a private file's bytes and its reconciliation parent, NOT that its allocation came from
the journal: a copied parent/head with an altered allocation passes it. This check, in the run stage AFTER the occurrence receiver accepted the
journal snapshot against a FRESHLY AUTHENTICATED chain, recomputes the authority instead of trusting the binding:

  check-plan  this run's own reserve is recomputed from the authenticated events (provenance = the admitted request digest, campaign = the
              request's runId, run/attempt = GitHub's actual job fields) and must be OPEN and the LAST event; its canonical event digest,
              allocation digest and identityReads, and the snapshot head, must EQUAL the plan's binding and identityReserved; the binding's
              tested release must equal the verified request's, and its harness source the stage's CT_SOURCE_SHA and the checkout HEAD.
  pre-start   immediately before the campaign starts, one more read through the existing approved path (check_gates.authenticated_chain):
              the head must still be the binding's and this run's reserve still the open last event.

Preparation-time authority (prepare) and runtime freshness (receiver, check-plan, pre-start) are distinct. A race after pre-start and during
execution remains: a post-run settle can detect but neither prevent nor undo it; branch protection on the state ref is not assumed.
A plan without a binding passes unchanged unless it enables shared identity boundaries. Exit 78 on every refusal."""
import argparse
import hashlib
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (the one journal read is state_ref_writer's git subprocess)
import reservation_binding as RB  # noqa: E402


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def _canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":")).encode()


def own_last_open_reserve(events, campaign_id, run_id, attempt, request_sha256):
    """This run's one reserve, open (no settle/release of it) and the LAST event; anything else refuses."""
    _need(isinstance(events, list) and events, "runtime-reserve-missing")
    closed = {(e.get("campaignId"), e.get("runId"), e.get("attempt")) for e in events if isinstance(e, dict) and e.get("type") in ("settle", "release")}
    own = [e for e in events if isinstance(e, dict) and e.get("type") == "reserve" and e.get("campaignId") == campaign_id
           and e.get("runId") == run_id and e.get("attempt") == attempt and e.get("provenance") == "request-sha256:" + request_sha256]
    _need(len(own) == 1, "runtime-reserve-missing")
    _need((campaign_id, run_id, attempt) not in closed, "runtime-reserve-closed")
    _need(events[-1] == own[0], "runtime-reserve-not-last")
    return own[0]


def authenticated_snapshot(snapshot_file_doc, authenticated):
    """Sam 1794117109: never trust a reloaded snapshot file. The file the receiver accepted must EQUAL a fresh read through the approved path
    (check_gates.authenticated_chain, the receiver's own rule), and only the authenticated head and events are used from here on."""
    head, events = authenticated
    _need(isinstance(snapshot_file_doc, dict) and snapshot_file_doc.get("headSha") == head and snapshot_file_doc.get("events") == events,
          "runtime-snapshot-not-authenticated")
    return {"headSha": head, "events": events}


def _same_reserve(b, event, identity_reserved):
    alloc = event.get("allocation")
    _need(isinstance(alloc, dict) and type(alloc.get("identityReads")) is int, "runtime-reserve-allocation")
    _need(b["reserveEventSha256"] == hashlib.sha256(_canon(event)).hexdigest(), "runtime-binding-reserve-event")
    _need(b["allocationSha256"] == hashlib.sha256(_canon(alloc)).hexdigest(), "runtime-binding-allocation")
    _need(b["identityReads"] == alloc["identityReads"] == identity_reserved, "runtime-binding-identity-reads")


def check_plan(plan, snapshot, request, request_sha256, run_id, attempt, source_sha, checkout_head):
    b = plan.get("reservationBinding")
    if b is None:
        _need(plan.get("sharedIdentityBoundaries") is not True, "runtime-binding-missing")
        return None
    _need(isinstance(b, dict) and set(b) == RB.KEYS and b.get("schema") == RB.SCHEMA, "runtime-binding-shape")
    _need(isinstance(snapshot, dict) and isinstance(snapshot.get("headSha"), str) and isinstance(snapshot.get("events"), list), "runtime-snapshot")
    campaign = request.get("runId")
    _need(b["campaignId"] == campaign == plan.get("campaignId"), "runtime-binding-campaign")
    _need(b["requestSha256"] == request_sha256 == plan.get("requestSha256"), "runtime-binding-request")
    _need(isinstance(run_id, str) and run_id and b["runId"] == run_id == str((plan.get("executionIdentity") or {}).get("runId"))
          and b["attempt"] == attempt == (plan.get("executionIdentity") or {}).get("attempt"), "runtime-binding-execution")
    _need(b["testedSha"] == (request.get("release") or {}).get("testedSha"), "runtime-binding-tested-release")
    _need(isinstance(source_sha, str) and source_sha and b["harnessSourceSha"] == source_sha == checkout_head, "runtime-binding-harness-source")
    event = own_last_open_reserve(snapshot["events"], campaign, run_id, attempt, request_sha256)
    _need(b["journalHeadSha"] == snapshot["headSha"], "runtime-binding-journal-head")
    _same_reserve(b, event, plan.get("identityReserved"))
    return b


def pre_start(plan, authenticated, request_sha256, run_id, attempt):
    b = plan.get("reservationBinding")
    if b is None:
        _need(plan.get("sharedIdentityBoundaries") is not True, "runtime-binding-missing")
        return None
    head, events = authenticated
    _need(head == b.get("journalHeadSha"), "runtime-journal-changed-before-start")
    event = own_last_open_reserve(events, b.get("campaignId"), run_id, attempt, request_sha256)
    _same_reserve(b, event, plan.get("identityReserved"))          # Sam 1794117109: the FULL own reserve and allocation, not just head/open
    return head


def _load(path):
    with open(path, "rb") as f:
        raw = f.read()
    return raw, json.loads(raw)


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("check-plan", "pre-start"))
    for flag in ("--plan", "--journal-snapshot", "--request", "--request-sha256", "--source-sha", "--run-id", "--attempt", "--repo"):
        a.add_argument(flag)
    x = a.parse_args(argv[1:])
    try:
        _need(bool(x.plan), "runtime-inputs")
        _, plan = _load(x.plan)
        if plan.get("reservationBinding") is None and plan.get("sharedIdentityBoundaries") is not True:
            return 0                                   # unshared, unbound plans (nightly and every existing plan) are unchanged
        _need(bool(x.request_sha256 and x.run_id and x.attempt and x.attempt.isdigit()), "runtime-inputs")
        attempt = int(x.attempt)
        if x.command == "check-plan":
            _need(bool(x.journal_snapshot and x.request), "runtime-inputs")
            req_raw, request = _load(x.request)
            _need(hashlib.sha256(req_raw).hexdigest() == x.request_sha256, "runtime-binding-request")
            _, snapshot_file = _load(x.journal_snapshot)
            if plan.get("reservationBinding") is not None:
                import check_gates
                snapshot = authenticated_snapshot(snapshot_file, check_gates.authenticated_chain())
            else:
                snapshot = snapshot_file
            head = subprocess.run(["git", "-C", x.repo or ".", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            check_plan(plan, snapshot, request, x.request_sha256, x.run_id, attempt, x.source_sha, head)
        else:
            import check_gates
            pre_start(plan, check_gates.authenticated_chain(), x.request_sha256, x.run_id, attempt)
        return 0
    except (Refused, RB.Refused) as e:
        print("BLOCKED_SETUP: %s" % e, file=sys.stderr)
        return 78
    except (OSError, ValueError, KeyError, TypeError) as e:
        print("BLOCKED_SETUP: runtime-binding-unreadable (%s)" % type(e).__name__, file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
