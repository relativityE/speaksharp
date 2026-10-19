"""Read-only #1565 retained-corpus audit; no acquisition, models or references are output.

Usage: python local-packets/evaluator-1565/audit_corpus.py --repo . --output /tmp/corpus-audit.json
The proposed speaker folds are review metadata, not accepted qualification subsets.
"""
import argparse
import io
import subprocess
import hashlib
import json
import pathlib
import wave

SEED = "speaksharp-1565-speaker-review-v1"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def audit(repo):
    repo = repo.resolve()
    def git(*args):
        return subprocess.run(
            ["git", "-C", str(repo), *args], check=True,
            capture_output=True, text=True).stdout.strip()
    observed_head = git("rev-parse", "HEAD")
    observed_tree = git("rev-parse", "HEAD^{tree}")
    observed_inputs = {}
    def read_input(name):
        data = (repo / name).read_bytes()
        # Compare the actual bytes consumed with the named commit, not the index.
        expected_blob = git("rev-parse", observed_head + ":" + name)
        actual_blob = hashlib.sha1(
            b"blob " + str(len(data)).encode() + bytes([0]) + data).hexdigest()
        if actual_blob != expected_blob:
            raise ValueError("source input differs from observed HEAD: " + name)
        observed_inputs[name] = {
            "sha256": digest(data), "gitBlobOid": actual_blob,
            "matchesObservedHead": True,
        }
        return data
    def load(name):
        data = read_input(name)
        return json.loads(data), digest(data)

    manifest, manifest_hash = load("tests/fixtures/corpus-manifest.json")
    selection = []
    for partition, entries in sorted(manifest["subsets"].items()):
        for entry in entries:
            speaker, chapter, _ = entry["id"].split("-")
            bucket = int(digest((SEED + ":" + speaker).encode()), 16) % 5
            selection.append({
                "id": entry["id"], "sourcePartition": partition,
                "speaker": speaker, "sessionClusterProxy": speaker + "-" + chapter,
                "proposedReviewFold": "held_out" if bucket == 0 else "development",
                "sourceAudioSha256": entry["audio"]["sha256"],
                "sourceAudioBytes": entry["audio"]["bytes"],
                "referenceSha256": digest(entry["reference"].encode()),
            })
    ids = [r["id"] for r in selection]
    if len(ids) != 600 or len(set(ids)) != 600:
        raise ValueError("retained corpus is not 600 unique rows")
    folds = {}
    speaker_sets = {}
    for fold in ["development", "held_out"]:
        rows = [r for r in selection if r["proposedReviewFold"] == fold]
        speakers = {r["speaker"] for r in rows}
        speaker_sets[fold] = speakers
        folds[fold] = {
            "clips": len(rows), "speakers": len(speakers),
            "sourcePartitions": {p: sum(r["sourcePartition"] == p for r in rows) for p in sorted(manifest["subsets"])},
        }
    if speaker_sets["development"] & speaker_sets["held_out"]:
        raise ValueError("speaker leakage between proposed folds")

    smoke, smoke_hash = load("tests/evidence/fixtures/corpus/manifest.json")
    wavs = []
    def verify_wav(relative, expected, group):
        path = repo / relative
        data = read_input(relative)
        actual = digest(data)
        if actual != expected:
            raise ValueError("audio hash mismatch: " + relative)
        with wave.open(io.BytesIO(data), "rb") as w:
            row = {"path": relative, "group": group, "sha256": actual,
                   "sampleRate": w.getframerate(), "channels": w.getnchannels(),
                   "sampleBytes": w.getsampwidth(), "frames": w.getnframes()}
            row["durationSeconds"] = round(w.getnframes() / w.getframerate(), 6)
        if (row["sampleRate"], row["channels"], row["sampleBytes"]) != (16000, 1, 2):
            raise ValueError("unexpected PCM format: " + relative)
        wavs.append(row)

    for fixture in smoke["fixtures"]:
        if digest(fixture["referenceText"].encode()) != fixture["referenceTextSha256"]:
            raise ValueError("smoke reference hash mismatch")
        verify_wav("tests/evidence/fixtures/corpus/" + fixture["path"], fixture["fixtureSha256"], "synthetic_smoke")
    rwt, rwt_hash = load("tests/fixtures/rwt/rwt-fixtures.manifest.json")
    for fixture in rwt["fixtures"].values():
        verify_wav("tests/fixtures/rwt/" + fixture["file"], fixture["sha256"], "synthetic_product_flow")
    for line in read_input("tests/fixtures/corpus-longform/CHECKSUMS").decode().splitlines():
        expected, name = line.split()
        if name.endswith(".wav"):
            verify_wav("tests/fixtures/corpus-longform/" + name, expected, "derived_librispeech")
        elif digest(read_input("tests/fixtures/corpus-longform/" + name)) != expected:
            raise ValueError("long-form reference hash mismatch")

    canonical = "\n".join(sorted(r["id"] + "\t" + r["sourceAudioSha256"] for r in selection))
    assignment = "\n".join(sorted(r["id"] + "\t" + r["proposedReviewFold"] for r in selection))
    if git("rev-parse", "HEAD") != observed_head:
        raise ValueError("source HEAD changed during audit")
    return {
        "auditVersion": "pm-corpus-readiness-v2",
        "sourceHead": observed_head, "sourceTree": observed_tree,
        "sourceIdentity": {
            "method": "observed_git_HEAD_and_actual_consumed_bytes",
            "inputFiles": observed_inputs,
            "allConsumedInputsMatchObservedHead": True,
            "headStableAcrossAudit": True,
        },
        "status": "PREPARATION_ONLY_NO_MODEL_QUALIFICATION",
        "manifestSha256": manifest_hash, "frozenSelectionDigest": digest(canonical.encode()),
        "manifestDeclaredLicence": manifest.get("licence"), "licenceStatus": "RETAINED_MANIFEST_DECLARATION_NOT_NEW_RIGHTS_REVIEW",
        "clips": len(selection), "speakers": len({r["speaker"] for r in selection}),
        "sessionClusterProxies": len({r["sessionClusterProxy"] for r in selection}),
        "emptyReferences": sum(not e["reference"].strip() for es in manifest["subsets"].values() for e in es),
        "sourceAudioBytes": sum(r["sourceAudioBytes"] for r in selection),
        "sourceAudioVerification": "NOT_PERFORMED_600_FLAC_BYTES_NOT_IN_THIS_CHECKOUT_NO_DOWNLOAD",
        "proposedFolds": {"status": "PROPOSED_NOT_ACCEPTED", "seed": SEED,
                          "rule": "sha256(seed + ':' + speakerId) modulo5:0=held_out;1..4=development",
                          "assignmentDigest": digest(assignment.encode()), "folds": folds, "speakerOverlap": 0},
        "smokeManifestSha256": smoke_hash, "rwtManifestSha256": rwt_hash,
        "verifiedLocalWavs": wavs, "verificationErrors": 0,
        "requiredAnnotationGaps": ["accent", "measured_noise", "contextual_filler_spans_and_negatives",
                                   "pause_boundaries", "silence_hallucination_controls", "opening_tail_alignment",
                                   "long_take_repetition", "natural_focus_content", "human_usefulness"],
        "speakerAssignments": [{"speaker": speaker,
                                "proposedReviewFold": next(r["proposedReviewFold"] for r in selection if r["speaker"] == speaker),
                                "clips": sum(r["speaker"] == speaker for r in selection)}
                               for speaker in sorted({r["speaker"] for r in selection})],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=".")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = audit(pathlib.Path(args.repo))
    pathlib.Path(args.output).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k not in ["speakerAssignments", "verifiedLocalWavs"]}, indent=2))
    print("verified_local_wavs=" + str(len(result["verifiedLocalWavs"])))

