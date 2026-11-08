#!/usr/bin/env python3
"""Runtime authority for the plan's reservation binding (Sam RETURN 1794116817; 1794117109; 1794117662).

reservation_binding.verify (run_env / build_plan) proves a private file's bytes and its reconciliation parent, NOT that its allocation came
from the journal: a copied parent/head with an altered allocation passes it. This check, in the run stage, recomputes the authority from ONE
authenticated read of the whole state-ref chain through the existing approved path (check_gates.authenticated_state_chain: a fresh fetch of
the approved remote, validated from the reviewed root actually used) instead of trusting the binding or any reloaded file:

  check-plan  after the occurrence receiver: the receiver's snapshot file must EQUAL the authenticated head and events; the binding's
              journalRootSha must equal the reviewed root the chain was validated from; reconciliationHeadSha must equal BOTH the accepted
              reconciliation checkpoint's headSha and the authenticated parent of the head (head = parent + exactly this run's reserve);
              this run's own reserve (provenance = the admitted request digest, campaign = the request's runId, run/attempt = GitHub's job
              fields) must be OPEN and the LAST event; journal head, canonical event digest, allocation digest and identityReads must EQUAL
              the authenticated values and the plan's identityReserved; tested release == the verified request's; harness source ==
              CT_SOURCE_SHA == the HARNESS checkout HEAD.
  pre-start   immediately before the campaign starts: a fresh authenticated read; the same root, parent, head and the same FULL own reserve.

Both commands verify the plan's bytes against --plan-sha256, the digest campaign-runner is also given, so every check applies to the same plan.
Preparation-time authority (prepare) and runtime freshness (receiver, check-plan, pre-start) are distinct. A race after pre-start and during
execution remains: a post-run settle can detect but neither prevent nor undo it; branch protection on the state ref is not assumed.
A plan without a binding passes unchanged unless it enables shared identity boundaries. Exit 78 on every refusal, including an unavailable or
unauthenticated journal read."""
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


def authenticated_view(chain, reviewed_root):
    """The root, parent and head of a chain validated from the reviewed root (entries: (sha, events, ledger bytes))."""
    _need(isinstance(chain, list) and len(chain) >= 2 and isinstance(reviewed_root, str) and chain[0][0] == reviewed_root, "runtime-journal-root")
    return {"root": chain[0][0], "parentHead": chain[-2][0], "parentEvents": chain[-2][1], "head": chain[-1][0], "events": chain[-1][1]}


def authenticated_snapshot(snapshot_file_doc, view):
    """Sam 1794117109: never trust a reloaded snapshot file: it must EQUAL the authenticated head and events (the receiver's own rule)."""
    _need(isinstance(snapshot_file_doc, dict) and snapshot_file_doc.get("headSha") == view["head"] and snapshot_file_doc.get("events") == view["events"],
          "runtime-snapshot-not-authenticated")
    return view


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


def _same_journal_and_reserve(b, view, run_id, attempt, request_sha256, identity_reserved):
    """Sam 1794117662: root and reconciliation parent are compared too, not only head and reserve."""
    _need(b["journalRootSha"] == view["root"], "runtime-binding-journal-root")
    _need(b["reconciliationHeadSha"] == view["parentHead"] and view["parentEvents"] == view["events"][:-1], "runtime-binding-reconciliation")
    _need(b["journalHeadSha"] == view["head"], "runtime-binding-journal-head")
    event = own_last_open_reserve(view["events"], b["campaignId"], run_id, attempt, request_sha256)
    alloc = event.get("allocation")
    _need(isinstance(alloc, dict) and type(alloc.get("identityReads")) is int, "runtime-reserve-allocation")
    _need(b["reserveEventSha256"] == hashlib.sha256(_canon(event)).hexdigest(), "runtime-binding-reserve-event")
    _need(b["allocationSha256"] == hashlib.sha256(_canon(alloc)).hexdigest(), "runtime-binding-allocation")
    _need(b["identityReads"] == alloc["identityReads"] == identity_reserved, "runtime-binding-identity-reads")


def _binding(plan):
    b = plan.get("reservationBinding")
    if b is None:
        _need(plan.get("sharedIdentityBoundaries") is not True, "runtime-binding-missing")
        return None
    _need(isinstance(b, dict) and set(b) == RB.KEYS and b.get("schema") == RB.SCHEMA, "runtime-binding-shape")
    return b


