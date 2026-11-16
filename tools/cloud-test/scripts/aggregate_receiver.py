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
# #1772 Code finding 4446324167: a recurring (nightly) request's bytes and campaign change every occurrence, so its retained manifest pins
# only the historical components and the release; the request/campaign binding and the reconciliation come from an OCCURRENCE envelope
# derived from the verified journal (receive_occurrence), recorded apart from the retained components. The same v2 boundary serves an approved
# predeployment manual run: reconciliation and genuine current release verification are occurrence inputs, never fabricated future pins.
OCCURRENCE_SCHEMA = "speaksharp.cloud-test.aggregate-receiver.v2-occurrence"
JOURNAL_SNAPSHOT_SCHEMA = "speaksharp.cloud-test.journal-snapshot.v1"
REQUIRED = (
    "reconciliation", "release-verification", "gap-ledger",
    "prior-run-verification", "comparison-prior", "case-costs",
)
RUNTIME_OCCURRENCE = ("reconciliation", "release-verification")
RETAINED_OCCURRENCE = tuple(name for name in REQUIRED if name not in RUNTIME_OCCURRENCE)


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


def receive_retained(manifest_raw, bundle_dir, pins):
    """Verify and return only the immutable historical half of a v2 bundle.

    This boundary exists so release verification can be generated from a
    pinned gap ledger before the full occurrence is received.  It never admits
    a request, a reconciliation, a release identity, or a PASS result.
    """
    need(pins.get("activated") is True and SHA256.fullmatch(str(pins.get("manifestSha256", ""))) and
         SHA256.fullmatch(str(pins.get("bundleRootSha256", ""))), "aggregate-receiver-not-activated")
    need(digest(manifest_raw) == pins["manifestSha256"], "aggregate-manifest-not-pinned")
    manifest = load_json(manifest_raw, "aggregate-manifest")
    entries = manifest.get("components") or {}
    need(manifest.get("schema") == OCCURRENCE_SCHEMA and set(entries) == set(RETAINED_OCCURRENCE) and
         all(name not in manifest for name in ("requestSha256", "runId", "sourceSha")), "aggregate-manifest-shape")
    docs, original = {}, {}
    for name in RETAINED_OCCURRENCE:
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
    return manifest, docs, original


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


def receive_occurrence(request, request_raw, occurrence):
    """#1772 Code finding 4446324167: the occurrence envelope of a recurring request, derived only from the AUTHENTICATED journal: the supplied
    snapshot is admitted only when its head and events are exactly the approved state ref as authenticated now, through the same boundary
    G11 uses (check_gates.authenticated_chain: a fresh fetch into a private repository and whole-chain validation from the reviewed root;
    the CLI developer RETURN ), so a well-shaped fabricated, reduced or stale snapshot never yields an envelope or a receipt. That
    journal must hold exactly one open reserve of THIS request (campaign and admitted request digest). A nightly reconciliation is at the
    reserved head; a manual reconciliation is the authenticated parent that immediately precedes this run's own final reserve. Returns
    (envelope, occurrence runtime bytes)."""
    need(isinstance(occurrence, dict) and isinstance(occurrence.get("journalSnapshot"), bytes)
         and isinstance(occurrence.get("reconciliation"), bytes)
         and isinstance(occurrence.get("releaseVerification"), bytes), "aggregate-occurrence-missing")
    snap = load_json(occurrence["journalSnapshot"], "aggregate-occurrence-journal")
    need(isinstance(snap, dict) and snap.get("schema") == JOURNAL_SNAPSHOT_SCHEMA and SHA40.fullmatch(str(snap.get("headSha", "")))
         and isinstance(snap.get("events"), list), "aggregate-occurrence-journal")
    import check_gates
    import state_ref_writer
    try:
        auth_head, auth_events = check_gates.authenticated_chain()
    except (state_ref_writer.Refused, OSError):
        raise Refused("aggregate-occurrence-journal-unauthenticated")
    need(snap["headSha"] == auth_head and snap["events"] == auth_events, "aggregate-occurrence-journal-unauthenticated")
    provenance = "request-sha256:" + digest(request_raw)
    closed = {(e.get("campaignId"), e.get("runId"), e.get("attempt")) for e in snap["events"] if isinstance(e, dict)
              and e.get("type") in ("settle", "release")}
    own = [e for e in snap["events"] if isinstance(e, dict) and e.get("type") == "reserve" and e.get("provenance") == provenance
           and e.get("campaignId") == request.get("runId") and (e["campaignId"], e.get("runId"), e.get("attempt")) not in closed]
    need(len(own) == 1, "aggregate-occurrence-reserve")
    rec = load_json(occurrence["reconciliation"], "aggregate-occurrence-reconciliation")
    need(isinstance(rec, dict) and rec.get("source") == "accepted-rollup", "aggregate-occurrence-reconciliation")
    if request.get("priority") == "nightly-regression":
        need(rec.get("headSha") == snap["headSha"], "aggregate-occurrence-reconciliation")
    else:
        need(check_gates.manual_occurrence(request) and snap["events"] and snap["events"][-1] == own[0],
             "aggregate-occurrence-reserve-transition")
        try:
            parent_head, _parent_events = check_gates.authenticated_parent_transition(rec.get("headSha"), auth_head, auth_events)
        except (state_ref_writer.Refused, OSError):
            raise Refused("aggregate-occurrence-reconciliation")
        need(parent_head == rec.get("headSha"), "aggregate-occurrence-reconciliation")
    release = load_json(occurrence["releaseVerification"], "aggregate-occurrence-release-verification")
    tested = (request.get("release") or {}).get("testedSha")
    need(release.get("needs") == [] and (release.get("testedSha") or release.get("releaseSha") or release.get("sourceSha")) == tested,
         "aggregate-occurrence-release-verification")
    envelope = {"schema": OCCURRENCE_SCHEMA, "requestSha256": digest(request_raw), "campaignId": request.get("runId"),
                "executionRunId": own[0].get("runId"), "journalHeadSha": snap["headSha"],
                "reconciliationSha256": digest(occurrence["reconciliation"]),
                "releaseVerificationSha256": digest(occurrence["releaseVerification"]), "testedSha": tested}
    return envelope, {"reconciliation": occurrence["reconciliation"],
                      "release-verification": occurrence["releaseVerification"]}


