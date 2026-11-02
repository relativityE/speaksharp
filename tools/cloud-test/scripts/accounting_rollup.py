#!/usr/bin/env python3
"""Accepted-rollup receiving mode (Sam 1793553421.029269, correction 1793555433.084449): cumulative usage for G5 from ONE independently
accepted, content-free accounting bootstrap, an explicitly APPROVED period scope, and the verified state-ref journal. Separate from, and
leaving unchanged, the legacy receipt validation (verify_receipts.py / reconcile_cumulative.py). SOURCE ONLY and refusing today: no bootstrap
is accepted (ACCEPTED_BOOTSTRAP_SHA256 / ACCEPTED_ROOT are None), no period scope is approved, and the state-ref writer is not activated.

  bootstrap   HISTORICAL usage only, content-free: the last defensible cumulative record's usage (coaching/runner dimensions stay null when
              unknown, never 0), the authority it was counted under (an expired one-run approval is marked expired and is never a ceiling
              for new work), and every UNRESOLVED usage item kept distinct. It defines no period and no ceiling: acceptance never invents a
              budget period.
  scope       the explicitly approved period scope for new work: its start and end, its ceilings, and its carryover rule. "none" keeps the
              historical usage out of the period's ceilings; "historical" counts it in. There is no default rule.
  receive     period usage = every settle plus every OUTSTANDING reservation (reserved, not yet settled or released) on the verified chain,
              inside the approved period. With carryover "historical", the bootstrap usage is added. Refuses an unaccepted or substituted
              bootstrap, a chain not rooted at the accepted root, an unapproved scope or carryover, a settle or reservation outside the scope,
              a replayed settle, and any unresolved item whose G5 dimensions (requests, identity reads, Starts, takes) are unknown.
              Output is the reconciliation shape G5 consumes (check_gates.py stays the cap authority, unchanged), with the historical usage
              reported beside it, never folded in silently.
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
import state_ref_writer  # noqa: E402

SCHEMA = "speaksharp.cloud-test.accounting-bootstrap.v1"
SCOPE_SCHEMA = "speaksharp.cloud-test.period-scope.v1"
# Independent acceptance: the exact bootstrap bytes and the state-ref root they anchor, pinned together by a reviewed change. None today.
ACCEPTED_BOOTSTRAP_SHA256 = None
ACCEPTED_ROOT = None
G5_KEYS = ("requests", "identityReads", "starts", "takes")
UNKNOWN_ALLOWED = ("coachingRequests", "runnerMinutes")
USAGE_KEYS = G5_KEYS + UNKNOWN_ALLOWED
CEILING_KEYS = ("requests", "protectedReserveRequests", "identityReads", "starts", "takes")
UNRESOLVED_KINDS = ("diagnostic", "evaluator-start", "reservation")
DIGEST_REF = re.compile(r"(sha256|git):[0-9a-f]{40,64}")
# Sam 1793556731.837039: a GitHub run id is an UNRESOLVED item's LOCATOR only (which run to resolve), never digest evidence or acceptance;
# it is admitted only on an UNRESOLVED item, whose usage stays null. A MEASURED item still needs a digest ref.
RUN_LOCATOR = re.compile(r"gha-run:[1-9][0-9]{0,19}")


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def _nonneg(v):
    return type(v) is int and v >= 0


def _utc(value):
    _need(isinstance(value, str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value) is not None, "rollup-utc")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        raise Refused("rollup-utc")


def _usage(u, code):
    """G5 dimensions are known non-negative integers; coaching and runner minutes may be null (unknown), never coerced to 0."""
    _need(isinstance(u, dict) and set(u) == set(USAGE_KEYS) and all(_nonneg(u[k]) for k in G5_KEYS)
          and all(u[k] is None or _nonneg(u[k]) for k in UNKNOWN_ALLOWED), code)
    return u


def parse_bootstrap(raw):
    try:
        doc = json.loads(raw)
    except (TypeError, ValueError):
        raise Refused("rollup-bootstrap-unreadable")
    _need(isinstance(doc, dict) and set(doc) == {"schema", "asOfUtc", "sourceRecords", "usage", "authority", "unresolved"}
          and doc["schema"] == SCHEMA, "rollup-bootstrap-shape")
    _utc(doc["asOfUtc"])
    _need(isinstance(doc["sourceRecords"], list) and doc["sourceRecords"] and all(isinstance(r, str) and DIGEST_REF.fullmatch(r)
                                                                                 for r in doc["sourceRecords"]), "rollup-source-records")
    _usage(doc["usage"], "rollup-usage")
    auth = doc["authority"]
    _need(isinstance(auth, dict) and set(auth) == {"approvalRef", "expired"} and isinstance(auth["approvalRef"], str) and auth["approvalRef"]
          and type(auth["expired"]) is bool, "rollup-authority")
    _need(isinstance(doc["unresolved"], list), "rollup-unresolved")
    for item in doc["unresolved"]:
        _need(isinstance(item, dict) and set(item) == {"kind", "ref", "disposition", "usage"} and item["kind"] in UNRESOLVED_KINDS
              and item["disposition"] in ("UNRESOLVED", "MEASURED") and isinstance(item["ref"], str)
              and (DIGEST_REF.fullmatch(item["ref"]) or (item["disposition"] == "UNRESOLVED" and RUN_LOCATOR.fullmatch(item["ref"]))),
              "rollup-unresolved")
        _need((item["disposition"] == "MEASURED") == (item["usage"] is not None), "rollup-unresolved")
        if item["usage"] is not None:
            _usage(item["usage"], "rollup-unresolved")
    return doc


def parse_scope(scope):
    """The explicitly approved period scope: a period, its ceilings and its carryover rule. Nothing here is defaulted."""
    _need(isinstance(scope, dict) and set(scope) == {"schema", "approvalRef", "periodStartUtc", "periodEndUtc", "carryover", "ceilings"}
          and scope["schema"] == SCOPE_SCHEMA and isinstance(scope["approvalRef"], str) and scope["approvalRef"], "rollup-period-scope-unapproved")
    _need(_utc(scope["periodStartUtc"]) < _utc(scope["periodEndUtc"]), "rollup-period-scope-unapproved")
    _need(scope["carryover"] in ("none", "historical"), "rollup-carryover-unapproved")
    _need(isinstance(scope["ceilings"], dict) and set(scope["ceilings"]) == set(CEILING_KEYS)
          and all(_nonneg(v) for v in scope["ceilings"].values()), "rollup-ceilings")
    return scope


def _add(total, usage):
    for k in USAGE_KEYS:
        total[k] = None if total[k] is None or usage.get(k) is None else total[k] + usage[k]


def _allocation_usage(allocation):
    return {"requests": allocation["requests"], "identityReads": allocation["identityReads"], "starts": allocation["starts"],
            "takes": allocation["takes"], "coachingRequests": allocation["coachingRequests"], "runnerMinutes": allocation["runnerMinutes"]}


def receive(bootstrap_raw, scope, chain, accepted_sha256=None, accepted_root=None):
    """Prior usage for G5 from the accepted bootstrap, the approved period scope and the VERIFIED state-ref chain (as returned by
    state_ref_writer.validate_chain from the accepted root). `accepted_*` are TEST-ONLY overrides of the module pins."""
    pin = ACCEPTED_BOOTSTRAP_SHA256 if accepted_sha256 is None else accepted_sha256
    root = ACCEPTED_ROOT if accepted_root is None else accepted_root
    _need(pin is not None and root is not None, "rollup-not-accepted")
    _need(isinstance(bootstrap_raw, bytes) and hashlib.sha256(bootstrap_raw).hexdigest() == pin, "rollup-bootstrap-not-accepted")
    doc = parse_bootstrap(bootstrap_raw)
    _need(all(item["disposition"] == "MEASURED" for item in doc["unresolved"]), "rollup-unresolved-usage")
    scope = parse_scope(scope)
    _need(isinstance(chain, list) and chain and chain[0][0] == root and chain[0][1] == [], "rollup-predecessor-gap")
    p_start, p_end = _utc(scope["periodStartUtc"]), _utc(scope["periodEndUtc"])
    historical = dict(doc["usage"])
    for item in doc["unresolved"]:
        _add(historical, item["usage"])
    period = {k: 0 for k in USAGE_KEYS}
    open_reservations, settled = {}, set()
    for e in chain[-1][1]:
        key = (e["campaignId"], e["runId"], e["attempt"])
        _need(p_start <= _utc(e["atUtc"]) < p_end, "rollup-event-outside-period")
        if e["type"] == "reserve":
            open_reservations[key] = e["allocation"]
        elif e["type"] == "settle":
            _need(key not in settled, "rollup-settle-replayed")
            settled.add(key)
            open_reservations.pop(key, None)
            _add(period, _allocation_usage(e["allocation"]))
        else:
            open_reservations.pop(key, None)
    for allocation in open_reservations.values():  # outstanding reservations count as used until settled or released
        _add(period, _allocation_usage(allocation))
    counted = dict(period)
    if scope["carryover"] == "historical":
        _add(counted, historical)
    c = scope["ceilings"]
    return {"source": "accepted-rollup", "bootstrapSha256": pin, "root": root, "headSha": chain[-1][0], "scopeApprovalRef": scope["approvalRef"],
            "carryover": scope["carryover"], "historical": historical, "period": period, "outstandingReservations": len(open_reservations),
            "requests": {"conservativeUsed": counted["requests"], "ownerCounted": counted["requests"]},
            "identityReads": {"conservativeUsed": counted["identityReads"], "ownerCounted": counted["identityReads"]},
            "starts": {"ownerCounted": counted["starts"]}, "takes": {"ownerCounted": counted["takes"]},
            "unknown": {k: counted[k] is None for k in UNKNOWN_ALLOWED}, "ceilings": dict(c),
            "currentHeadroom": {"requests": c["requests"] - c["protectedReserveRequests"] - counted["requests"],
                                "identityReads": c["identityReads"] - counted["identityReads"],
                                "starts": c["starts"] - counted["starts"], "takes": c["takes"] - counted["takes"]}}


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("receive",))
    for flag in ("--bootstrap", "--scope", "--repo", "--out"):
        a.add_argument(flag, required=True)
    x = a.parse_args(argv[1:])
    try:
        _need(ACCEPTED_BOOTSTRAP_SHA256 is not None and ACCEPTED_ROOT is not None, "rollup-not-accepted")
        with open(x.bootstrap, "rb") as f:
            raw = f.read()
        with open(x.scope, encoding="utf-8") as f:
            scope = json.load(f)
        chain = state_ref_writer.validate_chain(x.repo, state_ref_writer.fetch_head(x.repo, state_ref_writer.APPROVED_URL,
                                                                                    state_ref_writer.APPROVED_URL), ACCEPTED_ROOT)
        out = receive(raw, scope, chain)
        fd = os.open(x.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(out, f, sort_keys=True)
        return 0
    except (Refused, state_ref_writer.Refused) as e:
        print("BLOCKED_SETUP: " + str(e), file=sys.stderr)
        return 78
    except (OSError, ValueError, KeyError, TypeError):
        print("BLOCKED_SETUP: rollup-inputs-unreadable", file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
