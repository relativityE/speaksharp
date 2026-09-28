/**
 * RWT finalization (PO 2026-09-25): consume a COMPLETED human-check worksheet after the run and emit the run's final
 * overall verdict. A finished receipt cannot update itself; this is the only path from INCOMPLETE to PASS/FAIL.
 *
 *   pnpm rwt:finalize -- --receipt test-results/rwt/<suite>.receipt.json --worksheet <completed>.human-worksheet.md \
 *     [--readback test-results/rwt/<suite>.readback-verdicts.json]
 *
 * Binds the worksheet to the SAME suite, deployed SHA, journey ids and receipt, requires PASS/FAIL and a named observer
 * for exactly the receipt's human observations, recomputes acceptance over ALL rows, and writes
 * `<suite>.final.json` beside the receipt with both input digests. Exit 0 = PASS, 1 = FAIL, 2 = INCOMPLETE / binding
 * error. Content-free: nothing but ids, verdicts, SHAs, digests and observer names is read or written.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { finalizeReceipt, parseHumanWorksheet, runJourneyIds, type ReadbackBinding } from '../tests/live/helpers/rwtAcceptance.ts';

const arg = (name: string): string | null => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const receiptPath = arg('receipt');
const worksheetPath = arg('worksheet');
// #1532 Codex P1 r4121232394: the workflow's per-journey readback verdicts (optional; absent = `journey telemetry received` stays HOLD).
const readbackPath = arg('readback');
if (!receiptPath || !worksheetPath) {
    console.error('usage: pnpm rwt:finalize -- --receipt <suite>.receipt.json --worksheet <suite>.human-worksheet.md [--readback <suite>.readback-verdicts.json]');
    process.exit(2);
}
const receiptBytes = readFileSync(receiptPath);
const worksheetBytes = readFileSync(worksheetPath);
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
// The receipt is untrusted input: finalizeReceipt validates its structure, verdicts and required observations.
let raw: unknown;
try { raw = JSON.parse(receiptBytes.toString('utf8')); } catch { raw = null; }
const readbackBytes = readbackPath ? readFileSync(readbackPath) : null;
let readback: unknown;
if (readbackBytes) { try { readback = JSON.parse(readbackBytes.toString('utf8')); } catch { readback = null; } }
const result = finalizeReceipt(raw, parseHumanWorksheet(worksheetBytes.toString('utf8')), readbackBytes ? readback : undefined);
const receipt = (raw && typeof raw === 'object' ? raw : {}) as { suite?: unknown; release?: unknown; readback?: { journeys?: unknown; reportedJourneyIds?: unknown } };
const suite = typeof receipt.suite === 'string' && /^[a-z0-9-]+$/.test(receipt.suite) ? receipt.suite : 'invalid-receipt';

const final = {
    suite,
    release: typeof receipt.release === 'string' ? receipt.release : null,
    // #1532: the run's journeys = bound (qualified) plus reported-only; the structure was validated by finalizeReceipt.
    journeyIds: result.status === 'binding_error' ? [] : runJourneyIds({
        journeys: Array.isArray(receipt.readback?.journeys) ? receipt.readback!.journeys as ReadbackBinding[] : [],
        reportedJourneyIds: Array.isArray(receipt.readback?.reportedJourneyIds) ? receipt.readback!.reportedJourneyIds as string[] : [],
    }),
    receiptSha256: sha256(receiptBytes),
    worksheetSha256: sha256(worksheetBytes),
    readbackSha256: readbackBytes ? sha256(readbackBytes) : null,
    status: result.status,
    finalAcceptance: result.finalAcceptance,
    automatedRowsAllPass: result.automatedRowsAllPass,
    humanObservations: result.humanObservations,
    errors: result.errors,
};
const out = path.join(path.dirname(receiptPath), `${suite}.final.json`);
writeFileSync(out, `${JSON.stringify(final, null, 2)}\n`);
console.log(`RWT_FINAL ${JSON.stringify(final)}`);
if (result.errors.length > 0) for (const e of result.errors) console.error(`binding error: ${e}`);
process.exit(result.finalAcceptance === 'PASS' ? 0 : result.finalAcceptance === 'FAIL' ? 1 : 2);
