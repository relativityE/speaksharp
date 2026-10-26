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
    type ExpectedLines, type PanelObservation, type PressEvent, type ServerAttempt, type ServerEvidence,
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
let clock = 0;
/** Attempts are listed newest first; each gets a strictly older accepted_at unless one is given. */
let ids = 0;
const att = (lifecycle: string | null, outcome: string | null, isThisRepeat: boolean, acceptedAt?: string): ServerAttempt =>
    ({ id: `attempt-${ids += 1}`, lifecycle, outcome, isThisRepeat, acceptedAt: acceptedAt ?? new Date(Date.UTC(2026, 9, 26, 12, 0, 0) - (clock += 1000)).toISOString() });
/**
 * The two separate server reads from one attempt list (newest first): the newest two, and the count of attempts bound
 * to this repeat. `attempts` repeats the list in the pre-3e1dc2ff shape, so a RED run against that helper exercises its
 * logic rather than failing on a missing field.
 */
const read = (
    attempts: ServerAttempt[], recommendation: typeof REC | null = REC, boundCount = attempts.filter((a) => a.isThisRepeat).length,
    boundId: unknown = attempts.find((a) => a.isThisRepeat)?.id ?? null,
): ServerEvidence => ({ kind: 'read', recommendation, newest: attempts.slice(0, 2), boundCount, boundId, attempts } as ServerEvidence);
const LINKED = { kind: 'linked', linkedAttempt: 'ok' } as const;
const BOUND = att('completed', 'moved', true, '2026-10-26T12:00:00.000Z');

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
        expect(repeatMetricPrerequisites(read([BOUND]), { kind: 'unverified', reason: 'no_proceeding_press', contradictory: false })).toMatchObject({ observe: true });
    });

    it.each([
        ['server_read_failed', { kind: 'read_failed' } as ServerEvidence, LINKED],
        ['ran_unlinked', read([]), { kind: 'unlinked' } as const],
        ['linkage_unverified', read([]), { kind: 'unverified', reason: 'no_proceeding_press', contradictory: false } as const],
        ['repeat_unbound', read([att('completed', 'moved', false)]), LINKED],
        ['repeat_unbound', read([att('pending', null, false)]), LINKED],
        ['linkage_contradiction', read([BOUND]), { kind: 'unlinked' } as const],
        ['no_recommendation', read([BOUND], null), LINKED],
        ['not_newest_attempt', read([att('completed', 'moved', false, '2026-10-26T12:30:00.000Z'), BOUND]), LINKED],
        ['repeat_unresolved', read([att('pending', null, true)]), LINKED],
    ])('%s → HOLD without navigation (row %#)', (reason, server, linkage) => {
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
    scope: SCOPE_LINE, legacyPhrase: false, readsStable: true,
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
            scope: null, legacyPhrase: true, readsStable: true,
        };
        expect(repeatMetricWordingVerdict(EXPECTED, legacy)).toMatchObject({ verdict: 'FAIL', evidence: { targetMatches: false, outcomeMatches: false, scopeMatches: false, legacyPhrase: true } });
        expect(legacy.outcome).toContain(LEGACY_PHRASE);
    });

    it('an unsettled, wrong-route, errored, non-eligible, closed or unreadable page is HOLD, even with the lines missing', () => {
        for (const state of ['wrong_route', 'not_settled', 'error', 'insufficient', 'ineligible', 'closed', 'unreadable'] as const) {
            const verdict = repeatMetricWordingVerdict(EXPECTED, { state, target: null, outcome: null, scope: null, legacyPhrase: false, readsStable: false });
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

describe('G03 review RETURN (Sam 1793016155.858699): unknown state, ties, contradictory telemetry, unstable reads', () => {
    it('an unknown or incoherent lifecycle/outcome never falls through to "not completed" copy', () => {
        for (const [lifecycle, outcome] of [['completed', 'mystery'], ['archived', 'moved'], ['completed', null], [null, 'moved'], ['completed', 7]] as const) {
            const prerequisite = repeatMetricPrerequisites(read([att(lifecycle as never, outcome as never, true, '2026-10-26T12:00:00.000Z')]), LINKED);
            expect({ lifecycle, outcome, prerequisite }).toMatchObject({ lifecycle, outcome, prerequisite: { observe: false, reason: 'attempt_state_unknown' } });
        }
    });

    it('CONTROL: every RPC-written lifecycle/outcome pair is still observed with its exact copy', () => {
        for (const [lifecycle, outcome] of [['completed', 'moved'], ['completed', 'did_not_move'], ['not_comparable', 'not_comparable'], ['abandoned', 'not_completed']]) {
            expect(repeatMetricPrerequisites(read([att(lifecycle, outcome, true, '2026-10-26T12:00:00.000Z')]), LINKED)).toMatchObject({ observe: true });
        }
    });

    it('an accepted_at tie with the next attempt, or an unreadable accepted_at, leaves the newest undetermined → HOLD', () => {
        const tie = read([att('completed', 'moved', true, '2026-10-26T12:00:00.000Z'), att('completed', 'did_not_move', false, '2026-10-26T12:00:00.000Z')]);
        expect(repeatMetricPrerequisites(tie, LINKED)).toMatchObject({ observe: false, reason: 'newest_attempt_ambiguous' });
        expect(repeatMetricPrerequisites(read([att('completed', 'moved', true, 'not a time')]), LINKED)).toMatchObject({ observe: false, reason: 'attempt_order_unknown' });
        const older = read([att('completed', 'moved', true, '2026-10-26T12:00:00.000Z'), att('completed', 'did_not_move', false, '2026-10-26T11:59:59.999Z')]);
        expect(repeatMetricPrerequisites(older, LINKED)).toMatchObject({ observe: true });
    });

    it('more than one attempt bound to the same repeat take → HOLD', () => {
        const two = read([att('completed', 'moved', true, '2026-10-26T12:00:00.000Z'), att('completed', 'moved', true, '2026-10-26T11:00:00.000Z')]);
        expect(repeatMetricPrerequisites(two, LINKED)).toMatchObject({ observe: false, reason: 'multiple_bound_attempts' });
    });

    it('contradictory press telemetry is HOLD even with a bound row; merely missing telemetry is not', () => {
        for (const reason of ['multiple_proceeding_presses', 'linked_attempt_not_ok', 'multiple_linked_attempts', 'press_state_inconsistent']) {
            expect(repeatMetricPrerequisites(read([BOUND]), { kind: 'unverified', reason, contradictory: true })).toMatchObject({ observe: false, reason: 'linkage_contradiction' });
        }
        expect(repeatMetricPrerequisites(read([BOUND]), { kind: 'unverified', reason: 'no_proceeding_press', contradictory: false })).toMatchObject({ observe: true });
        expect(pressLinkage([])).toEqual({ kind: 'unverified', reason: 'no_proceeding_press', contradictory: false });
        expect(pressLinkage([press({ action: 'open_session', link_state: 'linked', action_seq: 1 })])).toMatchObject({ contradictory: true });
    });

    it('a page that closed, moved or failed a read during the text reads is HOLD, never FAIL or PASS', () => {
        expect(repeatMetricWordingVerdict(EXPECTED, { ...SHOWN, readsStable: false })).toMatchObject({ verdict: 'HOLD', evidence: { panelState: 'unreadable' } });
        expect(repeatMetricWordingVerdict(EXPECTED, { ...SHOWN, target: null, outcome: null, scope: null, readsStable: false }).verdict).toBe('HOLD');
        expect(repeatMetricWordingVerdict(EXPECTED, { ...SHOWN, target: null, readsStable: true }).verdict).toBe('FAIL');
    });

    it('the spec reads accepted_at, distinguishes an absent line from a failed read, and re-checks the page after the reads', () => {
        const spec = readFileSync(path.join(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        const begin = spec.indexOf("await test.step('the repeat result names the measured metric'");
        const step = spec.slice(begin, spec.indexOf('} finally {\n            await finish();', begin));
        expect(step).toMatch(/\.select\('id,lifecycle,outcome,accepted_at,practice_session_id'\)/);
        expect(step).toMatch(/acceptedAt: a\.accepted_at/);
        expect(step).toMatch(/const present = await el\.count\(\)\.then\(\(n\) => n > 0, \(\) => \{ readFailed = true; return false; \}\);/);
        const lastRead = step.indexOf("await line('progress-attempt-scope')");
        const recheck = step.indexOf('const readsStable = state === \'eligible\' && !readFailed && await stillEligible();');
        expect(lastRead).toBeGreaterThan(-1);
        expect(recheck).toBeGreaterThan(lastRead);
    });
});

describe('G03 narrow RETURN (Sam 1793017348.714649): pairs, not enums; duplicate binding from its own read', () => {
    it('every incoherent lifecycle/outcome pair is HOLD, though each value alone is a valid enum', () => {
        for (const [lifecycle, outcome] of [
            ['abandoned', 'moved'], ['abandoned', 'did_not_move'], ['abandoned', 'not_comparable'],
            ['completed', 'not_completed'], ['completed', 'not_comparable'],
            ['not_comparable', 'moved'], ['not_comparable', 'did_not_move'], ['not_comparable', 'not_completed'],
        ]) {
            const prerequisite = repeatMetricPrerequisites(read([att(lifecycle, outcome, true, '2026-10-26T12:00:00.000Z')]), LINKED);
            expect({ lifecycle, outcome, prerequisite }).toMatchObject({ lifecycle, outcome, prerequisite: { observe: false, reason: 'attempt_state_unknown' } });
        }
    });

    it('a second bound attempt outside the newest two (only the separate bound read sees it) is HOLD', () => {
        const newestTwo = [BOUND, att('completed', 'did_not_move', false, '2026-10-26T11:00:00.000Z')];
        expect(repeatMetricPrerequisites(read(newestTwo, REC, 2), LINKED)).toMatchObject({ observe: false, reason: 'multiple_bound_attempts' });
        expect(repeatMetricPrerequisites(read(newestTwo, REC, 1), LINKED)).toMatchObject({ observe: true });
    });

    it('the spec reads the bound attempts separately (limit 2) and the newest two separately; no limit-10 scan', () => {
        const spec = readFileSync(path.join(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        const begin = spec.indexOf("await test.step('the repeat result names the measured metric'");
        const step = spec.slice(begin, spec.indexOf('} finally {\n            await finish();', begin));
        expect(step).toMatch(/\.select\('id'\)\s*\.eq\('recommendation_id', rec\.id\)\.eq\('user_id', capturedUid\)\.eq\('practice_session_id', repeatSessionId\)\.limit\(2\)/);
        expect(step).toMatch(/\.select\('id,lifecycle,outcome,accepted_at,practice_session_id'\)\s*\.eq\('recommendation_id', rec\.id\)\.eq\('user_id', capturedUid\)\.order\('accepted_at', \{ ascending: false \}\)\.limit\(2\)/);
        expect(step).toMatch(/boundCount: \(bound \?\? \[\]\)\.length/);
        expect(step).not.toMatch(/\.limit\(10\)/);
    });
});

describe('G03 id-equality RETURN (Sam 1793018351.121669): the bound read and the newest read must name the same row', () => {
    it('a newest-two read holding two bound attempts is HOLD, even when the bound read reported one', () => {
        const raced = [att('completed', 'moved', true, '2026-10-26T12:00:00.000Z'), att('completed', 'moved', true, '2026-10-26T11:00:00.000Z')];
        expect(repeatMetricPrerequisites(read(raced, REC, 1, raced[0].id), LINKED)).toMatchObject({ observe: false, reason: 'multiple_bound_attempts' });
    });

    it('a newest bound row that is not the bound read\'s row (or no bound id) is HOLD', () => {
        const newestTwo = [BOUND, att('completed', 'did_not_move', false, '2026-10-26T11:00:00.000Z')];
        expect(repeatMetricPrerequisites(read(newestTwo, REC, 1, 'attempt-other'), LINKED)).toMatchObject({ observe: false, reason: 'bound_read_mismatch' });
        expect(repeatMetricPrerequisites(read(newestTwo, REC, 1, null), LINKED)).toMatchObject({ observe: false, reason: 'bound_read_mismatch' });
        expect(repeatMetricPrerequisites(read(newestTwo, REC, 1, BOUND.id), LINKED)).toMatchObject({ observe: true });
    });

    it('the spec carries each row\'s id in memory only, and the sole bound id from the bound read', () => {
        const spec = readFileSync(path.join(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        const begin = spec.indexOf("await test.step('the repeat result names the measured metric'");
        const step = spec.slice(begin, spec.indexOf('} finally {\n            await finish();', begin));
        expect(step).toMatch(/\.select\('id,lifecycle,outcome,accepted_at,practice_session_id'\)/);
        expect(step).toMatch(/boundId: bound\?\.length === 1 \? bound\[0\]\.id : null,/);
        expect(step).not.toMatch(/receipt\.row\([^)]*\bid\b/);
    });
});
