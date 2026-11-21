/**
 * #1835 — coaching follows the owner's own recorded privacy choice (PO-approved policy, 17 Nov; Sam's UI contract).
 *
 *   - unknown, loading, unreadable or declined: no coaching request is made, automatic or Retry;
 *   - a turn-off while a review is in flight drops the late result instead of showing it;
 *   - the server's consent_required (403) / consent_unavailable (503) answers show their own copy, never a retry;
 *   - History: an existing user who opens a legacy saved transcript BEFORE visiting Practice (no recorded choice) can
 *     still read it, but gets no Try again and no provider request.
 */
import React from 'react';
import { render, screen, cleanup, waitFor, act, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PracticeSession } from '@/types/session';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { savePracticePrivacy, usePracticePrivacyStore } from '@/services/practicePrivacy';
import { grantPracticePrivacy, resetPracticePrivacyForTests, TEST_PRIVACY_OWNER } from '../../../../tests/test-utils/practicePrivacy';

vi.mock('@/lib/supabaseClient');
vi.mock('@/components/analytics/SavedPracticeLoopReview', () => ({
    SavedPracticeLoopReview: ({ sessionId, noneFallback }: {
        sessionId: string;
        noneFallback?: (ctx: { action: React.ReactNode; product: 'open_mic'; retryReady: boolean }) => React.ReactNode;
    }) => <section data-testid="saved-review" data-session={sessionId}>
        {noneFallback?.({ action: <button data-testid="saved-review-practice">Practice again?</button>, product: 'open_mic', retryReady: true })}
    </section>,
}));
vi.mock('@/components/analytics/SavedFocusPointsCoverage', () => ({ SavedFocusPointsCoverage: () => null }));

const { default: AISuggestions, COACHING_OFF_SAVE_OFF, COACHING_OFF_SAVE_ON, COACHING_STOPPED, CONSENT_REQUIRED_MESSAGE,
    CONSENT_UNAVAILABLE_MESSAGE } = await import('../AISuggestions');
const { SavedSessionReturn } = await import('../SavedSessionReturn');

const VALID = { version: 'gemini_coaching_v1' as const, what_worked: 'Clear opening.', what_to_try_next: 'Lead with the ask.' };

const client = {
    functions: { invoke: vi.fn() },
    rpc: vi.fn(),
    from: vi.fn(),
};

/** A choice row read for the signed-in owner (or none). */
function serveChoiceRow(row: Record<string, unknown> | null) {
    client.from.mockReturnValue({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
    });
}

function setPrivacy(state: Partial<ReturnType<typeof usePracticePrivacyStore.getState>>) {
    resetPracticePrivacyForTests();
    usePracticePrivacyStore.setState({ ownerId: TEST_PRIVACY_OWNER, status: 'unknown', transcriptSave: false, aiCoaching: false, revision: null, ...state });
}

