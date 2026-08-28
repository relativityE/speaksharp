#!/usr/bin/env tsx
/**
 * #1304 — merge the Node and browser lanes into ONE record where every row states what it is.
 *
 * THE CONTRADICTION THIS FIXES. The 13th cell was described once as "Node / onnxruntime-node" and once
 * as "cpu -> wasm, browser WASM proven". Both were true of different lanes and neither was true of "the
 * cell", because a cell is not a result — a LANE plus a cell is. A row that does not say which lane it
 * came from can be read as either, and I read it as both.
 *
 * Every row therefore carries: lane, runtime and version, the device REQUESTED, the backend PROVEN,
 * whether it is selection-eligible and why not, and — for diagnostics — what question it answers.
 *
 *   usage: npx tsx scripts/build-matrix-report.mts --node=node.json --browser=browser.json --out=report.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ARM_MATRIX } from '../tests/evidence/certification/arms/registry';

const args = process.argv.slice(2);
const arg = (name: string, fallback = '') =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;

const read = (path: string) => (path ? JSON.parse(readFileSync(path, 'utf8')) : null);
const nodeReport = read(arg('node'));
const browserReport = read(arg('browser'));

interface Row {
    id: string;
    lane: 'node' | 'browser';
    label: string;
    runtime: string;
    requestedDevice: string;
    resolvedBackend: string | null;
    backendProven: boolean;
    hardwareRepresentative: boolean | null;
    transcriptDigest: string | null;
    wer: number | null;
    substitutions: number | null;
    deletions: number | null;
    insertions: number | null;
    referenceWords: number | null;
    wallClockMs: number | null;
    selectionEligible: boolean;
    selectionIneligibleReason: string | null;
    diagnosticPurpose: string | null;
    duplicateOf: string | null;
    error: string | null;
}

const rows: Row[] = [];

/** Why a row may not inform the down-select. Absence of a reason is itself a defect. */
function eligibility(spec: (typeof ARM_MATRIX)[number], lane: 'node' | 'browser', proven: boolean) {
    if (spec.role === 'diagnostic') {
        return {
            eligible: false,
            reason: lane === 'browser' && spec.duplicateInBrowserLaneOf
                ? `diagnostic cell; in the browser lane it is the same experiment as ${spec.duplicateInBrowserLaneOf} under a second name`
                : 'diagnostic cell: answers a question about the harness, not about a candidate',
        };
    }
    if (spec.admission.status === 'rejected') {
        return { eligible: false, reason: `rejected: ${spec.admission.reason}` };
    }
    if (lane === 'node') {
        return {
            eligible: false,
            reason: 'Node lane is DIAGNOSTIC ONLY — the product runs ONNX Runtime Web in a browser, '
                + 'and Node can substantiate neither WASM nor WebGPU',
        };
    }
    if (!proven) return { eligible: false, reason: 'backend claim not proven in this run' };
    return { eligible: true, reason: null };
}

for (const spec of ARM_MATRIX) {
    const nodeResult = nodeReport?.results?.find((r: { id: string }) => r.id === spec.id);
    if (nodeResult) {
        const e = eligibility(spec, 'node', true);
        rows.push({
            id: spec.id, lane: 'node', label: spec.label,
            runtime: `${nodeResult.provenance?.runtime?.library ?? '?'}@${nodeResult.provenance?.runtime?.version ?? '?'}`,
            requestedDevice: spec.device,
            // Node exposes no execution providers on a loaded session, so nothing here may claim one.
            resolvedBackend: nodeResult.provenance?.runtime?.backend ?? null,
            backendProven: false,
            hardwareRepresentative: null,
            transcriptDigest: null,
            wer: nodeResult.wer ?? null,
            substitutions: nodeResult.substitutions ?? null,
            deletions: nodeResult.deletions ?? null,
            insertions: nodeResult.insertions ?? null,
            referenceWords: nodeResult.referenceWords ?? null,
            wallClockMs: nodeResult.wallClockMs ?? null,
            selectionEligible: e.eligible, selectionIneligibleReason: e.reason,
            diagnosticPurpose: spec.diagnosticPurpose ?? null,
            duplicateOf: null,
            error: nodeResult.crash ?? nodeResult.armInvalidReason ?? null,
        });
    }

    const browserResult = browserReport?.results?.find((r: { id: string }) => r.id === spec.id);
    if (browserResult) {
        const proven = Boolean(browserResult.claimSatisfied);
        const e = eligibility(spec, 'browser', proven);
        rows.push({
            id: spec.id, lane: 'browser', label: spec.label,
            runtime: spec.runtime === 'v2' ? '@xenova/transformers (browser bundle)' : '@huggingface/transformers (web bundle)',
            requestedDevice: spec.device === 'cpu' || spec.device === 'onnxruntime-node' ? 'wasm (cpu is not a browser backend)' : spec.device,
            resolvedBackend: browserResult.backendResolved ?? null,
            backendProven: proven,
            hardwareRepresentative: browserResult.hardwareRepresentative ?? null,
            transcriptDigest: browserResult.transcriptDigest ?? null,
            wer: browserResult.wer ?? null,
            substitutions: browserResult.substitutions ?? null,
            deletions: browserResult.deletions ?? null,
            insertions: browserResult.insertions ?? null,
            referenceWords: browserResult.referenceWords ?? null,
            wallClockMs: browserResult.wallClockMs ?? null,
            selectionEligible: e.eligible, selectionIneligibleReason: e.reason,
            diagnosticPurpose: spec.diagnosticPurpose ?? null,
            duplicateOf: spec.duplicateInBrowserLaneOf ?? null,
            error: browserResult.error ?? null,
        });
    }
}

const eligible = rows.filter((r) => r.selectionEligible);
console.log('\n=== #1304 CONSOLIDATED MATRIX ===\n');
console.log('lane     wer      arm                                  requested -> proven backend        eligible');
for (const r of rows) {
    console.log(
        `${r.lane.padEnd(8)} ${(r.wer === null ? '—' : r.wer.toFixed(4)).padEnd(8)} ${r.id.padEnd(36)} `
        + `${r.requestedDevice.padEnd(12)} -> ${(r.resolvedBackend ?? 'unresolved').padEnd(26)} `
        + `${r.selectionEligible ? 'YES' : 'no'}`,
    );
}
console.log(`\n  ${eligible.length} selection-eligible rows; ${rows.length - eligible.length} recorded but not eligible.`);
console.log('  Every ineligible row carries a REASON — an unexplained row in a results table reads as a candidate.\n');

const outPath = arg('out');
if (outPath) {
    writeFileSync(outPath, `${JSON.stringify({ rows, eligibleCount: eligible.length }, null, 2)}\n`, 'utf8');
    console.log(`wrote ${outPath}`);
}
