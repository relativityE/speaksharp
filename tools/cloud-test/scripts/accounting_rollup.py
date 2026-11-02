#!/usr/bin/env python3
"""Accepted-rollup receiving mode (Sam 1793553421.029269, correction 1793555433.084449): cumulative usage for G5 from ONE independently
accepted, content-free accounting bootstrap, an explicitly APPROVED period scope, and the verified state-ref journal. Separate from, and
leaving unchanged, the legacy receipt validation (verify_receipts.py / reconcile_cumulative.py). The independently reviewed R10 bootstrap,
fresh-period scope and state-ref root are pinned below; every substituted byte or root still refuses.

  bootstrap   HISTORICAL usage only, content-free: the last defensible cumulative record's usage (coaching/runner dimensions stay null when
              unknown, never 0), the authority it was counted under (an expired one-run approval is marked expired and is never a ceiling
              for new work), and every UNRESOLVED usage item kept distinct. It defines no period and no ceiling: acceptance never invents a
              budget period.
  scope       the explicitly approved period scope for new work: its start and end, its ceilings, and its carryover rule. "none" keeps the
              historical usage out of the period's ceilings; "historical" counts it in. There is no default rule.
  receive     period usage = every settle plus every OUTSTANDING reservation (reserved, not yet settled or released) on the verified chain,
              inside the approved period. With carryover "historical", the bootstrap usage is added and every historical item must be resolved.
              With explicitly approved carryover "none", unresolved historical items remain visible as unresolved but cannot block or be charged
              into the fresh period: they are never converted to zero and the output labels the historical total incomplete. Refuses an unaccepted
              or substituted bootstrap, a chain not rooted at the accepted root, an unapproved scope or carryover, a settle or reservation outside
              the scope, a replayed settle, and unresolved history whenever historical carryover was selected. Historical items may be MEASURED,
              or BOUNDED only when their full charged upper bound is tied to distinct reviewed source, enforcement control and result digests.
              BOUNDED is retained as separate provenance and is never reported as MEASURED.
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
# Independent acceptance for the single PO-approved R10 manual period.  The
# historical bootstrap remains content-free and its unresolved entries remain
# unresolved; the separately pinned scope selects carryover:none.
ACCEPTED_BOOTSTRAP_SHA256 = "0a3e60271dc703f12cf02684450a9f74bc7f60d5c3f610a86bb9eaddc268f174"
ACCEPTED_ROOT = "92d6ebf902351750c368d7d513116c6b1f19f80c"
G5_KEYS = ("requests", "identityReads", "starts", "takes")
UNKNOWN_ALLOWED = ("coachingRequests", "runnerMinutes")
USAGE_KEYS = G5_KEYS + UNKNOWN_ALLOWED
CEILING_KEYS = ("requests", "protectedReserveRequests", "identityReads", "starts", "takes")
UNRESOLVED_KINDS = ("diagnostic", "evaluator-start", "reservation")
DIGEST_REF = re.compile(r"(sha256|git):[0-9a-f]{40,64}")
BOUND_SCHEMA = "speaksharp.cloud-test.accounting-upper-bound.v1"
BOUND_METHODS = ("enforced-maximum", "exhaustive-accounting")
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


def _canon(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("ascii")


def _bound_result_ref(result):
    """Digest of the exact, content-free result bytes embedded in the accepted bootstrap."""
    return "sha256:" + hashlib.sha256(_canon(result)).hexdigest()


def _bound_result_map(doc):
    return {_bound_result_ref(result): result for result in doc.get("boundResults", [])}


def parse_bootstrap(raw):
    try:
        doc = json.loads(raw)
    except (TypeError, ValueError):
        raise Refused("rollup-bootstrap-unreadable")
    base_keys = {"schema", "asOfUtc", "sourceRecords", "usage", "authority", "unresolved"}
    _need(isinstance(doc, dict) and set(doc) in (base_keys, base_keys | {"boundResults"})
          and doc["schema"] == SCHEMA, "rollup-bootstrap-shape")
    _utc(doc["asOfUtc"])
    _need(isinstance(doc["sourceRecords"], list) and doc["sourceRecords"] and all(isinstance(r, str) and DIGEST_REF.fullmatch(r)
                                                                                 for r in doc["sourceRecords"]), "rollup-source-records")
    _usage(doc["usage"], "rollup-usage")
    auth = doc["authority"]
    _need(isinstance(auth, dict) and set(auth) == {"approvalRef", "expired"} and isinstance(auth["approvalRef"], str) and auth["approvalRef"]
          and type(auth["expired"]) is bool, "rollup-authority")
    _need(isinstance(doc["unresolved"], list), "rollup-unresolved")
    results = {}
    source_records = set(doc["sourceRecords"])
    for result in doc.get("boundResults", []):
        _need(isinstance(result, dict) and set(result) == {
            "schema", "itemRef", "method", "sourceRef", "controlRef", "reviewRef", "observedMinimum", "upperBound"
        } and result["schema"] == BOUND_SCHEMA and result["method"] in BOUND_METHODS, "rollup-bound-result")
        refs = (result["sourceRef"], result["controlRef"], result["reviewRef"])
        _need(all(isinstance(ref, str) and DIGEST_REF.fullmatch(ref) and ref in source_records for ref in refs)
              and len(set(refs)) == len(refs), "rollup-bound-result")
        observed = _usage(result["observedMinimum"], "rollup-bound-result")
        upper = _usage(result["upperBound"], "rollup-bound-result")
        _need(all(observed[key] is None or (upper[key] is not None and upper[key] >= observed[key])
                  for key in USAGE_KEYS), "rollup-bound-understated")
        result_ref = _bound_result_ref(result)
        _need(result_ref in source_records, "rollup-bound-result-unanchored")
        _need(result_ref not in refs, "rollup-bound-result")
        _need(result_ref not in results, "rollup-bound-evidence-duplicate")
        results[result_ref] = result
    used_results = set()
    for item in doc["unresolved"]:
        disposition = item.get("disposition") if isinstance(item, dict) else None
        keys = {"kind", "ref", "disposition", "usage", "boundResultRef"} if disposition == "BOUNDED" else {
            "kind", "ref", "disposition", "usage"
        }
        _need(isinstance(item, dict) and set(item) == keys and item["kind"] in UNRESOLVED_KINDS
              and disposition in ("UNRESOLVED", "MEASURED", "BOUNDED") and isinstance(item["ref"], str)
              and (DIGEST_REF.fullmatch(item["ref"]) or (disposition in ("UNRESOLVED", "BOUNDED") and RUN_LOCATOR.fullmatch(item["ref"]))),
              "rollup-unresolved")
        _need((disposition != "UNRESOLVED") == (item["usage"] is not None), "rollup-unresolved")
        if item["usage"] is not None:
            _usage(item["usage"], "rollup-unresolved")
        if disposition == "BOUNDED":
            result_ref = item["boundResultRef"]
            _need(isinstance(result_ref, str) and DIGEST_REF.fullmatch(result_ref) and result_ref in results,
                  "rollup-bound-evidence-missing")
            evidence = results[result_ref]
            _need(evidence["itemRef"] == item["ref"], "rollup-bound-evidence-unrelated")
            _need(any(item["usage"][key] > 0 for key in G5_KEYS), "rollup-bound-zero")
            _need(evidence["upperBound"] == item["usage"], "rollup-bound-understated")
            _need(result_ref not in used_results, "rollup-bound-evidence-duplicate")
            used_results.add(result_ref)
    _need(used_results == set(results), "rollup-bound-evidence-unrelated")
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


def checkpoint_bytes(rollup):
    """The continuity checkpoint's canonical bytes: what an action approval's reconciliationSha256 names and the stage runner consumes.
    One definition for init_run_inputs (prepare) and manual_reservation (the writer job's pre-append admission)."""
    return (json.dumps(rollup, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")


def receive(bootstrap_raw, scope, chain, accepted_sha256=None, accepted_root=None):
    """Prior usage for G5 from the accepted bootstrap, the approved period scope and the VERIFIED state-ref chain (as returned by
    state_ref_writer.validate_chain from the accepted root). `accepted_*` are TEST-ONLY overrides of the module pins."""
    pin = ACCEPTED_BOOTSTRAP_SHA256 if accepted_sha256 is None else accepted_sha256
    root = ACCEPTED_ROOT if accepted_root is None else accepted_root
    _need(pin is not None and root is not None, "rollup-not-accepted")
    _need(isinstance(bootstrap_raw, bytes) and hashlib.sha256(bootstrap_raw).hexdigest() == pin, "rollup-bootstrap-not-accepted")
    doc = parse_bootstrap(bootstrap_raw)
    scope = parse_scope(scope)
    # A no-carryover period excludes only activity that is demonstrably before
    # the approved period.  If the retained cutoff overlaps or follows the
    # period start, the omitted interval is current-period usage and must not be
    # hidden behind the fresh-period boundary.
    _need(scope["carryover"] != "none" or _utc(doc["asOfUtc"]) <= _utc(scope["periodStartUtc"]),
          "rollup-bootstrap-overlaps-fresh-period")
    historical_incomplete = any(item["disposition"] == "UNRESOLVED" for item in doc["unresolved"])
    _need(scope["carryover"] == "none" or not historical_incomplete, "rollup-unresolved-usage")
    _need(isinstance(chain, list) and chain and chain[0][0] == root and chain[0][1] == [], "rollup-predecessor-gap")
    p_start, p_end = _utc(scope["periodStartUtc"]), _utc(scope["periodEndUtc"])
    historical = dict(doc["usage"])
    for item in doc["unresolved"]:
        if item["usage"] is not None:
            _add(historical, item["usage"])
    period = {k: 0 for k in USAGE_KEYS}
    open_reservations, open_provenance, settled = {}, {}, set()
    for e in chain[-1][1]:
        key = (e["campaignId"], e["runId"], e["attempt"])
        _need(p_start <= _utc(e["atUtc"]) < p_end, "rollup-event-outside-period")
        if e["type"] == "reserve":
            open_reservations[key] = e["allocation"]
            open_provenance[key] = e.get("provenance", "")
        elif e["type"] == "settle":
            _need(key not in settled, "rollup-settle-replayed")
            settled.add(key)
            open_reservations.pop(key, None)
            _add(period, _allocation_usage(e["allocation"]))
        else:
            open_reservations.pop(key, None)
    for allocation in open_reservations.values():  # outstanding reservations count as used until settled or released
        _add(period, _allocation_usage(allocation))
    # #1772 review 4446137335: which open reservations a request holds, keyed by its admitted request digest (the reserve's provenance) AND
    # the reservation's campaign, so a run's own reservation, already counted above, is not charged again by its Start check. Review
    # 4446862226: a Case 10 observation reserve shares the request's provenance under its own campaign (<runId>.case10-observation), so the
    # campaign is part of the key; a second open reserve of the SAME request and campaign stays visible (count 2) and the consumer refuses it.
    # Review 4447628949: every G5 dimension of the held allocation is carried (G5_KEYS), so requests and identity reads are discounted
    # once exactly like Starts/takes.
    by_request = {}
    for key, allocation in open_reservations.items():
        provenance = open_provenance.get(key, "")
        if provenance.startswith("request-sha256:"):
            slot = by_request.setdefault(provenance[len("request-sha256:"):], {}).setdefault(key[0], {"count": 0, **{k: 0 for k in G5_KEYS}})
            slot["count"] += 1
            for k in G5_KEYS:
                slot[k] += allocation[k]
    counted = dict(period)
    if scope["carryover"] == "historical":
        _add(counted, historical)
    c = scope["ceilings"]
    bound_results = _bound_result_map(doc)
    resolution = [{"kind": item["kind"], "ref": item["ref"], "disposition": item["disposition"], "usage": item["usage"],
                   **({"boundEvidence": {"resultRef": item["boundResultRef"], **{
                       k: bound_results[item["boundResultRef"]][k]
                       for k in ("method", "sourceRef", "controlRef", "reviewRef")}}}
                      if item["disposition"] == "BOUNDED" else {})} for item in doc["unresolved"]]
    return {"source": "accepted-rollup", "bootstrapSha256": pin, "root": root, "headSha": chain[-1][0], "scopeApprovalRef": scope["approvalRef"],
            "carryover": scope["carryover"], "historical": historical, "historicalIncomplete": historical_incomplete,
            "period": period, "outstandingReservations": len(open_reservations),
            "openReservationsByRequest": {k: {c: by_request[k][c] for c in sorted(by_request[k])} for k in sorted(by_request)},
            "historicalResolution": resolution,
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
