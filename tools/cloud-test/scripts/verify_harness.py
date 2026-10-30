#!/usr/bin/env python3
"""Verifies the vendored, reviewed harness. Offline.
 1. bundle/CODE.sha256 has the hash the owner-approved config fixes (harness.expectedCodeManifestSha256) and every file it lists has its recorded bytes;
 2. PACKET-MANIFEST.sha256 has the packet-manifest hash the config fixes (harness.expectedPacketManifestSha256);
 3. every vendored file (bundle/ and draft-adapters/) is listed in that packet manifest with the same sha256, and no unlisted file exists, so the
    vendored subset is byte-identical to the reviewed packet.
Usage: verify_harness.py --config config/test-config.v1.json [--root DIR]   Exit 0 only when everything matches; 78 (BLOCKED_SETUP) otherwise."""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, sha256_file  # noqa: E402


def check(cfg, root):
    errs = []
    h = cfg["harness"]
    packet = os.path.join(root, h["packetDir"])
    code = os.path.join(packet, "bundle", "CODE.sha256")
    pm = os.path.join(packet, "PACKET-MANIFEST.sha256")
    if not os.path.isfile(code) or not os.path.isfile(pm):
        return ["harness packet not vendored at %s" % h["packetDir"]], 0
    if sha256_file(code) != h["expectedCodeManifestSha256"]:
        errs.append("CODE.sha256 is %s, the approved hash is %s" % (sha256_file(code), h["expectedCodeManifestSha256"]))
    if sha256_file(pm) != h["expectedPacketManifestSha256"]:
        errs.append("PACKET-MANIFEST.sha256 differs from the pinned hash")
    n = 0
    for line in open(code, encoding="utf-8"):
        line = line.rstrip("\n")
        if line:
            hh, p = line.split("  ", 1)
            f = os.path.join(packet, "bundle", p)
            n += 1
            if not os.path.exists(f) or sha256_file(f) != hh:
                errs.append("CODE.sha256 file differs or is missing: " + p)
    listed = {}
    for line in open(pm, encoding="utf-8"):
        line = line.rstrip("\n")
        if line:
            hh, p = line.split("  ", 1)
            listed[p] = hh
    for sub in ("bundle", "draft-adapters"):
        for r, _, files in os.walk(os.path.join(packet, sub)):
            for fn in files:
                full = os.path.join(r, fn)
                rel = os.path.relpath(full, packet).replace(os.sep, "/")
                n += 1
                if rel not in listed:
                    errs.append("vendored file not in the reviewed packet manifest: " + rel)
                elif sha256_file(full) != listed[rel]:
                    errs.append("vendored file differs from the reviewed packet: " + rel)
    return errs, n


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--config", required=True)
    a.add_argument("--root", default=os.path.abspath(os.path.join(ROOT, "..", "..")))
    x = a.parse_args()
    errs, n = check(load(x.config), x.root)
    if errs:
        for e in errs[:8]:
            print("BLOCKED_SETUP:", e)
        sys.exit(78)
    print("harness verified: %d files; CODE.sha256 and the packet manifest match the approved hashes; vendored files are byte-identical to the reviewed packet" % n)


if __name__ == "__main__":
    main()
