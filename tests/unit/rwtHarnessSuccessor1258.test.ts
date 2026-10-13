// @vitest-environment node
/**
 * #1258 harness successor (PM 6134479029) — regressions for the alpha-baseline oracle drift and harness defects:
 * minute-format pace guide (R5), numbered rail labels (R6) and a missing coaching card (R3b). Delayed-header (R4) and
 * fatal-stop/cleanup (R3) are pinned in rwtHarnessFailFast1258.test.ts; the R7 tolerance in rwtCorpusTolerance1258.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Locator } from '@playwright/test';

vi.mock('@playwright/test', () => ({ expect: Object.assign(() => ({}), { soft: () => ({ toBe: () => undefined }) }), test: {} }));
import { readCoachingPhrase, sameOrderedPendingSet } from '../live/helpers/rwtJourney';
import { PACE_GUIDE_DEFAULT_SECONDS, parsePaceGuideSeconds } from '../live/helpers/rwtPaceGuide';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('R5 — the pace guide is minutes per point, compared as seconds', () => {
    it('the shipped default "1 min" is 60 s, and half-minute steps read exactly', () => {
        expect(PACE_GUIDE_DEFAULT_SECONDS).toBe(60);
        expect(parsePaceGuideSeconds('1 min')).toBe(60);
        expect(parsePaceGuideSeconds('0.5 min')).toBe(30);
        expect(parsePaceGuideSeconds('1.5 min')).toBe(90);
        expect(parsePaceGuideSeconds(' 3 MIN ')).toBe(180);
    });
    it('anything that is not a minutes value is null, never a guess (a skipped or missing guide included)', () => {
        for (const text of ['', null, undefined, '1:00', 'min', '0 min', 'about 1 min', '1 min per point']) {
            expect(parsePaceGuideSeconds(text)).toBeNull();
        }
    });
    it('the product still renders minutes, and the journey reads the guide with the minutes parser', () => {
        expect(read('frontend/src/components/session/ObjectiveSetupForm.tsx')).toMatch(/data-testid="objective-pace-value"[^>]*>\{fmtMin\(paceGuideMin\)\} min</);
        const journey = read('tests/live/helpers/rwtFocusPointsJourney.ts');
        expect(journey).toMatch(/parsePaceGuideSeconds\(await paceValue\.innerText\(\{ timeout: 5_000 \}\)/);
        expect(journey).not.toMatch(/parseClock\(await page\.getByTestId\('objective-pace-value'\)/);
    });
});

describe('R6 — the reopened set is compared by label, order, count and pending status', () => {
    const points = ['Open with the problem', 'Name the cost', 'Offer the fix'];
    const pending = ['pending', 'pending', 'pending'];
    it('the same labels in order, all pending, is the same set', () => {
        expect(sameOrderedPendingSet(points, pending, points)).toBe(true);
    });
    it('whole-row text that starts with the numbered marker is NOT a label (the 38304068207 oracle drift)', () => {
        expect(sameOrderedPendingSet(points.map((p, i) => `${i + 1}\n${p}`), pending, points)).toBe(false);
    });
    it('order, count and every pending status still matter', () => {
        expect(sameOrderedPendingSet([points[1], points[0], points[2]], pending, points)).toBe(false);
        expect(sameOrderedPendingSet(points.slice(0, 2), pending.slice(0, 2), points)).toBe(false);
        expect(sameOrderedPendingSet(points, ['pending', 'covered', 'pending'], points)).toBe(false);
        expect(sameOrderedPendingSet(points, ['pending', null, 'pending'], points)).toBe(false);
    });
    it('the rail row draws a number before its label, and the helper reads the label paragraph', () => {
        expect(read('frontend/src/components/session/FocusPointsRail.tsx')).toMatch(/String\(index \+ 1\)/);
        expect(read('tests/live/helpers/rwtJourney.ts')).toMatch(/rows\.map\(\(r\) => r\.locator\('p'\)\.first\(\)\.innerText\(\{ timeout: 5_000 \}\)/);
    });
});

describe('R3b — a coaching phrase is read by its test id, bounded', () => {
    const fake = (count: number, innerText: () => Promise<string>) => ({
        getByTestId: () => ({ first: () => ({ count: async () => count, innerText }) }),
    }) as unknown as Locator;
    it('a missing card phrase is "" immediately, not a wait', async () => {
        const innerText = vi.fn(async () => 'never read');
        expect(await readCoachingPhrase(fake(0, innerText), 'review-what-went-well')).toBe('');
        expect(innerText).not.toHaveBeenCalled();
    });
    it('a read that fails within its bound is "", and a present phrase is trimmed', async () => {
        expect(await readCoachingPhrase(fake(1, async () => { throw new Error('Timeout 5000ms exceeded'); }), 'review-try-next')).toBe('');
        expect(await readCoachingPhrase(fake(1, async () => '  Slow down at the close.  '), 'review-try-next')).toBe('Slow down at the close.');
    });
    it('the shared review pair owns both ids, and the Focus reader no longer walks headings', () => {
        const pair = read('frontend/src/components/review/PracticeLoopReviewPair.tsx');
        expect(pair).toContain('data-testid="review-what-went-well"');
        expect(pair).toContain('data-testid="review-try-next"');
        const journey = read('tests/live/helpers/rwtJourney.ts');
        expect(journey).toMatch(/node\.innerText\(\{ timeout: COACHING_PHRASE_READ_MS \}\)/);
        expect(journey).not.toMatch(/card\.locator\('div', \{ has: title \}\)/);
    });
});

describe('R11 — the chain uses the category the PAGE reported, captured, never derived', async () => {
    const { capturedFailureCategory, toAiRequestDiagnostic, PAGE_FAILURE_REASONS } = await import('../live/helpers/coachingFeedbackAdapter');
    const { validateFeedbackDiagnostics } = await import('../live/helpers/feedbackDiagnosticContract');
    // Scenario 2's request as observed (ai_coaching_diagnostic 2026-10-12T20:27:50Z); ids synthetic; answered at t=1000.
    const s2 = {
        sent: { requestId: 'req-1', attemptId: 'att-1', sessionId: 'sess-1' }, status: 502, clientMs: 41_000, suggestions: null, at: 1_000,
        diagnostics: { request_id: 'req-1', attempt_id: 'att-1', outcome: 'failure', reason: 'provider_timeout', provider_status: null,
            provider_attempts: 2, retry_count: 1, provider_duration_ms: 40_009, total_duration_ms: 40_603,
            configured_model: 'gemini-3.8-flash', observed_model: null, source: 'fresh' },
    };
    const verdictWith = (category: string | null) => validateFeedbackDiagnostics({
        report: { reportId: 'r1', sessionId: 'sess-1', association: 'current_take', linkedRequestId: 'req-1', storage: 'stored_once', acknowledgementVisible: true, telemetryReceived: false },
        requests: [toAiRequestDiagnostic(s2 as never, category)],
    } as never, { reportId: 'r1', association: 'current_take', sessionId: 'sess-1', requestId: 'req-1', attemptId: 'att-1', currentRequestId: 'req-1',
        outcome: null, failureCategory: null, serverReason: null, configuredModel: 'gemini-3.8-flash' } as never);

    it('a captured page report is used: the false 38304068207 FAIL becomes the readback HOLD only', () => {
        const category = capturedFailureCategory(s2 as never, [{ at: 900, reason: 'network' }, { at: 1_050, reason: 'unavailable' }]);
        expect(category, 'the first report at or after the answer — not an earlier one').toBe('unavailable');
        expect(verdictWith(category)).toEqual({ verdict: 'HOLD', reasons: ['telemetry_not_received'] });
    });

    it('no captured report is an explicit HOLD (`failure_category_not_observed`), never a guess and never a contradiction', () => {
        expect(capturedFailureCategory(s2 as never, [])).toBeNull();
        expect(capturedFailureCategory(s2 as never, [{ at: 1_050, reason: 'made_up' }]), 'only the page\'s closed reasons').toBeNull();
        expect(verdictWith(null)).toEqual({ verdict: 'HOLD', reasons: ['telemetry_not_received', 'failure_category_not_observed'] });
    });

    it('a captured category outside the contract vocabulary still FAILs; a success carries none', () => {
        expect(verdictWith('provider_timeout').verdict).toBe('FAIL');
        expect(capturedFailureCategory({ ...s2, status: 200 } as never, [{ at: 1_050, reason: 'unavailable' }])).toBeNull();
    });

    it('the page reasons equal the product telemetry vocabulary, and every chain caller passes the observed reports', () => {
        const allowlist = read('frontend/src/services/telemetryAllowlist.ts');
        const block = allowlist.slice(allowlist.indexOf('const PRACTICE_LOOP_REVIEW_FAILURE_REASONS = ['), allowlist.indexOf('] as const;', allowlist.indexOf('const PRACTICE_LOOP_REVIEW_FAILURE_REASONS = [')));
        expect([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...PAGE_FAILURE_REASONS].sort());
        const adapter = read('tests/live/helpers/coachingFeedbackAdapter.ts');
        expect(adapter).toMatch(/failureCategory: \(e\) => capturedFailureCategory\(e, input\.reportedFailures \?\? \[\]\),/);
        expect(adapter).not.toMatch(/failureCategory: \(\) => null,/);
        for (const caller of ['tests/live/rwt-open-mic-first-session.live.spec.ts', 'tests/live/helpers/rwtFocusPointsJourney.ts', 'tests/live/rwt-feedback-association-boundaries.live.spec.ts']) {
            expect({ caller, passes: read(caller).includes("reportedFailures: tap.sent('practice_loop_review_failed')") }).toEqual({ caller, passes: true });
        }
    });
});

describe('R8/R9 — wait boundedly for the OBSERVED events before leaving the page or counting "sent"', async () => {
    const { AnalyticsTap } = await import('../live/helpers/rwtJourney');
    afterEach(() => { vi.useRealTimers(); });
    const page = (closed = false) => ({ isClosed: () => closed, waitForTimeout: (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); }) });
    const observe = (tap: InstanceType<typeof AnalyticsTap>, event: string) => tap.events.push({ event, at: Date.now() } as never);

    it('returns as soon as every expected event has been observed', async () => {
        vi.useFakeTimers();
        const tap = new AnalyticsTap();
        observe(tap, 'feedback_submit');
        const pending = tap.awaitObserved(page(), { feedback_submit: 2 });
        await vi.advanceTimersByTimeAsync(700);
        observe(tap, 'feedback_submit');
        await vi.advanceTimersByTimeAsync(200);
        expect(await pending).toEqual({ observed: true, missing: [] });
    });

    it('an interval passing is NOT delivery: unobserved events are reported missing after the bound', async () => {
        vi.useFakeTimers();
        const pending = new AnalyticsTap().awaitObserved(page(), { journey_step: 1, feedback_submit: 1 }, { timeoutMs: 8_000 });
        await vi.advanceTimersByTimeAsync(9_000);
        expect(await pending).toEqual({ observed: false, missing: ['journey_step', 'feedback_submit'] });
    });

    it('a closed page or a failing wait stops at once, reports what is missing, and never throws', async () => {
        expect(await new AnalyticsTap().awaitObserved(page(true), { journey_step: 1 })).toEqual({ observed: false, missing: ['journey_step'] });
        const throwing = { isClosed: () => false, waitForTimeout: async () => { throw new Error('Target closed'); } };
        expect(await new AnalyticsTap().awaitObserved(throwing, { journey_step: 1 })).toEqual({ observed: false, missing: ['journey_step'] });
    });

    it('wiring: after Share Feedback (attempted + outcome), before sign-out, and before every "sent" count', () => {
        const journey = read('tests/live/helpers/rwtJourney.ts');
        const share = journey.slice(journey.indexOf('export async function shareFeedbackRows'), journey.indexOf('export async function feedbackRetentionAfterDeletionRow'));
        const wait = share.indexOf("tap.awaitObserved(page, { feedback_submit: feedbackBefore + (acknowledged ? 2 : 1) })");
        expect(wait).toBeGreaterThan(share.indexOf("'Thanks — we’ve got it.'"));
        expect(wait).toBeLessThan(share.indexOf("from('user_issue_reports')"));
        const nav = read('tests/live/rwt-products-navigation.live.spec.ts');
        expect(nav.indexOf("tap.awaitObserved(page, { journey_step: 1 })")).toBeLessThan(nav.indexOf("getByTestId('sign-out-button')"));
        expect(nav.lastIndexOf("tap.awaitObserved(page, { journey_step: 1 })")).toBeLessThan(nav.indexOf("receipt.row('journey_step sent'"));
        const openMic = read('tests/live/rwt-open-mic-first-session.live.spec.ts');
        expect(openMic.indexOf("tap.awaitObserved(page, { session_saved: 1, feedback_submit: 1 })")).toBeLessThan(openMic.indexOf("receipt.row('telemetry sent'"));
        const focus = read('tests/live/helpers/rwtFocusPointsJourney.ts');
        expect(focus.indexOf("tap.awaitObserved(page, { coverage_evaluation: 1 })")).toBeLessThan(focus.indexOf("tap.sent('coverage_evaluation')"));
        expect(journey).not.toMatch(/settleBeforeLeaving/);
    });
});