def check_plan(plan, view, request, request_sha256, run_id, attempt, source_sha, checkout_head, reconciliation_head):
    b = _binding(plan)
    if b is None:
        return None
    campaign = request.get("runId")
    _need(b["campaignId"] == campaign == plan.get("campaignId"), "runtime-binding-campaign")
    _need(b["requestSha256"] == request_sha256 == plan.get("requestSha256"), "runtime-binding-request")
    _need(isinstance(run_id, str) and run_id and b["runId"] == run_id == str((plan.get("executionIdentity") or {}).get("runId"))
          and b["attempt"] == attempt == (plan.get("executionIdentity") or {}).get("attempt"), "runtime-binding-execution")
    _need(b["testedSha"] == (request.get("release") or {}).get("testedSha"), "runtime-binding-tested-release")
    _need(isinstance(source_sha, str) and source_sha and b["harnessSourceSha"] == source_sha == checkout_head, "runtime-binding-harness-source")
    _need(isinstance(reconciliation_head, str) and b["reconciliationHeadSha"] == reconciliation_head, "runtime-binding-reconciliation")
    _same_journal_and_reserve(b, view, run_id, attempt, request_sha256, plan.get("identityReserved"))
    return b


def pre_start(plan, view, request_sha256, run_id, attempt):
    b = _binding(plan)
    if b is None:
        return None
    _need(view["head"] == b["journalHeadSha"], "runtime-journal-changed-before-start")
    _same_journal_and_reserve(b, view, run_id, attempt, request_sha256, plan.get("identityReserved"))
    return view["head"]


def _authenticated_view():
    """The one production read: check_gates' approved path, validated from the root it actually used (no CLI/env-selectable target)."""
    import check_gates
    import state_ref_writer as W
    return authenticated_view(check_gates.authenticated_state_chain(), check_gates.JOURNAL_ROOT or W.REVIEWED_ROOT)


def _load(path):
    with open(path, "rb") as f:
        raw = f.read()
    return raw, json.loads(raw)


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("check-plan", "pre-start"))
    for flag in ("--plan", "--plan-sha256", "--journal-snapshot", "--reconciliation", "--request", "--request-sha256", "--source-sha", "--run-id",
                 "--attempt", "--repo"):
        a.add_argument(flag)
    x = a.parse_args(argv[1:])
    try:
        _need(bool(x.plan), "runtime-inputs")
        plan_raw, plan = _load(x.plan)
        if plan.get("reservationBinding") is None and plan.get("sharedIdentityBoundaries") is not True:
            return 0                                   # unshared, unbound plans (nightly and every existing plan) are unchanged
        # Sam 1794117662: the SAME plan bytes campaign-runner is given (its --plan-sha256), so every check applies to one version of the file
        _need(isinstance(x.plan_sha256, str) and hashlib.sha256(plan_raw).hexdigest() == x.plan_sha256, "runtime-plan-digest")
        _need(bool(x.request_sha256 and x.run_id and x.attempt and x.attempt.isdigit()), "runtime-inputs")
        attempt = int(x.attempt)
        if x.command == "check-plan":
            _need(bool(x.journal_snapshot and x.request and x.reconciliation), "runtime-inputs")
            req_raw, request = _load(x.request)
            _need(hashlib.sha256(req_raw).hexdigest() == x.request_sha256, "runtime-binding-request")
            _, snapshot_file = _load(x.journal_snapshot)
            _, reconciliation = _load(x.reconciliation)
            view = _authenticated_view()
            authenticated_snapshot(snapshot_file, view)
            head = subprocess.run(["git", "-C", x.repo or ".", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            check_plan(plan, view, request, x.request_sha256, x.run_id, attempt, x.source_sha, head,
                       reconciliation.get("headSha") if isinstance(reconciliation, dict) else None)
        else:
            pre_start(plan, _authenticated_view(), x.request_sha256, x.run_id, attempt)
        return 0
    except (Refused, RB.Refused) as e:
        print("BLOCKED_SETUP: %s" % e, file=sys.stderr)
        return 78
    except Exception as e:  # noqa: BLE001  fail closed on ANY unavailable/unauthenticated read (state_ref_writer.Refused included)
        print("BLOCKED_SETUP: runtime-binding-unverifiable (%s)" % type(e).__name__, file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
