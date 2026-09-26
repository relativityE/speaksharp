import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SavedSessionReview } from '@/services/review/savedSessionReview';

/**
 * #1258 (PM RETURN, #1535 cycle 1, P1) — "Practice this again" must never skip a valid linked Progress repeat.
 *
 * `recommendationId === null` used to mean "no linked repeat", but it is also null while the progress query is still
 * loading and when it failed, so a fast click navigated unlinked and the Practice Loop link silently disappeared. These
 * run the REAL `useLinkedRepeat` (only its service boundaries are doubled) through the rendered action:
 *   - pending + an immediate click → no navigation, no selection, no attempt; once eligible resolves → exactly one
 *     linked attempt + handoff, then the session's own product opens;
 *   - a terminal insufficient/ineligible answer → the product opens directly;
 *   - a failed progress read → a visible error and a retry, no navigation;
 *   - a repeated click while linking → one attempt, one navigation.
 */
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
const deferred = <T,>(): Deferred<T> => {
    let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

const loadReview = vi.fn<(id: string) => Promise<SavedSessionReview>>();
vi.mock('@/services/review/savedSessionReview', () => ({ loadSavedSessionReview: (id: string) => loadReview(id) }));
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('@/contexts/AuthProvider', () => ({ useAuthProvider: () => ({ user: { id: 'user-1' } }) }));
const loadProgress = vi.fn<(id: string) => Promise<unknown>>();
vi.mock('@/services/progress/loadSessionProgress', () => ({ loadSessionProgress: (id: string) => loadProgress(id) }));
const readPending = vi.fn();
const recordAttempt = vi.fn();
const abandon = vi.fn();
vi.mock('@/services/progress/recordProgress', () => ({
    readPendingRecommendationAttempt: (id: string) => readPending(id),
    recordRecommendationAttempt: (id: string) => recordAttempt(id),
    abandonRecommendationAttempt: (id: string) => abandon(id),
}));
const setOpenAttempt = vi.fn((_attempt: unknown) => true);
vi.mock('@/services/progress/openAttempt', () => ({ setOpenAttempt: (a: unknown) => setOpenAttempt(a) }));
const practiceSelected = vi.fn();
vi.mock('@/services/reviewSurfaceTelemetry', () => ({
    trackSavedReviewRevisited: vi.fn(),
    trackSavedReviewPracticeSelected: (...args: unknown[]) => practiceSelected(...args),
}));
const setActiveObjectiveBrief = vi.fn();
vi.mock('@/stores/useSessionStore', () => ({ useSessionStore: { getState: () => ({ setActiveObjectiveBrief }) } }));

const { SavedPracticeLoopReview } = await import('../SavedPracticeLoopReview');

const FOCUS: SavedSessionReview = {
    coaching: { kind: 'review', review: { whatWorked: 'Clear opening.', whatToTryNext: 'Name the price first.' } },
    product: 'focus_points', evidence: [], focusBrief: { briefId: 'b1', projectId: 'p1', topic: 'Pitch' }, focusPoints: ['One', 'Two'],
};
const ELIGIBLE = { status: 'eligible', sessionId: 's1', recommendationId: 'rec-1' };

const renderReview = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}><SavedPracticeLoopReview sessionId="s1" /></QueryClientProvider>);
};
const action = () => screen.getByTestId('saved-review-practice') as HTMLButtonElement;
/** A click that still reaches the handler even if the control rendered disabled a frame earlier. */
const staleClick = (el: HTMLButtonElement) => { el.disabled = false; fireEvent.click(el); };

beforeEach(() => {
    vi.clearAllMocks();
    loadReview.mockResolvedValue(FOCUS);
    setOpenAttempt.mockReturnValue(true);
    readPending.mockResolvedValue({ status: 'none' });
    recordAttempt.mockResolvedValue('attempt-1');
});