function httpError(status: number, code: string) {
    const response = new Response(JSON.stringify({ error: code, code }), { status, headers: { 'Content-Type': 'application/json' } });
    const error = Object.assign(new Error(`Edge Function returned a non-2xx status code`), { name: 'FunctionsHttpError', context: response });
    return { data: null, error };
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

beforeEach(() => {
    vi.clearAllMocks();
    client.functions.invoke.mockReset();
    client.rpc.mockReset();
    client.from.mockReset();
    vi.mocked(getSupabaseClient).mockReturnValue(client as unknown as ReturnType<typeof getSupabaseClient>);
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    vi.stubGlobal('IntersectionObserver', vi.fn(() => ({ root: null, rootMargin: '0px', thresholds: [0.01], observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(), takeRecords: vi.fn(() => []) })));
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetPracticePrivacyForTests();
});

describe('#1835 AISuggestions: no coaching request without the owner\'s recorded yes', () => {
    it.each([
        ['unknown (never asked)', { status: 'unknown' as const }, 'save_off', COACHING_OFF_SAVE_OFF],
        ['unavailable (row unreadable)', { status: 'unavailable' as const }, 'save_off', COACHING_OFF_SAVE_OFF],
        ['declined: save off', { status: 'chosen' as const, transcriptSave: false, aiCoaching: false, revision: 2 }, 'save_off', COACHING_OFF_SAVE_OFF],
        ['declined: save on, AI off', { status: 'chosen' as const, transcriptSave: true, aiCoaching: false, revision: 2 }, 'ai_off', COACHING_OFF_SAVE_ON],
    ])('%s → no request, the coaching-off band with its privacy link', async (_label, state, variant, copy) => {
        setPrivacy(state);
        client.functions.invoke.mockResolvedValue({ data: { suggestions: VALID }, error: null });
        render(<AISuggestions canReview sessionId="s-off" product="open_mic" />);
        await flush();
        expect(client.functions.invoke).not.toHaveBeenCalled();
        const band = screen.getByTestId('ai-suggestions-coaching-off');
        expect([band.getAttribute('data-coaching-off'), band.textContent?.includes(copy)]).toEqual([variant, true]);
        expect(screen.getByTestId('ai-suggestions-privacy-link')).toHaveAttribute('href', '/account#privacy-data');
        // No disclosure that the transcript is sent, and no retry control: nothing is going to be sent.
        expect(screen.queryByTestId('ai-suggestions-disclosure')).toBeNull();
        expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    });

    it('loading → nothing is requested until THIS owner\'s choice is read; a yes then requests exactly once', async () => {
        setPrivacy({ status: 'loading' });
        client.functions.invoke.mockResolvedValue({ data: { suggestions: VALID }, error: null });
        render(<AISuggestions canReview sessionId="s-load" product="open_mic" />);
        await flush();
        expect(client.functions.invoke).not.toHaveBeenCalled();
        expect(screen.queryByTestId('ai-suggestions-coaching-off')).toBeNull();

        act(() => { usePracticePrivacyStore.setState({ status: 'chosen', transcriptSave: true, aiCoaching: true, revision: 1 }); });
        await waitFor(() => expect(client.functions.invoke).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByText('Clear opening.')).toBeInTheDocument());
    });

    it('a recorded yes → one request, and the review shows (control)', async () => {
        grantPracticePrivacy();
        client.functions.invoke.mockResolvedValue({ data: { suggestions: VALID }, error: null });
        render(<AISuggestions canReview sessionId="s-on" product="open_mic" />);
        await waitFor(() => expect(screen.getByText('Clear opening.')).toBeInTheDocument());
        expect(client.functions.invoke).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('ai-suggestions-coaching-off')).toBeNull();
    });

    it('turning AI coaching off while the review is in flight drops the late result; it is never shown', async () => {
        grantPracticePrivacy();
        let settle: (value: unknown) => void = () => {};
        client.functions.invoke.mockImplementation(() => new Promise((resolve) => { settle = resolve; }));
        // The server records the turn-off; until it answers the client has already refused new work.
        client.rpc.mockImplementation(() => new Promise(() => { /* in flight */ }));
        render(<AISuggestions canReview sessionId="s-late" product="open_mic" />);
        await waitFor(() => expect(client.functions.invoke).toHaveBeenCalledTimes(1));

        act(() => { void savePracticePrivacy(true, false); });
        expect(usePracticePrivacyStore.getState()).toMatchObject({ aiCoaching: false, revision: null });
        await waitFor(() => expect(screen.getByTestId('ai-suggestions-coaching-off')).toHaveAttribute('data-coaching-off', 'stopped'));
        expect(screen.getByTestId('ai-suggestions-coaching-off')).toHaveTextContent(COACHING_STOPPED);

        await act(async () => { settle({ data: { suggestions: VALID }, error: null }); });
        await flush();
        expect(screen.queryByText('Clear opening.')).toBeNull();
        expect(screen.getByTestId('ai-suggestions-coaching-off')).toHaveAttribute('data-coaching-off', 'stopped');
        expect(client.functions.invoke).toHaveBeenCalledTimes(1);
    });

    it('re-recording the choice (new revision) also drops a review requested under the old one', async () => {
        grantPracticePrivacy({ revision: 3 });
        let settle: (value: unknown) => void = () => {};
        client.functions.invoke.mockImplementation(() => new Promise((resolve) => { settle = resolve; }));
        render(<AISuggestions canReview sessionId="s-rev" product="open_mic" />);
        await waitFor(() => expect(client.functions.invoke).toHaveBeenCalledTimes(1));
        act(() => { usePracticePrivacyStore.setState({ revision: 4 }); });
        await act(async () => { settle({ data: { suggestions: VALID }, error: null }); });
        await flush();
        expect(screen.queryByText('Clear opening.')).toBeNull();
    });

    it.each([
        [403, 'consent_required', CONSENT_REQUIRED_MESSAGE],
        [503, 'consent_unavailable', CONSENT_UNAVAILABLE_MESSAGE],
    ])('server answers %s %s → its own message, no automatic retry', async (status, code, message) => {
        grantPracticePrivacy();
        serveChoiceRow({ transcript_save: true, ai_coaching: true, consent_version: 1, choice_revision: 1 });
        client.functions.invoke.mockResolvedValue(httpError(status, code));
        render(<AISuggestions canReview sessionId={`s-${code}`} product="open_mic" retryBackoffMs={1} />);
        await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
        await flush();
        expect(client.functions.invoke).toHaveBeenCalledTimes(1);
    });

    it('a refusal decoded after switching owners cannot refresh or replace the new owner', async () => {
        const nextOwner = 'replacement-owner';
        grantPracticePrivacy({ revision: 1 });
        serveChoiceRow(null);
        let finishDecode: (body: unknown) => void = () => {};
        const closedBody = vi.fn(() => new Promise((resolve) => { finishDecode = resolve; }));
        const { error } = httpError(403, 'consent_required');
        // The diagnostics read is different from the refusal decode. Let the latter START before switching owners.
        vi.spyOn(error.context, 'clone')
            .mockReturnValueOnce({ json: async () => ({}) } as Response)
            .mockReturnValueOnce({ json: closedBody } as unknown as Response);
        client.functions.invoke.mockResolvedValue({ data: null, error });
        render(<AISuggestions canReview sessionId="s-replaced-owner" product="open_mic" />);
        await waitFor(() => expect(closedBody).toHaveBeenCalledTimes(1));

        // Keep the same card mounted to rule out relying on a session/key change.
        act(() => {
            usePracticePrivacyStore.setState({
                ownerId: nextOwner, status: 'chosen', revision: 5, transcriptSave: true, aiCoaching: true,
            });
        });
        const nextPrivacy = usePracticePrivacyStore.getState();
        await act(async () => { finishDecode({ code: 'consent_required' }); });
        await flush();

        expect(client.from).not.toHaveBeenCalled();
        expect(usePracticePrivacyStore.getState()).toEqual(nextPrivacy);
        expect(client.functions.invoke).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(CONSENT_REQUIRED_MESSAGE)).toBeNull();
    });

    it('a current consent refusal stops the request immediately and re-reads the owner’s choice', async () => {
        grantPracticePrivacy();
        let finishRefresh: (value: { data: null; error: null }) => void = () => {};
        const eq = vi.fn(() => ({
            maybeSingle: () => new Promise((resolve) => { finishRefresh = resolve; }),
        }));
        client.from.mockReturnValue({ select: () => ({ eq }) });
        client.functions.invoke.mockResolvedValue(httpError(403, 'consent_required'));
        render(<AISuggestions canReview sessionId="s-reread" product="open_mic" retryBackoffMs={1} />);
        await waitFor(() => expect(screen.getByText(CONSENT_REQUIRED_MESSAGE)).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
        expect(client.functions.invoke).toHaveBeenCalledTimes(1);
        expect(client.from).toHaveBeenCalledExactlyOnceWith('practice_privacy_choices');
        expect(eq).toHaveBeenCalledExactlyOnceWith('user_id', TEST_PRIVACY_OWNER);

        await act(async () => { finishRefresh({ data: null, error: null }); });
        await waitFor(() => expect(usePracticePrivacyStore.getState()).toMatchObject({
            ownerId: TEST_PRIVACY_OWNER, status: 'unknown', aiCoaching: false,
        }));
    });

});

