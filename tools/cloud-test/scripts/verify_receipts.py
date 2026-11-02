#!/usr/bin/env python3
"""Verifies sealed receipt sets: every file listed in RECEIPTS.sha256 exists with the recorded bytes, no unlisted file exists, and the manifest's
own sha256 equals the hash pinned in the config (history.runs[].receiptsManifestSha256). A changed, added or removed receipt fails.
Usage: verify_receipts.py --config C.json [--root DIR] [--label L ...] [--out verification.json]   Exit 0 only when every set verifies."""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, dump, sha256_file  # noqa: E402


def verify_set(base, pinned):
    errs = []
    man = os.path.join(base, "RECEIPTS.sha256")
    if not os.path.isfile(man):
        return ["RECEIPTS.sha256 missing"], 0
    if pinned is None:
        errs.append("no pinned manifest hash in the config")
    elif sha256_file(man) != pinned:
        errs.append("RECEIPTS.sha256 differs from the pinned hash in the config")
    listed = {}
    for line in open(man, encoding="utf-8"):
        line = line.rstrip("\n")
        if line:
            h, p = line.split("  ", 1)
            listed[p] = h
    for p, h in listed.items():
        f = os.path.join(base, p)
        if not os.path.isfile(f):
            errs.append("missing: " + p)
        elif sha256_file(f) != h:
            errs.append("changed: " + p)
    for root, _, files in os.walk(base):
        for fn in files:
            rel = os.path.relpath(os.path.join(root, fn), base)
            if rel not in listed and rel not in ("RECEIPTS.sha256", "SEAL.json"):
                errs.append("unlisted file: " + rel)
    return errs, len(listed)


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
    a.add_argument("--root", default=os.path.join(ROOT, "config", "history", "receipts"))
    a.add_argument("--label", action="append")
    a.add_argument("--out")
    x = a.parse_args()
    cfg = load(x.config)
    res = {}
    for r in cfg["history"]["runs"]:
        if x.label and r["label"] not in x.label:
            continue
        errs, n = verify_set(os.path.join(x.root, r["label"]), r.get("receiptsManifestSha256"))
        res[r["label"]] = {"files": n, "errors": errs, "verified": not errs}
        print(("OK   " if not errs else "FAIL ") + r["label"], n, "files", "; ".join(errs[:3]))
    if x.out:
        dump({"schema": "speaksharp.cloud-test.receipts-verification.v1", "sets": res, "allVerified": all(v["verified"] for v in res.values())}, x.out)
    sys.exit(0 if res and all(v["verified"] for v in res.values()) else 1)


if __name__ == "__main__":
    main()
