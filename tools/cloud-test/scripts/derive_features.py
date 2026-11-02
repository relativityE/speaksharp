#!/usr/bin/env python3
"""Derived status of reviewed features (feature -> expected behaviour -> test coverage). Offline. Nothing is typed: deployment comes from release-verification.json,
results from the sealed latest run, rows from the assertion catalog. Per feature:
  NOT-IN-RELEASE        the feature's change is not (verifiably) in the tested release
  NEEDS-REVIEW          no approved review by a named reviewer, or no stated expected behaviour
  COVERAGE-PENDING      its test coverage is not in the assertion catalog yet (new rows for a later catalog version): the release check refuses it until they exist
  DEPLOYED-AWAITING-TEST  reviewed, covered and deployed, no latest run yet
  VERIFIED              every covered row PASSed in the latest run (executed, with evidence)
  FAILING               a covered row FAILed (a regression of the feature's expected behaviour)
  UNCOVERED             a covered row was NOT RUN or is absent from the latest run, so the feature was not shown to work
Usage: derive_features.py --features F.json --catalog CAT.json --release-verification RV.json --config C.json [--receipts-root DIR] [--latest-label L] --out features-derived.json"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, dump, sha256_file  # noqa: E402


def derive(feats, catalog, rv, receipts_root, latest):
    res = {}
    base = None
    if latest:
        base = os.path.join(receipts_root, latest)
        cr = load(os.path.join(base, "case-results.json"))
        res = {(c["caseId"], a["id"]): (a["result"], a.get("evidenceRefs") or []) for c in cr["cases"] for a in c.get("assertions", [])}
    known = {(c, a) for c, v in (catalog.get("cases") or {}).items() for a in v.get("requiredAssertions", [])}
    out = []
    for f in feats.get("features", []):
        r = (rv.get("features") or {}).get(f["id"]) or {}
        rows = [(q["case"], a) for q in (f.get("coverage") or {}).get("requirements", []) for a in q.get("assertions", [])]
        d = {"id": f["id"], "title": f.get("title"), "area": f.get("area"), "pr": r.get("pr") or f.get("pr"), "commit": r.get("commit"), "inclusion": r.get("inclusion", "unknown"),
             "expectedBehaviour": (f.get("expectedBehaviour") or {}).get("summary"), "criteria": (f.get("expectedBehaviour") or {}).get("criteria"),
             "confirmedByOwner": bool((f.get("expectedBehaviour") or {}).get("confirmedByOwner")), "review": {"by": (f.get("review") or {}).get("reviewedBy"), "ref": (f.get("review") or {}).get("reviewRef")},
             "coverageRows": ["%s/%s" % r_ for r_ in rows], "problems": r.get("problems", []), "evidence": [], "rowResults": {}}
        pend = [x for x in ((f.get("coverage") or {}).get("newRows") or []) if (x.get("case"), x.get("assertion")) not in known]
        if r.get("inclusion") != "cloud-verified":
            st, why = "NOT-IN-RELEASE", "deployment is %s" % r.get("inclusion", "unknown")
        elif not r.get("reviewOk") or any("expected behaviour" in p for p in r.get("problems", [])):
            st, why = "NEEDS-REVIEW", "; ".join(r.get("problems", [])) or "review not approved"
        elif pend or not rows or any(r_ not in known for r_ in rows):
            st, why = "COVERAGE-PENDING", "; ".join(r.get("problems", [])) or "its coverage rows are not in the catalog"
        elif latest is None:
            st, why = "DEPLOYED-AWAITING-TEST", "reviewed, covered and deployed; no latest run yet"
        else:
            verdicts = {}
            for row in rows:
                v, refs = res.get(row, ("NOT RUN", []))
                verdicts["%s/%s" % row] = v
                if v in ("PASS", "FAIL"):
                    for ref in refs[:2]:
                        p = os.path.join(base, row[0], ref)
                        d["evidence"].append({"file": "%s/%s/%s" % (latest, row[0], ref), "sha256": sha256_file(p) if os.path.isfile(p) else None})
            d["rowResults"] = verdicts
            if any(v == "FAIL" for v in verdicts.values()):
                st, why = "FAILING", "failed: %s" % ", ".join(k for k, v in verdicts.items() if v == "FAIL")
            elif all(v == "PASS" for v in verdicts.values()):
                st, why = "VERIFIED", "every covered row PASSed in %s" % latest
            else:
                st, why = "UNCOVERED", "not run: %s" % ", ".join(k for k, v in verdicts.items() if v not in ("PASS", "FAIL"))
        d["status"], d["statusReason"] = st, why
        out.append(d)
    counts = {}
    for d in out:
        counts[d["status"]] = counts.get(d["status"], 0) + 1
    return {"schema": "speaksharp.cloud-test.features-derived.v1", "derived": True, "latestLabel": latest, "features": out, "counts": counts}


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--features", default=os.path.join(ROOT, "config", "feature-ledger.json"))
    a.add_argument("--catalog", default=os.path.join(ROOT, "config", "assertion-catalog.json"))
    a.add_argument("--release-verification", required=True)
    a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
    a.add_argument("--receipts-root", default=os.path.join(ROOT, "config", "history", "receipts"))
    a.add_argument("--latest-label")
    a.add_argument("--out", required=True)
    x = a.parse_args()
    out = derive(load(x.features), load(x.catalog), load(x.release_verification), x.receipts_root, x.latest_label)
    dump(out, x.out)
    print("features: %s" % (", ".join("%s=%d" % kv for kv in sorted(out["counts"].items())) or "none registered"))


if __name__ == "__main__":
    main()
