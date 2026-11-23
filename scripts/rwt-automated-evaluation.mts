/**
 * J8 nightly entry (Sam, 21 Nov): the reviewed finalizer's AUTOMATED half (`automatedEvaluation`, rwtAcceptance.ts) as a CLI,
 * so a CommonJS runner settles a receipt with the same validation and readback merge `pnpm rwt:finalize` applies. No worksheet,
 * no human observation is inferred. Prints one JSON line `{ suite, release, errors, rows }` and exits 0; a receipt or readback
 * that cannot be read is an error in that line, never a silent skip. Usage:
 *   tsx scripts/rwt-automated-evaluation.mts <receipt.json> [<readback-verdicts.json>]
 */
import { readFileSync } from 'node:fs';
import { automatedEvaluation } from '../tests/live/helpers/rwtAcceptance';

const [receiptPath, readbackPath] = process.argv.slice(2);
const parse = (p: string): unknown => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
if (!receiptPath) {
    process.stdout.write(`${JSON.stringify({ suite: null, release: null, errors: ['usage: rwt-automated-evaluation <receipt> [<readback>]'], rows: [] })}\n`);
} else {
    process.stdout.write(`${JSON.stringify(automatedEvaluation(parse(receiptPath), readbackPath ? parse(readbackPath) : undefined))}\n`);
}
