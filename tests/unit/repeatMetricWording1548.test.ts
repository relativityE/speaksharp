// @vitest-environment node
/**
 * G03 (#1548 A2, APP-G4): the review-owned repeat result names the measured delivery metric. This tests the pure
 * contract in `tests/live/helpers/repeatMetricWording.ts` and binds the Open Mic spec step to it. Source and unit evidence
 * only: no browser, account or live run happens here, and none of it is live acceptance.
 *
 * The product wording is already fixed on main (#1716), so the legacy-copy case below is a negative control, not a
 * product-regression RED.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    LEGACY_PHRASE, PROGRESS_FORMULA, REPEAT_METRIC_ROW, SCOPE_LINE, expectedOutcomeLine, expectedTargetLine, normalizeLine, pressLinkage,
    repeatMetricPrerequisites, repeatMetricWordingVerdict, validRecommendation,
    type ExpectedLines, type PanelObservation, type PressEvent, type ServerEvidence,
} from '../live/helpers/repeatMetricWording';

const rec = (targetMetric: string, targetDirection: string, targetValue: number, targetUnits: string) => validRecommendation({ targetMetric, targetDirection, targetValue, targetUnits })!;

describe('G03 expected copy, written from the #1697 contract and the server derivation', () => {
    it('the target line names the metric, the saved direction, the value and the units as one sentence', () => {
        expect(expectedTargetLine(rec('filler_rate', 'decrease', 3.5, 'per 100 words')))
            .toBe('Separate delivery comparison: Filler rate (saved target: decrease toward 3.5 per 100 words).');
        expect(expectedTargetLine(rec('pace', 'increase', 140, 'words per minute')))
            .toBe('Separate delivery comparison: Pace (saved target: increase toward 140 words per minute).');
        expect(expectedTargetLine(rec('clear_delivery', 'maintain', 72.6, 'points')))
            .toBe('Separate delivery comparison: Clear delivery (saved target: maintain at 73 points).');
    });

    it('only clear delivery is rounded', () => {
        expect(expectedTargetLine(rec('clear_delivery', 'increase', 71.4, 'points'))).toContain('increase toward 71 points');
        expect(expectedTargetLine(rec('pace', 'decrease', 151.6, 'words per minute'))).toContain('decrease toward 151.6 words per minute');
    });

    it.each([
        ['decrease', 'moved', 'Filler rate was lower on the repeat than in the original session.'],
        ['decrease', 'did_not_move', 'Filler rate was not lower on the repeat than in the original session.'],
        ['increase', 'moved', 'Filler rate was higher on the repeat than in the original session.'],
        ['increase', 'did_not_move', 'Filler rate was not higher on the repeat than in the original session.'],
        ['maintain', 'moved', 'Filler rate stayed the same or increased compared with the original session.'],
        ['maintain', 'did_not_move', 'Filler rate decreased compared with the original session.'],
        ['decrease', 'not_comparable', 'Filler rate could not be compared for this repeat.'],
        ['decrease', 'not_completed', 'The stored repeat was not completed.'],
    ])('%s / %s', (direction, outcome, sentence) => {
        expect(expectedOutcomeLine(rec('filler_rate', direction, 3, 'per 100 words'), { lifecycle: 'completed', outcome })).toBe(sentence);
    });

    it('a pending attempt reads as pending (unit only; the live row never binds a pending attempt)', () => {
        expect(expectedOutcomeLine(rec('pace', 'increase', 140, 'wpm'), { lifecycle: 'pending', outcome: null })).toBe('Your linked repeat is pending.');
    });

    it('an invalid structured target is not a recommendation', () => {
        expect(validRecommendation({ targetMetric: 'volume', targetDirection: 'decrease', targetValue: 1, targetUnits: 'x' })).toBeNull();
        expect(validRecommendation({ targetMetric: 'pace', targetDirection: 'sideways', targetValue: 1, targetUnits: 'x' })).toBeNull();
        expect(validRecommendation({ targetMetric: 'pace', targetDirection: 'increase', targetValue: Number.NaN, targetUnits: 'x' })).toBeNull();
        expect(validRecommendation({ targetMetric: 'pace', targetDirection: 'increase', targetValue: 1, targetUnits: ' ' })).toBeNull();
    });

    it('CONTROL: the labels match the product\'s own label maps on this tree', () => {
        const panel = readFileSync(path.join(__dirname, '../../frontend/src/components/progress/ProgressPanel.tsx'), 'utf8');
        expect(panel).toMatch(/filler_rate: 'Filler rate', pace: 'Pace', clear_delivery: 'Clear delivery',/);
        expect(panel).toMatch(/decrease: 'decrease toward', increase: 'increase toward', maintain: 'maintain at',/);
        expect(panel).toContain(SCOPE_LINE);
        expect(panel).toContain('Separate delivery comparison: {TARGET_METRIC_LABELS[view.takeaways.target.metric]} (saved target:');
    });
});

const press = (fields: Record<string, string | number>): PressEvent => ({ event: 'saved_review_practice_action', fields });
const linkedAttempt = (outcome: string, seq = 1): PressEvent => ({ event: 'saved_review_linked_attempt', fields: { outcome, action_seq: seq } });

describe('G03 press-bound linkage', () => {
    it('one linked press (with or without its observed attempt event) is linked', () => {
        expect(pressLinkage([press({ action: 'accept_linked', link_state: 'linked', action_seq: 1 }), linkedAttempt('ok')]))
            .toEqual({ kind: 'linked', linkedAttempt: 'ok' });
        expect(pressLinkage([press({ action: 'accept_linked', link_state: 'linked', action_seq: 1 })]))
            .toEqual({ kind: 'linked', linkedAttempt: 'unobserved' });
    });

    it('only one direct press supports "ran unlinked"', () => {
        expect(pressLinkage([press({ action: 'open_session', link_state: 'direct', action_seq: 1 })])).toEqual({ kind: 'unlinked' });
    });

    it('ignored presses do not count; zero, several or inconsistent presses are unverified', () => {
        expect(pressLinkage([press({ action: 'ignored', link_state: 'pending', action_seq: 1 })])).toMatchObject({ kind: 'unverified', reason: 'no_proceeding_press' });
        expect(pressLinkage([])).toMatchObject({ kind: 'unverified', reason: 'no_proceeding_press' });
        expect(pressLinkage([
            press({ action: 'open_session', link_state: 'direct', action_seq: 1 }), press({ action: 'open_session', link_state: 'direct', action_seq: 2 }),
        ])).toMatchObject({ kind: 'unverified', reason: 'multiple_proceeding_presses' });
        expect(pressLinkage([press({ action: 'open_session', link_state: 'linked', action_seq: 1 })])).toMatchObject({ kind: 'unverified', reason: 'press_state_inconsistent' });
    });

    it('a linked attempt that did not succeed, or two for the same press, is unverified', () => {
        expect(pressLinkage([press({ action: 'accept_linked', link_state: 'linked', action_seq: 3 }), linkedAttempt('server_failed', 3)]))
            .toMatchObject({ kind: 'unverified', reason: 'linked_attempt_not_ok' });
        expect(pressLinkage([press({ action: 'accept_linked', link_state: 'linked', action_seq: 3 }), linkedAttempt('ok', 3), linkedAttempt('ok', 3)]))
            .toMatchObject({ kind: 'unverified', reason: 'multiple_linked_attempts' });
        // Another press's attempt event is not this press's.
        expect(pressLinkage([press({ action: 'accept_linked', link_state: 'linked', action_seq: 3 }), linkedAttempt('server_failed', 2)]))
            .toEqual({ kind: 'linked', linkedAttempt: 'unobserved' });
    });
});

const REC = { targetMetric: 'filler_rate', targetDirection: 'decrease', targetValue: 3, targetUnits: 'per 100 words' };
const read = (attempts: { lifecycle: string; outcome: string | null; isThisRepeat: boolean }[], recommendation: typeof REC | null = REC): ServerEvidence =>
    ({ kind: 'read', recommendation, attempts });
const LINKED = { kind: 'linked', linkedAttempt: 'ok' } as const;
const BOUND = { lifecycle: 'completed', outcome: 'moved', isThisRepeat: true };

describe('G03 prerequisites: nothing is navigated without the bindings', () => {
    it('a bound, newest, resolved attempt on a valid recommendation is observed, with its exact expected lines', () => {
        expect(repeatMetricPrerequisites(read([BOUND]), LINKED)).toEqual({
            observe: true,
            expected: {
                metric: 'filler_rate', direction: 'decrease',
                target: 'Separate delivery comparison: Filler rate (saved target: decrease toward 3 per 100 words).',
                outcome: 'Filler rate was lower on the repeat than in the original session.',
            },
        });
    });

    it('the server row proves the link even when the press telemetry was not observed', () => {
        expect(repeatMetricPrerequisites(read([BOUND]), { kind: 'unverified', reason: 'no_proceeding_press' })).toMatchObject({ observe: true });
    });

    it.each([
        ['server_read_failed', { kind: 'read_failed' } as ServerEvidence, LINKED],
        ['ran_unlinked', read([]), { kind: 'unlinked' } as const],
        ['linkage_unverified', read([]), { kind: 'unverified', reason: 'no_proceeding_press' } as const],
        ['repeat_unbound', read([{ lifecycle: 'completed', outcome: 'moved', isThisRepeat: false }]), LINKED],
        ['repeat_unbound', read([{ lifecycle: 'pending', outcome: null, isThisRepeat: false }]), LINKED],
        ['linkage_contradiction', read([BOUND]), { kind: 'unlinked' } as const],
        ['no_recommendation', read([BOUND], null), LINKED],
        ['not_newest_attempt', read([{ lifecycle: 'completed', outcome: 'moved', isThisRepeat: false }, BOUND]), LINKED],
        ['repeat_unresolved', read([{ lifecycle: 'pending', outcome: null, isThisRepeat: true }]), LINKED],
    ])('%s → HOLD without navigation', (reason, server, linkage) => {
        expect(repeatMetricPrerequisites(server, linkage)).toMatchObject({ observe: false, reason });
    });

    it('an invalid target on the bound recommendation → HOLD without navigation', () => {
        expect(repeatMetricPrerequisites(read([BOUND], { ...REC, targetMetric: 'volume' }), LINKED)).toMatchObject({ observe: false, reason: 'recommendation_invalid' });
    });
});

const EXPECTED: ExpectedLines = {
    metric: 'filler_rate', direction: 'decrease',
    target: 'Separate delivery comparison: Filler rate (saved target: decrease toward 3 per 100 words).',
    outcome: 'Filler rate was lower on the repeat than in the original session.',
};
const SHOWN: PanelObservation = {
    state: 'eligible',
    target: 'Separate delivery comparison: Filler rate (saved target:\n decrease toward 3 per 100 words).',
    outcome: 'Filler rate was lower on the repeat than in the original session.',
    scope: SCOPE_LINE, legacyPhrase: false,
};

describe('G03 verdict on a settled observation', () => {
    it('NORMAL: the exact three lines (whitespace-normalized) on a settled eligible panel PASS', () => {
        expect(repeatMetricWordingVerdict(EXPECTED, SHOWN)).toMatchObject({ verdict: 'PASS', evidence: { targetMatches: true, outcomeMatches: true, scopeMatches: true } });
    });

    it('a missing or wrong line on a settled eligible panel is FAIL', () => {
        for (const change of [
            { target: null }, { outcome: null }, { scope: null },
            { target: SHOWN.target!.replace('Filler rate', 'Pace') },
            { target: SHOWN.target!.replace('decrease toward', 'increase toward') },
            { target: SHOWN.target!.replace(' 3 ', ' 4 ') },
            { outcome: 'Filler rate was not lower on the repeat than in the original session.' },
            { scope: 'This comparison measures delivery.' },
            { legacyPhrase: true },
        ] as Partial<PanelObservation>[]) {
            expect({ change, verdict: repeatMetricWordingVerdict(EXPECTED, { ...SHOWN, ...change }).verdict }).toEqual({ change, verdict: 'FAIL' });
        }
    });

    it('NEGATIVE CONTROL: the pre-#1697 copy is rejected (not a product-regression RED; main already ships the fix)', () => {
        const legacy: PanelObservation = {
            state: 'eligible',
            target: 'Measured repeat target: Filler rate; decrease toward 3 per 100 words.',
            outcome: 'The stored repeat shows movement in the practiced direction.',
            scope: null, legacyPhrase: true,
        };
        expect(repeatMetricWordingVerdict(EXPECTED, legacy)).toMatchObject({ verdict: 'FAIL', evidence: { targetMatches: false, outcomeMatches: false, scopeMatches: false, legacyPhrase: true } });
        expect(legacy.outcome).toContain(LEGACY_PHRASE);
    });

    it('an unsettled, wrong-route, errored, non-eligible, closed or unreadable page is HOLD, even with the lines missing', () => {
        for (const state of ['wrong_route', 'not_settled', 'error', 'insufficient', 'ineligible', 'closed', 'unreadable'] as const) {
            const verdict = repeatMetricWordingVerdict(EXPECTED, { state, target: null, outcome: null, scope: null, legacyPhrase: false });
            expect({ state, verdict: verdict.verdict }).toEqual({ state, verdict: 'HOLD' });
        }
    });

    it('CONTROL: a verified attempt with the panel still loading at the deadline is HOLD, never FAIL', () => {
        expect(repeatMetricWordingVerdict(EXPECTED, { ...SHOWN, state: 'not_settled', target: null, outcome: null, scope: null }).verdict).toBe('HOLD');
    });

    it('the row evidence carries closed codes and booleans only', () => {
        const { evidence } = repeatMetricWordingVerdict(EXPECTED, SHOWN);
        for (const value of Object.values(evidence)) expect(['string', 'boolean'].includes(typeof value) || value === null).toBe(true);
        expect(Object.values(evidence).filter((v) => typeof v === 'string')).toEqual(['filler_rate', 'decrease', 'eligible']);
        expect(normalizeLine(' a \n b ')).toBe('a b');
    });
});

describe('G03 the Open Mic spec step: server oracle first, no navigation without bindings, sanitized failure', () => {
    const spec = readFileSync(path.join(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
    const begin = spec.indexOf("await test.step('the repeat result names the measured metric'");
    const step = begin >= 0 ? spec.slice(begin, spec.indexOf('} finally {\n            await finish();', begin)) : '';

    it('runs after the coaching-binding step and before the journey finalizes', () => {
        expect(begin).toBeGreaterThan(spec.indexOf("await test.step('coaching prompt binding — restricted synthetic artifact'"));
        expect(step.length).toBeGreaterThan(0);
    });

    it('binds the recommendation by source session, formula version and account, and the attempt by this repeat take', () => {
        expect(PROGRESS_FORMULA).toBe('clarity_v1');
        expect(step).toMatch(/\.eq\('source_session_id', persistedId\)\.eq\('formula_version', PROGRESS_FORMULA\)\.eq\('user_id', capturedUid\)\.maybeSingle\(\)/);
        expect(step).toMatch(/\.eq\('recommendation_id', rec\.id\)\.eq\('user_id', capturedUid\)\.order\('accepted_at', \{ ascending: false \}\)/);
        expect(step).toMatch(/isThisRepeat: a\.practice_session_id === repeatSessionId/);
        expect(step).toMatch(/pressLinkage\(repeatWindow \? tap\.events\.slice\(repeatWindow\[0\], repeatWindow\[1\]\) : \[\]\)/);
    });

    it('reads the server and decides before navigating; a HOLD prerequisite returns without a goto', () => {
        const oracle = step.indexOf("from('progress_recommendations')");
        const decide = step.indexOf('if (!prerequisite.observe) {');
        const goto = step.indexOf('await page.goto(route)');
        expect(oracle).toBeGreaterThan(-1);
        expect(oracle).toBeLessThan(decide);
        expect(decide).toBeLessThan(goto);
        expect(step.slice(decide, goto)).toMatch(/receipt\.row\(REPEAT_METRIC_ROW, 'HOLD'[\s\S]*return;/);
        expect(step.match(/page\.goto\(/g)).toHaveLength(1);
        expect(step).toMatch(/const route = `\/progress\/\$\{persistedId\}`;/);
    });

    it('settles once, binds the route, and records a failure by error class only', () => {
        expect(step).toMatch(/\.waitFor\(\{ state: 'visible', timeout: 45_000 \}\)/);
        expect(step).not.toMatch(/Promise\.race/);
        expect(step).toMatch(/new URL\(page\.url\(\)\)\.pathname === route/);
        expect(step).toMatch(/receipt\.row\(REPEAT_METRIC_ROW, 'HOLD', `the repeat-metric observation failed \(\$\{name\}\)`\)/);
        expect(REPEAT_METRIC_ROW).toBe('repeat result names the measured metric');
    });
});
