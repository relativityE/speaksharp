#!/usr/bin/env python3
"""Chooses the baseline of every comparison from the sealed history instead of always using the previous run.
A row can only be compared with a run that actually has a verdict for it. For each required row of each gap the baseline is the MOST RECENT earlier run in which
that row is PASS or FAIL; a run where it was NOT RUN (or absent) is skipped. A defect that FAILED in R4C and was NOT RUN in R5 is therefore compared with R4C, and
a comparison with R5 alone can never report it as a verified fix. For every journey the report also names the previous-verdict run and the last-known-good run
(the most recent earlier run in which the journey PASSED), which the alerts use.
Usage: select_baselines.py --ledger L.json --config C.json --latest-label LABEL [--receipts-root DIR] --out baselines.json
Output pairs: the labels the latest run must be compared with (the pipeline runs one pairwise comparison per label)."""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _common import ROOT, load, dump, ep_requirements  # noqa: E402
import derive_ledger as DL  # noqa: E402


def comparable_history(cfg):
    return [r["label"] for r in cfg["history"]["runs"] if not r.get("ledgersOnly")]


def row_verdict(cases, case, assertion):
    a = next((x for x in (cases.get(case) or {}).get("assertions", []) if x["id"] == assertion), None)
    return a["result"] if a else None


def select(ledger, cfg, receipts_root, latest):
    order = comparable_history(cfg)
    if latest not in order:
        raise ValueError("latest run %r is not a comparable sealed run in the config history" % latest)
    prior = order[:order.index(latest)]
    runs = {lab: DL.load_run(receipts_root, lab) for lab in prior}
    gaps = {}
    for g in ledger["gaps"]:
        rows = {}
        for rq in ep_requirements(g["expectedPass"]):
            for aid in rq["assertions"]:
                key = "%s/%s" % (rq["case"], aid)
                hist = [(lab, row_verdict(runs[lab][1], rq["case"], aid)) for lab in prior]
                got = next(((lab, v) for lab, v in reversed(hist) if v in ("PASS", "FAIL")), None)
                skipped = [lab for lab, v in reversed(hist) if v not in ("PASS", "FAIL") and (got is None or order.index(lab) > order.index(got[0]))]
                rows[key] = {"baseline": got[0] if got else None, "baselineVerdict": got[1] if got else None, "skippedRunsWithoutVerdict": skipped,
                             "verdicts": {lab: v for lab, v in hist},
                             "reason": ("most recent earlier run with a verdict for this row%s" % ("; skipped %s (no verdict)" % ", ".join(skipped) if skipped else "")) if got else "no earlier run has a verdict for this row: there is nothing to compare it with"}
        gaps[g["id"]] = {"rows": rows, "baselines": sorted({r["baseline"] for r in rows.values() if r["baseline"]}, key=order.index)}
    served = {r["label"]: r.get("servedSha") for r in cfg["history"]["runs"]}
    journeys = {}
    for n in range(1, 16):
        cid = "AHT-%02d" % n
        res = [(lab, (runs[lab][1].get(cid) or {}).get("result")) for lab in prior]
        prev = next(((lab, v) for lab, v in reversed(res) if v in ("PASS", "FAIL")), None)
        good = next((lab for lab, v in reversed(res) if v == "PASS"), None)
        journeys[cid] = {"previousVerdictRun": prev[0] if prev else None, "previousVerdict": prev[1] if prev else None, "lastKnownGood": good,
                         "lastKnownGoodServedSha": served.get(good)}
    needed = set()
    for g in gaps.values():
        needed.update(g["baselines"])
    for j in journeys.values():
        needed.update(x for x in (j["previousVerdictRun"], j["lastKnownGood"]) if x)
    if prior:
        needed.add(prior[-1])   # the immediately previous run is always compared (the three-way report)
    return {"schema": "speaksharp.cloud-test.baselines.v1", "derived": True, "latest": latest, "history": order, "priorRuns": prior,
            "rule": "a row is compared with the most recent earlier run in which it has a verdict (PASS or FAIL); NOT RUN runs are skipped", "gaps": gaps, "journeys": journeys,
            "pairs": [l for l in order if l in needed]}


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--ledger", required=True)
    a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
    a.add_argument("--receipts-root", default=os.path.join(ROOT, "config", "history", "receipts"))
    a.add_argument("--latest-label", required=True)
    a.add_argument("--out", required=True)
    x = a.parse_args()
    out = select(load(x.ledger), load(x.config), x.receipts_root, x.latest_label)
    dump(out, x.out)
    print("baselines for %s: compare with %s" % (x.latest_label, ", ".join(out["pairs"]) or "nothing"))


if __name__ == "__main__":
    main()
