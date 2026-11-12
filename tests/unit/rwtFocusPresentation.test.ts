// AHT-02 / AHT-03 rows `sign-in` and `Focus presentation contract` (front-run review fix 9): the harness group() over its ten
// FOCUS_ROWS, applied to the Focus journey's own rows by name, and the owner-bound sign-in fact. Fail closed throughout.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ReceiptRow } from '../live/helpers/rwtAcceptance';
import {
    FOCUS_PRESENTATION_ROW, FOCUS_PRESENTATION_SOURCE_ROWS, FOCUS_SIGN_IN_ROW, focusPresentationRow, focusSignInRow,
} from '../live/helpers/rwtFocusPresentation';

const here = path.dirname(fileURLToPath(import.meta.url));
const journey = readFileSync(path.join(here, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
const row = (step: string, verdict: ReceiptRow['verdict'] = 'PASS'): ReceiptRow => ({ step, verdict, detail: '' });
const allPass = () => FOCUS_PRESENTATION_SOURCE_ROWS.map((s) => row(s));

describe('focusPresentationRow (harness group over the ten Focus rows)', () => {
    it('PASS only when every one of the ten rows appears exactly once and passes; unrelated rows are ignored', () => {
        const r = focusPresentationRow([row('model identity', 'FAIL'), ...allPass()]);
        expect(r.verdict).toBe('PASS');
        expect(r.evidence).toEqual({ required: 10, observed: 10, duplicated: 0, passed: 10, failed: 0 });
    });
    it('any FAIL decides FAIL, even beside a missing row (a FAIL is never hidden)', () => {
        const rows = allPass().slice(1);
        rows[3] = row(rows[3].step, 'FAIL');
        expect(focusPresentationRow(rows).verdict).toBe('FAIL');
    });
    it('a missing row HOLDs (the harness NOT RUN)', () => {
        for (let i = 0; i < 10; i += 1) {
            const rows = allPass().filter((_, j) => j !== i);
            expect(focusPresentationRow(rows)).toMatchObject({ verdict: 'HOLD', evidence: { observed: 9 } });
        }
    });
    it('a row written twice HOLDs, even when both copies pass', () => {
        expect(focusPresentationRow([...allPass(), row('coverage count')])).toMatchObject({ verdict: 'HOLD', evidence: { duplicated: 1 } });
    });
    it('a HOLD or EXTERNAL source row HOLDs the group, never PASS', () => {
        for (const v of ['HOLD', 'EXTERNAL'] as const) {
            const rows = allPass();
            rows[9] = row(rows[9].step, v);
            expect(focusPresentationRow(rows).verdict).toBe('HOLD');
        }
    });
    it('no rows at all HOLDs', () => {
        expect(focusPresentationRow([]).verdict).toBe('HOLD');
    });
    it('the ten names match the harness FOCUS_ROWS one for one, in order', () => {
        const req = createRequire(import.meta.url);
        const controls = req('../../tools/cloud-test/harness/draft-adapters/presentation-controls.cjs') as { FOCUS_ROWS?: readonly unknown[] };
        // The helper's mapping, row for row (its comments): if the harness adds, drops or reorders a row, this fails.
        expect(controls.FOCUS_ROWS).toEqual([
            'focus-pace-guide', 'focus-rail-before', 'focus-rail-legend', 'focus-pending-labelled', 'focus-next-point-marked',
            'focus-no-red-before-stop', 'focus-not-detected-explained', 'focus-coverage-count', 'focus-average-per-point',
            'focus-final-rail-colours-words',
        ]);
        expect(controls.FOCUS_ROWS!.length).toBe(FOCUS_PRESENTATION_SOURCE_ROWS.length);
    });
    it('each of the ten rows is written by the Focus journey or the shared journey it calls', () => {
        const shared = readFileSync(path.join(here, '../live/helpers/rwtJourney.ts'), 'utf8');
        const unwritten = FOCUS_PRESENTATION_SOURCE_ROWS.filter((name) => !journey.includes(`'${name}'`) && !shared.includes(`'${name}'`));
        expect(unwritten).toEqual([]);
    });
});

describe('focusSignInRow', () => {
    it('PASS only for a real-form sign-in back as the run-owned uid', () => {
        expect(focusSignInRow({ signedIn: true, sameUid: true, signinMs: 900 })).toMatchObject({ verdict: 'PASS', evidence: { sameUid: true, signinMs: 900 } });
    });
    it('an unconfirmed account HOLDs; a sign-in that did not complete FAILs', () => {
        expect(focusSignInRow({ signedIn: true, sameUid: null, signinMs: 900 }).verdict).toBe('HOLD');
        expect(focusSignInRow({ signedIn: true, sameUid: false, signinMs: null }).verdict).toBe('HOLD');
        expect(focusSignInRow({ signedIn: false, sameUid: true, signinMs: null }).verdict).toBe('FAIL');
    });
});

describe('Focus journey wiring', () => {
    it('writes the sign-in row right after signing back in through the real form', () => {
        const at = journey.indexOf('await account.signOutAndSignIn()');
        const written = journey.indexOf('receipt.row(FOCUS_SIGN_IN_ROW', at);
        expect(at).toBeGreaterThan(0);
        expect(written).toBeGreaterThan(at);
        expect(FOCUS_SIGN_IN_ROW).toBe('sign-in');
    });
    it('writes the group after Stop\'s rows and before the coaching step, from the receipt\'s own rows', () => {
        const group = journey.indexOf("test.step('Focus presentation contract'");
        expect(group).toBeGreaterThan(journey.indexOf("test.step('row 11 — Stop: verdicts, count and average'"));
        expect(group).toBeLessThan(journey.indexOf("test.step('row 11 — Focus Points coaching after Stop'"));
        expect(journey.slice(group, group + 300)).toContain('focusPresentationRow(receipt.rows)');
        expect(journey).toContain('receipt.row(FOCUS_PRESENTATION_ROW');
        expect(FOCUS_PRESENTATION_ROW).toBe('Focus presentation contract');
    });
});
