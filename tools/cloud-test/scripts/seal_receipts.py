#!/usr/bin/env python3
"""Seals a run's ORIGINAL receipts into an immutable, hash-pinned receipt set under config/history/receipts/<label>/ (flat layout that
report/build_run_report.py reads directly). Files are copied byte for byte; tls/ and sandbox.json (local proxy certificates and sandbox facts)
are never copied. A secret scan refuses credentials, JWTs, private keys and e-mail addresses. Writes RECEIPTS.sha256 (sha256 of every file but
itself) and prints the manifest hash, which the owner-approved config pins under history.runs[].receiptsManifestSha256.
Usage: seal_receipts.py --label R6 --out DIR --case-results F --campaign-plan F --security-approval F --campaign-ledger F --identity-ledger F
          --cases-dir DIR [--plan-sha F] [--admission F] [--policy F] [--code-manifest F] [--run-record F] [--ledgers-only] --provenance TEXT [--provenance TEXT ...]
--ledgers-only seals only the ledgers (and case results when given) for a run that counts toward cumulative limits but is not a comparison baseline.
Refuses to write into an existing directory. Offline."""
import argparse
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import dump, sha256_file, now_utc  # noqa: E402

EXCLUDE_DIRS = {"tls"}
EXCLUDE_FILES = {"sandbox.json"}
SECRET = [re.compile(p) for p in (rb"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}", rb"sb_secret_[A-Za-z0-9_-]{10,}", rb"sk_(live|test)_[A-Za-z0-9]{10,}",
                                   rb"-----BEGIN [A-Z ]*PRIVATE KEY-----", rb"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", rb"(?i)bearer\s+[A-Za-z0-9._-]{20,}")]


def scan(path):
    data = open(path, "rb").read()
    for p in SECRET:
        if p.search(data):
            return p.pattern[:40].decode("latin1")
    return None


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--label", required=True)
    a.add_argument("--out", required=True)
    for k in ("case-results", "campaign-plan", "security-approval", "campaign-ledger", "identity-ledger", "plan-sha", "admission", "policy", "code-manifest", "cases-dir", "run-record"):
        a.add_argument("--" + k)
    a.add_argument("--ledgers-only", action="store_true")
    a.add_argument("--provenance", action="append", default=[])
    x = a.parse_args()
    if os.path.exists(x.out):
        sys.exit("refusing to write into an existing directory (receipt sets are immutable): " + x.out)
    if not x.provenance:
        sys.exit("--provenance is required (where the originals came from)")
    need = ["campaign_ledger", "identity_ledger"] if x.ledgers_only else ["case_results", "campaign_plan", "security_approval", "campaign_ledger", "identity_ledger", "cases_dir"]
    for k in need:
        if not getattr(x, k):
            sys.exit("missing --" + k.replace("_", "-"))
    copies = []
    for opt, dest in (("case_results", "case-results.json"), ("campaign_plan", "campaign-plan.json"), ("plan_sha", "plan.sha"), ("security_approval", "security-approval.json"),
                      ("admission", "admission-receipt.json"), ("policy", "policy.json"), ("campaign_ledger", "campaign-ledger.json"), ("identity_ledger", "identity-ledger.json"), ("code_manifest", "CODE.sha256"), ("run_record", "run-record.json")):
        src = getattr(x, opt)
        if src:
            copies.append((src, dest))
    if x.cases_dir and not x.ledgers_only:
        for cid in sorted(os.listdir(x.cases_dir)):
            d = os.path.join(x.cases_dir, cid)
            if not (cid.startswith("AHT-") and os.path.isdir(d)):
                continue
            for fn in sorted(os.listdir(d)):
                p = os.path.join(d, fn)
                if os.path.isdir(p) or fn in EXCLUDE_FILES or fn in EXCLUDE_DIRS:
                    continue
                copies.append((p, cid + "/" + fn))
    for src, dest in copies:
        bad = scan(src)
        if bad:
            sys.exit("secret scan refused %s (%s)" % (src, bad))
    for src, dest in copies:
        dst = os.path.join(x.out, dest)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
        os.chmod(dst, 0o444)
    lines = []
    for root, _, files in os.walk(x.out):
        for fn in files:
            full = os.path.join(root, fn)
            lines.append("%s  %s" % (sha256_file(full), os.path.relpath(full, x.out)))
    lines.sort(key=lambda s: s.split("  ", 1)[1])
    man = os.path.join(x.out, "RECEIPTS.sha256")
    with open(man, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    dump({"schema": "speaksharp.cloud-test.receipts-seal.v1", "label": x.label, "sealedUtc": now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"), "ledgersOnly": x.ledgers_only,
          "files": len(lines), "provenance": x.provenance, "excluded": ["tls/", "sandbox.json"], "note": "byte-for-byte copies of the original run files; changing any file changes RECEIPTS.sha256 and must change the pinned hash in config"},
         os.path.join(x.out, "SEAL.json"))
    print("sealed %s: %d files; RECEIPTS.sha256 sha256 = %s" % (x.label, len(lines), sha256_file(man)))


if __name__ == "__main__":
    main()
