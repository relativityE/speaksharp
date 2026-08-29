#!/usr/bin/env tsx
/**
 * #1304 Task 3C — certify the harness, then run the REAL shipping-v2 controls.
 *
 * Order matters and is enforced: certification runs FIRST, and no measurement is reported if it fails.
 * A harness that measured first and certified afterwards would already have printed a number, and a
 * number that exists gets quoted regardless of the caveat attached to it.
 *
 * This script WRITES NO LEDGER. `benchmark-whisper-ceiling.mts` mutated `STT_BENCHMARKS.json` as a
 * side effect of measuring, so a run silently rewrote the very baseline it was being compared against.
 * Output goes to stdout, and to an explicit `--out` path if one is given.
 *
 *   usage: npx tsx scripts/certify-harness.mts [--model=whisper-base.en] [--out=/path/report.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import goldens from '../tests/evidence/normalization/goldens.json' with { type: 'json' };
import manifest from '../tests/fixtures/corpus-manifest.json' with { type: 'json' };
import { certifyArm } from '../tests/evidence/certification/certify';
import { scoreUtterance, aggregateArm } from '../tests/evidence/certification/scoringAdapter';
import { decodeWav } from '../tests/evidence/certification/audio';
import { createTransformersV2Arm } from '../tests/evidence/certification/arms/transformersV2Arm';
import { HARVARD_SENTENCES } from '../tests/fixtures/stt-isomorphic/harvard-sentences';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;

const localModelId = arg('model', 'whisper-base.en');
const outPath = arg('out', '');

const corpusProvenance = {
    version: (manifest as { corpusVersion: string }).corpusVersion,
    archives: Object.fromEntries(
        Object.entries((manifest as { archives: Record<string, { sha256: string }> }).archives)
            .map(([name, a]) => [name, a.sha256]),
    ),
};

const arm = createTransformersV2Arm({
    localModelId,
    modelsRoot: resolve('frontend/public/models'),
    corpus: corpusProvenance,
});

// ---------------------------------------------------------------------------------------------
// CERTIFICATION — before anything is measured.
// ---------------------------------------------------------------------------------------------
const certification = certifyArm(arm, 'v2', localModelId, goldens.cases);

console.log(`\n=== CERTIFICATION (${certification.rulesVersion}) — ${certification.armId} ===`);
for (const probe of certification.gates.routeParity.probes) {
    console.log(
        `  route ${probe.probe.padEnd(8)} ${probe.audioSeconds.toFixed(2)}s  ` +
        `shipping=${probe.shippingHash}  arm=${probe.armHash}  ${probe.matched ? 'MATCH' : 'DIVERGES'}`,
    );
}
const oracle = certification.gates.oracleVectors;
console.log(`  oracle vectors  ${oracle.vectorsRun}/${oracle.vectorsRequired}  failures=${oracle.failures.length}`);
console.log(`  provenance      ${certification.gates.provenance.ok ? 'complete' : `INCOMPLETE ${JSON.stringify(certification.gates.provenance)}`}`);
console.log(`  => ${certification.certified ? 'CERTIFIED' : `NOT CERTIFIED (${certification.failedGates.join(', ')})`}`);

if (!certification.certified) {
    console.error('\nRefusing to measure with an uncertified harness.');
    process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// CONTROLS — real shipping-v2 decodes on the committed short and long fixtures.
// ---------------------------------------------------------------------------------------------
interface ControlRow { id: string; seconds: number; strideBranch: number; wer: number | null; reference: string; hypothesis: string | null }

const controls: ControlRow[] = [];

const runControl = async (id: string, wavPath: string, reference: string): Promise<ControlRow> => {
    const audio = decodeWav(wavPath);
    const hypothesis = await arm.decode(audio.samples, audio.seconds);
    const score = scoreUtterance(id, reference, hypothesis);
    return {
        id,
        seconds: Number(audio.seconds.toFixed(2)),
        strideBranch: arm.declareRoute(audio.seconds).stride_length_s,
        wer: score.ok ? score.row.wer : null,
        reference,
        hypothesis,
    };
};

console.log('\n=== SHIPPING-v2 CONTROLS (committed fixtures) ===');
controls.push(await runControl('short:h1_1', 'tests/fixtures/stt-isomorphic/audio/h1_1.wav', HARVARD_SENTENCES[0].transcript));
controls.push(await runControl(
    'long:long-01',
    'tests/fixtures/corpus-longform/long-01.wav',
    readFileSync('tests/fixtures/corpus-longform/long-01.reference.txt', 'utf8').split('\n').filter(Boolean).join(' '),
));
for (const c of controls) {
    console.log(`  ${c.id.padEnd(14)} ${String(c.seconds).padStart(6)}s  stride=${c.strideBranch}  WER=${c.wer === null ? 'unmeasurable' : c.wer.toFixed(4)}`);
}
// The two controls must land on DIFFERENT branches, or the long-form decode path is unexercised.
const branches = new Set(controls.map((c) => c.strideBranch));
console.log(`  branches exercised: ${[...branches].join(', ')}${branches.size === 2 ? '' : '   <-- ONLY ONE BRANCH: long-form path unproven'}`);

// ---------------------------------------------------------------------------------------------
// HARVARD-10 — a strict pooled Track-A CHARACTERIZATION. Not a target, and not compared to `0.0936`.
// ---------------------------------------------------------------------------------------------
console.log('\n=== HARVARD-10 CHARACTERIZATION (pooled, Track A) ===');
const harvard = HARVARD_SENTENCES.filter((s) => /^h1_\d+$/.test(s.id));
const scores = [];
for (const sentence of harvard) {
    const audio = decodeWav(`tests/fixtures/stt-isomorphic/audio/${sentence.id}.wav`);
    const hypothesis = await arm.decode(audio.samples, audio.seconds);
    const score = scoreUtterance(sentence.id, sentence.transcript, hypothesis);
    scores.push(score);
    console.log(
        `  ${sentence.id.padEnd(6)} ${score.ok ? `WER=${(score.row.wer ?? 0).toFixed(4)}` : `INVALID ${score.invalidReason}`}` +
        `  hyp=${JSON.stringify((hypothesis ?? '').slice(0, 60))}`,
    );
}
const harvardAggregate = aggregateArm(scores, harvard.map((s) => s.id));
console.log(
    harvardAggregate.wer === null
        ? `  POOLED: unscoreable (${harvardAggregate.armInvalidReason})`
        : `  POOLED WER = ${harvardAggregate.wer.toFixed(4)}  over ${harvardAggregate.referenceWords} reference words` +
          `  (S=${harvardAggregate.substitutions} D=${harvardAggregate.deletions} I=${harvardAggregate.insertions})`,
);
console.log('  NOTE: a characterization, not a target. The retired 0.0936 was a MEAN over surviving');
console.log('        rows from a disqualified scorer on the browser path; it is not comparable.');

const report = {
    rulesVersion: certification.rulesVersion,
    armId: certification.armId,
    certified: certification.certified,
    routeParity: certification.gates.routeParity.probes.map((p) => ({ probe: p.probe, seconds: p.audioSeconds, shippingHash: p.shippingHash, armHash: p.armHash, matched: p.matched })),
    oracleVectors: { run: oracle.vectorsRun, required: oracle.vectorsRequired, failures: oracle.failures.length, nonIdempotentInputs: oracle.nonIdempotentInputs },
    controls,
    harvard10: { pooled: harvardAggregate, note: 'characterization, not a target' },
    provenance: arm.provenance(),
};
if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`\nwrote ${outPath}`);
}
console.log('\nNo ledger was written. This script reports; it does not mutate baselines.\n');
