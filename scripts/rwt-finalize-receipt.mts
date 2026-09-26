/**
 * RWT finalization (PO 2026-09-25): consume a COMPLETED human-check worksheet after the run and emit the run's final
 * overall verdict. A finished receipt cannot update itself; this is the only path from INCOMPLETE to PASS/FAIL.
 *
 *   pnpm rwt:finalize -- --receipt test-results/rwt/<suite>.receipt.json --worksheet <completed>.human-worksheet.md
 *
 * Binds the worksheet to the SAME suite, deployed SHA, journey ids and receipt, requires PASS/FAIL (and an observer for
 * PASS) for exactly the receipt's human observations, recomputes acceptance over ALL rows, and writes
 * `<suite>.final.json` beside the receipt with both input digests. Exit 0 = PASS, 1 = FAIL, 2 = INCOMPLETE / binding
 * error. Content-free: nothing but ids, verdicts, SHAs, digests and observer names is read or written.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { finalizeReceipt, parseHumanWorksheet, type ReceiptForFinalization } from '../tests/live/helpers/rwtAcceptance.ts';

const arg = (name: string): string | null => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const receiptPath = arg('receipt');
const worksheetPath = arg('worksheet');
if (!receiptPath || !worksheetPath) {
    console.error('usage: pnpm rwt:finalize -- --receipt <suite>.receipt.json --worksheet <suite>.human-worksheet.md');
    process.exit(2);
}
const receiptBytes = readFileSync(receiptPath);
const worksheetBytes = readFileSync(worksheetPath);
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const receipt = JSON.parse(receiptBytes.toString('utf8')) as ReceiptForFinalization;
const result = finalizeReceipt(receipt, parseHumanWorksheet(worksheetBytes.toString('utf8')));

const final = {
    suite: receipt.suite,
    release: receipt.release,
    journeyIds: receipt.readback?.journeyIds ?? [],
    receiptSha256: sha256(receiptBytes),
    worksheetSha256: sha256(worksheetBytes),
    status: result.status,
    finalAcceptance: result.finalAcceptance,
    automatedRowsAllPass: result.automatedRowsAllPass,
    humanObservations: result.humanObservations,
    errors: result.errors,
};
const out = path.join(path.dirname(receiptPath), `${receipt.suite}.final.json`);
writeFileSync(out, `${JSON.stringify(final, null, 2)}\n`);
console.log(`RWT_FINAL ${JSON.stringify(final)}`);
if (result.errors.length > 0) for (const e of result.errors) console.error(`binding error: ${e}`);
process.exit(result.finalAcceptance === 'PASS' ? 0 : result.finalAcceptance === 'FAIL' ? 1 : 2);
