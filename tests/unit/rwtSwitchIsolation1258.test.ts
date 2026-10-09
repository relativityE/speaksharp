// @vitest-environment node
/**
 * #1258 (Browser PM 6089889070) — a Focus take recorded right after an Open Mic take, on the deployed engine, is clean. The
 * fake microphone replays the Focus fixture from the start at each acquisition, so a short take hears only point 1; points
 * 2–4 were spoken only in the earlier Open Mic take, so any of them detected is old-take carry-over, partial or whole.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { labelHeardIn, switchIsolationVerdict, type SwitchIsolationObservation } from '../live/helpers/rwtOracles';
import { requiredAutomatedRows } from '../live/helpers/rwtAcceptance';

const clean: SwitchIsolationObservation = {
    railPendingBefore: true, openMicId: 'om', focusId: 'fp', savedProduct: 'focus_points',
    finalStatuses: ['covered', 'missing', 'missing', 'missing'], staleCoachingBeforeStart: false, markerSupport: [true, true, true],
    openMicBefore: { product: 'open_mic', digest: 'd1' }, openMicAfter: { product: 'open_mic', digest: 'd1' },
};
const verdict = (o: Partial<SwitchIsolationObservation>) => switchIsolationVerdict({ ...clean, ...o }).verdict;

describe('take after switching products is clean', () => {
    it('PASS: point 1 recognised, points 2–4 absent, saved as Focus, the Open Mic take untouched', () => {
        expect(verdict({})).toBe('PASS');
    });
    it('CASUALTY: partial carry-over (one old-only point detected or partial) fails', () => {
        expect([
            verdict({ finalStatuses: ['covered', 'missing', 'covered', 'missing'] }),
            verdict({ finalStatuses: ['covered', 'partial', 'missing', 'missing'] }),
            verdict({ finalStatuses: ['covered', 'covered', 'covered', 'covered'] }),
        ]).toEqual(['FAIL', 'FAIL', 'FAIL']);
    });
    it('CASUALTY: empty or missing current-take recognition is never PASS', () => {
        const none = switchIsolationVerdict({ ...clean, finalStatuses: ['missing', 'missing', 'missing', 'missing'] });
        const unread = switchIsolationVerdict({ ...clean, finalStatuses: [] });
        expect([none.verdict, unread.verdict]).toEqual(['FAIL', 'FAIL']);
        expect(none.detail).toMatch(/no current-take recognition/);
    });
    it('CASUALTY: stale state, a reused id, a wrong product, stale coaching or a changed Open Mic row each FAIL', () => {
        expect([
            verdict({ railPendingBefore: false }),
            verdict({ focusId: 'om' }),
            verdict({ focusId: null }),
            verdict({ savedProduct: 'open_mic' }),
            verdict({ staleCoachingBeforeStart: true }),
            verdict({ openMicAfter: { product: 'open_mic', digest: 'd2' } }),
            verdict({ openMicAfter: { product: 'focus_points', digest: 'd1' } }),
        ]).toEqual(['FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL']);
    });
    // Browser PM 6090552875 (2): the proof needs EXACTLY four readable statuses, a real Open Mic row, and markers the
    // earlier take actually recognised. Absence of a marker it never heard proves nothing → HOLD, never PASS.
    it('CASUALTY (6090552875): truncated, extra or unread statuses, or a missing / non-Open Mic source row, FAIL', () => {
        expect([
            verdict({ finalStatuses: ['covered', 'missing'] }),
            verdict({ finalStatuses: ['covered', 'missing', 'missing', 'missing', 'missing'] }),
            verdict({ finalStatuses: ['covered', 'missing', null, 'missing'] }),
            verdict({ openMicId: null }),
            verdict({ openMicBefore: { product: 'focus_points', digest: 'd1' }, openMicAfter: { product: 'focus_points', digest: 'd1' } }),
        ]).toEqual(['FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL']);
    });
    it('CASUALTY (6090552875): a marker the earlier Open Mic take did not recognise makes the row HOLD, not PASS', () => {
        expect([verdict({ markerSupport: [true, false, true] }), verdict({ markerSupport: [] })]).toEqual(['HOLD', 'HOLD']);
    });
    it('labelHeardIn: every content word of the point label appears in the transcript (case and punctuation ignored)', () => {
        expect([
            labelHeardIn('Name the price', 'First, I will NAME the price, clearly.'),
            labelHeardIn('Name the price', 'I will name a number'),
            labelHeardIn('State the guarantee', ''),
        ]).toEqual([true, false, false]);
    });
    // Browser PM 6090552875 (1): the card's test id is the same for valid current coaching, so stale coaching is observed
    // only at the Focus pre-Start boundary, where no current Focus review can exist yet.
    it('CASUALTY (6090552875): stale coaching is observed before the switch take starts, never after its Stop', () => {
        const helper = readFileSync(resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        const step = helper.slice(helper.indexOf("'Open Mic take, then a Focus take right after the product switch'"), helper.indexOf("receipt.row('take after switching products is clean'"));
        const observed = step.indexOf('staleCoachingBeforeStart =');
        const started = step.indexOf('startBenchmarkRecording(page, `${suite}-switch-focus`)');
        expect([observed > 0, started > observed, /staleCoachingShown/.test(step)]).toEqual([true, true, false]);
    });
    it('the full Focus suite requires the row and runs the step', () => {
        expect(requiredAutomatedRows('focus-points-session')?.product).toEqual(expect.arrayContaining(['take after switching products is clean']));
        const helper = readFileSync(resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        expect(helper).toMatch(/receipt\.row\('take after switching products is clean', iso\.verdict/);
        expect(helper).toMatch(/await openProduct\('open-mic'\)[\s\S]*await openProduct\('focus-points'\)/);
        expect(helper).toContain('getByTestId(`nav-products-${item}`)');
        // Every database read in the step fails closed (6089889070: no infrastructure failure becomes a verdict).
        const step = helper.slice(helper.indexOf("'Open Mic take, then a Focus take right after the product switch'"), helper.indexOf("receipt.row('take after switching products is clean'"));
        const reads = step.match(/admin!\.from\(/g)?.length ?? 0;
        expect([reads > 0, step.match(/fail closed/g)?.length ?? 0]).toEqual([true, reads]);
    });
});
