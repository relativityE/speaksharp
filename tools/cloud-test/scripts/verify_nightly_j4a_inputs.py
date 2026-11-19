#!/usr/bin/env python3
"""Offline J4.a dependency check, rooted at the repository. Not a production seal."""
import argparse
import hashlib
import json
from pathlib import Path
import re

SCHEMA = "speaksharp.nightly-j4a-reviewed-inputs.v1"
HEX = re.compile(r"[0-9a-f]{64}\Z")
NIGHTLY_ROOT = "tools/cloud-test/nightly/"
RESIDUE_HELPER = "tests/live/helpers/runOwnedCleanup.ts"
REQUIRED = frozenset(NIGHTLY_ROOT + name + ".cjs" for name in (
    "account-lookup", "account-reservation", "admin-transport", "case-results", "cleanup-evidence",
    "cleanup-plan", "counts", "guarded-signup", "j4a-guarded-step",
    "j4a-nightly-entry", "j4a-parent-teardown", "j4a-supervised-binding",
    "j4a-supervised-channel", "j4a-writer-evidence", "journey-plan", "leg-verdicts", "limits",
    "residue-inventory", "run-budget", "runner-bridge",
)) | {
    RESIDUE_HELPER,
    "scripts/production-release-policy.mjs",
    "scripts/lib/releaseEvidenceEligibility.mjs",
}


def _no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate manifest key")
        result[key] = value
    return result


def check(root, manifest, approved_digest):
    root = Path(root).absolute()
    manifest = Path(manifest).absolute()
    if root.resolve(strict=True) != root or not root.is_dir():
        raise ValueError("noncanonical source root")
    if manifest.resolve(strict=True) != manifest or not manifest.is_file():
        raise ValueError("noncanonical manifest")
    if not HEX.fullmatch(approved_digest):
        raise ValueError("missing or invalid approved manifest digest")
    raw = manifest.read_bytes()
    if hashlib.sha256(raw).hexdigest() != approved_digest:
        raise ValueError("manifest differs from approved bytes")
    parsed = json.loads(raw, object_pairs_hook=_no_duplicates)
    if (not isinstance(parsed, dict) or parsed.keys() != {"schema", "files"}
            or parsed["schema"] != SCHEMA or not isinstance(parsed["files"], dict)
            or parsed["files"].keys() != REQUIRED):
        raise ValueError("manifest does not name exactly the reviewed J4.a inputs")
    for name, digest in sorted(parsed["files"].items()):
        file = root / name
        if not isinstance(digest, str) or not HEX.fullmatch(digest):
            raise ValueError("invalid file digest: " + name)
        if file.resolve(strict=True) != file or not file.is_file():
            raise ValueError("noncanonical input: " + name)
        if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise ValueError("changed input: " + name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--approved-manifest-sha256", required=True)
    args = parser.parse_args()
    try:
        check(args.root, args.manifest, args.approved_manifest_sha256)
    except (OSError, ValueError) as exc:
        print(f"BLOCKED_SETUP: {exc}")
        return 78
    print(f"J4.a nightly inputs verified: {len(REQUIRED)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
