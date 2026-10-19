/**
 * #1593 (PO via Sam, case-1 diagnosis) — THE COACHING REQUEST LIFECYCLE IS OBSERVABLE.
 *
 * Live run 39136771332: the server logged three successful generations, but nothing in PostHog could say which request
 * the user's screen was waiting on, whether its answer arrived, or why the second take's review was never shown. Each
 * request now reports content-free `ai_coaching_lifecycle` stages under its own diagnostic ids and ORIGIN (the journey,
 * boot and recording attempt captured at request start), plus exactly one terminal `ended` with a closed reason.
 */
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '../../../../tests/support/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AISuggestions from '@/components/session/AISuggestions';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { __resetPracticeLoopTelemetryForTests } from '@/services/telemetry/practiceLoopTelemetry';
import { __resetJourneyIdentityForTests, beginJourney, beginRecordingAttempt } from '@/services/telemetry/journeyIdentity';
import { __resetCompletionStagesForTests } from '@/services/telemetry/completionStages';
import { projectEventProps } from '@/services/telemetryAllowlist';

vi.mock('@/lib/supabaseClient');

const invoke = vi.fn();
const VALID_A = { version: 'gemini_coaching_v1' as const, what_worked: 'Take A worked.', what_to_try_next: 'Take A next.' };
const VALID_B = { version: 'gemini_coaching_v1' as const, what_worked: 'Take B worked.', what_to_try_next: 'Take B next.' };

type Lifecycle = Record<string, unknown> & { stage: string };
let pushSpy: ReturnType<typeof vi.spyOn>;
let intersectionCallback: IntersectionObserverCallback | null;

const lifecycle = (): Lifecycle[] => pushSpy.mock.calls
    .filter((c) => c[0] === 'ai_coaching_lifecycle')
    .map((c) => c[1] as Lifecycle);
