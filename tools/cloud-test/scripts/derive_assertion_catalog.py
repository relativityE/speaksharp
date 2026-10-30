#!/usr/bin/env python3
"""Derives the assertion catalog (the exact denominator of a full-coverage run) from the vendored, hash-verified harness contract
(harness/draft-adapters/contracts.json: requiredAssertions, minimumAuthorizedTakes, minimumAuthorizedStartPresses per case) and cross-checks every row id
against the sealed receipts of the compared runs. A disagreement is an error: the catalog must be the set of rows the harness can actually report.
Usage: derive_assertion_catalog.py --out config/assertion-catalog.json [--check]
  --check  re-derive and fail unless the file on disk is identical (used by the offline checks)."""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, sha256_file  # noqa: E402


def derive(root=ROOT):
    contracts = load(os.path.join(root, "harness", "draft-adapters", "contracts.json"))["cases"]
    cfg = load(os.path.join(root, "config", "test-config.v1.json"))
    cases, errs = {}, []
    for c in sorted(contracts, key=lambda x: x["caseId"]):
        ids = list(c["requiredAssertions"])
        if len(set(ids)) != len(ids):
            errs.append("%s: duplicate required assertion ids" % c["caseId"])
        cases[c["caseId"]] = {"requiredAssertions": ids, "minimumTakes": c["minimumAuthorizedTakes"], "minimumStarts": c["minimumAuthorizedStartPresses"]}
    for label in cfg["history"]["comparisonBaselines"]:
        res = load(os.path.join(root, "config", "history", "receipts", label, "case-results.json"))
        for row in res["cases"]:
            got = sorted(a["id"] for a in row["assertions"])
            if got != sorted(cases[row["caseId"]]["requiredAssertions"]):
                errs.append("%s %s: receipt rows differ from the harness contract" % (label, row["caseId"]))
    out = {"schema": "speaksharp.cloud-test.assertion-catalog.v1", "derived": True,
           "source": "harness/draft-adapters/contracts.json (hash-verified by verify_harness.py), cross-checked against the sealed receipts of every compared run",
           "contractsSha256": sha256_file(os.path.join(root, "harness", "draft-adapters", "contracts.json")),
           "totalAssertions": sum(len(v["requiredAssertions"]) for v in cases.values()),
           "minimumStarts": sum(v["minimumStarts"] for v in cases.values()), "minimumTakes": sum(v["minimumTakes"] for v in cases.values()), "cases": cases}
    return out, errs


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--out", required=True)
    a.add_argument("--check", action="store_true")
    x = a.parse_args()
    out, errs = derive()
    text = json.dumps(out, indent=1) + "\n"
    if errs:
        print("\n".join("ERROR: " + e for e in errs))
        sys.exit(1)
    if x.check:
        if not os.path.exists(x.out) or open(x.out, encoding="utf-8").read() != text:
            print("assertion catalog on disk differs from the harness contract")
            sys.exit(1)
        print("assertion catalog matches the harness contract: %d assertions, %d Starts, %d takes" % (out["totalAssertions"], out["minimumStarts"], out["minimumTakes"]))
        return
    with open(x.out, "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote %s: %d assertions, %d Starts, %d takes" % (x.out, out["totalAssertions"], out["minimumStarts"], out["minimumTakes"]))


if __name__ == "__main__":
    main()
