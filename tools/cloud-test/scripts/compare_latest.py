#!/usr/bin/env python3
"""Automatic comparison of two sealed runs. Verifies both receipt sets against the pinned hashes, then runs report/build_run_report.py on the
ORIGINAL receipts (never on summaries). Analyst inputs (facts, overlay) are used only when the config pins a file for the pair; otherwise the
comparison is purely mechanical. Writes a NEW directory: comparison.json, REPORT.html, CSVs, MANIFEST.json and a copy of the receipts.
Usage: compare_latest.py --current LABEL --previous LABEL --out NEW_DIR [--config C] [--generated-at ISO] [--receipts-root DIR]
Exit 0 on success; 2 when a receipt set fails verification (nothing is compared)."""
import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _common import ROOT, load, sha256_file  # noqa: E402
from verify_receipts import verify_set  # noqa: E402


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--current", required=True)
    a.add_argument("--previous", required=True)
    a.add_argument("--out", required=True)
    a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
    a.add_argument("--receipts-root", default=os.path.join(ROOT, "config", "history", "receipts"))
    a.add_argument("--generated-at", default=None)
    x = a.parse_args()
    cfg = load(x.config)
    runs = {r["label"]: r for r in cfg["history"]["runs"]}
    for lab in (x.current, x.previous):
        if lab not in runs:
            sys.exit("label %s is not in the config history (seal its receipts and pin the hash first)" % lab)
        if runs[lab].get("ledgersOnly"):
            sys.exit("label %s has ledgers only and cannot be compared" % lab)
        errs, _ = verify_set(os.path.join(x.receipts_root, lab), runs[lab].get("receiptsManifestSha256"))
        if errs:
            print("receipt set %s failed verification: %s" % (lab, "; ".join(errs[:3])))
            sys.exit(2)
    cur, prev = (os.path.join(x.receipts_root, l) for l in (x.current, x.previous))
    cmd = [sys.executable, "-I", os.path.join(ROOT, "report", "build_run_report.py"), "--current", cur, "--current-label", x.current,
           "--previous", prev, "--previous-label", x.previous, "--traceability-dir", os.path.join(ROOT, "config", "history", "traceability"), "--out", x.out]
    for side, d in (("current", cur), ("previous", prev)):
        cm = os.path.join(d, "CODE.sha256")
        if os.path.isfile(cm):
            cmd += ["--%s-code-manifest" % side, cm]
    pair = cfg["history"].get("analysis", {}).get("%s-vs-%s" % (x.current, x.previous))
    if pair:
        for key, flag in (("facts", "--facts"), ("overlay", "--overlay")):
            p = os.path.join(ROOT, pair[key])
            if sha256_file(p) != pair[key + "Sha256"]:
                sys.exit("analysis file %s differs from the pinned hash" % pair[key])
            cmd += [flag, p]
    if x.generated_at:
        cmd += ["--generated-at", x.generated_at]
    r = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(r.stdout)
    if r.returncode:
        sys.stderr.write(r.stderr)
        sys.exit(r.returncode)


if __name__ == "__main__":
    main()
