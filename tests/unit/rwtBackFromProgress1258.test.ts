// @vitest-environment node
/**
 * #1258 D1 (PO 2026-10-09) — the deployed rehearsal exercises the person's own repro: Progress → browser Back restores the
 * saved session with its review (saved coaching, or Try again when none was saved), and requests no coaching. These rows
 * are REQUIRED for the Open Mic suite, so a missing row is a failure, not a silent gap.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backFromProgressRows, type RwtReceipt } from '../live/helpers/rwtJourney';
import { requiredAutomatedRows } from '../live/helpers/rwtAcceptance';

const ROWS = ['Back from Progress restores the session', 'restored review', 'Back requests no coaching'] as const;
// The real receipt raises a Playwright soft assertion on FAIL; a plain recorder keeps the verdicts for the assertions.
type Recorder = { rows: Array<{ step: string; verdict: string }> };
const recorder = (): Recorder & RwtReceipt => {
    const r: Recorder = { rows: [] };
    return Object.assign(r, { row: (step: string, verdict: string) => { r.rows.push({ step, verdict }); } }) as unknown as Recorder & RwtReceipt;
};
const verdicts = (r: Recorder) => Object.fromEntries(r.rows.map((row) => [row.step, row.verdict]));
const ok = { left: true, restored: true, idleShown: false, liveTracks: 0, review: 'saved' } as const;

describe('Back from Progress rows', () => {
    it('PASS: restored, saved coaching back, no request', () => {
        const r = recorder();
        backFromProgressRows(r, ok, true, 1, 1);
        expect(verdicts(r)).toEqual({ [ROWS[0]]: 'PASS', [ROWS[1]]: 'PASS', [ROWS[2]]: 'PASS' });
    });

    it('no coaching saved: Try again offered is PASS; terminal "not available" on the newest session is FAIL', () => {
        const offered = recorder();
        backFromProgressRows(offered, { ...ok, review: 'try_again' }, false, 1, 1);
        const terminal = recorder();
        backFromProgressRows(terminal, { ...ok, review: 'not_available' }, false, 1, 1);
        expect([verdicts(offered)[ROWS[1]], verdicts(terminal)[ROWS[1]]]).toEqual(['PASS', 'FAIL']);
    });

    it('CASUALTY (run 37706942773): the idle recorder, a lost session, or a coaching request each FAIL', () => {
        const idle = recorder();
        backFromProgressRows(idle, { ...ok, idleShown: true }, true, 1, 1);
        const lost = recorder();
        backFromProgressRows(lost, { ...ok, restored: false, review: 'missing' }, true, 1, 1);
        const requested = recorder();
        backFromProgressRows(requested, ok, true, 1, 2);
        expect([verdicts(idle)[ROWS[0]], verdicts(lost)[ROWS[0]], verdicts(lost)[ROWS[1]], verdicts(requested)[ROWS[2]]])
            .toEqual(['FAIL', 'FAIL', 'HOLD', 'FAIL']);
    });

    // #1576 Codex P1 4237614260: a capture left live after Back need not render the idle recorder, so tracks are read there.
    it('CASUALTY (Codex 4237614260): a live or unreadable microphone right after Back FAILS the restore row', () => {
        const live = recorder();
        backFromProgressRows(live, { ...ok, liveTracks: 1 }, true, 1, 1);
        const unread = recorder();
        backFromProgressRows(unread, { ...ok, liveTracks: null }, true, 1, 1);
        expect([verdicts(live)[ROWS[0]], verdicts(unread)[ROWS[0]]]).toEqual(['FAIL', 'FAIL']);
    });

    it('the Open Mic suite requires the rows and runs the step', () => {
        expect(requiredAutomatedRows('open-mic-first-session')?.product).toEqual(expect.arrayContaining([...ROWS]));
        const spec = readFileSync(resolve(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        expect(spec).toMatch(/backFromProgressRestoresSession\(page, persistedId, savedCoaching\)/);
        expect(spec).toMatch(/backFromProgressRows\(receipt, back, savedCoaching !== undefined, before, coaching\.requests\)/);
    });
});