def receiver_receipt(manifest_raw, request_raw, accepted_bytes, pins, envelope=None):
    manifest = load_json(manifest_raw, "aggregate-manifest")
    if envelope is not None:
        return {
            "schema": "speaksharp.cloud-test.aggregate-receiver-receipt.v2",
            "manifestSha256": digest(manifest_raw),
            "bundleRootSha256": pins["bundleRootSha256"],
            # the retained, pinned historical components, kept apart from the occurrence envelope
            "retainedComponentSha256": {name: manifest["components"][name]["sha256"] for name in RETAINED_OCCURRENCE},
            "occurrence": envelope,
            "acceptedSha256": {name: digest(accepted_bytes[name]) for name in REQUIRED},
            "sourceSha": load_json(request_raw, "aggregate-request")["release"]["testedSha"],
            "acceptedComponents": list(REQUIRED),
        }
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


def receive_bundle(manifest_raw, bundle_dir, request_raw, config, pins, occurrence=None):
    """Return validated documents and the accepted bytes (plus the occurrence envelope, or None). ``pins`` is injectable only for unit
    controls; the CLI always takes it from the reviewed config and refuses while inactive. ``occurrence`` (journal snapshot, reconciliation
    and release-verification bytes) is required for, and only accepted with, a v2 manifest."""
    need(pins.get("activated") is True and SHA256.fullmatch(str(pins.get("manifestSha256", ""))) and
         SHA256.fullmatch(str(pins.get("bundleRootSha256", ""))), "aggregate-receiver-not-activated")
    need(digest(manifest_raw) == pins["manifestSha256"], "aggregate-manifest-not-pinned")
    manifest = load_json(manifest_raw, "aggregate-manifest")
    request = load_json(request_raw, "aggregate-request")
    recurring = manifest.get("schema") == OCCURRENCE_SCHEMA
    envelope = None
    if recurring:
        # the pinned historical part names no request or campaign; the occurrence envelope binds them from the verified journal
        import check_gates
        need(request.get("priority") == "nightly-regression" or check_gates.manual_occurrence(request), "aggregate-occurrence-priority")
        manifest, docs, original = receive_retained(manifest_raw, bundle_dir, pins)
        envelope, occurrence_runtime = receive_occurrence(request, request_raw, occurrence)
    else:
        need(occurrence is None, "aggregate-occurrence-unexpected")
        need(manifest.get("schema") == SCHEMA and set(manifest.get("components") or {}) == set(REQUIRED), "aggregate-manifest-shape")
        need(manifest.get("requestSha256") == digest(request_raw) and manifest.get("runId") == request.get("runId"), "aggregate-request-binding")
    need((recurring or manifest.get("sourceSha") == (request.get("release") or {}).get("testedSha")) and
         manifest.get("workflowVersion") == request.get("workflowVersion") and
         manifest.get("codeManifestSha256") == (request.get("harness") or {}).get("codeManifestSha256"), "aggregate-source-binding")
    entries = manifest["components"]
    if not recurring:
        docs, original = {}, {}
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
    if recurring:
        for name in RUNTIME_OCCURRENCE:
            original[name] = occurrence_runtime[name]
            docs[name] = load_json(occurrence_runtime[name], "aggregate-occurrence-" + name)
    validate_documents(docs, request, config)
    accepted = dict(original)
    accepted["prior-run-verification"] = json.dumps(docs["prior-run-verification"], sort_keys=True).encode() + b"\n"
    return docs, accepted, envelope


