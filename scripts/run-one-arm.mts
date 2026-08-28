#!/usr/bin/env tsx
/**
 * #1304 — run ONE arm, in its own process, and print a single JSON line.
 *
 * WHY A CHILD PROCESS PER ARM. Running every arm in one process crashed with SIGABRT partway through
 * the matrix: `@xenova/transformers` and `@huggingface/transformers` each bundle their own native
 * onnxruntime, and loading several models of different precisions into one process aborts natively —
 * no exception, no stack, nothing to catch. Four measured arms went down with it.
 *
 * Isolation makes a crash a RESULT rather than a lost run: the parent records `arm_crashed` for that
 * arm and keeps going. It also stops one arm's memory and thermal state from leaking into the next,
 * which is the difference between comparable timings and coincidental ones.
 *
 *   usage: npx tsx scripts/run-one-arm.mts --arm=<id> --set=harvard|corpus
 */
import goldens from '../tests/evidence/normalization/goldens.json' with { type: 'json' };
import manifest from '../tests/fixtures/corpus-manifest.json' with { type: 'json' };
import { ARM_MATRIX } from '../tests/evidence/certification/arms/registry';
import { buildArm, expectationFor } from '../tests/evidence/certification/arms/build';
import { certifyArmWithHonorProbe } from '../tests/evidence/certification/certify';
import { scoreUtterance, aggregateArm } from '../tests/evidence/certification/scoringAdapter';
import { decodeWav } from '../tests/evidence/certification/audio';
import { loadFrozenCorpus, verifyFrozenAudio, type ManifestShape } from '../tests/evidence/certification/corpusSet';
import { HARVARD_SENTENCES } from '../tests/fixtures/stt-isomorphic/harvard-sentences';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;

const armId = arg('arm', '');
const setName = arg('set', 'harvard');
const spec = ARM_MATRIX.find((a) => a.id === armId);
if (!spec) { console.error(`unknown arm ${armId}`); process.exit(2); }

const corpus = {
    version: manifest.corpusVersion,
    archives: Object.fromEntries(Object.entries(manifest.archives).map(([n, a]) => [n, a.sha256])),
};

interface Utterance {
    id: string;
    reference: string;
    wav: string;
    /** Present for corpus clips: the identity the manifest froze, verified before the clip is decoded. */
    frozen?: { audioSha256: string; audioBytes: number };
}
const harvard: Utterance[] = HARVARD_SENTENCES
    .filter((s) => /^h1_\d+$/.test(s.id))
    .map((s) => ({ id: s.id, reference: s.transcript, wav: `tests/fixtures/stt-isomorphic/audio/${s.id}.wav` }));

let utterances = harvard;
if (setName === 'corpus') {
    const loaded = loadFrozenCorpus(manifest as unknown as ManifestShape);
    if (!loaded.ok) {
        console.log(JSON.stringify({ id: armId, error: `corpus_unusable:${loaded.reason}`, detail: loaded.detail }));
        process.exit(1);
    }
    utterances = loaded.corpus.utterances.map((u) => ({
        id: u.id,
        reference: u.reference,
        wav: `bench-corpus/${u.audioPath}`,
        frozen: { audioSha256: u.audioSha256, audioBytes: u.audioBytes },
    }));
}

const arm = buildArm(spec, corpus);
const probe = decodeWav(harvard[0].wav);
const certification = await certifyArmWithHonorProbe(
    arm, expectationFor(spec), goldens.cases, probe.samples, probe.seconds,
);

if (!certification.certified) {
    console.log(JSON.stringify({
        id: armId, certified: false, failedGates: certification.failedGates,
        routeHonored: certification.gates.routeHonored,
    }));
    process.exit(0);
}

const scores = [];
const decodeFailures: string[] = [];
const audioMismatches: string[] = [];
for (const u of utterances) {
    let hypothesis: string | null = null;
    // THE CLIP MUST BE THE FROZEN ONE. A complete set of ids says nothing about whether the files on
    // disk are the files the manifest describes — a re-extraction, a substitution, or a partial
    // overwrite leaves every id present while the audio is different.
    if (u.frozen) {
        const verified = verifyFrozenAudio(u.wav, u.frozen);
        if (!verified.ok) {
            audioMismatches.push(`${u.id}: ${verified.reason} (${verified.detail})`);
            // Scored as an invalid utterance, which invalidates the ARM. Skipping it would remove the
            // clip from both numerator and denominator and quietly improve the result.
            scores.push(scoreUtterance(u.id, u.reference, null));
            continue;
        }
    }
    try {
        const audio = decodeWav(u.wav);
        hypothesis = await arm.decode(audio.samples, audio.seconds);
    } catch (error) {
        // Recorded and STILL SCORED — skipping would drop the clip from both numerator and denominator.
        decodeFailures.push(`${u.id}: ${(error as Error).message.split('\n')[0].slice(0, 120)}`);
    }
    scores.push(scoreUtterance(u.id, u.reference, hypothesis));
}

const aggregate = aggregateArm(scores, utterances.map((u) => u.id));
const provenance = arm.provenance();
console.log(JSON.stringify({
    id: armId, label: spec.label, certified: true, failedGates: [],
    wer: aggregate.wer, referenceWords: aggregate.referenceWords,
    substitutions: aggregate.substitutions, deletions: aggregate.deletions, insertions: aggregate.insertions,
    scoredCount: aggregate.scoredCount, armInvalidReason: aggregate.armInvalidReason,
    decodeFailures, audioMismatches, wallClockMs: provenance.resources.wallClockMs,
    fingerprint: certification.fingerprint.digest,
    peakRssBytes: provenance.resources.peakRssBytes,
    deviceClaim: certification.gates.routeHonored?.deviceClaim ?? 'none',
    routeHash: provenance.route.hash,
    provenance,
}));
