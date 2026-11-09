#!/usr/bin/env python3
"""Retained, append-only run history. config/history/index.json is a hash chain: one entry per sealed run, each recording what that run showed (journey and row
verdict counts, requests, identity reads, the catalog version it was measured against) and the hash of the entry before it. Nothing already recorded can change:
`verify` recomputes every entry from the sealed receipts and fails if any differs from the stored one or the chain is broken; `append` adds ONLY runs that are in
the config history but not yet in the index and refuses if an existing entry would change. New features (a new catalog row, a new check) therefore add coverage
for FUTURE runs without rewriting what earlier runs showed.
Usage: history_index.py build|verify|append --config C.json --receipts-root DIR --index config/history/index.json [--catalog-version N]
  build   writes a new index for the whole config history (only when no index exists)
  verify  exit 0 only when the index equals a fresh derivation and its head equals config history.index.headHash (when pinned)
  append  adds entries for runs not yet indexed (never alters old ones) and prints the new head hash to pin in the config"""
import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, dump  # noqa: E402
from derive_case_costs import count_actions  # noqa: E402

ENTRY_VERSION = 2   # 1.4.0 entries (version 1) had no Starts, takes, coaching or runner-minute fields; the index was rebuilt in 1.5.0 before any run had been appended


def canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":")).encode()


def entry_hash(e):
    return hashlib.sha256(canon({k: v for k, v in e.items() if k != "entryHash"})).hexdigest()


def summarize(root, run):
    if run.get("ledgersOnly"):
        base = os.path.join(root, run["label"])
        cl = load(os.path.join(base, "campaign-ledger.json"))
        il = load(os.path.join(base, "identity-ledger.json"))
        return {"kind": "ledgers-only", "requests": cl["used"]["total"], "identityReads": il["identityGets"]}
    base = os.path.join(root, run["label"])
    cr = load(os.path.join(base, "case-results.json"))
    cl = load(os.path.join(base, "campaign-ledger.json"))
    il = load(os.path.join(base, "identity-ledger.json"))
    rows = {"PASS": 0, "FAIL": 0, "NOT RUN": 0}
    j = {"PASS": 0, "FAIL": 0, "NOT RUN": 0}
    for c in cr["cases"]:
        j[c["result"] if c["result"] in j else "NOT RUN"] += 1
        for a in c["assertions"]:
            rows[a["result"] if a["result"] in rows else "NOT RUN"] += 1
    acts = count_actions(base)
    return {"kind": "run", "campaignResult": cr.get("result"),
            "starts": acts["starts"] if acts else None, "takes": acts["takes"] if acts else None, "coachingRequests": cl["used"].get("coaching", 0),
            "runnerMinutes": None, "runnerMinutesBasis": "not recorded in sealed receipts: a period check counts the approved per-run cap", "journeys": j, "rows": rows, "rowsTotal": sum(rows.values()), "rowsExecuted": rows["PASS"] + rows["FAIL"],
            "requests": cl["used"]["total"], "identityReads": il["identityGets"], "endedUtc": cl.get("updated"), "safetyStopped": cr.get("safetyStopped"), "finalIdentity": cr.get("finalIdentity"),
            "sourceSha": cr.get("sourceSha"), "servedSha": cr.get("servedSha")}


def derive(cfg, root, catalog_version, existing=None):
    entries = []
    prev = "0" * 64
    for i, run in enumerate(cfg["history"]["runs"]):
        old = (existing or [None] * (i + 1))[i] if existing and i < len(existing) else None
        e = {"entryVersion": ENTRY_VERSION, "seq": i + 1, "label": run["label"], "campaignId": run.get("campaignId"), "servedSha": run.get("servedSha"), "ledgersOnly": bool(run.get("ledgersOnly")),
             "receiptsManifestSha256": run.get("receiptsManifestSha256"), "catalogVersion": (old or {}).get("catalogVersion", catalog_version), "summary": summarize(root, run), "prevHash": prev}
        e["entryHash"] = entry_hash(e)
        prev = e["entryHash"]
        entries.append(e)
    return entries