const forRequest = (id: unknown) => lifecycle().filter((e) => e.diagnostic_request_id === id);
const stagesOf = (id: unknown) => forRequest(id).map((e) => (e.stage === 'ended' ? `ended:${String(e.end_reason)}` : e.stage));
const requestIds = () => [...new Set(lifecycle().map((e) => e.diagnostic_request_id))];
const reveal = () => {
    const card = screen.getByTestId('ai-suggestions-card');
    act(() => intersectionCallback?.([{ target: card, isIntersecting: true, intersectionRatio: 1 } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
};
const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
};

/**
 * #1593 — a ROUTE EXIT leaves the page the review was mounted on; an unmount alone (a new take on /session) is not one.
 * The global test setup replaces `window.location` with a plain writable object, so the path is set directly.
 */
const setPath = (pathname: string) => { (window.location as unknown as { pathname: string }).pathname = pathname; };
const exitRoute = (view: { unmount: () => void }) => {
    setPath('/analytics');
    view.unmount();
};

beforeEach(() => {
    setPath('/session');
    vi.clearAllMocks();
    invoke.mockReset();
    vi.mocked(getSupabaseClient).mockReturnValue({ functions: { invoke } } as unknown as ReturnType<typeof getSupabaseClient>);
    __resetPracticeLoopTelemetryForTests();
    __resetJourneyIdentityForTests();
    __resetCompletionStagesForTests();
    beginJourney();
    pushSpy = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
    intersectionCallback = null;
    vi.stubGlobal('IntersectionObserver', vi.fn((callback: IntersectionObserverCallback) => {
        intersectionCallback = callback;
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(), takeRecords: vi.fn(() => []) } as unknown as IntersectionObserver;
    }));
});

afterEach(async () => {
    cleanup();
    vi.useRealTimers();
    // The unmount above ends any open lifecycle one tick later (by design); let it land here, not in the next case.
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.unstubAllGlobals();
});

describe('ai_coaching_lifecycle — one observable chain per request (#1593)', () => {
    it('THE CASE-1 RACE: take A requests, B starts, A returns late — A keeps its own origin and ends superseded with no render claim; B shows its complete chain exactly once', async () => {
        const answerA = deferred<unknown>();
        const attemptA = beginRecordingAttempt();
        invoke.mockImplementationOnce(() => answerA.promise);
        const view = render(<AISuggestions transcript="take a" canReview sessionId="take-a" />);
        await waitFor(() => expect(lifecycle().some((e) => e.stage === 'requested')).toBe(true));
        const [idA] = requestIds();

        // The user immediately starts take B: a new recording attempt, a new session, a new request.
        const attemptB = beginRecordingAttempt();
        invoke.mockResolvedValueOnce({ data: { suggestions: VALID_B }, error: null });
        view.rerender(<AISuggestions transcript="take b" canReview sessionId="take-b" />);
        await waitFor(() => expect(requestIds()).toHaveLength(2));
        const idB = requestIds().find((id) => id !== idA);

        // A's lifecycle ends AT ONCE on the session change — not when its late answer arrives.
        await waitFor(() => expect(stagesOf(idA)).toContain('ended:superseded_session'));
        await screen.findByText('Take B next.');
        reveal();

        // A answers late (the server did succeed). It is reported as received, under A's origin, and never rendered.
        await act(async () => { answerA.resolve({ data: { suggestions: VALID_A }, error: null }); await Promise.resolve(); });
        await waitFor(() => expect(stagesOf(idA)).toContain('response_received'));
        expect(screen.queryByText('Take A next.')).toBeNull();

        expect(stagesOf(idA)).not.toContain('ready');
        expect(stagesOf(idA)).not.toContain('rendered');
        expect(stagesOf(idA).filter((s) => s.startsWith('ended:'))).toEqual(['ended:superseded_session']);
        for (const e of forRequest(idA)) expect(e.origin_attempt_id).toBe(attemptA);

        expect(stagesOf(idB)).toEqual(['requested', 'response_received', 'response_parsed', 'persisted', 'ready', 'rendered', 'ended:completed']);
        for (const e of forRequest(idB)) expect(e.origin_attempt_id).toBe(attemptB);
        expect(forRequest(idB).find((e) => e.stage === 'response_parsed')?.parse_valid).toBe(true);
    });

    it('a NEVER-SETTLING invoke ends `timeout` at the client allowance (no abort), exactly once', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        invoke.mockImplementation(() => new Promise(() => { /* never settles */ }));
        render(<AISuggestions transcript="hello" canReview sessionId="s-hang" />);
        await waitFor(() => expect(lifecycle().some((e) => e.stage === 'requested')).toBe(true));
        const [id] = requestIds();
        await act(async () => { vi.advanceTimersByTime(59_000); });
        expect(stagesOf(id)).toEqual(['requested']);
        await act(async () => { vi.advanceTimersByTime(2_000); });
        expect(stagesOf(id)).toEqual(['requested', 'ended:timeout']);
        await act(async () => { vi.advanceTimersByTime(120_000); });
        expect(stagesOf(id).filter((s) => s.startsWith('ended:'))).toHaveLength(1);
    });

    it('a MALFORMED response is received, parsed invalid and ends `invalid_response` — no ready or rendered claim', async () => {
        invoke.mockResolvedValue({ data: { suggestions: { version: 'gemini_coaching_v1', what_worked: '' } }, error: null });
        render(<AISuggestions transcript="hello" canReview sessionId="s-bad" retryBackoffMs={5} />);
        await waitFor(() => expect(lifecycle().some((e) => e.stage === 'ended')).toBe(true));
        const [id] = requestIds();
        expect(stagesOf(id)).toEqual(['requested', 'response_received', 'response_parsed', 'ended:invalid_response']);
        expect(forRequest(id).find((e) => e.stage === 'response_parsed')?.parse_valid).toBe(false);
    });

    it('UNMOUNT while in flight ends `unmounted` immediately (a local abandonment), and a late answer adds no second end', async () => {
        const answer = deferred<unknown>();
        invoke.mockImplementationOnce(() => answer.promise);
        const view = render(<AISuggestions transcript="hello" canReview sessionId="s-leave" />);
        await waitFor(() => expect(lifecycle().some((e) => e.stage === 'requested')).toBe(true));
        const [id] = requestIds();
        exitRoute(view);
        await waitFor(() => expect(stagesOf(id)).toContain('ended:unmounted'));
        await act(async () => { answer.resolve({ data: { suggestions: VALID_A }, error: null }); await Promise.resolve(); });
        await waitFor(() => expect(stagesOf(id)).toContain('response_received'));
        expect(stagesOf(id).filter((s) => s.startsWith('ended:'))).toEqual(['ended:unmounted']);
        expect(stagesOf(id)).not.toContain('persisted');
    });

    it('UNMOUNT during a scheduled automatic retry ends `unmounted` and the retry never fires', async () => {
        invoke.mockResolvedValueOnce({ data: null, error: { name: 'FunctionsFetchError', message: 'network' } });
        const view = render(<AISuggestions transcript="hello" canReview sessionId="s-retry" retryBackoffMs={50} />);
        await waitFor(() => expect(screen.getByTestId('ai-suggestions-card')).toHaveAttribute('data-retry-scheduled', 'true'));
        const [id] = requestIds();
        exitRoute(view);
        await waitFor(() => expect(stagesOf(id)).toContain('ended:unmounted'));
        await new Promise((r) => setTimeout(r, 120));
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(stagesOf(id).filter((s) => s.startsWith('ended:'))).toEqual(['ended:unmounted']);
    });

    it('a SESSION CHANGE during a scheduled retry ends the old lifecycle `superseded_session` (never retry_cancelled), once', async () => {
        invoke.mockResolvedValueOnce({ data: null, error: { name: 'FunctionsFetchError', message: 'network' } });
        const view = render(<AISuggestions transcript="hello" canReview sessionId="s-old" retryBackoffMs={60_000} />);
        await waitFor(() => expect(screen.getByTestId('ai-suggestions-card')).toHaveAttribute('data-retry-scheduled', 'true'));
        const [oldId] = requestIds();
        invoke.mockResolvedValueOnce({ data: { suggestions: VALID_B }, error: null });
        view.rerender(<AISuggestions transcript="next" canReview sessionId="s-new" retryBackoffMs={60_000} />);
        await screen.findByText('Take B next.');
        expect(stagesOf(oldId).filter((s) => s.startsWith('ended:'))).toEqual(['ended:superseded_session']);
    });

    it('a SESSION CHANGE to a session that makes no request still ends the in-flight lifecycle at once', async () => {
        invoke.mockImplementationOnce(() => new Promise(() => { /* still in flight */ }));
        const view = render(<AISuggestions transcript="hello" canReview sessionId="s-first" />);
        await waitFor(() => expect(lifecycle().some((e) => e.stage === 'requested')).toBe(true));
        const [id] = requestIds();
        // The next session is not reviewable yet, so nothing new is requested — the old request must still be closed.
        view.rerender(<AISuggestions transcript="" canReview={false} sessionId="s-second" />);
        await waitFor(() => expect(stagesOf(id)).toContain('ended:superseded_session'));
        expect(requestIds()).toEqual([id]);
    });

    it('ROUTE EXIT (PO 15:29) aborts the in-flight invoke — `ended: unmounted` with client_aborted — and starts nothing new', async () => {
        let signal: AbortSignal | undefined;
        invoke.mockImplementationOnce((_name: string, options: { signal?: AbortSignal }) => {
            signal = options.signal;
            return new Promise(() => { /* the server may still be working */ });
        });
        const view = render(<AISuggestions transcript="hello" canReview sessionId="s-route" />);
        await waitFor(() => expect(signal).toBeDefined());
        const [id] = requestIds();
        expect(signal!.aborted).toBe(false);
        exitRoute(view);
        await waitFor(() => expect(signal!.aborted).toBe(true));
        const ended = forRequest(id).filter((e) => e.stage === 'ended');
        expect(ended.map((e) => [e.end_reason, e.client_aborted])).toEqual([['unmounted', true]]);
        await new Promise((r) => setTimeout(r, 30));
        expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('Codex r4307758219: ROUTE EXIT after the watchdog reported `timeout` still aborts the hung invoke (one end only)', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        let signal: AbortSignal | undefined;
        invoke.mockImplementationOnce((_name: string, options: { signal?: AbortSignal }) => {
            signal = options.signal;
            return new Promise(() => { /* hung */ });
        });
        const view = render(<AISuggestions transcript="hello" canReview sessionId="s-hung-exit" />);
        await waitFor(() => expect(signal).toBeDefined());
        const [id] = requestIds();
        await act(async () => { vi.advanceTimersByTime(61_000); });
        expect(stagesOf(id)).toEqual(['requested', 'ended:timeout']);
        exitRoute(view);
        await act(async () => { vi.advanceTimersByTime(10); });
        expect(signal!.aborted).toBe(true);
        expect(stagesOf(id).filter((s) => s.startsWith('ended:'))).toEqual(['ended:timeout']);
        expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('ROUTE EXIT during a retry wait cancels the retry; nothing was in flight, so nothing is reported aborted', async () => {
        invoke.mockResolvedValueOnce({ data: null, error: { name: 'FunctionsFetchError', message: 'network' } });
        const view = render(<AISuggestions transcript="hello" canReview sessionId="s-route-retry" retryBackoffMs={40} />);
        await waitFor(() => expect(screen.getByTestId('ai-suggestions-card')).toHaveAttribute('data-retry-scheduled', 'true'));
        const [id] = requestIds();
        exitRoute(view);
        await new Promise((r) => setTimeout(r, 100));
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(forRequest(id).filter((e) => e.stage === 'ended').map((e) => [e.end_reason, e.client_aborted])).toEqual([['unmounted', false]]);
    });

    it('RAPID REPEAT is not weakened: a session change never aborts take A — its request is left to finish server-side', async () => {
        let signalA: AbortSignal | undefined;
        const answerA = deferred<unknown>();
        invoke.mockImplementationOnce((_name: string, options: { signal?: AbortSignal }) => { signalA = options.signal; return answerA.promise; });
        const view = render(<AISuggestions transcript="take a" canReview sessionId="take-a" />);
        await waitFor(() => expect(signalA).toBeDefined());
        invoke.mockResolvedValueOnce({ data: { suggestions: VALID_B }, error: null });
        view.rerender(<AISuggestions transcript="take b" canReview sessionId="take-b" />);
        await screen.findByText('Take B next.');
        await new Promise((r) => setTimeout(r, 10));
        expect(signalA!.aborted).toBe(false);
        await act(async () => { answerA.resolve({ data: { suggestions: VALID_A }, error: null }); await Promise.resolve(); });
        expect(screen.queryByText('Take A next.')).toBeNull();
    });

    it('STRICTMODE replay never aborts the automatic request', async () => {
        let signal: AbortSignal | undefined;
        invoke.mockImplementationOnce((_name: string, options: { signal?: AbortSignal }) => {
            signal = options.signal;
            return Promise.resolve({ data: { suggestions: VALID_A }, error: null });
        });
        render(<React.StrictMode><AISuggestions transcript="hello" canReview sessionId="s-strict-abort" /></React.StrictMode>);
        await screen.findByText('Take A next.');
        await new Promise((r) => setTimeout(r, 10));
        expect(signal?.aborted).toBe(false);
        expect(lifecycle().some((e) => e.end_reason === 'unmounted')).toBe(false);
    });

    it('Sam #1657: a TRANSPORT failure (FunctionsFetchError, no response) is `transport_failed`, never `response_received` — retry semantics kept', async () => {
        invoke
            .mockResolvedValueOnce({ data: null, error: { name: 'FunctionsFetchError', message: 'network' } })
            .mockResolvedValueOnce({ data: null, error: { name: 'FunctionsFetchError', message: 'network' } });
        render(<AISuggestions transcript="hello" canReview sessionId="s-transport" retryBackoffMs={5} />);
        await waitFor(() => expect(lifecycle().some((e) => e.stage === 'ended')).toBe(true));
        const [id] = requestIds();
        expect(stagesOf(id)).toEqual(['requested', 'transport_failed', 'requested', 'transport_failed', 'ended:failed']);
        expect(invoke).toHaveBeenCalledTimes(2);
    });

    it('CONTROL: an HTTP ERROR response (FunctionsHttpError) WAS received — `response_received`, then the failure', async () => {
        const httpError = { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status: 503, clone() { return this; }, json: async () => ({}) } };
        invoke.mockResolvedValue({ data: null, error: httpError });
        render(<AISuggestions transcript="hello" canReview sessionId="s-http" retryBackoffMs={5} />);
        await waitFor(() => expect(lifecycle().some((e) => e.stage === 'ended')).toBe(true));
        const [id] = requestIds();
        expect(stagesOf(id).filter((s) => s === 'response_received').length).toBeGreaterThanOrEqual(1);
        expect(stagesOf(id)).not.toContain('transport_failed');
    });

    it('Sam #1657: a rapid repeat then route exit aborts only the CURRENT request — superseded A settles with no abort claim', async () => {
        let signalA: AbortSignal | undefined;
        let signalB: AbortSignal | undefined;
        invoke.mockImplementationOnce((_n: string, o: { signal?: AbortSignal }) => { signalA = o.signal; return new Promise(() => {}); });
        const view = render(<AISuggestions transcript="take a" canReview sessionId="take-a" />);
        await waitFor(() => expect(signalA).toBeDefined());
        const [idA] = requestIds();
        invoke.mockImplementationOnce((_n: string, o: { signal?: AbortSignal }) => { signalB = o.signal; return new Promise(() => {}); });
        view.rerender(<AISuggestions transcript="take b" canReview sessionId="take-b" />);
        await waitFor(() => expect(signalB).toBeDefined());
        const idB = requestIds().find((id) => id !== idA);
        exitRoute(view);
        await waitFor(() => expect(signalB!.aborted).toBe(true));
        expect(signalA!.aborted).toBe(false);
        expect(forRequest(idA).filter((e) => e.stage === 'ended').map((e) => [e.end_reason, e.client_aborted])).toEqual([['superseded_session', undefined]]);
        expect(forRequest(idB).filter((e) => e.stage === 'ended').map((e) => [e.end_reason, e.client_aborted])).toEqual([['unmounted', true]]);
    });

    it('BELOW THE FOLD: ready is reported when the review is available; rendered only when the card is seen', async () => {
        invoke.mockResolvedValue({ data: { suggestions: VALID_A }, error: null });
        render(<AISuggestions transcript="hello" canReview sessionId="s-fold" />);
        await screen.findByText('Take A next.');
        const [id] = requestIds();
        await waitFor(() => expect(stagesOf(id)).toContain('ready'));
        expect(stagesOf(id)).not.toContain('rendered');
        reveal();
        expect(stagesOf(id).slice(-2)).toEqual(['rendered', 'ended:completed']);
        reveal(); // the observer firing again adds nothing
        expect(stagesOf(id).filter((s) => s === 'rendered')).toHaveLength(1);
    });

    it('STRICTMODE replay (setup → cleanup → setup) reports no false end; the chain completes once', async () => {
        invoke.mockResolvedValue({ data: { suggestions: VALID_A }, error: null });
        render(<React.StrictMode><AISuggestions transcript="hello" canReview sessionId="s-strict" /></React.StrictMode>);
        await screen.findByText('Take A next.');
        reveal();
        await waitFor(() => expect(lifecycle().some((e) => e.end_reason === 'completed')).toBe(true));
        const ends = lifecycle().filter((e) => e.stage === 'ended');
        expect(ends.map((e) => e.end_reason)).toEqual(['completed']);
    });

    it('every lifecycle event survives the governed allowlist intact and carries no session id or coaching text', async () => {
        invoke.mockResolvedValue({ data: { suggestions: VALID_A }, error: null });
        render(<AISuggestions transcript="secret transcript words" canReview sessionId="11111111-1111-4111-8111-111111111111" />);
        await screen.findByText('Take A next.');
        reveal();
        await waitFor(() => expect(lifecycle().some((e) => e.end_reason === 'completed')).toBe(true));
        for (const event of lifecycle()) {
            const { props, dropped } = projectEventProps('ai_coaching_lifecycle', event);
            expect(dropped).toEqual([]);
            expect(Object.keys(props).sort()).toEqual(Object.keys(event).sort());
            const text = JSON.stringify(event);
            expect(text).not.toContain('11111111-1111-4111-8111-111111111111');
            expect(text).not.toContain('Take A');
            expect(text).not.toContain('secret transcript');
        }
    });
});

describe('origin fields accept the identity formats journeyIdentity actually mints (#1593, Sam #1657 review)', () => {
    it('a UUID and the no-crypto fallback `j-<base36>-<base36>` both survive the allowlist; prose and queries do not', () => {
        for (const id of ['11111111-1111-4111-8111-111111111111', 'j-lz3k9q2a-4f9xk2m1qz']) {
            const { props, dropped } = projectEventProps('ai_coaching_lifecycle', { stage: 'requested', elapsed_ms: 0, product: 'open_mic', origin_journey_id: id, origin_boot_id: id, origin_attempt_id: id });
            expect(dropped).toEqual([]);
            expect([props.origin_journey_id, props.origin_boot_id, props.origin_attempt_id]).toEqual([id, id, id]);
        }
        for (const bad of ['has space', 'x?y=1', 'a'.repeat(49)]) {
            expect(projectEventProps('ai_coaching_lifecycle', { stage: 'requested', origin_attempt_id: bad }).dropped).toContain('origin_attempt_id');
        }
    });
});

describe('#1593 (live RWT case 1, run 39166041750) — an in-page unmount is NOT a route exit', () => {
    it('Practice again replaces the review on /session: the in-flight request is NOT aborted and ends superseded_session', async () => {
        let signal: AbortSignal | undefined;
        const answer = deferred<unknown>();
        invoke.mockImplementationOnce((_name: string, options: { signal?: AbortSignal }) => { signal = options.signal; return answer.promise; });
        const view = render(<AISuggestions transcript="take a" canReview sessionId="take-a" />);
        await waitFor(() => expect(signal).toBeDefined());
        const [id] = requestIds();
        view.unmount(); // the recording state replaces the after-state review — same page
        await waitFor(() => expect(stagesOf(id)).toContain('ended:superseded_session'));
        expect(signal!.aborted, 'the accepted request is left to finish and persist').toBe(false);
        expect(forRequest(id).find((e) => e.stage === 'ended')).not.toHaveProperty('client_aborted');
        // Its answer arriving later is a transport fact only: no ready/render, no second terminal.
        await act(async () => { answer.resolve({ data: { suggestions: VALID_A }, error: null }); await Promise.resolve(); });
        await waitFor(() => expect(stagesOf(id)).toContain('response_received'));
        expect(stagesOf(id)).not.toContain('ready');
        expect(stagesOf(id).filter((s) => s.startsWith('ended:'))).toEqual(['ended:superseded_session']);
    });

    it('CONTROL: the same unmount after LEAVING the page still aborts (ended unmounted, client_aborted)', async () => {
        let signal: AbortSignal | undefined;
        invoke.mockImplementationOnce((_name: string, options: { signal?: AbortSignal }) => { signal = options.signal; return new Promise(() => {}); });
        const view = render(<AISuggestions transcript="take a" canReview sessionId="take-a" />);
        await waitFor(() => expect(signal).toBeDefined());
        const [id] = requestIds();
        exitRoute(view);
        await waitFor(() => expect(signal!.aborted).toBe(true));
        expect(forRequest(id).filter((e) => e.stage === 'ended').map((e) => [e.end_reason, e.client_aborted])).toEqual([['unmounted', true]]);
    });
});

/**
 * #1593 — Sam's RETURN on 7b76c257, from the Browser PM's executed counterexamples. The route was sampled at the deferred
 * tick, so whatever the URL did between the teardown and that tick decided the outcome. Each sequence below changes the
 * URL in exactly that window; the outcome must follow the route AT TEARDOWN.
 */
describe('#1593 RETURN — the route is read at the teardown boundary, not at the deferred tick', () => {
    it('FAIL1: exit, then an immediate return before the deferred tick — the live request is still aborted (unmounted)', async () => {
        let signal: AbortSignal | undefined;
        invoke.mockImplementationOnce((_name: string, options: { signal?: AbortSignal }) => { signal = options.signal; return new Promise(() => {}); });
        const view = render(<AISuggestions transcript="take a" canReview sessionId="take-a" />);
        await waitFor(() => expect(signal).toBeDefined());
        const [id] = requestIds();
        setPath('/analytics');
        view.unmount();
        setPath('/session'); // back before the deferred callback runs
        await waitFor(() => expect(signal!.aborted).toBe(true));
        expect(forRequest(id).filter((e) => e.stage === 'ended').map((e) => [e.end_reason, e.client_aborted])).toEqual([['unmounted', true]]);
    });

    it('FAIL2: Practice again unmounts the review on /session, then an immediate exit — the superseded take is NOT aborted', async () => {
        let signal: AbortSignal | undefined;
        const answer = deferred<unknown>();
        invoke.mockImplementationOnce((_name: string, options: { signal?: AbortSignal }) => { signal = options.signal; return answer.promise; });
        const view = render(<AISuggestions transcript="take a" canReview sessionId="take-a" />);
        await waitFor(() => expect(signal).toBeDefined());
        const [id] = requestIds();
        view.unmount(); // the recording state replaces the review — same page
        setPath('/analytics'); // the person leaves before the deferred callback runs
        await waitFor(() => expect(stagesOf(id)).toContain('ended:superseded_session'));
        expect(signal!.aborted, 'the superseded take keeps its accepted request').toBe(false);
        expect(forRequest(id).find((e) => e.stage === 'ended')).not.toHaveProperty('client_aborted');
        expect(stagesOf(id).filter((s) => s.startsWith('ended:'))).toEqual(['ended:superseded_session']);
    });

    /*
     * Browser PM settlement-order controls on 889d7b21: the answer (or error) arriving AFTER the teardown but BEFORE the
     * deferred tick ended the lifecycle `unmounted` even on a same-page repeat, and the once-only terminal kept that
     * reason. The teardown's classification now decides it, whenever the settlement lands.
     */
    const settleBeforeTick = async (outcome: 'success' | 'error', leaveFirst: boolean) => {
        const answer = deferred<unknown>();
        invoke.mockImplementationOnce(() => answer.promise);
        const view = render(<AISuggestions transcript="take a" canReview sessionId="take-a" />);
        await waitFor(() => expect(requestIds()).toHaveLength(1));
        const [id] = requestIds();
        if (leaveFirst) setPath('/analytics');
        view.unmount();
        // Settle in the microtask window: before the deferred (setTimeout 0) cleanup runs.
        answer.resolve(outcome === 'success'
            ? { data: { suggestions: VALID_A }, error: null }
            : { data: null, error: { name: 'FunctionsFetchError', message: 'network' } });
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        return stagesOf(id).filter((s) => s.startsWith('ended:'));
    };

    it('SETTLEMENT ORDER: a success before the tick on a same-page repeat ends superseded_session, once', async () => {
        expect(await settleBeforeTick('success', false)).toEqual(['ended:superseded_session']);
    });

    it('SETTLEMENT ORDER: an error before the tick on a same-page repeat ends superseded_session, once', async () => {
        expect(await settleBeforeTick('error', false)).toEqual(['ended:superseded_session']);
    });

    it('SETTLEMENT ORDER: a success before the tick after a route exit ends unmounted, once', async () => {
        expect(await settleBeforeTick('success', true)).toEqual(['ended:unmounted']);
    });

    it('SETTLEMENT ORDER: an error before the tick after a route exit ends unmounted, once', async () => {
        expect(await settleBeforeTick('error', true)).toEqual(['ended:unmounted']);
    });

    it('STRICTMODE replay still never ends or aborts the automatic request, whatever the URL does afterwards', async () => {
        let signal: AbortSignal | undefined;
        invoke.mockImplementationOnce((_name: string, options: { signal?: AbortSignal }) => { signal = options.signal; return new Promise(() => {}); });
        render(<React.StrictMode><AISuggestions transcript="take a" canReview sessionId="take-a" /></React.StrictMode>);
        await waitFor(() => expect(signal).toBeDefined());
        const [id] = requestIds();
        setPath('/analytics');
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(signal!.aborted).toBe(false);
        expect(stagesOf(id).filter((s) => s.startsWith('ended:'))).toEqual([]);
    });
});
