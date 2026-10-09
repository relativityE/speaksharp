// @vitest-environment node
/**
 * #1258 (Browser PM 6087216991, option B) — the deployed rehearsal presses Focus "Start a new set" and "Edit". The oracle is
 * pure; the journey only observes. Required for the full Focus suite, so a missing row is a failure, not a silent gap.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newSetEditVerdicts, newSetSourcePoints, setupIsBlank, type NewSetEditObservation } from '../live/helpers/rwtOracles';
import { requiredAutomatedRows } from '../live/helpers/rwtAcceptance';

const ok: NewSetEditObservation = {
    newSetBlank: true, editSeeded: true, railLabelsMatchEdit: true, takeAId: 'a', takeBId: 'b', briefA: 'brief-a', briefB: 'brief-b',
    takeAVerdictsBefore: ['p1:detected', 'p2:not_detected'], takeAVerdictsAfter: ['p1:detected', 'p2:not_detected'],
    finalStatuses: ['covered', 'covered', 'covered'], takeBVerdicts: ['detected', 'detected', 'detected'],
};
const verdicts = (o: Partial<NewSetEditObservation>) => {
    const v = newSetEditVerdicts({ ...ok, ...o });
    return [v.newSet.verdict, v.edit.verdict];
};

describe('Focus New Set / Edit oracle', () => {
    it('picks three points the fixture expects covered, or none', () => {
        expect([newSetSourcePoints(['covered', 'missing', 'covered', 'covered']), newSetSourcePoints(['covered', 'partial', 'covered'])])
            .toEqual([[0, 2, 3], null]);
    });
    it('PASS: blank new set, seeded edit, 3/3 on the edited set, the earlier take unchanged', () => {
        expect(verdicts({})).toEqual(['PASS', 'PASS']);
    });
    it('CASUALTY: scored on the unedited set (the unspoken point missed) fails Edit only', () => {
        expect(verdicts({ finalStatuses: ['covered', 'covered', 'missing'], takeBVerdicts: ['detected', 'detected', 'not_detected'] })).toEqual(['PASS', 'FAIL']);
    });
    it('CASUALTY: the earlier take\'s verdicts changed, or the take reused the old set, fails New Set', () => {
        expect([
            verdicts({ takeAVerdictsAfter: ['p1:detected', 'p2:detected'] })[0],
            verdicts({ briefB: 'brief-a' })[0],
            verdicts({ takeBId: 'a' })[0],
            verdicts({ newSetBlank: false })[0],
        ]).toEqual(['FAIL', 'FAIL', 'FAIL', 'FAIL']);
    });
    it('CASUALTY: Edit not seeded, or the rail kept the replaced point, fails Edit', () => {
        expect([verdicts({ editSeeded: false })[1], verdicts({ railLabelsMatchEdit: false })[1]]).toEqual(['FAIL', 'FAIL']);
    });
    // Browser PM 6089313104: "opened blank" proved only point 0 was empty, so a stale goal, topic or second point passed.
    it('CASUALTY (6089313104): blank means goal, topic and EVERY rendered point empty, with no old label anywhere', () => {
        const blank = { goal: '', topic: '', pointValues: ['', '', ''], staleLabels: ['Name the price', 'Pricing pitch'] };
        expect([
            setupIsBlank(blank),
            setupIsBlank({ ...blank, goal: 'other' }),
            setupIsBlank({ ...blank, topic: 'Pricing pitch' }),
            setupIsBlank({ ...blank, pointValues: ['', 'Name the price', ''] }),
            setupIsBlank({ ...blank, pointValues: [] }),
            setupIsBlank({ ...blank, topic: null }),
        ]).toEqual([true, false, false, false, false, true]);
    });
    it('the helper reads every rendered setup field and fails closed on each saved-Focus read', () => {
        const helper = readFileSync(resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        expect(helper).toMatch(/setupIsBlank\(\{/);
        expect(helper).toMatch(/\[data-testid\^="objective-point-label-"\]/);
        expect(helper).not.toMatch(/objective-point-label-0'\)\.inputValue\(\)\.catch\(\(\) => 'x'\)\) === ''/);
        const savedFocus = helper.slice(helper.indexOf('const savedFocus'), helper.indexOf('const takeA = await savedFocus'));
        expect(savedFocus.match(/fail closed/g)?.length).toBe(3);
    });
    it('the full Focus suite requires both rows and runs the step', () => {
        expect(requiredAutomatedRows('focus-points-session')?.product).toEqual(expect.arrayContaining(['Focus New Set', 'Focus Edit']));
        const helper = readFileSync(resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        expect(helper).toMatch(/receipt\.row\('Focus New Set', v\.newSet\.verdict/);
        expect(helper).toMatch(/receipt\.row\('Focus Edit', v\.edit\.verdict/);
        expect(helper).toMatch(/getByTestId\('focus-points-new-set'\)/);
        expect(helper).toMatch(/getByTestId\('focus-points-edit'\)/);
    });
});