describe('#1258 P1 — the saved review never skips a valid linked repeat', () => {
    it('CASUALTY: pending progress + an immediate click navigates nowhere; once eligible, ONE linked attempt/handoff then the same set opens', async () => {
        const progress = deferred<unknown>();
        loadProgress.mockReturnValue(progress.promise);
        renderReview();
        await waitFor(() => expect(screen.getByTestId('saved-review')).toHaveAttribute('data-review-state', 'review'));

        expect(action()).toBeDisabled();
        expect(action()).toHaveAttribute('data-link-state', 'pending');
        expect(action()).toHaveTextContent('Checking your next practice…');
        staleClick(action());
        expect(navigate).not.toHaveBeenCalled();
        expect(practiceSelected).not.toHaveBeenCalled();
        expect(readPending).not.toHaveBeenCalled();
        expect(recordAttempt).not.toHaveBeenCalled();

        await act(async () => { progress.resolve(ELIGIBLE); });
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
        expect(action()).toBeEnabled();
        fireEvent.click(action());
        await waitFor(() => expect(navigate).toHaveBeenCalledWith('/session'));
        expect(readPending).toHaveBeenCalledTimes(1);
        expect(recordAttempt).toHaveBeenCalledTimes(1);
        expect(recordAttempt).toHaveBeenCalledWith('rec-1');
        expect(setOpenAttempt).toHaveBeenCalledWith({ attemptId: 'attempt-1', userId: 'user-1', sourceSessionId: 's1' });
        expect(setActiveObjectiveBrief).toHaveBeenCalledWith(expect.objectContaining({ briefId: 'b1', points: ['One', 'Two'] }));
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(practiceSelected).toHaveBeenCalledWith('focus_points', true);
    });

    it.each([
        ['insufficient', { status: 'insufficient', sessionId: 's1' }],
        ['ineligible', { status: 'ineligible', sessionId: 's1', reasons: [] }],
    ])('CONTROL: a terminal %s answer opens the product directly (no attempt)', async (_label, view) => {
        loadProgress.mockResolvedValue(view);
        renderReview();
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'direct'));
        fireEvent.click(action());
        expect(navigate).toHaveBeenCalledWith('/session');
        expect(recordAttempt).not.toHaveBeenCalled();
        expect(practiceSelected).toHaveBeenCalledWith('focus_points', false);
    });

    it.each([
        ['returns an error view', () => loadProgress.mockResolvedValue({ status: 'error', sessionId: 's1', message: 'x' })],
        ['is not available yet', () => loadProgress.mockResolvedValue({ status: 'unavailable', sessionId: 's1', message: 'x' })],
        ['rejects', () => loadProgress.mockRejectedValue(new Error('offline'))],
    ])('CASUALTY: a progress read that %s shows its error and a retry — never a guessed, unlinked navigation', async (_label, arrange) => {
        arrange();
        renderReview();
        await waitFor(() => expect(screen.getByTestId('saved-review-progress-error')).toBeInTheDocument());
        expect(screen.getByTestId('saved-review-progress-error')).toHaveTextContent('couldn’t be checked');
        expect(action()).toHaveAttribute('data-link-state', 'error');
        expect(action()).toHaveTextContent('Try again');
        const calls = loadProgress.mock.calls.length;
        fireEvent.click(action());
        expect(navigate).not.toHaveBeenCalled();
        expect(practiceSelected).not.toHaveBeenCalled();
        expect(recordAttempt).not.toHaveBeenCalled();
        await waitFor(() => expect(loadProgress.mock.calls.length).toBe(calls + 1)); // the retry re-reads progress
    });

    it('CASUALTY (PM cycle 2): eligible WITHOUT a recommendation fails closed — error + retry, never a direct open', async () => {
        loadProgress.mockResolvedValue({ status: 'eligible', sessionId: 's1', recommendationId: null });
        renderReview();
        await waitFor(() => expect(screen.getByTestId('saved-review-progress-error')).toBeInTheDocument());
        expect(action()).toHaveAttribute('data-link-state', 'error');
        const calls = loadProgress.mock.calls.length;
        fireEvent.click(action()); // "Try again"
        await waitFor(() => expect(loadProgress.mock.calls.length).toBe(calls + 1)); // exactly one re-read
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(loadProgress.mock.calls.length).toBe(calls + 1);
        expect(navigate).not.toHaveBeenCalled();
        expect(practiceSelected).not.toHaveBeenCalled();
        expect(readPending).not.toHaveBeenCalled();
        expect(recordAttempt).not.toHaveBeenCalled();
        expect(setOpenAttempt).not.toHaveBeenCalled();
    });

    it('CASUALTY: a repeated click while linking starts ONE attempt and ONE navigation', async () => {
        loadProgress.mockResolvedValue(ELIGIBLE);
        const attempt = deferred<string>();
        recordAttempt.mockReturnValue(attempt.promise);
        renderReview();
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
        const el = action();
        fireEvent.click(el);
        fireEvent.click(el); // same frame: before React re-renders "Linking repeat…"
        staleClick(el);
        await act(async () => { attempt.resolve('attempt-1'); });
        await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
        expect(readPending).toHaveBeenCalledTimes(1);
        expect(recordAttempt).toHaveBeenCalledTimes(1);
        expect(setOpenAttempt).toHaveBeenCalledTimes(1);
    });
});
