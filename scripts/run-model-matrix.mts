#!/usr/bin/env tsx
/**
 * #1304 — execute the candidate matrix through the certified harness.
 *
 * Every admitted arm is certified and then measured; every PENDING cell is reported with what this
 * harness cannot do and what would resolve it; every rejected candidate is reported with the property
 * of the model that rejects it. An arm that does not appear in the output does not exist — a
 * down-select whose losers cannot be enumerated is not a down-select.
 *
 * ONE CHILD PROCESS PER ARM. Running the matrix in a single process crashed with SIGABRT partway
 * through: `@xenova/transformers` and `@huggingface/transformers` each bundle their own native
 * onnxruntime, and loading several models of different precisions into one process aborts natively —
 * no exception, no stack, nothing to catch. Four already-measured arms went down with it. Isolation
 * turns a crash into a RESULT (`arm_crashed`) instead of a lost run, and stops one arm's memory and
 * thermal state from leaking into the next.
 *
 * Writes no ledger. Results go to stdout and, with --out, to an explicit file.
 *
 *   usage: npx tsx scripts/run-model-matrix.mts [--set=harvard|corpus] [--out=report.json] [--only=id,id]
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { ARM_MATRIX, ADMITTED_ARMS, PENDING_ARMS, REJECTED_ARMS } from '../tests/evidence/certification/arms/registry';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;

const setName = arg('set', 'harvard');
const outPath = arg('out', '');
const only = arg('only', '');
const onlyIds = only ? new Set(only.split(',')) : null;

console.log(`\n#1304 model matrix — set=${setName}\n`);

console.log('=== PENDING A HARNESS (open cells — NOT rejections) ===');
for (const spec of PENDING_ARMS) {
    if (spec.admission.status !== 'pending_harness') continue;
    console.log(`\n  ${spec.id}  [${spec.admission.reason}]`);
    console.log(`    ${spec.label}`);
    console.log(`    evidence: ${spec.admission.evidence}`);
    console.log(`    resolved by: ${spec.admission.resolvedBy}`);
}

console.log(
    REJECTED_ARMS.length === 0
        ? '\n=== REJECTED CANDIDATES: none ==='
        : '\n=== REJECTED CANDIDATES (a property of the model, not of the harness) ===',
);
for (const spec of REJECTED_ARMS) {
    if (spec.admission.status !== 'rejected') continue;
    console.log(`\n  ${spec.id}  [${spec.admission.reason}]`);
    console.log(`    evidence: ${spec.admission.evidence}`);
    console.log(`    would be admissible via: ${spec.admission.admissiblePath}`);
}

interface ArmResult {
    id: string;
    label?: string;
    certified: boolean;
    failedGates?: string[];
    wer?: number | null;
    referenceWords?: number;
    substitutions?: number;
    deletions?: number;
    insertions?: number;
    armInvalidReason?: string;
    decodeFailures?: string[];
    wallClockMs?: number;
    deviceClaim?: string;
    crash?: string;
}

const results: ArmResult[] = [];

console.log('\n\n=== ADMITTED ARMS ===');
for (const spec of ADMITTED_ARMS) {
    if (onlyIds && !onlyIds.has(spec.id)) continue;
    process.stdout.write(`\n  ${spec.id}  (${spec.label})\n`);

    const child = spawnSync(
        'npx',
        ['tsx', 'scripts/run-one-arm.mts', `--arm=${spec.id}`, `--set=${setName}`],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );

    // The LAST JSON line: the libraries print warnings to stdout, and a native abort prints nothing.
    const line = (child.stdout ?? '').trimEnd().split('\n').reverse().find((l) => l.startsWith('{'));
    if (!line) {
        const cause = child.signal ? `signal ${child.signal}` : `exit ${child.status}`;
        console.log(`    ARM CRASHED (${cause}) — recorded, not silently dropped`);
        results.push({ id: spec.id, label: spec.label, certified: false, crash: cause });
        continue;
    }

    const result = JSON.parse(line) as ArmResult;
    results.push({ ...result, label: spec.label });

    if (!result.certified) {
        console.log(`    certification: FAILED (${(result.failedGates ?? []).join(', ')})`);
        continue;
    }
    console.log('    certification: CERTIFIED');
    console.log(
        result.wer === null || result.wer === undefined
            ? `    POOLED: unscoreable (${result.armInvalidReason}) — decode failures: ${result.decodeFailures?.length ?? 0}`
            : `    POOLED WER = ${result.wer.toFixed(4)}  words=${result.referenceWords}  ` +
              `S=${result.substitutions} D=${result.deletions} I=${result.insertions}  ${result.wallClockMs}ms` +
              `  [${result.deviceClaim === 'none' ? 'accuracy only' : `device: ${result.deviceClaim}`}]`,
    );
}

console.log('\n\n=== RANKING (scoreable arms only) ===');
const scoreable = results
    .filter((r): r is ArmResult & { wer: number } => typeof r.wer === 'number')
    .sort((a, b) => a.wer - b.wer);
for (const [i, r] of scoreable.entries()) {
    console.log(`  ${i + 1}. ${r.wer.toFixed(4)}  ${r.id.padEnd(34)} ${r.wallClockMs}ms`);
}
const unranked = results.filter((r) => typeof r.wer !== 'number');
if (unranked.length > 0) {
    console.log('\n  NOT RANKED:');
    for (const r of unranked) {
        console.log(`     ${r.id.padEnd(34)} ${r.crash ?? (r.failedGates ?? []).join(',') ?? r.armInvalidReason}`);
    }
}
console.log(
    `\n  ${scoreable.length} of ${ARM_MATRIX.length} matrix cells produced a comparable number ` +
    `(${PENDING_ARMS.length} pending a browser harness).`,
);
console.log('  A ranking is not a selection: latency, size and device coverage are separate axes,');
console.log('  and on a 10-utterance set most of these differences are a single word.\n');

if (outPath) {
    writeFileSync(
        outPath,
        `${JSON.stringify({ set: setName, results, pending: PENDING_ARMS, rejected: REJECTED_ARMS }, null, 2)}\n`,
        'utf8',
    );
    console.log(`wrote ${outPath}`);
}
console.log('No ledger was written.\n');
