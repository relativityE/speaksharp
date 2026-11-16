/**
 * AHT-02 / AHT-03, catalog rows `owner-bound` and `focus-presentation-contract` (fix list item 9 of the 2026-11-10 front-run
 * review). Case-only helper; no file outside the Focus journey uses it.
 *
 * `sign-in`: the Focus journey already signs out and back in through the real form (`signOutAndSignIn`) and polls the uid, but
 * wrote no row. AHT-01 writes `sign-in` after the same step; this records the same fact for Focus.
 *
 * `Focus presentation contract`: the harness `group()` over its ten FOCUS_ROWS (presentation-controls.cjs), applied to the
 * journey's own ten source rows by name:
 *  - FAIL when any required row FAILs (a FAIL is never hidden behind a missing row);
 *  - PASS only when every required row appears exactly once and every one PASSes;
 *  - otherwise HOLD (the harness's NOT RUN): a row missing, written twice, HOLD, EXTERNAL or after a halt.
 * Evidence is counts only.
 */
import type { ReceiptRow } from './rwtAcceptance';

export const FOCUS_SIGN_IN_ROW = 'sign-in';
export const FOCUS_PRESENTATION_ROW = 'Focus presentation contract';

/** The journey's rows for the harness FOCUS_ROWS, in the harness's order (presentation-controls.cjs FOCUS_ROWS). */
export const FOCUS_PRESENTATION_SOURCE_ROWS: readonly string[] = Object.freeze([
    'pace guide',                    // focus-pace-guide
    'rail before speaking',          // focus-rail-before
    'rail legend',                   // focus-rail-legend
    'pending points labelled',       // focus-pending-labelled
    'next point marked',             // focus-next-point-marked
    'no red before Stop',            // focus-no-red-before-stop
    'not-detected explained',        // focus-not-detected-explained
    'coverage count',                // focus-coverage-count
    'average per point',             // focus-average-per-point
    'final rail colours and words',  // focus-final-rail-colours-words
]);

export interface FocusRowResult {
    verdict: 'PASS' | 'FAIL' | 'HOLD';
    detail: string;
    evidence: Record<string, string | number | boolean | null>;
}

export function focusPresentationRow(rows: readonly ReceiptRow[]): FocusRowResult {
    const matches = FOCUS_PRESENTATION_SOURCE_ROWS.map((name) => rows.filter((r) => r.step === name));
    const flat = matches.flat();
    const evidence = {
        required: FOCUS_PRESENTATION_SOURCE_ROWS.length,
        observed: matches.filter((m) => m.length === 1).length,
        duplicated: matches.filter((m) => m.length > 1).length,
        passed: flat.filter((r) => r.verdict === 'PASS').length,
        failed: flat.filter((r) => r.verdict === 'FAIL').length,
    };
    if (evidence.failed > 0) return { verdict: 'FAIL', detail: 'a Focus presentation row failed', evidence };
    const complete = matches.every((m) => m.length === 1);
    if (complete && flat.every((r) => r.verdict === 'PASS')) {
        return { verdict: 'PASS', detail: 'all ten Focus presentation rows passed, each once', evidence };
    }
    return {
        verdict: 'HOLD',
        detail: !complete ? 'a Focus presentation row is missing or was written more than once' : 'a Focus presentation row did not pass',
        evidence,
    };
}

/** The sign-in fact: PASS only when the real form signed back in as the same run-owned uid. */
export function focusSignInRow(o: { signedIn: boolean; sameUid: boolean | null; signinMs: number | null }): FocusRowResult {
    const evidence = { sameUid: o.sameUid, signinMs: o.signinMs };
    if (!o.signedIn) return { verdict: 'FAIL', detail: 'signing back in through the real form did not complete', evidence };
    if (o.sameUid !== true) return { verdict: 'HOLD', detail: 'signed in, but the session\'s account could not be confirmed as the run-owned account', evidence };
    return { verdict: 'PASS', detail: 'signed out and back in through the real form', evidence };
}