describe('#1835 History: a legacy saved transcript opened before visiting Practice', () => {
    const legacy = (): PracticeSession => ({
        id: 'a1b2c3d4-0000-4000-8000-000000001835', user_id: TEST_PRIVACY_OWNER, created_at: '2026-10-07T18:12:00Z', duration: 95,
        total_words: 190, wpm: 120, filler_counts: { um: 2 }, transcript_state: 'available', transcript: 'My legacy saved words.',
        product: 'open_mic',
    } as PracticeSession);

    it.each([
        ['unknown (never asked)', { status: 'unknown' as const }, COACHING_OFF_SAVE_OFF],
        ['declined: save off', { status: 'chosen' as const, transcriptSave: false, aiCoaching: false, revision: 1 }, COACHING_OFF_SAVE_OFF],
        ['declined: save on, AI off', { status: 'chosen' as const, transcriptSave: true, aiCoaching: false, revision: 1 }, COACHING_OFF_SAVE_ON],
    ])('%s → the saved data stays readable; no Try again and no provider request', async (_label, state, copy) => {
        setPrivacy(state);
        render(<SavedSessionReturn session={legacy()} onSeeAllSessions={() => {}} />);
        await flush();
        expect(screen.getByTestId('review-transcript')).toHaveTextContent('My legacy saved words.');
        expect(screen.getByText(/190 words/)).toBeInTheDocument();
        expect(screen.getByTestId('saved-review-practice')).toBeInTheDocument();
        const band = screen.getByTestId('restored-review-retry');
        expect(band.getAttribute('data-retry')).toBe('coaching_off');
        expect(screen.getByTestId('restored-review-coaching-off')).toHaveTextContent(copy);
        expect(screen.getByTestId('restored-review-privacy-link')).toHaveAttribute('href', '/account#privacy-data');
        expect(screen.queryByTestId('restored-review-retry-button')).toBeNull();
        expect(screen.queryByTestId('ai-suggestions-card')).toBeNull();
        expect(client.functions.invoke).not.toHaveBeenCalled();
        // Nothing about the past data was changed to show this.
        expect(client.rpc).not.toHaveBeenCalled();
    });

    it('while the choice is still loading → readable, no Try again, no request', async () => {
        setPrivacy({ status: 'loading' });
        render(<SavedSessionReturn session={legacy()} onSeeAllSessions={() => {}} />);
        await flush();
        expect(screen.getByTestId('review-transcript')).toHaveTextContent('My legacy saved words.');
        expect(screen.getByTestId('restored-review-retry')).toHaveAttribute('data-retry', 'checking');
        expect(screen.queryByTestId('restored-review-retry-button')).toBeNull();
        expect(client.functions.invoke).not.toHaveBeenCalled();
    });

    it('a recorded yes → Try again is offered and one request is made only on the press (control)', async () => {
        grantPracticePrivacy();
        client.functions.invoke.mockResolvedValue({ data: { suggestions: VALID }, error: null });
        render(<SavedSessionReturn session={legacy()} onSeeAllSessions={() => {}} />);
        await flush();
        expect(client.functions.invoke).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('restored-review-retry-button'));
        await waitFor(() => expect(client.functions.invoke).toHaveBeenCalledTimes(1));
    });
});
