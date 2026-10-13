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

describe('R11 — a failure report is bound to ITS request by the page\'s emission order (helper → adapter → validator)', async () => {
    const { bindFailureReports, capturedFailureCategory, feedbackDiagnosticChainRow, PAGE_FAILURE_REASONS } = await import('../live/helpers/coachingFeedbackAdapter');
    const { validateFeedbackDiagnostics, FAILURE_CATEGORY_AMBIGUOUS, FAILURE_CATEGORY_OBSERVED_INVALID } = await import('../live/helpers/feedbackDiagnosticContract');

    /** A failed coaching exchange shaped like scenario 2's (502 provider_timeout, 2 provider attempts). */
    const failed = (requestId: string, sessionId: string, at: number) => ({
        sent: { requestId, attemptId: `${requestId}-att`, sessionId }, status: 502, clientMs: 41_000, suggestions: null, at,
        diagnostics: { request_id: requestId, attempt_id: `${requestId}-att`, outcome: 'failure', reason: 'provider_timeout', provider_status: null,
            provider_attempts: 2, retry_count: 1, provider_duration_ms: 40_009, total_duration_ms: 40_603,
            configured_model: 'gemini-3.8-flash', observed_model: null, source: 'fresh' },
    });
    const diag = (requestId: string, capturedAt: number, bootId = 'boot-1', outcome = 'failure') =>
        ({ event: 'ai_coaching_diagnostic', at: capturedAt + 3_000, capturedAt, bootId, diagnosticRequestId: requestId, diagnosticOutcome: outcome });
    const report = (reason: string, capturedAt: number, bootId = 'boot-1') =>
        ({ event: 'practice_loop_review_failed', at: capturedAt + 3_000, capturedAt, bootId, reason });
    const health = (capturedAt: number) => ({ event: 'telemetry_health', at: capturedAt + 3_000, capturedAt, bootId: 'boot-1' });

    /** The REAL chain row, with a fake report reader and receipt: binding → category → adapter → validator → row. */
    const chain = async (opts: { exchanges: unknown[]; events: unknown[]; reportSession: string; currentSession: string; ref: string }) => {
        const rows: Array<{ step: string; verdict: string; evidence?: Record<string, unknown> }> = [];
        const receipt = { rows, row: (step: string, verdict: string, _d: string, evidence?: Record<string, unknown>) => { rows.push({ step, verdict, evidence }); } };
        const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: [{ id: 'r1', session_id: opts.reportSession, metadata: { coaching_diagnostic_ref: opts.ref } }], error: null }) }) }) }) };
        await feedbackDiagnosticChainRow({
            receipt: receipt as never, admin: admin as never, userId: 'u1', reportId: 'r1', currentSessionId: opts.currentSession,
            reportedSessionId: opts.reportSession, acknowledgementVisible: true, exchanges: opts.exchanges as never,
            observedEvents: opts.events as never, configuredModel: 'gemini-3.8-flash', product: 'open_mic',
        });
        const row = rows.find((r) => r.step === 'feedback diagnostic chain');
        return { verdict: row?.verdict, reasons: String(row?.evidence?.reasons ?? '') };
    };

    it('exact binding: the report right after A\'s terminal failure gives A the page category → readback HOLD only (38304068207)', async () => {
        const r = await chain({ exchanges: [failed('A', 's1', 1_000)], events: [diag('A', 1_010), health(1_011), report('unavailable', 1_012)], reportSession: 's1', currentSession: 's1', ref: 'A' });
        expect(r).toEqual({ verdict: 'HOLD', reasons: 'telemetry_not_received' });
    });

    it('PM repro: a LATER unrelated request\'s report is never borrowed — A stays unobserved (HOLD)', async () => {
        const events = [diag('A', 1_010), diag('B', 9_000), report('network', 9_999)];
        expect(capturedFailureCategory(failed('A', 's1', 1_000) as never, bindFailureReports(events as never))).toBeNull();
        // B is another take's request (an unrelated later failure); the report is about A's take.
        const r = await chain({ exchanges: [failed('A', 's1', 1_000), failed('B', 's2', 8_990)], events, reportSession: 's1', currentSession: 's1', ref: 'A' });
        expect(r).toEqual({ verdict: 'HOLD', reasons: 'telemetry_not_received,failure_category_not_observed' });
    });

    it('interleaved failures: a report binds only to its IMMEDIATE predecessor, and one report never serves two requests', () => {
        const bindings = bindFailureReports([diag('A', 100), diag('B', 110), report('unavailable', 111)] as never);
        expect(bindings.get('B')).toEqual({ state: 'bound', reason: 'unavailable' });
        expect(bindings.has('A')).toBe(false);
    });

    it('out-of-order flush: binding follows CAPTURE order, not the order the tap observed the batches', () => {
        // The report's batch was observed FIRST (at 500) but captured after A's failure.
        const events = [{ ...report('rate_limited', 1_012), at: 500 }, { ...diag('A', 1_010), at: 900 }];
        expect(bindFailureReports(events as never).get('A')).toEqual({ state: 'bound', reason: 'rate_limited' });
    });

    it('two reports for one request are ambiguous (HOLD); a report in another page boot binds nothing', async () => {
        const amb = bindFailureReports([diag('A', 10), report('unavailable', 11), diag('A', 20), report('network', 21)] as never);
        expect(capturedFailureCategory(failed('A', 's1', 0) as never, amb)).toBe(FAILURE_CATEGORY_AMBIGUOUS);
        const r = await chain({ exchanges: [failed('A', 's1', 0)], events: [diag('A', 10), report('unavailable', 11), diag('A', 20), report('network', 21)], reportSession: 's1', currentSession: 's1', ref: 'A' });
        expect(r.verdict).toBe('HOLD');
        expect(r.reasons.split(',')).toContain('failure_category_ambiguous');
        expect(bindFailureReports([diag('A', 10, 'boot-1'), report('unavailable', 11, 'boot-2')] as never).size).toBe(0);
        expect(bindFailureReports([diag('A', 10, 'boot-1', 'retrying'), report('unavailable', 11)] as never).size, 'a retrying diagnostic is not terminal').toBe(0);
    });

    it('older take / current take: the older report gets the older request\'s own category, never the current one\'s', async () => {
        const events = [diag('OLD', 100), report('access_denied', 101), diag('NEW', 500), report('unavailable', 501)];
        const bindings = bindFailureReports(events as never);
        expect(capturedFailureCategory(failed('OLD', 's-old', 90) as never, bindings)).toBe('access_denied');
        expect(capturedFailureCategory(failed('NEW', 's-new', 490) as never, bindings)).toBe('unavailable');
        const r = await chain({ exchanges: [failed('OLD', 's-old', 90), failed('NEW', 's-new', 490)], events, reportSession: 's-old', currentSession: 's-new', ref: 'OLD' });
        expect(r).toEqual({ verdict: 'HOLD', reasons: 'telemetry_not_received' });
    });

    it('an OBSERVED reason outside the page vocabulary stays invalid end to end → FAIL, with no raw text in the row', async () => {
        const events = [diag('A', 10), report('provider_timeout', 11)];
        expect(capturedFailureCategory(failed('A', 's1', 0) as never, bindFailureReports(events as never))).toBe(FAILURE_CATEGORY_OBSERVED_INVALID);
        const r = await chain({ exchanges: [failed('A', 's1', 0)], events, reportSession: 's1', currentSession: 's1', ref: 'A' });
        expect(r.verdict).toBe('FAIL');
        expect(r.reasons.split(',')).toContain('request_field_invalid');
        expect(r.reasons).not.toContain('provider_timeout');
    });

    describe('Browser PM RETURN 6145711360 — order is bound only where it is PROVABLE', () => {
        /** One PostHog payload: its position is the page's FIFO capture order. `at` is tap arrival, never evidence. */
        const inBatch = (batch: number, events: Array<Record<string, unknown>>) => events.map((e, batchIndex) => ({ ...e, batch, batchIndex }));
        const noTime = (e: Record<string, unknown>) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'capturedAt'));

        it('PM repro 1: A\'s failure with NO capture time, a later network report in another payload → A ambiguous (HOLD), never bound', async () => {
            const events = [...inBatch(1, [noTime({ ...diag('A', 0), at: 1_000 })]), ...inBatch(2, [{ ...report('network', 9_999), at: 9_999 }])];
            expect(bindFailureReports(events as never).get('A')).toEqual({ state: 'ambiguous' });
            const r = await chain({ exchanges: [failed('A', 's1', 900)], events, reportSession: 's1', currentSession: 's1', ref: 'A' });
            expect(r).toEqual({ verdict: 'HOLD', reasons: 'telemetry_not_received,failure_category_ambiguous' });
        });

        it('PM repro 2: tied capture times across reordered payloads (B, A, then B\'s report) bind NOTHING to A — both ambiguous', async () => {
            const events = [...inBatch(1, [diag('B', 100)]), ...inBatch(2, [diag('A', 100)]), ...inBatch(3, [report('network', 100)])];
            const b = bindFailureReports(events as never);
            expect(b.get('A')).toEqual({ state: 'ambiguous' });
            expect(b.get('B')).toEqual({ state: 'ambiguous' });
            const r = await chain({ exchanges: [failed('A', 's1', 50), failed('B', 's2', 40)], events, reportSession: 's1', currentSession: 's1', ref: 'A' });
            expect(r).toEqual({ verdict: 'HOLD', reasons: 'telemetry_not_received,failure_category_ambiguous' });
        });

        it('a tie among the candidates (report strictly later, but A and B captured in the same ms in different payloads) is ambiguous', () => {
            const events = [...inBatch(1, [diag('B', 100)]), ...inBatch(2, [diag('A', 100)]), ...inBatch(3, [report('network', 101)])];
            expect(bindFailureReports(events as never).get('A')).toEqual({ state: 'ambiguous' });
        });

        it('mixed availability: one unrelated event with no capture time makes a cross-payload order unprovable → ambiguous', async () => {
            const events = [...inBatch(1, [diag('A', 10)]), ...inBatch(2, [report('unavailable', 11)]), ...inBatch(3, [noTime(diag('C', 0))])];
            expect(bindFailureReports(events as never).get('A')).toEqual({ state: 'ambiguous' });
            const r = await chain({ exchanges: [failed('A', 's1', 0)], events, reportSession: 's1', currentSession: 's1', ref: 'A' });
            expect(r).toEqual({ verdict: 'HOLD', reasons: 'telemetry_not_received,failure_category_ambiguous' });
        });

        it('WITHIN one payload, position proves order even with missing or tied times — and arrival order is ignored', async () => {
            // The page queued B's failure, then A's, then A's report: FIFO position binds the report to A.
            const tied = inBatch(1, [{ ...diag('B', 100), at: 9 }, { ...diag('A', 100), at: 5 }, { ...report('rate_limited', 100), at: 1 }]);
            expect(bindFailureReports(tied as never).get('A')).toEqual({ state: 'bound', reason: 'rate_limited' });
            expect(bindFailureReports(tied as never).has('B')).toBe(false);
            const missing = inBatch(1, [noTime(diag('A', 0)), noTime(report('unavailable', 0))]);
            expect(bindFailureReports(missing as never).get('A')).toEqual({ state: 'bound', reason: 'unavailable' });
            const r = await chain({ exchanges: [failed('A', 's1', 0)], events: missing, reportSession: 's1', currentSession: 's1', ref: 'A' });
            expect(r).toEqual({ verdict: 'HOLD', reasons: 'telemetry_not_received' });
        });

        it('distinct capture times still order separate payloads (the earlier out-of-order flush case keeps binding)', () => {
            const events = [...inBatch(2, [{ ...report('rate_limited', 1_012), at: 500 }]), ...inBatch(1, [{ ...diag('A', 1_010), at: 900 }])];
            expect(bindFailureReports(events as never).get('A')).toEqual({ state: 'bound', reason: 'rate_limited' });
        });

        it('observed-invalid bound evidence stays FAIL when proven by payload position, with no raw text', async () => {
            const events = inBatch(1, [noTime(diag('A', 0)), noTime(report('provider_timeout', 0))]);
            const r = await chain({ exchanges: [failed('A', 's1', 0)], events, reportSession: 's1', currentSession: 's1', ref: 'A' });
            expect(r.verdict).toBe('FAIL');
            expect(r.reasons.split(',')).toContain('request_field_invalid');
            expect(r.reasons).not.toContain('provider_timeout');
        });

        it('RETURN 6149274471: a PROVEN invalid report stays FAIL even when another report in the boot cannot be placed', async () => {
            // A's failure and its own same-payload report (out of vocabulary); B's failure and an unplaceable report elsewhere.
            const events = [
                ...inBatch(1, [noTime(diag('A', 0)), noTime(report('provider_timeout', 0))]),
                ...inBatch(2, [noTime(diag('B', 0))]),
                ...inBatch(3, [noTime(report('network', 0))]),
            ];
            const b = bindFailureReports(events as never);
            expect(b.get('A')).toEqual({ state: 'observed_invalid' });
            expect(b.get('B')).toEqual({ state: 'ambiguous' });
            expect(JSON.stringify([...b.values()])).not.toContain('provider_timeout');
            const r = await chain({ exchanges: [failed('A', 's1', 0), failed('B', 's2', 0)], events, reportSession: 's1', currentSession: 's1', ref: 'A' });
            expect(r.verdict).toBe('FAIL');
            expect(r.reasons.split(',')).toContain('request_field_invalid');
            expect(r.reasons).not.toContain('provider_timeout');
        });

        it('CONTROLS: a proven VALID report under the same ambiguity is HOLD (ambiguous); ambiguity alone is HOLD', async () => {
            const valid = [
                ...inBatch(1, [noTime(diag('A', 0)), noTime(report('unavailable', 0))]),
                ...inBatch(2, [noTime(diag('B', 0))]),
                ...inBatch(3, [noTime(report('network', 0))]),
            ];
            expect(bindFailureReports(valid as never).get('A')).toEqual({ state: 'ambiguous' });
            expect(await chain({ exchanges: [failed('A', 's1', 0), failed('B', 's2', 0)], events: valid, reportSession: 's1', currentSession: 's1', ref: 'A' }))
                .toEqual({ verdict: 'HOLD', reasons: 'telemetry_not_received,failure_category_ambiguous' });
            const only = [...inBatch(1, [noTime(diag('A', 0))]), ...inBatch(2, [noTime(report('network', 0))])];
            expect(bindFailureReports(only as never).get('A')).toEqual({ state: 'ambiguous' });
        });

        it('two PROVEN reports for one request: any invalid one makes it FAIL; two valid ones stay ambiguous (HOLD)', () => {
            const mixed = inBatch(1, [diag('A', 1), report('unavailable', 2), diag('A', 3), report('provider_timeout', 4)]);
            expect(bindFailureReports(mixed as never).get('A')).toEqual({ state: 'observed_invalid' });
            const twoValid = inBatch(1, [diag('A', 1), report('unavailable', 2), diag('A', 3), report('network', 4)]);
            expect(bindFailureReports(twoValid as never).get('A')).toEqual({ state: 'ambiguous' });
        });

        it('the tap stamps every decoded event with its payload and position, in memory only', async () => {
            const { AnalyticsTap, OUTCOME_FIELDS } = await import('../live/helpers/rwtJourney');
            const tap = new AnalyticsTap();
            let onRequest: (r: unknown) => void = () => undefined;
            tap.attach({ on: (_e: string, cb: (r: unknown) => void) => { onRequest = cb; }, mainFrame: () => null } as never);
            const post = (events: string[]) => onRequest({
                isNavigationRequest: () => false, frame: () => null, url: () => 'https://us.i.posthog.com/e/', method: () => 'POST',
                postDataBuffer: () => Buffer.from(JSON.stringify(events.map((event) => ({ event, properties: { boot_id: 'b' } })))),
            });
            post(['ai_coaching_diagnostic', 'practice_loop_review_failed']);
            post(['telemetry_health']);
            expect(tap.events.map((e) => [e.event, e.batch, e.batchIndex])).toEqual([
                ['ai_coaching_diagnostic', 1, 0], ['practice_loop_review_failed', 1, 1], ['telemetry_health', 2, 0]]);
            expect(Object.values(OUTCOME_FIELDS).flat()).not.toContain('batch');
        });
    });

    it('the tap keeps the request id OUT of OUTCOME_FIELDS (receipt-bound) and records it in memory only', async () => {
        const { OUTCOME_FIELDS } = await import('../live/helpers/rwtJourney');
        expect(Object.values(OUTCOME_FIELDS).flat()).not.toContain('diagnostic_request_id');
        expect(read('tests/live/helpers/rwtJourney.ts')).toMatch(/record\.event === 'ai_coaching_diagnostic' \? \{ diagnosticRequestId: text\('diagnostic_request_id'\), diagnosticOutcome: text\('outcome'\) \}/);
    });

    it('the page reasons equal the product telemetry vocabulary, and every chain caller passes the observed events', () => {
        const allowlist = read('frontend/src/services/telemetryAllowlist.ts');
        const start = allowlist.indexOf('const PRACTICE_LOOP_REVIEW_FAILURE_REASONS = [');
        const block = allowlist.slice(start, allowlist.indexOf('] as const;', start));
        expect([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...PAGE_FAILURE_REASONS].sort());
        const page = read('frontend/src/components/session/AISuggestions.tsx');
        expect(page, 'the page emits the failure diagnostic, then the report, with no await between')
            .toMatch(/outcome: shouldRetry \? 'retrying' : failure\.reason === 'network' \? 'network_failure' : 'failure',[\s\S]{0,700}?trackPracticeLoopReviewFailed\(failure\.reason\);/);
        expect(read('tests/live/helpers/coachingFeedbackAdapter.ts')).toMatch(/failureCategory: \(e\) => capturedFailureCategory\(e, failureBindings\),/);
        for (const caller of ['tests/live/rwt-open-mic-first-session.live.spec.ts', 'tests/live/helpers/rwtFocusPointsJourney.ts', 'tests/live/rwt-feedback-association-boundaries.live.spec.ts']) {
            expect({ caller, passes: read(caller).includes('observedEvents: tap.events') }).toEqual({ caller, passes: true });
        }
    });

    describe('relaxing the unobserved category preserves EVERY other contradiction', () => {
        const base = { reportId: 'r1', sessionId: 's1', association: 'current_take', linkedRequestId: 'A', storage: 'stored_once', acknowledgementVisible: true, telemetryReceived: false };
        const request = (over: Record<string, unknown> = {}) => ({
            requestId: 'A', attemptId: 'A-att', sessionId: 's1', outcome: 'timeout', failureCategory: null, serverReason: 'provider_timeout',
            statusClass: '5xx', providerStatusClass: 'none', retryCount: 1, totalMs: 40_603, providerMs: 40_009,
            configuredModel: 'gemini-3.8-flash', observedModel: null, source: 'fresh', ...over,
        });
        const expectation = (over: Record<string, unknown> = {}) => ({ reportId: 'r1', association: 'current_take', sessionId: 's1', requestId: 'A', attemptId: 'A-att',
            currentRequestId: 'A', outcome: null, failureCategory: null, serverReason: null, configuredModel: 'gemini-3.8-flash', ...over });
        const verdict = (r: Record<string, unknown>, e: Record<string, unknown> = expectation(), rep: Record<string, unknown> = base) =>
            validateFeedbackDiagnostics({ report: rep, requests: [r] } as never, e as never);

        it.each([
            ['configured model mismatch', request({ configuredModel: 'other-model' }), expectation(), base, 'configured_model_mismatch'],
            ['attempt mismatch', request({ attemptId: 'other-att' }), expectation(), base, 'attempt_mismatch'],
            ['request bound to another session', request({ sessionId: 's2' }), expectation(), base, 'request_session_mismatch'],
            ['report session mismatch', request(), expectation(), { ...base, sessionId: 's9' }, 'session_mismatch'],
            ['poisoned echo (unmapped outcome)', request({ outcome: 'unmapped:echo_mismatch' }), expectation(), base, 'request_field_invalid'],
            ['negative duration', request({ totalMs: -1 }), expectation(), base, 'request_field_invalid'],
            ['provider leg longer than the request', request({ providerMs: 50_000 }), expectation(), base, 'request_field_invalid'],
            ['observed-invalid category', request({ failureCategory: FAILURE_CATEGORY_OBSERVED_INVALID }), expectation(), base, 'request_field_invalid'],
            ['no-session report with an invented link', request(), expectation({ association: 'no_session', sessionId: null, requestId: null }), { ...base, association: 'no_session', sessionId: null }, 'invented_link'],
        ])('%s stays FAIL with the category unobserved', (_n, r, e, rep, reason) => {
            const v = verdict(r as never, e as never, rep as never);
            expect(v.verdict).toBe('FAIL');
            expect(v.reasons).toContain(reason);
        });

        it('every contradiction stays FAIL with the category AMBIGUOUS too (an unprovable binding never relaxes them)', () => {
            const rows: Array<[Record<string, unknown>, Record<string, unknown>, Record<string, unknown>]> = [
                [request({ configuredModel: 'other-model' }), expectation(), base], [request({ attemptId: 'other-att' }), expectation(), base],
                [request({ sessionId: 's2' }), expectation(), base], [request(), expectation(), { ...base, sessionId: 's9' }],
                [request({ outcome: 'unmapped:echo_mismatch' }), expectation(), base], [request({ totalMs: -1 }), expectation(), base],
                [request({ providerMs: 50_000 }), expectation(), base],
            ];
            for (const [r, e, rep] of rows) expect(verdict({ ...r, failureCategory: FAILURE_CATEGORY_AMBIGUOUS }, e, rep).verdict).toBe('FAIL');
        });

        it('CONTROL: with no contradiction, an unobserved category is HOLD (not FAIL), and success settlement is unchanged', () => {
            expect(verdict(request())).toEqual({ verdict: 'HOLD', reasons: ['telemetry_not_received', 'failure_category_not_observed'] });
            const success = request({ outcome: 'success', failureCategory: null, serverReason: 'none', statusClass: '2xx', providerStatusClass: '2xx', observedModel: 'gemini-3.8-flash' });
            expect(verdict(success)).toEqual({ verdict: 'HOLD', reasons: ['telemetry_not_received'] });
        });
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