def wrap(entries):
    return {"schema": "speaksharp.cloud-test.history-index.v1", "rule": "append-only hash chain; each entry is recomputed from the sealed receipts by `verify`; new runs are appended, old entries never change",
            "entries": entries, "headHash": entries[-1]["entryHash"] if entries else "0" * 64}


def verify(index, cfg, root):
    errs = []
    stored = index.get("entries", [])
    fresh = derive(cfg, root, None, stored)
    if len(stored) > len(fresh):
        errs.append("the index has %d entries but the config history has %d (a run was removed)" % (len(stored), len(fresh)))
    prev = "0" * 64
    for i, e in enumerate(stored):
        if e.get("prevHash") != prev:
            errs.append("entry %d (%s): the chain is broken" % (i + 1, e.get("label")))
        if entry_hash(e) != e.get("entryHash"):
            errs.append("entry %d (%s): its hash does not match its content" % (i + 1, e.get("label")))
        if i < len(fresh) and fresh[i] != e:
            errs.append("entry %d (%s): differs from what the sealed receipts show now (history was rewritten, or a receipt changed)" % (i + 1, e.get("label")))
        prev = e.get("entryHash")
    if len(stored) < len(fresh):
        errs.append("the config history has %d run(s) the index does not record yet: %s (run `history_index.py append`)" % (len(fresh) - len(stored), ", ".join(r["label"] for r in cfg["history"]["runs"][len(stored):])))
    if stored and index.get("headHash") != stored[-1].get("entryHash"):
        errs.append("headHash is not the last entry's hash")
    pin = (cfg["history"].get("index") or {}).get("headHash")
    if pin and index.get("headHash") != pin:
        errs.append("the index head differs from the hash pinned in the config (history.index.headHash)")
    return errs


def append(index, cfg, root, catalog_version):
    stored = index.get("entries", [])
    errs = verify({"entries": stored, "headHash": stored[-1]["entryHash"] if stored else "0" * 64}, {**cfg, "history": {**cfg["history"], "runs": cfg["history"]["runs"][:len(stored)], "index": {}}}, root)
    if errs:
        raise ValueError("existing entries do not verify, nothing appended: " + "; ".join(errs[:3]))
    entries = derive(cfg, root, catalog_version, stored)
    if entries[:len(stored)] != stored:
        raise ValueError("an existing entry would change")
    return wrap(entries)


def main():
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=["build", "verify", "append"])
    a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
    a.add_argument("--receipts-root", default=os.path.join(ROOT, "config", "history", "receipts"))
    a.add_argument("--index", default=os.path.join(ROOT, "config", "history", "index.json"))
    a.add_argument("--catalog-version", type=int, default=1)
    a.add_argument("--allow-unrecorded", action="store_true", help="verify: runs in the config history that are not yet appended are reported, not an error (used by the pipeline for a just-sealed run)")
    a.add_argument("--out")
    x = a.parse_args()
    cfg = load(x.config)
    if x.command == "build":
        if os.path.exists(x.index):
            sys.exit("the index already exists; history is append-only (use append)")
        out = wrap(derive(cfg, x.receipts_root, x.catalog_version))
        dump(out, x.index)
        print("built %d entries; head %s" % (len(out["entries"]), out["headHash"]))
    elif x.command == "verify":
        errs = verify(load(x.index), cfg, x.receipts_root)
        pending = [e for e in errs if "does not record yet" in e]
        if x.allow_unrecorded:
            errs = [e for e in errs if e not in pending]
        if x.out:
            dump({"schema": "speaksharp.cloud-test.history-verification.v1", "verified": not errs, "errors": errs, "pendingAppend": pending}, x.out)
        for e in errs:
            print("ERROR:", e)
        print("history index %s" % ("VERIFIED" if not errs else "FAILED (%d)" % len(errs)))
        sys.exit(0 if not errs else 1)
    else:
        try:
            out = append(load(x.index), cfg, x.receipts_root, x.catalog_version)
        except ValueError as e:
            sys.exit("REFUSED: %s" % e)
        dump(out, x.index)
        print("index now has %d entries; head %s (pin this in config history.index.headHash)" % (len(out["entries"]), out["headHash"]))


if __name__ == "__main__":
    main()
