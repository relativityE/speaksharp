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
// #1258 (Codex r4191751371): every practice navigation carries its press's action_seq in router state.
const PRACTICE_NAV = { state: { practiceActionSeq: expect.any(Number) } };
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
const practiceAction = vi.fn();
const practiceState = vi.fn();
const linkedAttempt = vi.fn();
vi.mock('@/services/reviewSurfaceTelemetry', () => ({
    trackSavedReviewRevisited: vi.fn(),
    trackSavedReviewPracticeSelected: (...args: unknown[]) => practiceSelected(...args),
    trackSavedReviewPracticeAction: (...args: unknown[]) => practiceAction(...args),
    trackSavedReviewPracticeState: (...args: unknown[]) => practiceState(...args),
    trackSavedReviewLinkedAttempt: (...args: unknown[]) => linkedAttempt(...args),
}));
const setActiveObjectiveBrief = vi.fn();
vi.mock('@/stores/useSessionStore', () => ({ useSessionStore: { getState: () => ({ setActiveObjectiveBrief }) } }));

const { SavedPracticeLoopReview } = await import('../SavedPracticeLoopReview');

const FOCUS: SavedSessionReview = {
    coaching: { kind: 'review', review: { whatWorked: 'Clear opening.', whatToTryNext: 'Name the price first.' } },
    product: 'focus_points', evidence: [], focusBrief: { briefId: 'b1', projectId: 'p1', topic: 'Pitch' }, focusPoints: ['One', 'Two'],
};
const ELIGIBLE = { status: 'eligible', sessionId: 's1', recommendationId: 'rec-1' };

