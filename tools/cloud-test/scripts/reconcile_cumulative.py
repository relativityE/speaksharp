#!/usr/bin/env python3
"""Reconciles cumulative usage before any ceiling is approved. Compares the SEALED guard ledgers (measured) with the owner's allowance counters
(owner-stated), reports every unreconciled difference and CARRIES IT FORWARD: limits use measured usage plus the unexplained difference (never just the larger of the two). Also computes what a proposed run
needs against the ceiling: used + run cap + protected reserve + identity reads.
Usage: reconcile_cumulative.py --config C.json [--counters owner-counters.json] [--run-cap N --identity-reads K] [--proposed-ceiling N] --out reconciliation.json
Exit 0 always; the arithmetic and the differences are in the file."""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, dump, now_utc  # noqa: E402


def reconcile(cfg, counters, receipts_root):
    """Cumulative usage, with the owner's unexplained difference CARRIED FORWARD.
    The owner's counters were stated through run `statedThroughRun`. The difference between what the owner counted and what the sealed ledgers measure
    through that run (108 requests, 2 identity reads for R5) is unexplained usage: it stays in the total, whatever is added later. So
        conservative used = measured through the frozen run + max(0, owner counted - measured, both through the stated run)
    which gives 92 measured + 2 unexplained = 94 for identity, and 98 (not 96) once 4 more reads are sealed. When `frozen.throughRun` is moved past
    `statedThroughRun` the runs in between are added from their sealed ledgers and reservation logs; a snapshot that names no stated run, or a freeze that
    is earlier than the stated run, is rejected (stale or inconsistent)."""
    order = [r["label"] for r in cfg["history"]["runs"]]
    stated = counters.get("statedThroughRun")
    through = counters["frozen"]["throughRun"]
    if stated not in order:
        raise ValueError("owner-counters statedThroughRun %r is missing or not a run in the config history: the snapshot does not say which run it was counted through (stale or unlabeled)" % stated)
    if through not in order:
        raise ValueError("owner-counters frozen.throughRun %r is not a run in the config history" % through)
    if order.index(stated) > order.index(through):
        raise ValueError("owner-counters are frozen through %s, earlier than the run they were stated through (%s): inconsistent snapshot" % (through, stated))
    cut, scut = order.index(through), order.index(stated)
    runs, after = [], []
    req_total = id_total = 0
    meas_req_stated = meas_id_stated = 0
    between = []
    for i, r in enumerate(cfg["history"]["runs"]):
        base = os.path.join(receipts_root, r["label"])
        cl = load(os.path.join(base, "campaign-ledger.json"))
        il = load(os.path.join(base, "identity-ledger.json"))
        n, k = cl["used"]["total"], il["identityGets"]
        rec = {"label": r["label"], "requests": n, "byCategory": {c: v for c, v in cl["used"].items() if c != "total"}, "identityReads": k, "ledger": "config/history/receipts/%s/campaign-ledger.json" % r["label"]}
        if i <= scut:
            meas_req_stated += n
            meas_id_stated += k
        if i <= cut:
            runs.append(rec)
            req_total += n
            id_total += k
            if i > scut:
                between.append(rec)
        else:
            after.append(rec)  # sealed AFTER the freeze: reported separately, never inside the frozen figure
    rq = counters["requests"]
    stated_runs = [x for x in runs if order.index(x["label"]) <= scut and x["label"] not in ("R4", "R4B", "R4C")]
    owner_req_stated = rq["allowanceBaselineThroughR4C"] + sum(x["requests"] for x in stated_runs) + rq["outsideRunEstimate"]
    measured_through_r4c = sum(x["requests"] for x in runs if x["label"] in ("R4", "R4B", "R4C"))
    unexplained_req = owner_req_stated - meas_req_stated
    unexplained_id = counters["identityReadsCumulative"] - meas_id_stated
    carry_req, carry_id = max(0, unexplained_req), max(0, unexplained_id)
    starts, takes = counters["startsCumulative"], counters["takesCumulative"]
    from derive_case_costs import count_actions
    for rec in between:
        acts = count_actions(os.path.join(receipts_root, rec["label"]))
        if acts is None:
            raise ValueError("%s is sealed between the owner's stated run (%s) and the freeze (%s) but has no reservation log, so its Starts and takes cannot be carried forward: restate the owner counters through %s" % (rec["label"], stated, through, through))
        starts += acts["starts"]
        takes += acts["takes"]
    out = {
        "schema": "speaksharp.cloud-test.cumulative-reconciliation.v1", "generatedUtc": now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "runs": runs,
        "freeze": {"throughRun": through, "asOfUtc": counters["frozen"]["asOfUtc"], "rule": "frozen before the run; a later run's actual usage is added once, never counted inside this figure"},
        "snapshot": {"statedThroughRun": stated, "frozenThroughRun": through, "runsAddedAfterStatement": [x["label"] for x in between],
                     "carriedForwardUnexplained": {"requests": carry_req, "identityReads": carry_id},
                     "rule": "the owner's unexplained difference stays in the total however many runs are added; it leaves only when the owner explains it and restates the counters"},
        "afterFreeze": after,
        "requests": {
            "measuredFromSealedLedgers": req_total,
            "ownerCounted": req_total + unexplained_req,
            "ownerCountedBasis": "%d allowance baseline + %d ledger of the runs after R4C up to %s + %d outside-run estimate%s" % (rq["allowanceBaselineThroughR4C"], sum(x["requests"] for x in stated_runs), stated, rq["outsideRunEstimate"],
                                                                                                                        ("; plus %d from %s sealed after that statement" % (sum(x["requests"] for x in between), ", ".join(x["label"] for x in between))) if between else ""),
            "unreconciled": unexplained_req,
            "unreconciledParts": {"baselineAboveSealedLedgers": rq["allowanceBaselineThroughR4C"] - measured_through_r4c, "outsideRunEstimate": rq["outsideRunEstimate"]},
            "conservativeUsed": req_total + carry_req,
            "conservativeBasis": "measured from the sealed ledgers plus the owner's unexplained difference carried forward (never dropped as measured usage grows)",
        },
        "identityReads": {"measuredFromSealedLedgers": id_total, "ownerCounted": id_total + unexplained_id, "unreconciled": unexplained_id,
                          "conservativeUsed": id_total + carry_id},
        "starts": {"ownerCounted": starts, "source": "owner-stated through %s%s; the sealed ledgers carry no Start counters, later runs are counted from their reservation logs" % (stated, " plus the logs of " + ", ".join(x["label"] for x in between) if between else "")},
        "takes": {"ownerCounted": takes, "source": "owner-stated through %s%s; the sealed ledgers carry no take counters, later runs are counted from their reservation logs" % (stated, " plus the logs of " + ", ".join(x["label"] for x in between) if between else "")},
        "ceilings": counters["ceilings"],
        "currentHeadroom": {"requests": counters["ceilings"]["requests"] - counters["ceilings"]["protectedReserveRequests"] - (req_total + carry_req),
                            "identityReads": counters["ceilings"]["identityReads"] - (id_total + carry_id),
                            "starts": counters["ceilings"]["starts"] - starts, "takes": counters["ceilings"]["takes"] - takes},
    }
    return out


