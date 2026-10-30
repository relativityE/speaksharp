#!/usr/bin/env python3
"""Makes the pinned pdfjs-dist 4.10.38 available to a checkout WITHOUT a network install in the run environment, fail closed.
The runner lockfile (runner/package-lock.json, verified by `npm ci`) provides the package; this script verifies it against the pins in
config tools.pdfjs (package.json and legacy/build/pdf.mjs sha256), then either confirms the checkout's own node_modules/pdfjs-dist is the same bytes or
copies the verified package there. A checkout that has a different pdfjs-dist is refused (never overwritten). Prints the sha256 of pdf.mjs.
Usage: install_pdfjs.py --config C.json --checkout DIR [--check-only] [--runner-dir DIR]"""
import argparse
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, sha256_file  # noqa: E402


def verify_dir(d, pin):
    errs = []
    pj, pm = os.path.join(d, "package.json"), os.path.join(d, pin["relativePdfMjs"])
    if not os.path.isfile(pj) or not os.path.isfile(pm):
        return ["pdfjs-dist is not installed at %s" % d]
    if sha256_file(pj) != pin["packageJsonSha256"]:
        errs.append("package.json at %s differs from the pinned bytes (version %s)" % (d, pin["version"]))
    if sha256_file(pm) != pin["pdfMjsSha256"]:
        errs.append("%s at %s differs from the pinned sha256" % (pin["relativePdfMjs"], d))
    return errs


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
    a.add_argument("--checkout", required=True)
    a.add_argument("--runner-dir", default=os.path.join(ROOT, "runner"))
    a.add_argument("--source-dir", help="explicit already-installed PDF package; verification-only with --check-only")
    a.add_argument("--check-only", action="store_true")
    x = a.parse_args()
    if x.source_dir is not None and not x.check_only:
        print("BLOCKED_SETUP: --source-dir is verification-only and requires --check-only", file=sys.stderr)
        sys.exit(78)
    pin = load(x.config)["tools"]["pdfjs"]
    src = x.source_dir if x.source_dir is not None else os.path.join(x.runner_dir, "node_modules", "pdfjs-dist")
    errs = verify_dir(src, pin)
    if errs:
        print("BLOCKED_SETUP: the runner copy of pdfjs-dist is not the pinned one: " + "; ".join(errs), file=sys.stderr)
        sys.exit(78)
    dst = os.path.join(x.checkout, "node_modules", "pdfjs-dist")
    if os.path.lexists(dst):
        errs = verify_dir(dst, pin)
        if errs:
            print("BLOCKED_SETUP: the checkout already has a different pdfjs-dist and it is not overwritten: " + "; ".join(errs), file=sys.stderr)
            sys.exit(78)
    elif x.check_only:
        print("BLOCKED_SETUP: the checkout has no pdfjs-dist (run without --check-only to provide the verified copy)", file=sys.stderr)
        sys.exit(78)
    else:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copytree(src, dst, symlinks=False)
        errs = verify_dir(dst, pin)
        if errs:
            shutil.rmtree(dst)
            print("BLOCKED_SETUP: the copy failed verification: " + "; ".join(errs), file=sys.stderr)
            sys.exit(78)
    print(pin["pdfMjsSha256"])


if __name__ == "__main__":
    main()
