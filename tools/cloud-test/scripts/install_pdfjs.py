#!/usr/bin/env python3
"""Makes pinned runner dependencies available to a checkout WITHOUT another network install, fail closed.
The runner lockfile (runner/package-lock.json, verified by `npm ci`) provides the package; this script verifies it against the pins in
config tools.pdfjs (package.json and legacy/build/pdf.mjs sha256), then either confirms the checkout's own node_modules/pdfjs-dist is the same bytes or
copies the verified package there. With --bind-playwright it also binds the already lockfile-installed playwright and playwright-core
packages into the checkout, after verifying both package identities. Existing conflicting paths are refused and never overwritten.
Prints the sha256 of pdf.mjs.
Usage: install_pdfjs.py --config C.json --checkout DIR [--check-only] [--bind-playwright] [--runner-dir DIR]"""
import argparse
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, sha256_file  # noqa: E402


PLAYWRIGHT_PACKAGES = ("playwright", "playwright-core")


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


def playwright_binding_errors(checkout, runner_dir, version, require_bound=False):
    """Validate the verified source pair and any checkout bindings without changing either tree."""
    errs = []
    for package in PLAYWRIGHT_PACKAGES:
        src = os.path.join(runner_dir, "node_modules", package)
        manifest = os.path.join(src, "package.json")
        if not os.path.isdir(src) or os.path.islink(src) or not os.path.isfile(manifest) or os.path.islink(manifest):
            errs.append("the runner has no regular %s package" % package)
            continue
        try:
            identity = json.load(open(manifest, encoding="utf-8"))
        except (OSError, ValueError):
            errs.append("the runner %s package identity is unreadable" % package)
            continue
        if identity.get("name") != package or identity.get("version") != version:
            errs.append("the runner %s package is not version %s" % (package, version))
        dst = os.path.join(checkout, "node_modules", package)
        if os.path.lexists(dst):
            if not os.path.islink(dst) or os.path.realpath(dst) != os.path.realpath(src):
                errs.append("the checkout already has a different %s and it is not overwritten" % package)
        elif require_bound:
            errs.append("the checkout has no verified %s binding" % package)
    return errs


def bind_playwright(checkout, runner_dir, version):
    """Bind both verified packages or refuse before creating either binding."""
    errs = playwright_binding_errors(checkout, runner_dir, version)
    if errs:
        return errs
    node_modules = os.path.join(checkout, "node_modules")
    os.makedirs(node_modules, exist_ok=True)
    created = []
    try:
        for package in PLAYWRIGHT_PACKAGES:
            dst = os.path.join(node_modules, package)
            if not os.path.lexists(dst):
                os.symlink(os.path.realpath(os.path.join(runner_dir, "node_modules", package)), dst, target_is_directory=True)
                created.append(dst)
        errs = playwright_binding_errors(checkout, runner_dir, version, require_bound=True)
        if errs:
            raise RuntimeError("; ".join(errs))
    except Exception as error:
        for path in reversed(created):
            try:
                os.unlink(path)
            except OSError:
                pass
        return ["the verified Playwright binding failed: %s" % error]
    return []


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
    a.add_argument("--checkout", required=True)
    a.add_argument("--runner-dir", default=os.path.join(ROOT, "runner"))
    a.add_argument("--source-dir", help="explicit already-installed PDF package; verification-only with --check-only")
    a.add_argument("--check-only", action="store_true")
    a.add_argument("--bind-playwright", action="store_true")
    x = a.parse_args()
    if x.source_dir is not None and not x.check_only:
        print("BLOCKED_SETUP: --source-dir is verification-only and requires --check-only", file=sys.stderr)
        sys.exit(78)
    if x.source_dir is not None and not os.path.isabs(x.source_dir):
        print("BLOCKED_SETUP: --source-dir must be an absolute existing package path", file=sys.stderr)
        sys.exit(78)
    pin = load(x.config)["tools"]["pdfjs"]
    if x.bind_playwright:
        browser_pin = load(x.config)["tools"]["browser"]
        errs = playwright_binding_errors(x.checkout, x.runner_dir, browser_pin["playwright"], require_bound=x.check_only)
        if errs:
            print("BLOCKED_SETUP: the runner Playwright pair is unavailable or conflicts with the checkout: " + "; ".join(errs), file=sys.stderr)
            sys.exit(78)
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
    if x.bind_playwright and not x.check_only:
        errs = bind_playwright(x.checkout, x.runner_dir, browser_pin["playwright"])
        if errs:
            print("BLOCKED_SETUP: " + "; ".join(errs), file=sys.stderr)
            sys.exit(78)
    print(pin["pdfMjsSha256"])


if __name__ == "__main__":
    main()
