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

const EDITED = ['Name the price', 'State the guarantee', 'Explain the timeline'];
const ok: NewSetEditObservation = {
    newSetBlank: true, editSeeded: true, railLabelsMatchEdit: true, takeAId: 'a', takeBId: 'b', briefA: 'brief-a', briefB: 'brief-b',
    takeAVerdictsBefore: ['p1:detected', 'p2:not_detected'], takeAVerdictsAfter: ['p1:detected', 'p2:not_detected'],
    editedLabels: EDITED,
    railOrdered: EDITED.map((label) => ({ label, status: 'covered' })),
    takeBSavedOrdered: EDITED.map((label) => ({ label, verdict: 'detected' })),
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
        expect(verdicts({
            railOrdered: [...ok.railOrdered.slice(0, 2), { label: EDITED[2], status: 'missing' }],
            takeBSavedOrdered: [...ok.takeBSavedOrdered.slice(0, 2), { label: EDITED[2], verdict: 'not_detected' }],
        })).toEqual(['PASS', 'FAIL']);
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
    // Browser PM 6093772463 item 2: take B is bound per point — edited label, rail status and saved verdict at the SAME
    // ordered position — never by counts or a sorted id list.
    it('CASUALTY (6093772463): swapped, mislabelled, reordered, truncated or extra take-B points FAIL Edit', () => {
        const swappedSaved = [{ label: EDITED[1], verdict: 'detected' }, { label: EDITED[0], verdict: 'detected' }, { label: EDITED[2], verdict: 'detected' }];
        expect([
            verdicts({ takeBSavedOrdered: swappedSaved })[1],
            verdicts({ railOrdered: [{ label: 'Something else', status: 'covered' }, ...ok.railOrdered.slice(1)] })[1],
            verdicts({ takeBSavedOrdered: ok.takeBSavedOrdered.slice(0, 2) })[1],
            verdicts({ railOrdered: [...ok.railOrdered, { label: 'Extra', status: 'covered' }] })[1],
            verdicts({ takeBSavedOrdered: [...ok.takeBSavedOrdered.slice(0, 2), { label: EDITED[2], verdict: 'unavailable' }] })[1],
        ]).toEqual(['FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL']);
    });
    it('the saved-take reads are bound to brief order and labels, and every read fails closed', () => {
        const helper = readFileSync(resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        const savedFocus = helper.slice(helper.indexOf('const savedFocus'), helper.indexOf('const takeA = await savedFocus'));
        expect(savedFocus).toMatch(/select\('id,label,sort_order'\)/);
        const reads = savedFocus.match(/admin!\.from\(/g)?.length ?? 0;
        expect([reads, savedFocus.match(/\(fail closed\)/g)?.length ?? 0]).toEqual([reads, reads]);
        const detail = helper.slice(helper.indexOf("'analytics point detail'"), helper.indexOf("'analytics point detail'") + 1500);
        expect(detail.match(/\(fail closed\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    });
    // #1576 Codex P1 4237701739: the next-Start probe stops below the 5 s persist guard, so no completed review is on screen
    // and New Set (after-state only) never renders. The step must reach a completed review explicitly before looking for it.
    it('CASUALTY (Codex 4237701739 / Browser PM 6097978379): New Set starts from the switch take\'s LIVE completed review — no extra recording, take B bound to that predecessor', () => {
        const helper = readFileSync(resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        const nextStart = helper.indexOf("test.step('next Start without a hold'");
        const switchStep = helper.indexOf("test.step('Open Mic take, then a Focus take right after the product switch'");
        const newSetStep = helper.indexOf("test.step('Focus: Start a new set, Edit it, and the next take is scored on the edited set'");
        // The next-Start probe leaves no completed review; the switch take saves one; New Set runs from it.
        expect(nextStart).toBeGreaterThan(-1);
        expect(nextStart).toBeLessThan(switchStep);
        expect(switchStep).toBeLessThan(newSetStep);
        const sw = helper.slice(switchStep, newSetStep);
        expect(sw.indexOf('switchFocusId = focusId && focusId !== openMicId ? focusId : null;'))
            .toBeGreaterThan(sw.indexOf('const focusId = await waitForNewPersistedSession(page, openMicId);'));
        const step = helper.slice(newSetStep, helper.lastIndexOf("receipt.row('Focus New Set'"));
        const lookFor = step.indexOf("newSetButton.waitFor({ state: 'visible'");
        expect(lookFor).toBeGreaterThan(-1);
        // No recording of its own before New Set, and none to manufacture a review.
        expect(step.slice(0, lookFor)).not.toMatch(/startBenchmarkRecording|completed-review|page\.goto\(/);
        expect(step).not.toMatch(/completedReview/);
        // New Set is looked for only on the predecessor's review, and take B's durable save is new relative to THAT take.
        expect(step).toContain('const predecessor = switchFocusId;');
        expect(step).toMatch(/const offered = onPredecessorReview && await newSetButton\.waitFor\(/);
        expect(step).toContain('takeBId = await waitForNewPersistedSession(page, predecessor);');
        expect(step).not.toContain('waitForNewPersistedSession(page, persistedId)');
        expect(step).toContain('takeBId !== predecessor && takeBId !== persistedId ? await savedFocus(takeBId)');
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
