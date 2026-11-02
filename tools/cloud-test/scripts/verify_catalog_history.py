#!/usr/bin/env python3
"""New features add coverage; they never rewrite what earlier runs measured. The assertion catalog is versioned: config/history/catalogs/v<N>.json are frozen
snapshots. Verifies that (1) the snapshots are contiguous from v1, (2) each one contains every journey and every required row of the one before it and does not
lower a minimum Start or take count (a new row, a new journey or a higher minimum is allowed; removing, renaming or relaxing is not), (3) the current catalog
equals the snapshot of the version named in the config, and (4) every indexed run records a catalog version that exists.
Usage: verify_catalog_history.py [--config C.json] [--catalog config/assertion-catalog.json] [--index config/history/index.json] [--snapshots DIR]"""
import argparse
import glob
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load  # noqa: E402


def additive_errors(old, new, label_old, label_new):
    errs = []
    for cid, spec in old["cases"].items():
        n = new["cases"].get(cid)
        if n is None:
            errs.append("%s drops journey %s that %s measured" % (label_new, cid, label_old))
            continue
        gone = [r for r in spec["requiredAssertions"] if r not in n["requiredAssertions"]]
        if gone:
            errs.append("%s drops or renames %s/%s that %s measured" % (label_new, cid, ", ".join(gone[:3]), label_old))
        if n["minimumStarts"] < spec["minimumStarts"] or n["minimumTakes"] < spec["minimumTakes"]:
            errs.append("%s lowers the minimum Starts/takes of %s" % (label_new, cid))
    return errs


def verify(snapshots, current, version, index=None):
    errs = []
    vers = sorted(snapshots)
    if vers != list(range(1, len(vers) + 1)) or not vers:
        errs.append("catalog snapshots must be contiguous from v1 (found %s)" % vers)
    for a, b in zip(vers, vers[1:]):
        errs += additive_errors(snapshots[a], snapshots[b], "v%d" % a, "v%d" % b)
    if version not in snapshots:
        errs.append("config names catalog version %s but no snapshot exists" % version)
    elif snapshots[version] != current:
        errs.append("the current catalog differs from the frozen snapshot v%d: freeze a new version (v%d) instead of editing" % (version, max(vers) + 1 if vers else 1))
    if vers and version != vers[-1]:
        errs.append("config names catalog version %s but the newest snapshot is v%d" % (version, vers[-1]))
    for e in (index or {}).get("entries", []):
        if e.get("catalogVersion") not in snapshots:
            errs.append("indexed run %s records catalog version %s, which has no snapshot" % (e.get("label"), e.get("catalogVersion")))
    return errs


def load_snapshots(d):
    out = {}
    for p in glob.glob(os.path.join(d, "v*.json")):
        m = re.match(r"v(\d+)\.json$", os.path.basename(p))
        if m:
            out[int(m.group(1))] = load(p)
    return out


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
    a.add_argument("--catalog", default=os.path.join(ROOT, "config", "assertion-catalog.json"))
    a.add_argument("--index", default=os.path.join(ROOT, "config", "history", "index.json"))
    a.add_argument("--snapshots", default=os.path.join(ROOT, "config", "history", "catalogs"))
    a.add_argument("--out")
    x = a.parse_args()
    cfg = load(x.config)
    errs = verify(load_snapshots(x.snapshots), load(x.catalog), cfg["modes"]["full"]["assertionCatalog"]["version"], load(x.index) if os.path.exists(x.index) else None)
    if x.out:
        from _common import dump
        dump({"schema": "speaksharp.cloud-test.catalog-history-verification.v1", "verified": not errs, "errors": errs}, x.out)
    for e in errs:
        print("ERROR:", e)
    print("catalog history %s" % ("VERIFIED (additive only)" if not errs else "FAILED (%d)" % len(errs)))
    sys.exit(0 if not errs else 1)


if __name__ == "__main__":
    main()
