#!/usr/bin/env python3
"""Fail-closed receiver for the custodian's content-free manual-run bundle.

The production interface is deliberately inactive until one reviewed config
change pins both the manifest bytes and their canonical component-root digest.
The receiver never accepts raw retained history, transcripts, credentials, or
caller-authored pass flags.  It accepts only outputs of the existing retained
validators/calculators and binds them to the admitted request and exact source.
"""
import argparse
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402
from _common import comparison_errors  # noqa: E402

SHA256 = re.compile(r"[0-9a-f]{64}")
SHA40 = re.compile(r"[0-9a-f]{40}")
SCHEMA = "speaksharp.cloud-test.aggregate-receiver.v1"
REQUIRED = (
    "reconciliation", "release-verification", "gap-ledger",
    "prior-run-verification", "comparison-prior", "case-costs",
)


class Refused(ValueError):
    pass


def need(ok, code):
    if not ok:
        raise Refused(code)


def raw(path):
    st = os.lstat(path)
    need(os.path.isfile(path) and not os.path.islink(path) and st.st_nlink == 1, "aggregate-component-not-regular")
    with open(path, "rb") as f:
        return f.read()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canon(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("ascii")


def load_json(data, code):
    try:
        value = json.loads(data)
    except (ValueError, UnicodeDecodeError):
        raise Refused(code)
    need(isinstance(value, dict), code)
    return value


def component_root(entries):
    return digest(canon([{"name": name, "sha256": entries[name]["sha256"]} for name in sorted(entries)]))


def validate_documents(docs, request, config):
    rec = docs["reconciliation"]
    need(rec.get("source") == "accepted-rollup" and SHA40.fullmatch(str(rec.get("root", ""))) and
         SHA40.fullmatch(str(rec.get("headSha", ""))), "aggregate-reconciliation")
    need(rec.get("scopeApprovalRef") == (request.get("approvedLimits") or {}).get("approvalRef"), "aggregate-reconciliation-request")
    need(isinstance(rec.get("ceilings"), dict) and isinstance(rec.get("currentHeadroom"), dict), "aggregate-reconciliation")

    rv = docs["release-verification"]
    need(rv.get("needs") == [] and (rv.get("testedSha") or rv.get("releaseSha") or rv.get("sourceSha")) ==
         (request.get("release") or {}).get("testedSha"), "aggregate-release-verification")
    ledger = docs["gap-ledger"]
    need(ledger.get("schema") == "speaksharp.cloud-test.gap-ledger.v2" and isinstance(ledger.get("gaps"), list) and
         set(request.get("targetedGaps") or []).issubset({g.get("id") for g in ledger["gaps"]}), "aggregate-gap-ledger")

    prior = docs["prior-run-verification"]
    expected = [p.get("label") for p in request.get("priorRuns") or []]
    rows = prior.get("runs")
    need(prior.get("schema") == "speaksharp.cloud-test.prior-run-verification.v1" and
         prior.get("producers") == ["verify_receipts.py", "verify_run_binding.py"] and isinstance(rows, list),
         "aggregate-prior-run-verification")
    need([r.get("label") for r in rows] == expected and all(
         SHA256.fullmatch(str(r.get("receiptsManifestSha256", ""))) and
         SHA256.fullmatch(str(r.get("receiptsVerificationSha256", ""))) and
         SHA256.fullmatch(str((r.get("binding") or {}).get("sha256", ""))) and
         isinstance(r.get("receiptCount"), int) and r["receiptCount"] > 0 and r.get("errors") == [] and
         (r.get("binding") or {}).get("failed") == 0 and
         isinstance((r.get("binding") or {}).get("passed"), int) and (r.get("binding") or {})["passed"] > 0
         for r in rows),
         "aggregate-prior-run-verification")
    configured = {r["label"]: r.get("receiptsManifestSha256") for r in config["history"]["runs"]}
    need(all(configured.get(r["label"]) == r["receiptsManifestSha256"] for r in rows), "aggregate-prior-run-pin")
    # The receiver, not the custodian, derives the small G7 input after both
    # existing validators have supplied complete, pinned evidence.
    docs["prior-run-verification"] = {
        "schema": "speaksharp.cloud-test.prior-run-verification.v1",
        "runs": [{
            "label": r["label"], "passed": True,
            "receiptsManifestSha256": r["receiptsManifestSha256"],
            "receiptsVerificationSha256": r["receiptsVerificationSha256"],
            "bindingSha256": r["binding"]["sha256"],
        } for r in rows],
    }

    cmp_ = docs["comparison-prior"]
    baseline = config["history"]["comparisonBaselines"]
    need(not comparison_errors(cmp_, baseline), "aggregate-comparison-basis")
    costs = docs["case-costs"]
    need(costs.get("schema") == "speaksharp.cloud-test.case-costs.v1" and costs.get("derived") is True and
         all(label in (costs.get("runs") or {}) and (costs["runs"][label].get("reconciliation") or {}).get("ok") is True for label in baseline),
         "aggregate-case-costs")


def receiver_receipt(manifest_raw, request_raw, accepted_bytes, pins):
    manifest = load_json(manifest_raw, "aggregate-manifest")
    return {
        "schema": "speaksharp.cloud-test.aggregate-receiver-receipt.v1",
        "manifestSha256": digest(manifest_raw),
        "requestSha256": digest(request_raw),
        "bundleRootSha256": pins["bundleRootSha256"],
        "sourceComponentSha256": {name: manifest["components"][name]["sha256"] for name in REQUIRED},
        "acceptedSha256": {name: digest(accepted_bytes[name]) for name in REQUIRED},
        "sourceSha": load_json(request_raw, "aggregate-request")["release"]["testedSha"],
        "acceptedComponents": list(REQUIRED),
    }


def receive_bundle(manifest_raw, bundle_dir, request_raw, config, pins):
    """Return validated documents. ``pins`` is injectable only for unit controls;
    the CLI always takes it from the reviewed config and refuses while inactive."""
    need(pins.get("activated") is True and SHA256.fullmatch(str(pins.get("manifestSha256", ""))) and
         SHA256.fullmatch(str(pins.get("bundleRootSha256", ""))), "aggregate-receiver-not-activated")
    need(digest(manifest_raw) == pins["manifestSha256"], "aggregate-manifest-not-pinned")
    manifest = load_json(manifest_raw, "aggregate-manifest")
    request = load_json(request_raw, "aggregate-request")
    need(manifest.get("schema") == SCHEMA and set(manifest.get("components") or {}) == set(REQUIRED), "aggregate-manifest-shape")
    need(manifest.get("requestSha256") == digest(request_raw) and manifest.get("runId") == request.get("runId"), "aggregate-request-binding")
    need(manifest.get("sourceSha") == (request.get("release") or {}).get("testedSha") and
         manifest.get("workflowVersion") == request.get("workflowVersion") and
         manifest.get("codeManifestSha256") == (request.get("harness") or {}).get("codeManifestSha256"), "aggregate-source-binding")
    entries, docs, original = manifest["components"], {}, {}
    for name in REQUIRED:
        entry = entries[name]
        need(isinstance(entry, dict) and set(entry) == {"file", "sha256"} and SHA256.fullmatch(str(entry["sha256"])),
             "aggregate-component-entry")
        rel = entry["file"]
        need(isinstance(rel, str) and rel == os.path.basename(rel) and rel not in ("", ".", ".."), "aggregate-component-path")
        data = raw(os.path.join(bundle_dir, rel))
        need(digest(data) == entry["sha256"], "aggregate-component-digest:" + name)
        original[name] = data
        docs[name] = load_json(data, "aggregate-component-json:" + name)
    need(component_root(entries) == pins["bundleRootSha256"] == manifest.get("bundleRootSha256"), "aggregate-root-not-pinned")
    validate_documents(docs, request, config)
    accepted = dict(original)
    accepted["prior-run-verification"] = json.dumps(docs["prior-run-verification"], sort_keys=True).encode() + b"\n"
    return docs, accepted


def receive(manifest_raw, bundle_dir, request_raw, config, pins):
    """Compatibility wrapper used by focused unit controls."""
    return receive_bundle(manifest_raw, bundle_dir, request_raw, config, pins)[0]


def verified_accepted(manifest_path, request_path, accepted_dir, config):
    """Re-verify the pinned source bundle and the exact accepted consumer bytes.

    The consumer calls this at its own boundary.  It never treats a receipt that
    merely describes itself as proof, and it returns the already-read bytes so a
    caller can create a private snapshot instead of validating one file and then
    consuming a later substitution.
    """
    pins = config.get("aggregateReceiver") or {}
    manifest_raw, request_raw = raw(manifest_path), raw(request_path)
    docs, expected = receive_bundle(manifest_raw, os.path.dirname(os.path.realpath(manifest_path)), request_raw, config, pins)
    accepted = {}
    for name in REQUIRED:
        accepted[name] = raw(os.path.join(accepted_dir, name + ".json"))
        need(accepted[name] == expected[name], "aggregate-accepted-substitution:" + name)
    receipt_path = os.path.join(accepted_dir, "receiver-receipt.json")
    receipt_raw = raw(receipt_path)
    receipt = load_json(receipt_raw, "aggregate-receiver-receipt")
    expected_receipt = receiver_receipt(manifest_raw, request_raw, expected, pins)
    need(receipt == expected_receipt, "aggregate-receiver-receipt")
    return docs, accepted, receipt


def materialize_verified(directory, accepted, receipt):
    """Write one private, exclusive consumer snapshot from verified buffers."""
    os.mkdir(directory, 0o700)
    for name in REQUIRED:
        with open(os.path.join(directory, name + ".json"), "xb") as f:
            f.write(accepted[name])
        os.chmod(os.path.join(directory, name + ".json"), 0o400)
    with open(os.path.join(directory, "receiver-receipt.json"), "x", encoding="utf-8") as f:
        json.dump(receipt, f, sort_keys=True)
        f.write("\n")
    os.chmod(os.path.join(directory, "receiver-receipt.json"), 0o400)


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--manifest", required=True)
    a.add_argument("--request", required=True)
    a.add_argument("--config", required=True)
    a.add_argument("--out-dir", required=True)
    x = a.parse_args()
    try:
        with open(x.config, encoding="utf-8") as f:
            config = json.load(f)
        pins = config.get("aggregateReceiver") or {}
        # Activation is checked before manifest/request bytes are read.
        need(pins.get("activated") is True, "aggregate-receiver-not-activated")
        manifest_raw, request_raw = raw(x.manifest), raw(x.request)
        docs, accepted = receive_bundle(manifest_raw, os.path.dirname(os.path.realpath(x.manifest)), request_raw, config, pins)
        os.mkdir(x.out_dir, 0o700)
        for name in REQUIRED:
            path = os.path.join(x.out_dir, name + ".json")
            # `accepted` was captured in the same read that validation used.
            # Never validate one buffer and reopen a caller-controlled source.
            with open(path, "xb") as f:
                f.write(accepted[name])
        with open(os.path.join(x.out_dir, "receiver-receipt.json"), "x", encoding="utf-8") as f:
            json.dump(receiver_receipt(manifest_raw, request_raw, accepted, pins), f, sort_keys=True)
            f.write("\n")
        return 0
    except Refused as e:
        print("BLOCKED_SETUP: " + str(e), file=sys.stderr)
        return 78
    except (OSError, ValueError, KeyError, TypeError):
        print("BLOCKED_SETUP: aggregate-inputs-unreadable", file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main())
