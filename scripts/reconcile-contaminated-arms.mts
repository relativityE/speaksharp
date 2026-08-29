#!/usr/bin/env tsx
/**
 * #1304 — reconcile a contaminated arm's rerun against its original row.
 *
 * Two arms of the frozen 600 were decoded while other work competed for the machine. Their ACCURACY is
 * unaffected — decoding is deterministic, so contention changes how long a transcript takes, not what
 * it says — but their latency fields are unmeasured rather than slow.
 *
 * The rule this implements: DO NOT ASSUME contention touched only timing. Compare the per-utterance
 * evidence first. Only if the rerun is SCORE-EQUIVALENT may the performance fields be replaced in place;
 * anything else means the whole row is replaced and the difference investigated.
 *
 * WHAT "SCORE-EQUIVALENT" MEANS, EXACTLY — and what it does not. The retained artifact supports five
 * comparisons: the same 600 utterance ids, the same reference-word counts, the same per-utterance
 * substitutions/deletions/insertions, the same invalid reasons, and the same aggregate WER. When all
 * five match, replacing only the timing fields is defensible BECAUSE THOSE ARE THE VALUES THE BENCHMARK
 * RANKS ACCURACY BY. It does NOT establish that the two runs emitted identical transcript text, and no
 * report produced from this script may say "byte-identical transcripts".
 *
 * A LIMIT OF THE RETAINED DATA, stated because it bears directly on what this can prove.
 * `transcriptDigest` in the artifact is computed over `[id, substitutions, deletions, insertions]` —
 * it is an ERROR-PROFILE digest, not a digest of the transcript text, which the run never stored. Two
 * different transcripts that make the same errors in the same places would collide. Across 600 clips
 * with greedy decoding that is strong evidence of identical output, but it is evidence, not proof, and
 * the field's name overstates it. The original frozen artifact does NOT contain transcript hashes and
 * must never be described as if it did.
 *
 * Renaming is a deliberate follow-up, NOT done here: changing it now would alter the active execution
 * tree and make the rerun no longer comparable with the original. The follow-up is to rename the field
 * to `errorProfileDigest`, keep reading the legacy `transcriptDigest` with its existing meaning when
 * loading older artifacts, and add a correctly named digest of the normalized hypothesis text for
 * future corpus runs.
 *
 *   usage: npx tsx scripts/reconcile-contaminated-arms.mts --original=a.json --rerun=b.json --arm=<id>
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const originalPath = arg('original');
const rerunPath = arg('rerun');
const armId = arg('arm');
if (!originalPath || !rerunPath || !armId) {
    console.error('usage: --original=<json> --rerun=<json> --arm=<id>');
    process.exit(2);
}

interface Utterance {
    id: string;
    substitutions: number | null;
    deletions: number | null;
    insertions: number | null;
    referenceWords: number | null;
    invalidReason: string | null;
}
interface Row {
    id: string;
    wer: number | null;
    substitutions?: number;
    deletions?: number;
    insertions?: number;
    referenceWords?: number;
    transcriptDigest?: string;
    perUtterance?: Utterance[];
    verdict?: { speed: unknown; footprint: unknown };
}

const load = (path: string): Row => {
    const rows = (JSON.parse(readFileSync(path, 'utf8')) as { results: Row[] }).results;
    const row = rows.find((r) => r.id === armId);
    if (!row) { console.error(`${armId} not present in ${path}`); process.exit(2); }
    return row;
};

const original = load(originalPath);
const rerun = load(rerunPath);

console.log(`\n#1304 reconciliation — ${armId}`);
console.log(`  original: ${originalPath}`);
console.log(`  rerun   : ${rerunPath}\n`);

const differences: string[] = [];

// 1 — the aggregate figures.
for (const field of ['wer', 'substitutions', 'deletions', 'insertions', 'referenceWords'] as const) {
    if (original[field] !== rerun[field]) {
        differences.push(`${field}: ${String(original[field])} -> ${String(rerun[field])}`);
    }
}

// 2 — the error-profile digest.
if (original.transcriptDigest !== rerun.transcriptDigest) {
    differences.push(`transcriptDigest: ${original.transcriptDigest} -> ${rerun.transcriptDigest}`);
}

// 3 — EVERY utterance, individually. The aggregate can match while individual clips differ in
// compensating ways, which is precisely the case a pooled number cannot show.
const byId = new Map((rerun.perUtterance ?? []).map((u) => [u.id, u]));
const utteranceDifferences: string[] = [];
for (const before of original.perUtterance ?? []) {
    const after = byId.get(before.id);
    if (!after) { utteranceDifferences.push(`${before.id}: absent from the rerun`); continue; }
    for (const field of ['substitutions', 'deletions', 'insertions', 'referenceWords', 'invalidReason'] as const) {
        if (before[field] !== after[field]) {
            utteranceDifferences.push(`${before.id}.${field}: ${String(before[field])} -> ${String(after[field])}`);
        }
    }
}
const extra = (rerun.perUtterance ?? []).filter((u) => !(original.perUtterance ?? []).some((o) => o.id === u.id));
for (const u of extra) utteranceDifferences.push(`${u.id}: present only in the rerun`);

console.log(`  utterances compared : ${original.perUtterance?.length ?? 0}`);
console.log(`  aggregate diffs     : ${differences.length}`);
console.log(`  per-utterance diffs : ${utteranceDifferences.length}`);

if (differences.length === 0 && utteranceDifferences.length === 0) {
    console.log('\n  SCORE-EQUIVALENT — replace ONLY the performance fields:');
    console.log('    (same utterance ids, reference-word counts, per-utterance S/D/I, invalid reasons and aggregate WER)');
    console.log(`    speed     ${JSON.stringify(rerun.verdict?.speed)}`);
    console.log(`    footprint ${JSON.stringify(rerun.verdict?.footprint)}`);
    console.log('\n  The original accuracy stands; contention did not reach the values the ranking uses.');
    console.log('  This is score equivalence, NOT proof of byte-identical transcripts — the run never stored text.');
    process.exit(0);
}

console.log('\n  NOT SCORE-EQUIVALENT — the whole row is replaced, and the difference is investigated.');
console.log('  Contention affecting output would mean the decode is not deterministic, which would');
console.log('  put every arm measured under load in question, not only this one.\n');
for (const d of differences) console.log(`    aggregate     ${d}`);
for (const d of utteranceDifferences.slice(0, 25)) console.log(`    per-utterance ${d}`);
if (utteranceDifferences.length > 25) {
    console.log(`    … and ${utteranceDifferences.length - 25} more`);
}
process.exit(1);