let client: QueryClient;
const renderReview = () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
        await waitFor(() => expect(navigate).toHaveBeenCalledWith('/session', PRACTICE_NAV));
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
        expect(navigate).toHaveBeenCalledWith('/session', PRACTICE_NAV);
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

    // PM RETURN 5849471237 (#1535): a MARKED Focus take whose point set couldn't be read.
    it('CASUALTY: marked Focus + failed results read never launches practice; the retry re-reads and restores the linked repeat exactly once', async () => {
        loadReview.mockResolvedValueOnce({ ...FOCUS, evidence: [], focusBrief: null, focusPoints: [], focusReadFailed: true });
        loadProgress.mockResolvedValue(ELIGIBLE);
        renderReview();
        await waitFor(() => expect(screen.getByTestId('saved-review-focus-error')).toBeInTheDocument());
        expect(screen.getByTestId('saved-review')).toHaveAttribute('data-product', 'focus_points');
        expect(screen.getByTestId('saved-review-label')).toHaveTextContent('Focus Points');
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
        expect(action()).toHaveTextContent('Try again');
        expect(screen.getByTestId('saved-review-focus-error')).toHaveTextContent('couldn’t be loaded, so practice wasn’t started');

        fireEvent.click(action()); // "Try again": re-read, never a generic, unlinked or linked launch
        expect(navigate).not.toHaveBeenCalled();
        expect(practiceSelected).not.toHaveBeenCalled();
        expect(readPending).not.toHaveBeenCalled();
        expect(recordAttempt).not.toHaveBeenCalled();
        expect(setActiveObjectiveBrief).not.toHaveBeenCalled();
        await waitFor(() => expect(loadReview).toHaveBeenCalledTimes(2));

        // The re-read returns the saved set: the review is Focus again and the repeat runs once, on THIS set.
        await waitFor(() => expect(screen.queryByTestId('saved-review-focus-error')).not.toBeInTheDocument());
        await waitFor(() => expect(action()).toHaveTextContent('Practice this again'));
        fireEvent.click(action());
        fireEvent.click(action());
        await waitFor(() => expect(navigate).toHaveBeenCalledWith('/session', PRACTICE_NAV));
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(recordAttempt).toHaveBeenCalledTimes(1);
        expect(setActiveObjectiveBrief).toHaveBeenCalledWith(expect.objectContaining({ briefId: 'b1', points: ['One', 'Two'] }));
        expect(practiceSelected).toHaveBeenCalledWith('focus_points', true);
        expect(loadReview).toHaveBeenCalledTimes(2);
    });

    // #1535 Codex P2 r4116626850: brief-ONLY failure — the saved results stay visible, the action never launches.
    it('CASUALTY: a brief-only read failure shows the saved results, never launches practice, and a re-read restores ONE linked repeat on the same set', async () => {
        loadReview.mockResolvedValueOnce({ ...FOCUS, evidence: ['Detected: point 1 at 0:21.'], focusBrief: null, focusReadFailed: true });
        loadProgress.mockResolvedValue(ELIGIBLE);
        renderReview();
        await waitFor(() => expect(screen.getByTestId('saved-review-focus-error')).toBeInTheDocument());
        expect(screen.getByTestId('review-evidence')).toHaveTextContent('Detected: point 1 at 0:21.');
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
        fireEvent.click(action());
        expect(navigate).not.toHaveBeenCalled();
        expect(recordAttempt).not.toHaveBeenCalled();
        expect(setActiveObjectiveBrief).not.toHaveBeenCalled();
        await waitFor(() => expect(loadReview).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(action()).toHaveTextContent('Practice this again'));
        fireEvent.click(action());
        await waitFor(() => expect(navigate).toHaveBeenCalledWith('/session', PRACTICE_NAV));
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(recordAttempt).toHaveBeenCalledTimes(1);
        expect(setActiveObjectiveBrief).toHaveBeenCalledWith(expect.objectContaining({ briefId: 'b1', points: ['One', 'Two'] }));
    });

    // #1535 Codex P2 r4116741455 (PM RETURN 5859371590): the pre-#1535 ProgressPanel guard — no new take while the
    // previous linked repeat is still pending; the person closes it (Progress's Close pending repeat) first.
    it('CASUALTY: a PENDING previous repeat blocks the action — no accept, navigation or attempt; after reconciliation ONE linked repeat', async () => {
        loadProgress.mockResolvedValue({ ...ELIGIBLE, latestAttempt: { id: 'att-0', lifecycle: 'pending', outcome: null } });
        renderReview();
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'blocked'));
        expect(action()).toBeDisabled();
        expect(screen.getByTestId('saved-review-pending-attempt')).toHaveTextContent('A previous repeat is still pending');
        staleClick(action());
        expect(navigate).not.toHaveBeenCalled();
        expect(practiceSelected).not.toHaveBeenCalled();
        expect(readPending).not.toHaveBeenCalled();
        expect(recordAttempt).not.toHaveBeenCalled();
        expect(setOpenAttempt).not.toHaveBeenCalled();

        // Progress's "Close pending repeat" reconciles it and refetches the SHARED progress query.
        loadProgress.mockResolvedValue({ ...ELIGIBLE, latestAttempt: { id: 'att-0', lifecycle: 'closed', outcome: 'not_completed' } });
        await act(async () => { await client.refetchQueries({ queryKey: ['sessionProgress', 's1'] }); });
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
        expect(screen.queryByTestId('saved-review-pending-attempt')).not.toBeInTheDocument();
        fireEvent.click(action());
        fireEvent.click(action());
        await waitFor(() => expect(navigate).toHaveBeenCalledWith('/session', PRACTICE_NAV));
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(recordAttempt).toHaveBeenCalledTimes(1);
        expect(setOpenAttempt).toHaveBeenCalledTimes(1);
    });

    // #1535 Codex P2 r4116859975: a failed REVIEW read with a terminal progress answer must retry, never open /practice.
    it('CASUALTY: a failed review read + a direct progress answer re-reads instead of opening the generic chooser; the re-read restores the same set', async () => {
        loadReview.mockResolvedValueOnce({ coaching: { kind: 'error' }, product: 'unknown', evidence: [], focusBrief: null, focusPoints: [], reviewReadFailed: true });
        loadProgress.mockResolvedValue({ status: 'insufficient', sessionId: 's1' });
        renderReview();
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'direct'));
        await waitFor(() => expect(action()).toHaveTextContent('Try again'));
        fireEvent.click(action());
        expect(navigate).not.toHaveBeenCalled();
        expect(practiceSelected).not.toHaveBeenCalled();
        await waitFor(() => expect(loadReview).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(action()).toHaveTextContent('Practice this again'));
        fireEvent.click(action());
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith('/session', PRACTICE_NAV);
        expect(setActiveObjectiveBrief).toHaveBeenCalledWith(expect.objectContaining({ briefId: 'b1', points: ['One', 'Two'] }));
    });

    it('CONTROL: a READABLE legacy (unmarked) session with a direct progress answer still opens the product chooser', async () => {
        loadReview.mockResolvedValueOnce({ coaching: FOCUS.coaching, product: 'unknown', evidence: [], focusBrief: null, focusPoints: [] });
        loadProgress.mockResolvedValue({ status: 'insufficient', sessionId: 's1' });
        renderReview();
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'direct'));
        expect(action()).toHaveTextContent('Practice this again');
        fireEvent.click(action());
        expect(navigate).toHaveBeenCalledWith('/practice', PRACTICE_NAV);
        expect(practiceSelected).toHaveBeenCalledWith('unknown', false);
        expect(loadReview).toHaveBeenCalledTimes(1);
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

    describe('#1258 RWT 36955422629 hypothesis: the press is recorded with the branch it took (real hook)', () => {
        const OPEN_MIC: SavedSessionReview = { ...FOCUS, product: 'open_mic', focusBrief: null, focusPoints: [] };

        it('Progress UNAVAILABLE (no next-action recommendation): enabled "Try again", the press only re-checks — recorded, no navigation', async () => {
            loadReview.mockResolvedValue(OPEN_MIC);
            loadProgress.mockResolvedValue({ status: 'unavailable', sessionId: 's1', message: 'Your next action is not available yet. Retry to check again.' });
            renderReview();
            await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'error'));
            await waitFor(() => expect(action()).toBeEnabled());
            expect(action()).toHaveTextContent('Try again');
            fireEvent.click(action());
            expect(practiceAction).toHaveBeenCalledWith(expect.objectContaining({
                product: 'open_mic', linkState: 'error', reviewState: 'loaded', progressStatus: 'unavailable', action: 'refetch_progress', actionSeq: 1,
            }));
            expect(navigate).not.toHaveBeenCalled();
        });

        it('CONTROL (expected, not a failure): a short INELIGIBLE take opens Open Mic directly — open_session, intended route session, no linked attempt', async () => {
            loadReview.mockResolvedValue(OPEN_MIC);
            loadProgress.mockResolvedValue({ status: 'ineligible', sessionId: 's1', reasons: ['too_few_words', 'too_short'] });
            renderReview();
            await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'direct'));
            await waitFor(() => expect(action()).toBeEnabled());
            fireEvent.click(action());
            expect(practiceAction).toHaveBeenCalledWith(expect.objectContaining({
                product: 'open_mic', linkState: 'direct', progressStatus: 'ineligible', action: 'open_session', intendedRoute: 'session', actionSeq: 1,
            }));
            expect(navigate).toHaveBeenCalledWith('/session', PRACTICE_NAV);
            expect(recordAttempt).not.toHaveBeenCalled();
            expect(linkedAttempt).not.toHaveBeenCalled();
        });

        it('linked attempt succeeds: accept_linked, then outcome ok with the same action_seq, then the session opens', async () => {
            loadReview.mockResolvedValue(OPEN_MIC);
            loadProgress.mockResolvedValue(ELIGIBLE);
            renderReview();
            await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
            fireEvent.click(action());
            await waitFor(() => expect(navigate).toHaveBeenCalledWith('/session', PRACTICE_NAV));
            expect(practiceAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'accept_linked', progressStatus: 'eligible', actionSeq: 1 }));
            expect(linkedAttempt).toHaveBeenCalledWith('ok', expect.any(Number), 1, 'session');
        });

        it.each([
            ['server_failed', () => { recordAttempt.mockResolvedValue(null); }],
            ['readback_blocked', () => { readPending.mockResolvedValue({ status: 'blocked' }); }],
            ['threw', () => { recordAttempt.mockRejectedValue(new Error('network')); }],
            ['handoff_failed_abandoned', () => { setOpenAttempt.mockReturnValue(false); abandon.mockResolvedValue(true); }],
            ['handoff_failed_unclosed', () => { setOpenAttempt.mockReturnValue(false); abandon.mockResolvedValue(false); }],
        ] as const)('linked attempt %s: the outcome is recorded, the page stays, nothing navigates', async (outcome, arrange) => {
            arrange();
            loadReview.mockResolvedValue(OPEN_MIC);
            loadProgress.mockResolvedValue(ELIGIBLE);
            renderReview();
            await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
            fireEvent.click(action());
            await waitFor(() => expect(linkedAttempt).toHaveBeenCalledWith(outcome, expect.any(Number), 1, 'session'));
            expect(navigate).not.toHaveBeenCalled();
        });

        it('a PENDING progress read disables the action: the state is observed (enabled=false, progress_pending), then enabled', async () => {
            const progress = deferred<unknown>();
            loadReview.mockResolvedValue(OPEN_MIC);
            loadProgress.mockReturnValue(progress.promise);
            renderReview();
            await waitFor(() => expect(practiceState).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, blockedReason: 'progress_pending', linkState: 'pending' })));
            expect(action()).toBeDisabled();
            await act(async () => { progress.resolve({ status: 'insufficient', sessionId: 's1' }); });
            await waitFor(() => expect(practiceState).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, blockedReason: 'none', linkState: 'direct' })));
            const signatures = practiceState.mock.calls.map(([p]) => JSON.stringify(p));
            expect(new Set(signatures).size).toBe(signatures.length);
        });
    });
});