def need(rec, run_cap, identity_reads, ceiling=None):
    used = rec["requests"]["conservativeUsed"]
    reserve = rec["ceilings"]["protectedReserveRequests"]
    required = used + run_cap + reserve + identity_reads
    ceiling = ceiling if ceiling is not None else rec["ceilings"]["requests"]
    ident_need = rec["identityReads"]["conservativeUsed"] + identity_reads
    return {"runCap": run_cap, "identityReads": identity_reads, "requiredCeiling": required, "ceilingTested": ceiling, "fitsRequestCeiling": required <= ceiling,
            "requestHeadroomAfter": ceiling - required, "requiredIdentityCap": ident_need, "identityCapCurrent": rec["ceilings"]["identityReads"],
            "fitsIdentityCap": ident_need <= rec["ceilings"]["identityReads"], "identityHeadroomAfter": rec["ceilings"]["identityReads"] - ident_need}


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
    a.add_argument("--counters", default=os.path.join(ROOT, "config", "history", "owner-counters.json"))
    a.add_argument("--receipts-root", default=os.path.join(ROOT, "config", "history", "receipts"))
    a.add_argument("--run-cap", type=int)
    a.add_argument("--identity-reads", type=int)
    a.add_argument("--proposed-ceiling", type=int)
    a.add_argument("--out", required=True)
    x = a.parse_args()
    rec = reconcile(load(x.config), load(x.counters), x.receipts_root)
    if x.run_cap is not None:
        rec["need"] = need(rec, x.run_cap, x.identity_reads or 0, x.proposed_ceiling)
    dump(rec, x.out)
    r = rec["requests"]
    print("requests: measured %d, owner-counted %d, unreconciled %d, conservative %d; identity: measured %d, owner %d" % (r["measuredFromSealedLedgers"], r["ownerCounted"], r["unreconciled"], r["conservativeUsed"], rec["identityReads"]["measuredFromSealedLedgers"], rec["identityReads"]["ownerCounted"]))
    if "need" in rec:
        print("need:", rec["need"])


if __name__ == "__main__":
    main()
