/**
 * J3.a / J3.b evidence (#1904, Sam's first Focus wave). Each control must trip its own reason: a substituted take or point
 * result, missing speech or detection, a legacy build or the wrong privacy choice never passes. Partial counts as detected.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    J3B_REPEAT_ROW, J3_ACCEPTANCE_CONSENT_MODE, J3_PRIVACY_ROW, J3_SAVED_TIMING_ROW, focusAcceptancePrivacyVerdict,
    focusSavedTimingVerdict, j3bRepeatReopenVerdict, repeatReviewCard, type RepeatReopenObservation, type SavedTimingObservation,
} from '../live/helpers/rwtJ3Evidence';
import { savedFocusIdentityVerdict, type SavedFocusIdentityObservation } from '../live/helpers/rwtSavedFocusIdentity';
import { persistedVerdictMismatches } from '../live/helpers/rwtOracles';
import { loadedReviewSessionId } from '../live/helpers/rwtJ1dJourney';
import { requiredAutomatedRows } from '../live/helpers/rwtAcceptance';

describe('focusAcceptancePrivacyVerdict — bound before Start', () => {
    it('passes only the post-#1835 build with Save Yes / Coaching Yes recorded', () => {
        expect(J3_ACCEPTANCE_CONSENT_MODE).toBe('save_on_coaching_on');
        expect(focusAcceptancePrivacyVerdict({ build: 'includes_1835', mode: 'save_on_coaching_on', choiceRecorded: true }))
            .toEqual({ status: 'PASS', reason: 'save_yes_coaching_yes' });
    });
    it.each([
        [{ build: 'predates_1835', mode: 'save_on_coaching_on', choiceRecorded: false }, 'FAIL', 'legacy_build'],
        [{ build: 'predates_1835', mode: null, choiceRecorded: false }, 'FAIL', 'legacy_build'],
        [{ build: 'unknown', mode: 'save_on_coaching_on', choiceRecorded: true }, 'HOLD', 'build_unknown'],
        [{ build: 'includes_1835', mode: 'save_on_coaching_on', choiceRecorded: false }, 'HOLD', 'choice_unverified'],
        [{ build: 'includes_1835', mode: 'save_on', choiceRecorded: true }, 'HOLD', 'not_acceptance_mode'],
        [{ build: 'includes_1835', mode: 'save_off', choiceRecorded: true }, 'HOLD', 'not_acceptance_mode'],
        [{ build: 'includes_1835', mode: null, choiceRecorded: true }, 'HOLD', 'not_acceptance_mode'],
    ] as const)('%o → %s %s', (input, status, reason) => {
        expect(focusAcceptancePrivacyVerdict(input)).toEqual({ status, reason });
    });
});

const partialEvidence = [
    { verdict: 'detected', detected_at_seconds: 3 },
    { verdict: 'detected', detected_at_seconds: 9 },
    { verdict: 'detected', detected_at_seconds: 16 }, // the partial point: detected
    { verdict: 'not_detected', detected_at_seconds: null },
];
const timing = (over: Partial<SavedTimingObservation> = {}): SavedTimingObservation => ({
    elapsedSec: 60, savedDurationSec: 59, shownAverageSec: 19.7, evidence: partialEvidence, detectedExpected: 3, ...over,
});

describe('focusSavedTimingVerdict — the exact saved take', () => {
    it('passes when saved duration, shown average and detection times agree with the take', () => {
        expect(focusSavedTimingVerdict(timing())).toEqual({ status: 'PASS', reason: 'saved_timing' });
    });
    it.each([
        ['saved state unread', { savedDurationSec: null }, 'HOLD', 'saved_unread'],
        ['evidence unread', { evidence: null }, 'HOLD', 'saved_unread'],
        ['average unread', { shownAverageSec: null }, 'HOLD', 'average_unread'],
        ['take not measured', { elapsedSec: 0 }, 'HOLD', 'take_unmeasured'],
        ['no saved duration', { savedDurationSec: 0 }, 'FAIL', 'no_saved_duration'],
        ['another take\'s duration (substituted take)', { savedDurationSec: 42 }, 'FAIL', 'duration_not_this_take'],
        ['missing speech: nothing detected', { evidence: partialEvidence.map(() => ({ verdict: 'not_detected', detected_at_seconds: null })) }, 'FAIL', 'detected_count'],
        ['partial point not counted as detected', { evidence: [partialEvidence[0], partialEvidence[1], { verdict: 'not_detected', detected_at_seconds: null }, partialEvidence[3]] }, 'FAIL', 'detected_count'],
        ['detection after the take ended', { evidence: [{ verdict: 'detected', detected_at_seconds: 75 }, ...partialEvidence.slice(1)] }, 'FAIL', 'detection_outside_take'],
        ['detection without a time', { evidence: [{ verdict: 'detected', detected_at_seconds: null }, ...partialEvidence.slice(1)] }, 'FAIL', 'detection_outside_take'],
        ['time on an undetected point', { evidence: [...partialEvidence.slice(0, 3), { verdict: 'not_detected', detected_at_seconds: 5 }] }, 'FAIL', 'time_on_undetected'],
        ['shown average echoes the guide', { shownAverageSec: 60 }, 'FAIL', 'average_not_saved'],
    ] as const)('%s', (_name, over, status, reason) => {
        expect(focusSavedTimingVerdict(timing(over as Partial<SavedTimingObservation>))).toEqual({ status, reason });
    });
});

const labels = ['p1', 'p2', 'p3', 'p4'];
const fixtureStatuses = ['covered', 'covered', 'partial', 'missing'] as const;
const points = labels.map((label, i) => ({ id: `rp${i}`, brief_id: 'b1', sort_order: i, label }));
const repeatEvidence = [
    { brief_point_id: 'rp0', verdict: 'detected' }, { brief_point_id: 'rp1', verdict: 'detected' },
    { brief_point_id: 'rp2', verdict: 'detected' }, { brief_point_id: 'rp3', verdict: 'not_detected' },
];
const visible = ['From this session', 'Detected: point 1 at 0:03, point 2 at 0:09, point 3 at 0:16.', 'Not detected: point 4.'];
const identity = (over: Partial<SavedFocusIdentityObservation> = {}) => savedFocusIdentityVerdict({
    expectedBriefId: 'b1', savedBriefId: 'b1', expected: labels.map((label, i) => ({ label, railStatus: fixtureStatuses[i] })),
    savedPoints: points, evidence: repeatEvidence, visibleEvidence: visible, ...over,
});
const repeat = (over: Partial<RepeatReopenObservation> = {}): RepeatReopenObservation => ({
    reviewMode: 'coaching_on', firstSessionId: 's1', repeatSessionId: 's2', firstObjectiveId: 'o1',
    repeatObjective: { id: 'o2', source_session_id: 's2', brief_id: 'b1' }, repeatCoachingSaved: true, firstBriefId: 'b1',
    repeatIdentity: identity(), firstMismatchesAfter: [], repeatCardId: 's2', ...over,
});

describe('j3bRepeatReopenVerdict — one repeat on the same set, its own save, reopened', () => {
    it('passes the repeat that matches the fixture and leaves the first take unchanged', () => {
        expect(j3bRepeatReopenVerdict(repeat())).toEqual({ status: 'PASS', reason: 'repeat_saved_and_reopened' });
    });
    it.each([
        ['coaching off', { reviewMode: 'coaching_off_saved' }, 'HOLD', 'not_acceptance_mode'],
        ['no first take', { firstObjectiveId: null }, 'HOLD', 'no_first_take'],
        ['no repeat take', { repeatSessionId: null }, 'HOLD', 'no_repeat_take'],
        ['repeat is the first take', { repeatSessionId: 's1' }, 'FAIL', 'repeat_is_first_take'],
        ['repeat unread', { repeatObjective: 'error' }, 'HOLD', 'repeat_unread'],
        ['repeat never scored (missing detection)', { repeatObjective: null }, 'FAIL', 'repeat_not_scored'],
        ['scored result from another take', { repeatObjective: { id: 'o2', source_session_id: 's9', brief_id: 'b1' } }, 'FAIL', 'repeat_result_substituted'],
        ['first take\'s result shown as the repeat', { repeatObjective: { id: 'o1', source_session_id: 's2', brief_id: 'b1' } }, 'FAIL', 'repeat_result_substituted'],
        ['a different set', { repeatObjective: { id: 'o2', source_session_id: 's2', brief_id: 'b2' } }, 'FAIL', 'not_the_same_set'],
        ['first take unread after the repeat', { firstMismatchesAfter: null }, 'HOLD', 'saved_unread'],
        ['repeat changed the first take', { firstMismatchesAfter: [2] }, 'FAIL', 'first_take_changed'],
        ['repeat coaching not saved', { repeatCoachingSaved: false }, 'HOLD', 'no_saved_review'],
        ['repeat identity unread', { repeatIdentity: null }, 'HOLD', 'saved_unread'],
        // Sam, Nov 19 on 947d357: the reopened card must be the repeat's own, by its loaded id.
        ['no card id loaded', { repeatCardId: null }, 'HOLD', 'repeat_card_not_loaded'],
        ['the first take\'s card, identical statuses, wrong id', { repeatCardId: 's1' }, 'FAIL', 'repeat_card_wrong_id'],
        ['another session\'s card', { repeatCardId: 's9' }, 'FAIL', 'repeat_card_wrong_id'],
    ] as const)('%s', (_name, over, status, reason) => {
        expect(j3bRepeatReopenVerdict(repeat(over as Partial<RepeatReopenObservation>))).toEqual({ status, reason });
    });
    it.each([
        ['a substituted point result (partial saved as not detected)', { evidence: [...repeatEvidence.slice(0, 2), { brief_point_id: 'rp2', verdict: 'not_detected' }, repeatEvidence[3]] }],
        ['missing detection (no evidence rows)', { evidence: [] }],
        ['evidence from another take\'s points', { evidence: repeatEvidence.map((r) => ({ ...r, brief_point_id: `x${r.brief_point_id}` })) }],
        ['the reopened review shows another result', { visibleEvidence: ['Detected: point 1 at 0:03, point 2 at 0:09.', 'Not detected: point 3, point 4.'] }],
        ['the reopened review shows nothing', { visibleEvidence: [] }],
        ['saved points reordered', { savedPoints: points.map((p, i) => ({ ...p, label: labels[(i + 1) % 4] })) }],
    ] as const)('FAIL on %s', (_name, over) => {
        expect(j3bRepeatReopenVerdict(repeat({ repeatIdentity: identity(over as Partial<SavedFocusIdentityObservation>) })))
            .toEqual({ status: 'FAIL', reason: 'repeat_differs_from_fixture' });
    });
    it('the first-take re-read catches a swapped pair that keeps both counts', () => {
        const pts = labels.map((_, i) => ({ id: `fp${i}`, sort_order: i }));
        const swapped = [{ brief_point_id: 'fp0', verdict: 'detected' }, { brief_point_id: 'fp1', verdict: 'detected' },
            { brief_point_id: 'fp2', verdict: 'not_detected' }, { brief_point_id: 'fp3', verdict: 'detected' }];
        expect(persistedVerdictMismatches([...fixtureStatuses], pts, swapped)).toEqual([2, 3]);
    });
});

describe('J3 rows are required and written by the journey', () => {
    const journey = readFileSync('tests/live/helpers/rwtFocusPointsJourney.ts', 'utf8');
    it('both legs require the privacy and saved-timing rows; only J3.b requires the repeat row', () => {
        const full = requiredAutomatedRows('focus-points-session')!.product;
        const partial = requiredAutomatedRows('focus-points-partial')!.product;
        for (const row of [J3_PRIVACY_ROW, J3_SAVED_TIMING_ROW]) {
            expect(full).toContain(row);
            expect(partial).toContain(row);
        }
        expect(partial).toContain(J3B_REPEAT_ROW);
        expect(full).not.toContain(J3B_REPEAT_ROW);
    });
    it('the privacy row is the verdict, never a fixed PASS', () => {
        expect(journey).not.toMatch(/receipt\.row\('practice privacy choice', 'PASS'/);
        expect(journey).toMatch(/focusAcceptancePrivacyVerdict\(\{ build: consent\.build, mode: consent\.mode/);
        // Bound before Start: the row is written before the first take is armed.
        expect(journey.indexOf('receipt.row(J3_PRIVACY_ROW')).toBeLessThan(journey.indexOf('firstTakeMonitor = await armTakeMonitor'));
    });
    it('the repeat is judged against the fixture statuses, not its own rail or saved result', () => {
        const step = journey.slice(journey.indexOf("'J3.b — the repeat take saved and reopened against the fixture'"));
        expect(step).toMatch(/railStatuses: expectedFinal\.map/);
        expect(step).toMatch(/expectedBriefId: firstBriefId/);
        expect(journey).toMatch(/if \(fixtureKey === 'focus_points_partial_tts'\) \{\n\s+await test\.step\('J3\.b/);
    });
    it('saved timing reads this take\'s own objective session and its detection times', () => {
        expect(journey).toMatch(/select\('brief_point_id,verdict,detected_at_seconds'\)\s*\n\s*\.eq\('session_id', session\.id\)/);
        expect(journey).toMatch(/focusSavedTimingVerdict\(\{ elapsedSec, savedDurationSec: savedDuration, shownAverageSec: average/);
    });
});

describe('J3.b reads only the repeat\'s own review card (Sam, Nov 19 on 947d357)', () => {
    const journey = readFileSync('tests/live/helpers/rwtFocusPointsJourney.ts', 'utf8');
    const step = journey.slice(journey.indexOf("'J3.b — the repeat take saved and reopened against the fixture'"),
        journey.indexOf("'the repeat result names the measured metric'"));
    const S1 = '11111111-1111-4111-8111-111111111111';
    const S2 = '22222222-2222-4222-8222-222222222222';
    /** A reopened Analytics page whose first card is still the first take's, with the same visible statuses. */
    const staleFirstCardPage = () => {
        const selectors: string[] = [];
        return { selectors, page: {
            getByTestId: (id: string) => ({ first: () => ({ getAttribute: async (name: string) => (id === 'saved-review' && name === 'data-session-id' ? S1 : null) }) }),
            waitForTimeout: async () => undefined,
            locator: (sel: string) => { selectors.push(sel); return sel; },
        } };
    };
    it('control: the first take\'s card with identical statuses but the wrong id never passes as the repeat', async () => {
        const { page } = staleFirstCardPage();
        const loaded = await loadedReviewSessionId(page, 1_000);
        expect(loaded).toBe(S1);
        // The statuses on that card match the fixture exactly (the old read would have taken them as the repeat's).
        const sameStatuses = identity();
        expect(sameStatuses.verdict).toBe('PASS');
        expect(j3bRepeatReopenVerdict(repeat({ firstSessionId: S1, repeatSessionId: S2, repeatObjective: { id: 'o2', source_session_id: S2, brief_id: 'b1' },
            repeatIdentity: sameStatuses, repeatCardId: loaded }))).toEqual({ status: 'FAIL', reason: 'repeat_card_wrong_id' });
    });
    it('HOLD when no card id loads in time', async () => {
        let t = 0;
        const page = { getByTestId: () => ({ first: () => ({ getAttribute: async () => null }) }), waitForTimeout: async (ms: number) => { t += ms; } };
        const loaded = await loadedReviewSessionId(page, 1_000, () => t);
        expect(loaded).toBeNull();
        expect(j3bRepeatReopenVerdict(repeat({ repeatCardId: loaded }))).toEqual({ status: 'HOLD', reason: 'repeat_card_not_loaded' });
    });
    it('the card scope is the saved-review card carrying exactly the repeat id, and refuses a non-UUID', () => {
        const { page, selectors } = staleFirstCardPage();
        expect(repeatReviewCard(page, S2)).toBe(`[data-testid="saved-review"][data-session-id="${S2}"]`);
        expect(selectors).toEqual([`[data-testid="saved-review"][data-session-id="${S2}"]`]);
        expect(() => repeatReviewCard(page, '"] , *')).toThrow(/fail closed/);
    });
    it('the journey waits for the loaded id, reads evidence only inside the repeat\'s card, and judges the loaded id', () => {
        const load = step.indexOf('repeatCardId = await loadedReviewSessionId(tab);');
        expect(load).toBeGreaterThan(step.indexOf('await tab.goto(`/analytics/${repeatSessionId}`);'));
        expect(step.indexOf('if (repeatCardId === repeatSessionId) {')).toBeGreaterThan(load);
        expect(step.indexOf("repeatReviewCard(tab, repeatSessionId).getByTestId('review-evidence').first()")).toBeGreaterThan(load);
        expect(step).not.toMatch(/tab\.getByTestId\('review-evidence'\)/);
        expect(step).toMatch(/firstMismatchesAfter, repeatCardId \}\);/);
    });
});
