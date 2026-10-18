// #1593 campaign helper — the ONLY place a case receipt is judged, and it judges with the repository's own finalizer
// (`tests/live/helpers/rwtAcceptance.ts`) instead of row labels written into the helper (Sam 1792317800 §1–2).
// The operator's checkout must equal the authorized release S for those files; collect.mjs proves that before using it.
//
//   tsx evaluate.mts --inventory <suite>                       → the suite's required/product/absent rows and the human
//                                                                observations a real (non-synthetic) receipt carries
//   tsx evaluate.mts --receipt <file> [--readback <file>]     → automatedEvaluation(receipt, readback) at this checkout
//
// Reads local files only; writes one JSON line to stdout. No network, no GitHub, no dispatch.
import { readFileSync } from 'node:fs';
import { automatedEvaluation, requiredAutomatedRows, requiredHumanObservations } from '../../tests/live/helpers/rwtAcceptance.ts';

const arg = (name: string): string | null => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const parse = (file: string): unknown => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

const suite = arg('inventory');
if (suite) {
    const human = requiredHumanObservations({ suite, release: '0'.repeat(40), rows: [], meta: { fixtureKind: 'human' } });
    process.stdout.write(`${JSON.stringify({ suite, inventory: requiredAutomatedRows(suite), human })}\n`);
} else {
    const receipt = arg('receipt');
    if (!receipt) { console.error('usage: evaluate.mts --inventory <suite> | --receipt <file> [--readback <file>]'); process.exit(2); }
    const readback = arg('readback');
    const out = automatedEvaluation(parse(receipt), readback ? parse(readback) : undefined);
    // Steps, verdicts and the budget's numeric evidence only: the receipt is already content-free, and nothing else is needed.
    const rows = out.rows.map((r) => ({ step: r.step, verdict: r.verdict,
        ...(r.step === 'coaching request budget' ? { browserRequests: r.evidence?.browserRequests ?? null } : {}) }));
    process.stdout.write(`${JSON.stringify({ suite: out.suite, release: out.release, errors: out.errors, rows })}\n`);
}
