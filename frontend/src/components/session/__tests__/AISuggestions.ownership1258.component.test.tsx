/**
 * #1258 (contract 6037393538) — the card's real lifecycle produces paired, take-bound coaching events.
 * One automatic request with one recoverable retry is ONE logical generation: one seq, `invocations: 2`.
 */
import React from 'react';
import { render, screen, cleanup, waitFor } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AISuggestions from '@/components/session/AISuggestions';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { __resetReviewSubjectsForTests, rememberReviewSubject } from '@/services/telemetry/reviewSubject';

vi.mock('@/lib/supabaseClient');

const invoke = vi.fn();
const SUBJECT = { subject_boot_id: 'boot-9', subject_journey_id: 'jrn-9', subject_attempt_id: 'att-9', subject_attempt_seq: 2 };
const OK = { data: { suggestions: { version: 'gemini_coaching_v1', what_worked: 'Clear opening.', what_to_try_next: 'State the ask first.' } }, error: null };
const transport = () => { const err = new Error('network down') as Error & { name: string }; err.name = 'FunctionsFetchError'; return { data: null, error: err }; };
const coaching = () => vi.mocked(analyticsBuffer.push).mock.calls
    .filter(([event]) => String(event).startsWith('practice_loop_review_'))
    .map(([event, props]) => ({ event: String(event), props: (props ?? {}) as Record<string, unknown> }));

describe('#1258 — the card emits paired, take-bound coaching events', () => {
    beforeEach(() => {
        invoke.mockReset();
        __resetReviewSubjectsForTests();
        vi.mocked(getSupabaseClient).mockReturnValue({ functions: { invoke } } as unknown as ReturnType<typeof getSupabaseClient>);
        vi.spyOn(analyticsBuffer, 'push');
    });
    afterEach(() => { cleanup(); vi.restoreAllMocks(); });

    it('CASUALTY: one retry inside the automatic request is ONE generation — requested and completed share a seq; invocations = 2', async () => {
        rememberReviewSubject('s-own', SUBJECT);
        invoke.mockResolvedValueOnce(transport()).mockResolvedValueOnce(OK);
        render(<AISuggestions transcript="Hello world" canReview sessionId="s-own" product="open_mic" retryBackoffMs={10} />);
        await screen.findByText('Clear opening.');
        await waitFor(() => expect(coaching().map((e) => e.event)).toContain('practice_loop_review_persisted'));

        const requested = coaching().filter((e) => e.event === 'practice_loop_review_requested');
        const completed = coaching().find((e) => e.event === 'practice_loop_review_completed')!;
        expect(requested).toHaveLength(1);
        expect(requested[0].props).toMatchObject({ ...SUBJECT, product: 'open_mic' });
        expect(completed.props).toMatchObject({ ...SUBJECT, product: 'open_mic', invocations: 2, review_request_seq: requested[0].props.review_request_seq });
        expect(invoke).toHaveBeenCalledTimes(2);
        for (const { props } of coaching()) expect(JSON.stringify(props)).not.toContain('s-own');
    });

    it('a stored pair on the session renders as `stored` and requests nothing', async () => {
        rememberReviewSubject('s-stored', SUBJECT);
        const stored = { version: 'gemini_coaching_v1' as const, what_worked: 'Kept a steady pace.', what_to_try_next: 'Pause before the close.' };
        // The rendered receipt waits for the card to intersect the viewport; reveal it the way the suite's
        // existing receipt tests do.
        let reveal: IntersectionObserverCallback = () => undefined;
        vi.stubGlobal('IntersectionObserver', vi.fn((callback: IntersectionObserverCallback) => {
            reveal = callback;
            return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(), takeRecords: vi.fn(() => []) } as unknown as IntersectionObserver;
        }));
        render(<AISuggestions transcript="Hello world" canReview sessionId="s-stored" product="open_mic" initialSuggestions={stored} />);
        await screen.findByText('Kept a steady pace.');
        reveal([{ target: screen.getByTestId('ai-suggestions-card'), isIntersecting: true, intersectionRatio: 1 } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
        await waitFor(() => expect(coaching().map((e) => e.event)).toContain('practice_loop_review_rendered'));
        const rendered = coaching().find((e) => e.event === 'practice_loop_review_rendered')!;
        expect(rendered.props).toMatchObject({ ...SUBJECT, review_source: 'stored' });
        expect(rendered.props).not.toHaveProperty('review_request_seq');
        expect(invoke).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });
});
