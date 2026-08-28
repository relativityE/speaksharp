#!/usr/bin/env tsx
/**
 * #1304 — run ONE Node arm, in its own process, through the CERTIFIED PATH.
 *
 * It used to score and aggregate here, inline. That was a second execution path beside `runArm`, with
 * its own rules — and it derived the expected-id list from the clips it had just decoded, so a missing
 * clip could never be detected. Everything now goes through `runArm`, which takes the expected ids
 * from the SET's definition instead.
 *
 * ONE CHILD PROCESS PER ARM, because the two transformers packages each bundle their own native
 * onnxruntime and loading several precisions in one process aborts natively — no exception, no stack.
 *
 *   usage: npx tsx scripts/run-one-arm.mts --arm=<id> --set=harvard|preflight|corpus
 */
import manifest from '../tests/fixtures/corpus-manifest.json' with { type: 'json' };
import goldens from '../tests/evidence/normalization/goldens.json' with { type: 'json' };
import { ARM_MATRIX } from '../tests/evidence/certification/arms/registry';
import { buildArm, expectationFor } from '../tests/evidence/certification/arms/build';
import { certifyArmWithHonorProbe } from '../tests/evidence/certification/certify';
import { runArm, type CorpusUtterance } from '../tests/evidence/certification/runArm';
import { decodeAudio } from '../tests/evidence/certification/audio';
import { verifyFrozenAudio, type ManifestShape } from '../tests/evidence/certification/corpusSet';
import { buildEvidenceSet } from '../tests/evidence/certification/evidenceSets';
import { EVIDENCE_SETS } from '../tests/evidence/certification/evidenceClass';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;

const armId = arg('arm', '');
const setName = arg('set', 'harvard');
const spec = ARM_MATRIX.find((a) => a.id === armId);
if (!spec) { console.error(`unknown arm ${armId}`); process.exit(2); }

const corpusProvenance = {
    version: manifest.corpusVersion,
    archives: Object.fromEntries(Object.entries(manifest.archives).map(([n, a]) => [n, a.sha256])),
};

const set = buildEvidenceSet(setName, manifest as unknown as ManifestShape);

// FROZEN AUDIO IS VERIFIED BEFORE ANY DECODE. A complete set of ids says nothing about whether the
// files on disk are the ones the manifest describes.
const audioMismatches: string[] = [];
const utterances: CorpusUtterance[] = [];
for (const clip of set.clips) {
    if (clip.frozen) {
        const verified = verifyFrozenAudio(clip.path, {
            audioSha256: clip.frozen.audioSha256, audioBytes: clip.frozen.audioBytes,
        });
        if (!verified.ok) {
            audioMismatches.push(`${clip.id}: ${verified.reason} (${verified.detail})`);
            continue; // omitted from the run — and therefore MISSING against the expected ids
        }
    }
    let audioSeconds: number;
    try {
        audioSeconds = decodeAudio(clip.path).seconds;
    } catch (error) {
        audioMismatches.push(`${clip.id}: unreadable (${(error as Error).message.slice(0, 80)})`);
        continue;
    }
    utterances.push({ id: clip.id, reference: clip.reference, locator: clip.path, audioSeconds });
}

const arm = buildArm(spec, corpusProvenance);
const probe = utterances[0] ?? { locator: set.clips[0]?.path ?? '', audioSeconds: 1 };
const certification = await certifyArmWithHonorProbe(
    arm, expectationFor(spec), goldens.cases, probe.locator, probe.audioSeconds,
);

// The expected ids come from the SET, not from what was decoded — that is the whole point.
const result = await runArm(arm, certification, utterances, set.expectedIds);
const provenance = arm.provenance();

console.log(JSON.stringify({
    id: armId,
    label: spec.label,
    lane: 'node',
    set: setName,
    evidenceClass: EVIDENCE_SETS[setName]?.evidenceClass ?? 'unknown',
    referenceWordsExpected: set.referenceWords,
    expectedClips: set.expectedIds.length,
    decodedClips: utterances.length,
    audioMismatches,
    certified: certification.certified,
    failedGates: certification.failedGates,
    fingerprint: certification.fingerprint.digest,
    ...(result.ok
        ? {
              wer: result.row.wer,
              referenceWords: result.row.referenceWords,
              substitutions: result.row.substitutions,
              deletions: result.row.deletions,
              insertions: result.row.insertions,
              scoredCount: result.row.scoredCount,
              decodeFailures: result.decodeFailures,
          }
        : {
              wer: null,
              rejectedReason: result.reason,
              rejectedDetail: result.detail,
              armInvalidReason: result.aggregate?.armInvalidReason ?? null,
              missingUtteranceIds: result.aggregate?.missingUtteranceIds?.slice(0, 10) ?? [],
              decodeFailures: result.decodeFailures,
          }),
    wallClockMs: provenance.resources.wallClockMs,
    peakRssBytes: provenance.resources.peakRssBytes,
    deviceClaim: certification.gates.routeHonored?.deviceClaim ?? 'none',
    provenance,
}));