def receive(manifest_raw, bundle_dir, request_raw, config, pins, occurrence=None):
    """Compatibility wrapper used by focused unit controls."""
    return receive_bundle(manifest_raw, bundle_dir, request_raw, config, pins, occurrence)[0]


def read_occurrence(journal_snapshot_path, reconciliation_path, release_verification_path=None):
    """The occurrence inputs (journal snapshot, reconciliation, current release verification), all or none."""
    supplied = tuple(bool(path) for path in (journal_snapshot_path, reconciliation_path, release_verification_path))
    need(len(set(supplied)) == 1, "aggregate-occurrence-missing")
    return ({"journalSnapshot": raw(journal_snapshot_path), "reconciliation": raw(reconciliation_path),
             "releaseVerification": raw(release_verification_path)} if journal_snapshot_path else None)


def verified_accepted(manifest_path, request_path, accepted_dir, config, occurrence=None):
    """Re-verify the pinned source bundle and the exact accepted consumer bytes.

    The consumer calls this at its own boundary.  It never treats a receipt that
    merely describes itself as proof, and it returns the already-read bytes so a
    caller can create a private snapshot instead of validating one file and then
    consuming a later substitution.
    """
    pins = config.get("aggregateReceiver") or {}
    manifest_raw, request_raw = raw(manifest_path), raw(request_path)
    docs, expected, envelope = receive_bundle(manifest_raw, os.path.dirname(os.path.realpath(manifest_path)), request_raw, config, pins, occurrence)
    accepted = {}
    for name in REQUIRED:
        accepted[name] = raw(os.path.join(accepted_dir, name + ".json"))
        need(accepted[name] == expected[name], "aggregate-accepted-substitution:" + name)
    receipt_path = os.path.join(accepted_dir, "receiver-receipt.json")
    receipt_raw = raw(receipt_path)
    receipt = load_json(receipt_raw, "aggregate-receiver-receipt")
    expected_receipt = receiver_receipt(manifest_raw, request_raw, expected, pins, envelope)
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
    a.add_argument("--request")
    a.add_argument("--config", required=True)
    a.add_argument("--out-dir")
    a.add_argument("--retained-out-dir")
    a.add_argument("--journal-snapshot")
    a.add_argument("--occurrence-reconciliation")
    a.add_argument("--occurrence-release-verification")
    x = a.parse_args()
    try:
        with open(x.config, encoding="utf-8") as f:
            config = json.load(f)
        pins = config.get("aggregateReceiver") or {}
        # Activation is checked before manifest/request bytes are read.
        need(pins.get("activated") is True, "aggregate-receiver-not-activated")
        manifest_raw = raw(x.manifest)
        if x.retained_out_dir:
            need(not x.request and not x.out_dir and not any((x.journal_snapshot, x.occurrence_reconciliation,
                                                              x.occurrence_release_verification)), "aggregate-cli-shape")
            manifest, _docs, accepted = receive_retained(manifest_raw, os.path.dirname(os.path.realpath(x.manifest)), pins)
            os.mkdir(x.retained_out_dir, 0o700)
            for name in RETAINED_OCCURRENCE:
                with open(os.path.join(x.retained_out_dir, name + ".json"), "xb") as f:
                    f.write(accepted[name])
            with open(os.path.join(x.retained_out_dir, "retained-receipt.json"), "x", encoding="utf-8") as f:
                json.dump({"schema": "speaksharp.cloud-test.aggregate-retained-receipt.v1",
                           "manifestSha256": digest(manifest_raw), "bundleRootSha256": pins["bundleRootSha256"],
                           "occurrenceRequired": True,
                           "retainedComponentSha256": {name: manifest["components"][name]["sha256"]
                                                       for name in RETAINED_OCCURRENCE}}, f, sort_keys=True)
                f.write("\n")
            return 0
        need(bool(x.request) and bool(x.out_dir), "aggregate-cli-shape")
        request_raw = raw(x.request)
        occurrence = read_occurrence(x.journal_snapshot, x.occurrence_reconciliation, x.occurrence_release_verification)
        docs, accepted, envelope = receive_bundle(manifest_raw, os.path.dirname(os.path.realpath(x.manifest)), request_raw, config, pins,
                                                  occurrence)
        os.mkdir(x.out_dir, 0o700)
        for name in REQUIRED:
            path = os.path.join(x.out_dir, name + ".json")
            # `accepted` was captured in the same read that validation used.
            # Never validate one buffer and reopen a caller-controlled source.
            with open(path, "xb") as f:
                f.write(accepted[name])
        with open(os.path.join(x.out_dir, "receiver-receipt.json"), "x", encoding="utf-8") as f:
            json.dump(receiver_receipt(manifest_raw, request_raw, accepted, pins, envelope), f, sort_keys=True)
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
