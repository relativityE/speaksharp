"""Case 10 component request bound (R5 dossier, Case 10): a planning report, never an allocation.

The per-case allowance stays the fixed, already-enforced 240 (campaign-ledger.cjs refuses request 241). This module only
instantiates the dossier's component sum from a content-free starting-state projection and reports whether that sum fits.
Every input is required: a missing, unknown, negative, boolean or non-integer value is refused, never treated as zero.
It cannot raise the allowance (there is no allowance input) and it authorizes nothing.
Usage: case10_request_bound.py PROJECTION.json   prints the report as JSON; exit 78 when the projection is refused.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline: every network call fails and is counted)

ALLOWANCE = 240             # campaign-ledger.cjs per-case allowance; fixed here, never an input
SCANS = 6                   # owner-session snapshots in the recovery schedule
OTHER_HARNESS_GETS = 6      # the six explicit non-scan harness GETs, including the single post-fence tail GET
PAGE_ROWS = 100             # owner-query.cjs range size
MAX_PAGES = 11              # owner-query.cjs refuses a range starting above 1000, before HTTP
HEARTBEAT_MS = 5000         # recordingLease.ts heartbeat period
OBLIGATION_PAGE = 50        # recordProgress.ts obligation page size
OBLIGATION_PAGES_MAX = 20

LIST_INPUTS = ("snapshotSizes", "leaseHeldIntervalsMs", "scanObligationCounts", "loadQueueSizes")
COUNT_INPUTS = ("saveEvaluationInvocations", "distinctRetryDebtsUpperBound", "historyQueryLifecycles",
                "recommendationSettlementInvocations", "cancelledAttempts", "localRetrySkips",
                "bootstrap", "auth", "navigation", "modelAcquisition", "preflights", "successorSave", "evidenceTail")
INPUTS = frozenset(LIST_INPUTS + COUNT_INPUTS)


class BoundRefused(ValueError):
    pass


def _count(value, name):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise BoundRefused("INPUT_NOT_A_COUNT:" + name)
    return value


def compute(projection):
    """Return the component report for a content-free projection, or raise BoundRefused."""
    if not isinstance(projection, dict):
        raise BoundRefused("PROJECTION_NOT_AN_OBJECT")
    missing, unknown = INPUTS - projection.keys(), projection.keys() - INPUTS
    if missing:
        raise BoundRefused("INPUT_MISSING:" + ",".join(sorted(missing)))
    if unknown:
        raise BoundRefused("INPUT_UNKNOWN:" + ",".join(sorted(unknown)))
    lists = {}
    for name in LIST_INPUTS:
        value = projection[name]
        if not isinstance(value, list):
            raise BoundRefused("INPUT_NOT_A_LIST:" + name)
        lists[name] = [_count(v, name) for v in value]
    counts = {name: _count(projection[name], name) for name in COUNT_INPUTS}
    sizes = lists["snapshotSizes"]
    if len(sizes) != SCANS:
        raise BoundRefused("SNAPSHOT_COUNT_DIFFERS")
    if any(n > PAGE_ROWS * MAX_PAGES for n in sizes):
        raise BoundRefused("SNAPSHOT_EXCEEDS_READ_CAPACITY")    # a complete read is impossible; never truncate
    components = {
        "harness": OTHER_HARNESS_GETS + sum(max(1, -(-n // PAGE_ROWS)) for n in sizes),
        "heartbeat": sum(t // HEARTBEAT_MS for t in lists["leaseHeldIntervalsMs"]),
        "obligations": sum(min(OBLIGATION_PAGES_MAX, n // OBLIGATION_PAGE + 1) for n in lists["scanObligationCounts"]),
        # Released debt retried on a later authenticated load is a separate, charged attempt (each load's queue counts);
        # a local 250 ms retry skip is not an HTTP request, so localRetrySkips is declared but contributes nothing.
        "evaluation": (3 * counts["saveEvaluationInvocations"] + sum(lists["loadQueueSizes"])
                       + 3 * counts["distinctRetryDebtsUpperBound"]),
        "history": 6 * counts["historyQueryLifecycles"],
        "recommendation": 4 * counts["recommendationSettlementInvocations"],
        "cancelledAttempts": counts["cancelledAttempts"],
        "localRetrySkips": 0,
    }
    for name in ("bootstrap", "auth", "navigation", "modelAcquisition", "preflights", "successorSave", "evidenceTail"):
        components[name] = counts[name]
    total = sum(components.values())
    return {"schema": "speaksharp.cloud-test.case10-request-bound.v1", "caseId": "AHT-10",
            "allowance": ALLOWANCE, "components": components, "transmittedBound": total,
            "fitsAllowance": total <= ALLOWANCE,
            "harnessAttemptedCeiling": OTHER_HARNESS_GETS + SCANS * MAX_PAGES,
            "authority": "planning report only; allocation and run scope need a separate selection"}


def main(argv):
    if len(argv) != 2:
        print("usage: case10_request_bound.py PROJECTION.json", file=sys.stderr)
        return 2
    try:
        with open(argv[1], encoding="utf-8") as f:
            report = compute(json.load(f))
    except (OSError, ValueError) as e:
        print("BLOCKED_SETUP: " + (str(e) if isinstance(e, BoundRefused) else "PROJECTION_UNREADABLE"), file=sys.stderr)
        return 78
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
