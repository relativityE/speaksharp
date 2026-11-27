/**
 * J3.a / J3.b evidence (#1904, Sam's first Focus wave). Each control must trip its own reason: a substituted take or point
 * result, missing speech or detection, a legacy build or the wrong privacy choice never passes. Partial counts as detected.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
    J3B_REPEAT_ROW, J3_ACCEPTANCE_CONSENT_MODE, J3_PRIVACY_ROW, J3_SAVED_TIMING_ROW, focusAcceptancePrivacyVerdict,
    armJ3bFailureObserver, focusSavedTimingVerdict, j3bFallbackStatus, j3bRepeatReopenVerdict, j3bUpstreamStatus,
    readJ3bFailureObserver, readJ3bSavedPanel, repeatReviewCard, type RepeatReopenObservation, type SavedTimingObservation,
} from '../live/helpers/rwtJ3Evidence';
import { savedFocusIdentityVerdict, type SavedFocusIdentityObservation } from '../live/helpers/rwtSavedFocusIdentity';
import { persistedVerdictMismatches } from '../live/helpers/rwtOracles';
import { loadedReviewSessionId } from '../live/helpers/rwtJ1dJourney';
import { UNAVAILABLE_HEADLINES, takeExchangeEvidence } from '../live/helpers/coachingExternal';
import { receiptAcceptance, requiredAutomatedRows, type ReceiptRow } from '../live/helpers/rwtAcceptance';

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
    const outage = (over: Partial<RepeatReopenObservation> = {}): RepeatReopenObservation => ({
        ...repeat({ repeatCoachingSaved: false }),
        repeatFailure: { takeId: 's2', providerStatus: 429, fallback: 'PASS' },
        ...over,
    });
    it.each([429, 503] as const)('passes the app-owned repeat on confirmed Gemini %s without saved coaching', (providerStatus) => {
        expect(j3bRepeatReopenVerdict(outage({ repeatFailure: { takeId: 's2', providerStatus, fallback: 'PASS' } })))
            .toEqual({ status: 'PASS', reason: 'repeat_saved_and_reopened_provider_limited' });
    });
    it.each([
        ['first take error', { repeatFailure: { takeId: 's1', providerStatus: 429, fallback: 'PASS' } }, 'HOLD', 'no_saved_review'],
        ['Retry missing', { repeatFailure: { takeId: 's2', providerStatus: 429, fallback: 'FAIL' } }, 'FAIL', 'repeat_fallback_missing'],
        ['delayed response after view changed', { repeatFailure: { takeId: 's2', providerStatus: 503, fallback: 'HOLD' } }, 'HOLD', 'repeat_fallback_unobserved'],
        ['another take reopened', { repeatCardId: 's1' }, 'FAIL', 'repeat_card_wrong_id'],
        ['wrong points', { repeatIdentity: identity({ visibleEvidence: [] }) }, 'FAIL', 'repeat_differs_from_fixture'],
        ['first take changed', { firstMismatchesAfter: [0] }, 'FAIL', 'first_take_changed'],
    ] as const)('rejects %s despite the provider exception', (_name, change, status, reason) => {
        expect(j3bRepeatReopenVerdict(outage(change as Partial<RepeatReopenObservation>))).toEqual({ status, reason });
    });

    it('the first-take re-read catches a swapped pair that keeps both counts', () => {
        const pts = labels.map((_, i) => ({ id: `fp${i}`, sort_order: i }));
        const swapped = [{ brief_point_id: 'fp0', verdict: 'detected' }, { brief_point_id: 'fp1', verdict: 'detected' },
            { brief_point_id: 'fp2', verdict: 'not_detected' }, { brief_point_id: 'fp3', verdict: 'detected' }];
        expect(persistedVerdictMismatches([...fixtureStatuses], pts, swapped)).toEqual([2, 3]);
    });
});

describe('J3.b provider-limited evidence in the app-owned views', () => {
    it.each([
        [502, 'provider_http_4xx', 429, 429], [502, 'provider_http_5xx', 503, 503],
        [502, 'provider_timeout', 429, 429], [502, 'provider_timeout', 503, 503],
        [502, 'provider_timeout', null, null], [502, 'provider_http_5xx', 500, null],
        [503, 'service_configuration', 503, null], [429, 'quota_exceeded', null, null],
    ] as const)('classifies HTTP %s / %s / upstream %s as %s', (httpStatus, reason, providerStatus, expected) => {
        expect(j3bUpstreamStatus({ httpStatus, reason, providerStatus })).toBe(expected);
    });
    it('the browser closures do not depend on an outer keepNames helper after TypeScript serialization', () => {
        const browserFunctions = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
            import { armJ3bFailureObserver, readJ3bFailureObserver, readJ3bSavedPanel } from './tests/live/helpers/rwtJ3Evidence.ts';
            console.log(JSON.stringify([armJ3bFailureObserver, readJ3bFailureObserver, readJ3bSavedPanel].map(fn => fn.toString())));
        `], { encoding: 'utf8' });
        expect(browserFunctions.status).toBe(0);
        const serialized: string[] = JSON.parse(browserFunctions.stdout);
        expect(serialized).toHaveLength(3);
        for (const source of serialized) expect(source).not.toMatch(/\b__name\b/);
    });
    const onScreen = () => vi.spyOn(HTMLElement.prototype, 'getClientRects')
        .mockReturnValue({ length: 1 } as DOMRectList);
    const panel = (viewId: string) => `
        <section data-testid="saved-review" data-session-id="${viewId}" data-product="focus_points">No coaching was saved for this session.</section>
        <section data-testid="saved-focus-points"><ol>${labels.map((label, i) =>
            `<li data-testid="focus-point-${i}" data-status="${i === 3 ? 'missing' : 'covered'}"><p>${label}</p></li>`).join('')}
        </ol></section>`;
    it('reads the actual sibling panel, including label order, and refuses another loaded review', () => {
        const rects = onScreen();
        const previousUrl = document.location.pathname;
        try {
            document.defaultView!.history.replaceState(null, '', '/analytics/s2');
            document.body.innerHTML = panel('s1');
            expect(readJ3bSavedPanel('s2')).toBeNull();
            document.body.innerHTML = panel('s2');

            const rows = readJ3bSavedPanel('s2');
            expect(rows).toEqual(labels.map((label, i) => ({ ordinal: i + 1, label, status: i === 3 ? 'missing' : 'covered' })));
            expect(identity({ visibleEvidence: [], visiblePanel: rows! }).verdict).toBe('PASS');
            const badLabel = rows!.map((row, i) => i === 0 ? { ...row, label: 'substituted' } : row);
            expect(identity({ visibleEvidence: [], visiblePanel: badLabel }).verdict).toBe('FAIL');
            expect(identity({ visibleEvidence: [], visiblePanel: [...rows!].reverse() }).verdict).toBe('FAIL');
            document.defaultView!.history.replaceState(null, '', '/analytics/s1');
            expect(readJ3bSavedPanel('s2')).toBeNull();
        } finally {
            document.defaultView!.history.replaceState(null, '', previousUrl);
            document.body.replaceChildren();
            rects.mockRestore();
        }
    });
    it.each([429, 503] as const)('keeps the actual raw receipt incomplete on a delayed Gemini %s even when the app-owned repeat passes', async (providerStatus) => {
        const rects = onScreen();
        const root = document.documentElement;
        const previousUrl = document.location.pathname;
        const setTake = (id: string) => {
            root.setAttribute('data-session-persisted', 'true');
            root.setAttribute('data-session-persisted-id', id);
        };
        const fallback = `<span data-testid="ai-suggestions-headline">${[...UNAVAILABLE_HEADLINES][0]}</span>
            <button data-testid="ai-suggestions-retry">Try again</button>`;
        try {
            setTake('s2');
            document.body.innerHTML = '<div data-testid="session-shell" data-session-state="after"><div data-testid="ai-suggestions-card" data-review-state="loading"></div></div>';
            armJ3bFailureObserver([...UNAVAILABLE_HEADLINES]);
            // The request settles after the observer is attached; the caller does not wait before its rapid Repeat.
            await new Promise((resolve) => setTimeout(resolve, 1));
            const card = document.querySelector('[data-testid="ai-suggestions-card"]')!;
            card.setAttribute('data-review-state', 'error');
            card.innerHTML = fallback;
            await Promise.resolve();
            const ui = j3bFallbackStatus(readJ3bFailureObserver('s2'));
            const exchange = takeExchangeEvidence([{
                sent: { sessionId: 's2', product: 'focus_points', requestId: 'r1', attemptId: 'a1', clientAttempt: 1, clientReleaseId: null },
                status: 502, diagnostics: { provider_status: providerStatus, reason: providerStatus === 429 ? 'provider_http_4xx' : 'provider_http_5xx' },
                suggestions: null, clientMs: 50, at: 100, outcome: 'answered',
            }]);
            expect(exchange.unique).toBe(true);
            document.defaultView!.history.replaceState(null, '', '/analytics/s2');
            document.body.innerHTML = panel('s2');
            const observed = j3bRepeatReopenVerdict(repeat({
                repeatCoachingSaved: false,
                repeatIdentity: identity({ visibleEvidence: [], visiblePanel: readJ3bSavedPanel('s2')! }),
                repeatFailure: { takeId: 's2', providerStatus: j3bUpstreamStatus(exchange.evidence)!, fallback: ui },
            }));
            expect(observed).toEqual({ status: 'PASS', reason: 'repeat_saved_and_reopened_provider_limited' });
            const requirements = requiredAutomatedRows('focus-points-partial')!;
            const proof: ReceiptRow[] = [...new Set([...requirements.required, ...requirements.product])].map((step) => ({
                step, detail: 'synthetic receipt control', verdict: step === J3B_REPEAT_ROW ? observed.status
                    : step === 'Focus coaching differs between takes' || step === 'coaching prompt binding' ? 'HOLD' : 'PASS',
            }));
            expect(receiptAcceptance(proof).acceptance).toBe('INCOMPLETE');
            proof.push({ step: 'unexpected residue control', detail: 'synthetic failure', verdict: 'FAIL' });
            expect(receiptAcceptance(proof).acceptance).toBe('FAIL');
        } finally {
            readJ3bFailureObserver('s2');
            document.defaultView!.history.replaceState(null, '', previousUrl);
            root.removeAttribute('data-session-persisted');
            root.removeAttribute('data-session-persisted-id');
            document.body.replaceChildren();
            rects.mockRestore();
        }
    });
    it('does not attribute a delayed error on the next take to the repeat', async () => {
        const rects = onScreen();
        const root = document.documentElement;
        try {
            root.setAttribute('data-session-persisted', 'true');
            root.setAttribute('data-session-persisted-id', 's2');
            document.body.innerHTML = '<div data-testid="session-shell" data-session-state="after"></div>';
            armJ3bFailureObserver([...UNAVAILABLE_HEADLINES]);
            root.setAttribute('data-session-persisted-id', 's3');
            document.querySelector('[data-testid="session-shell"]')!.innerHTML =
                `<div data-testid="ai-suggestions-card" data-review-state="error"><span data-testid="ai-suggestions-headline">${[...UNAVAILABLE_HEADLINES][0]}</span><button data-testid="ai-suggestions-retry">Try again</button></div>`;
            await Promise.resolve();
            expect(j3bFallbackStatus(readJ3bFailureObserver('s2'))).toBe('HOLD');
        } finally {
            readJ3bFailureObserver('s2');
            root.removeAttribute('data-session-persisted');
            root.removeAttribute('data-session-persisted-id');
            document.body.replaceChildren();
            rects.mockRestore();
        }
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
    it('the privacy row is the verdict, never a fixed PASS, written only by the consent gate', () => {
        expect(journey).not.toMatch(/receipt\.row\('practice privacy choice'/);
        expect(journey).not.toContain('J3_PRIVACY_ROW');
        const evidence = readFileSync('tests/live/helpers/rwtJ3Evidence.ts', 'utf8');
        expect(evidence).toMatch(/focusAcceptancePrivacyVerdict\(\{ build: consent\.build, mode: consent\.mode/);
        // Bound before Start (J3 consent gate, Sam Nov 20): the gate exists before the first take is armed; the row itself is
        // written at the first capture-capable press, after a fresh readback (tests/unit/rwtJ3ConsentGate.test.ts).
        expect(journey.indexOf('consentGate = captureConsentGate({')).toBeGreaterThan(0);
        expect(journey.indexOf('consentGate = captureConsentGate({')).toBeLessThan(journey.indexOf('firstTakeMonitor = await armTakeMonitor'));
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
        expect(step).toMatch(/firstMismatchesAfter, repeatCardId, repeatFailure \}\);/);
    });
});
