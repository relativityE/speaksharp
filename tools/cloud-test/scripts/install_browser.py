#!/usr/bin/env python3
"""Installs the PINNED browser into the Playwright browsers directory and verifies it. Runs only in the run environment (it is the one script that
needs the network, to download the pinned archive); the offline control plane never calls it.
Every failure is a hard failure (exit 78, BLOCKED_SETUP): wrong archive size, wrong archive sha256, wrong extracted binary sha256, missing binary.
Nothing is ignored or retried silently.
Usage: install_browser.py --config C.json [--browsers-path DIR] [--archive FILE]
       install_browser.py --config C.json --existing FILE --source-sha SHA --run-id ID --receipt NEW_FILE
  --archive uses an already downloaded file (still verified); without it the pinned URL is downloaded.
  --existing ONLY verifies an existing executable against the unchanged binary pin.
  It never downloads, extracts, copies, installs, chmods or launches a browser.
Prints the verified chrome executable path on success."""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.request
import zipfile


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def fail(msg):
    print("BLOCKED_SETUP: " + msg, file=sys.stderr)
    sys.exit(78)


def verify_existing(browser, path):
    """Return observed identity only after the existing approved pin matches."""
    if not os.path.isfile(path) or not os.access(path, os.X_OK):
        fail("the existing browser is missing or not executable")
    actual = sha(path)
    if actual != browser["chromeBinarySha256"]:
        fail("existing browser binary sha256 differs from the pin")
    return {"schema": "speaksharp.cloud-test.existing-browser.v1",
            "acquisition": "existing-only; no installation or download",
            "path": os.path.realpath(path), "observedBinarySha256": actual,
            "expectedBinarySha256": browser["chromeBinarySha256"],
            "expectedVersion": browser["version"], "versionExecuted": False,
            "browserLaunched": False}


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--config", required=True)
    a.add_argument("--browsers-path", default=os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or os.path.join(os.path.expanduser("~"), ".cache", "ms-playwright"))
    a.add_argument("--archive")
    a.add_argument("--existing", help="verify this existing pinned executable; never download or install")
    a.add_argument("--receipt", help="new identity receipt for --existing (never overwritten)")
    a.add_argument("--source-sha", help="exact source identity bound to the --existing receipt")
    a.add_argument("--run-id", help="execution identity bound to the --existing receipt")
    x = a.parse_args()
    if x.existing is not None and x.archive:
        fail("--existing and --archive are mutually exclusive")
    if x.receipt and x.existing is None:
        fail("--receipt requires --existing")
    b = json.load(open(x.config, encoding="utf-8"))["tools"]["browser"]
    if x.existing is not None:
        if not x.receipt or not re.fullmatch(r"[0-9a-f]{40}", x.source_sha or "") or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", x.run_id or ""):
            fail("--existing requires --receipt, exact --source-sha and safe --run-id")
        identity = verify_existing(b, x.existing)
        identity.update({"sourceSha": x.source_sha, "runId": x.run_id, "configSha256": sha(x.config),
                         "bindingScope": "Caller-supplied source/run identities; not a live deployment assertion"})
        try:
            with open(x.receipt, "x", encoding="utf-8") as output:
                json.dump(identity, output, sort_keys=True)
                output.write("\n")
        except OSError:
            fail("cannot create the NEW existing-browser identity receipt")
        print(identity["path"])
        return
    dest = os.path.join(x.browsers_path, b["playwrightRevision"])
    final = os.path.join(dest, b["chromeBinary"])
    if os.path.isfile(final) and sha(final) == b["chromeBinarySha256"]:
        print(final)
        return
    tmp = tempfile.mkdtemp(prefix="ct-browser-")
    archive = x.archive
    if not archive:
        archive = os.path.join(tmp, "chrome.zip")
        if not b["archiveUrl"].startswith("https://storage.googleapis.com/chrome-for-testing-public/"):
            fail("the pinned archive URL is not the Chrome for Testing public bucket")
        try:
            with urllib.request.urlopen(b["archiveUrl"], timeout=300) as r, open(archive, "wb") as f:
                shutil.copyfileobj(r, f)
        except Exception as e:  # noqa: BLE001 - reported, never ignored
            fail("download failed: %s" % e)
    if os.path.getsize(archive) != b["archiveBytes"]:
        fail("archive is %d bytes, pinned %d" % (os.path.getsize(archive), b["archiveBytes"]))
    if sha(archive) != b["archiveSha256"]:
        fail("archive sha256 differs from the pin")
    os.makedirs(dest, exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        bad = z.testzip()
        if bad:
            fail("corrupt member in the archive: %s" % bad)
        for n in z.namelist():
            if n.startswith("/") or ".." in n.split("/"):
                fail("unsafe path in the archive: %s" % n)
        z.extractall(dest)
    if not os.path.isfile(final):
        fail("the extracted archive has no %s" % b["chromeBinary"])
    if sha(final) != b["chromeBinarySha256"]:
        fail("extracted chrome binary sha256 differs from the pin")
    os.chmod(final, 0o755)
    print(final)


if __name__ == "__main__":
    main()
