#!/usr/bin/env python3
"""#1304 — generate WER-normalizer goldens from the OFFICIAL openai/whisper implementation.

WHY THIS EXISTS. A TypeScript port of the Whisper English normalizer is only trustworthy if it is
checked against the real thing. Hand-authored "expected" outputs would validate a hand-written port
against its own author's assumptions — the "check that appears to verify and doesn't" failure class
this program has paid for repeatedly. Upstream does not publish a comprehensive golden suite for
`EnglishTextNormalizer`, so we generate our own from pinned official source.

This runs in CI ONLY (see .github/workflows/generate-normalizer-goldens.yml), against a checkout of
openai/whisper at a pinned commit. It imports the normalizer module DIRECTLY from that checkout — it
never pip-installs `whisper`, so no model weights or torch are involved.

Outputs are IMMUTABLE once committed. Regenerating against a different upstream commit is a new
vector-set version, never an edit.

  usage: generate-normalizer-goldens.py <whisper-checkout> <vectors-in.json> <goldens-out.json>
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

ORACLE_CLASS = "EnglishTextNormalizer"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_oracle(normalizers_dir: Path):
    """Import whisper.normalizers.english from the checkout WITHOUT installing whisper.

    The module does a relative `from .basic import ...`, so a real package context is required.
    """
    pkg_root = normalizers_dir.parent.parent            # <checkout>
    sys.path.insert(0, str(pkg_root))
    spec = importlib.util.spec_from_file_location(
        "whisper.normalizers.english", normalizers_dir / "english.py",
    )
    # Register the ancestor packages so the relative import resolves.
    for name, path in (("whisper", normalizers_dir.parent), ("whisper.normalizers", normalizers_dir)):
        if name not in sys.modules:
            s = importlib.util.spec_from_file_location(name, path / "__init__.py", submodule_search_locations=[str(path)])
            m = importlib.util.module_from_spec(s)
            sys.modules[name] = m
            if name == "whisper.normalizers":
                s.loader.exec_module(m)
    module = importlib.util.module_from_spec(spec)
    sys.modules["whisper.normalizers.english"] = module
    spec.loader.exec_module(module)
    return getattr(module, ORACLE_CLASS)


def main() -> int:
    checkout, vectors_in, goldens_out = (Path(a) for a in sys.argv[1:4])
    normalizers = checkout / "whisper" / "normalizers"
    for required in ("english.py", "basic.py", "english.json"):
        if not (normalizers / required).exists():
            print(f"FATAL: {required} missing from {normalizers}", file=sys.stderr)
            return 2

    oracle_cls = load_oracle(normalizers)
    normalize = oracle_cls()

    spec = json.loads(vectors_in.read_text(encoding="utf-8"))
    cases = []
    for category, inputs in spec["categories"].items():
        for raw in inputs:
            cases.append({"category": category, "input": raw, "expected": normalize(raw)})

    upstream_sha = (checkout / ".git-commit-sha").read_text(encoding="utf-8").strip()
    payload = {
        "goldenSetVersion": spec["vectorSetVersion"],
        "provenance": {
            "upstreamRepository": "https://github.com/openai/whisper",
            "upstreamCommit": upstream_sha,
            "oracleClass": ORACLE_CLASS,
            "sourceHashes": {
                "english.py": sha256(normalizers / "english.py"),
                "basic.py": sha256(normalizers / "basic.py"),
                "english.json": sha256(normalizers / "english.json"),
            },
            "generatorScriptSha256": sha256(Path(__file__).resolve()),
            "inputVectorsSha256": sha256(vectors_in),
        },
        "caseCount": len(cases),
        "cases": cases,
    }
    goldens_out.parent.mkdir(parents=True, exist_ok=True)
    with goldens_out.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())