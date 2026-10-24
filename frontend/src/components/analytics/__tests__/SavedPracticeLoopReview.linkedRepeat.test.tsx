import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SavedSessionReview } from '@/services/review/savedSessionReview';
import type { SessionProgressResult } from '@/services/progress/loadSessionProgress';
import { webcrypto } from 'node:crypto';
import { authEpoch, setCurrentLogin } from '@/services/loginSessionLog';
import { getOpenAttemptForUser, setOpenAttempt as writeHandoff, subscribeOpenAttempt } from '@/services/progress/openAttempt';
import { validateDisplayedTarget } from '@/services/progress/repeatPracticeTarget';
import { CoachingCard } from '@/components/session/CoachingCard';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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
let displayedSource: SavedSessionReview | null = null;
const sourceRead = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ from: () => ({ select: () => {
    const query = { eq: () => query, maybeSingle: () => sourceRead() }; return query;
} }) }) }));
vi.mock('@/services/objective/savedFocusPointsCoverage', () => ({ loadSavedFocusPointsCoverage: async () => ({
    kind: 'coverage', brief: FOCUS.focusBrief, points: FOCUS.focusPoints.map(label => ({ label })),
}) }));
vi.mock('@/services/review/savedSessionReview', () => ({ loadSavedSessionReview: async (id: string) => {
    const value = await loadReview(id); displayedSource = value; return value;
} }));
const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...await orig<typeof import('react-router-dom')>(), useNavigate: () => navigate }));
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
vi.mock('@/services/progress/openAttempt', async (orig) => {
    const actual = await orig<typeof import('@/services/progress/openAttempt')>();
    return { ...actual, setOpenAttempt: (a: Parameters<typeof actual.setOpenAttempt>[0]) => setOpenAttempt(a) ? actual.setOpenAttempt(a) : false };
});
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
const { ProgressPanel } = await import('../../progress/ProgressPanel');

const FOCUS: SavedSessionReview = {
    coaching: { kind: 'review', review: { whatWorked: 'Clear opening.', whatToTryNext: 'Name the price first.' } },
    product: 'focus_points', evidence: [], focusBrief: { briefId: 'b1', projectId: 'p1', topic: 'Pitch' }, focusPoints: ['One', 'Two'],
};
const ELIGIBLE = { status: 'eligible', sessionId: 's1', recommendationId: 'rec-1' };

let client: QueryClient;
const renderReview = (withProgress = false) => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>
        <SavedPracticeLoopReview sessionId="s1" />
        {withProgress && <ProgressPanel session={{ id: 's1' }} nextActionOwnedByReview />}
    </QueryClientProvider>);
};
const action = () => screen.getByTestId('saved-review-practice') as HTMLButtonElement;
/** A click that still reaches the handler even if the control rendered disabled a frame earlier. */
const staleClick = (el: HTMLButtonElement) => { el.disabled = false; fireEvent.click(el); };

describe('#1548 displayed instruction opt-in at the actual saved-review caller', () => {
    it('Focus reload recovery follows the offered route: close pending in Progress, then explicitly start a NEW linked repeat', async () => {
        const target = await validateDisplayedTarget({ ownerId: 'user-1', epoch: authEpoch(), sessionId: 's1', product: 'focus_points',
            instruction: 'Name the price first.', focus: { ...FOCUS.focusBrief!, points: [...FOCUS.focusPoints] }, isCurrent: () => true });
        writeHandoff({ userId: 'user-1', attemptId: 'pending-old', sourceSessionId: 's1', repeatTarget: target });
        const progress = { ...ELIGIBLE, direction: { text: 'A measured baseline.' }, baselineContext: 'Baseline',
            takeaways: { whatWorked: 'A measured observation.', practiceThisNext: 'Measured filler target.',
                target: { metric: 'filler_rate', direction: 'decrease', targetValue: 7, units: 'percent' } } };
        loadProgress.mockResolvedValueOnce({ ...progress, latestAttempt: { id: 'pending-old', lifecycle: 'pending' } })
            .mockResolvedValue({ ...progress, latestAttempt: null });
        abandon.mockResolvedValue(true); recordAttempt.mockResolvedValue('new-repeat');
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/session']}><Routes>
            <Route path="/session" element={<CoachingCard sessionState="before" practiceTarget={{ kind: 'unavailable', retry: vi.fn(), sourceSessionId: 's1' }} />} />
            <Route path="/progress/:sessionId" element={<><SavedPracticeLoopReview sessionId="s1" /><ProgressPanel session={{ id: 's1' }} nextActionOwnedByReview /></>} />
        </Routes></MemoryRouter></QueryClientProvider>);
        const recoveryCopy = screen.getByTestId('repeat-practice-target').textContent;
        fireEvent.click(screen.getByRole('link', { name: 'Reopen saved review' }));
        await screen.findByTestId('saved-review-pending-attempt');
        expect(action()).toBeDisabled();
        expect(getOpenAttemptForUser('user-1')?.attemptId).toBe('pending-old');
        expect(recordAttempt).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Close pending repeat' }));
        await waitFor(() => expect(action()).toBeEnabled());
        expect(abandon).toHaveBeenCalledExactlyOnceWith('pending-old');
        expect(getOpenAttemptForUser('user-1')).toBeNull();
        fireEvent.click(action());
        await waitFor(() => expect(getOpenAttemptForUser('user-1')?.attemptId).toBe('new-repeat'));
        expect(recordAttempt).toHaveBeenCalledExactlyOnceWith('rec-1');
        expect(setActiveObjectiveBrief).toHaveBeenCalledWith(expect.objectContaining({ briefId: 'b1', points: ['One', 'Two'] }));
        expect(navigate).toHaveBeenCalledWith('/session', PRACTICE_NAV);
        expect(recoveryCopy).toContain('close the pending repeat in Progress');
        expect(recoveryCopy).toContain('start a new repeat');
    });
    it('CASUALTY (Codex P2 r4342118259): a Focus review with no saved point set keeps the linked repeat and opens Focus setup', async () => {
        // A marked Focus take whose results were not saved has coaching but nothing to restore; there is no exact set to
        // validate against, so the press keeps the prior linked-then-setup flow instead of failing target verification.
        loadReview.mockResolvedValue({ ...FOCUS, focusBrief: null, focusPoints: [] });
        loadProgress.mockResolvedValue(ELIGIBLE);
        renderReview();
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
        fireEvent.click(action());
        await waitFor(() => expect(navigate).toHaveBeenCalledWith('/practice?product=focus-points', PRACTICE_NAV));
        expect(recordAttempt).toHaveBeenCalledExactlyOnceWith('rec-1');
        expect(screen.queryByTestId('saved-review-practice-error')).toBeNull();
    });
    it('does not accept or navigate when advice changes after display and before press', async () => {
        loadProgress.mockResolvedValue(ELIGIBLE);
        renderReview();
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
        expect(screen.getByTestId('saved-review')).toHaveTextContent('Name the price first.');
        sourceRead.mockResolvedValue({ data: { product: 'focus_points', ai_suggestions: {
            version: 'gemini_coaching_focus_v1', what_worked: 'Clear opening.', what_to_try_next: 'Hidden new advice.',
        } }, error: null });
        fireEvent.click(action());
        await waitFor(() => expect(linkedAttempt).toHaveBeenCalled());
        expect(navigate).not.toHaveBeenCalled();
        await screen.findByTestId('saved-review-practice-error');
        expect(recordAttempt).not.toHaveBeenCalled(); expect(readPending).not.toHaveBeenCalled();
        expect(setOpenAttempt).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
        expect(screen.getByTestId('saved-review')).not.toHaveTextContent('Hidden new advice.');
    });
    it.each(['source', 'pending', 'create'] as const)('ABA during awaited %s work cannot publish a handoff, navigate or abandon under another login', async stage => {
        const pending = deferred<unknown>();
        loadProgress.mockResolvedValue(ELIGIBLE);
        if (stage === 'source') sourceRead.mockReturnValue(pending.promise);
        if (stage === 'pending') readPending.mockReturnValue(pending.promise);
        if (stage === 'create') recordAttempt.mockReturnValue(pending.promise);
        renderReview();
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
        fireEvent.click(action());
        await waitFor(() => expect(stage === 'source' ? sourceRead : stage === 'pending' ? readPending : recordAttempt).toHaveBeenCalled());
        const earlierEpoch = authEpoch();
        setCurrentLogin('other-owner', 200); setCurrentLogin('user-1', 100);
        expect(authEpoch()).not.toBe(earlierEpoch);
        await act(async () => pending.resolve(stage === 'source' ? { data: { product: 'focus_points', ai_suggestions: {
            version: 'gemini_coaching_focus_v1', what_worked: 'Clear opening.', what_to_try_next: 'Name the price first.',
        } }, error: null } : stage === 'pending' ? { status: 'none' } : 'committed-attempt'));
        expect(setOpenAttempt).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled(); expect(abandon).not.toHaveBeenCalled();
    });
    it('navigation during create preserves the committed pending attempt without a late handoff', async () => {
        const pending = deferred<string>(); recordAttempt.mockReturnValue(pending.promise);
        loadProgress.mockResolvedValue(ELIGIBLE);
        const page = renderReview();
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
        fireEvent.click(action()); await waitFor(() => expect(recordAttempt).toHaveBeenCalledOnce());
        page.unmount(); await act(async () => pending.resolve('committed-attempt'));
        expect(setOpenAttempt).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled(); expect(abandon).not.toHaveBeenCalled();
    });
    it('a source change during create retains the committed pending attempt but does not publish newer advice', async () => {
        loadProgress.mockResolvedValue(ELIGIBLE);
        recordAttempt.mockImplementation(async () => {
            sourceRead.mockResolvedValue({ data: { product: 'focus_points', ai_suggestions: {
                version: 'gemini_coaching_focus_v1', what_worked: 'Clear opening.', what_to_try_next: 'Changed during create.',
            } }, error: null });
            return 'committed-attempt';
        });
        renderReview(); await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
        fireEvent.click(action()); await screen.findByTestId('saved-review-practice-error');
        expect(recordAttempt).toHaveBeenCalledOnce(); expect(setOpenAttempt).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled(); expect(abandon).not.toHaveBeenCalled();
    });
    it('a synchronous same-tab replacement after storage write prevents navigation and preserves the newer binding', async () => {
        loadProgress.mockResolvedValue(ELIGIBLE);
        const unsubscribe = subscribeOpenAttempt(() => {
            unsubscribe(); writeHandoff({ userId: 'user-1', attemptId: 'newer-attempt', sourceSessionId: 's2' });
        });
        try {
            renderReview(); await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
            fireEvent.click(action());
            await waitFor(() => expect(getOpenAttemptForUser('user-1')?.attemptId).toBe('newer-attempt'));
            expect(navigate).not.toHaveBeenCalled(); expect(abandon).not.toHaveBeenCalled();
        } finally { unsubscribe(); }
    });
});

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setCurrentLogin('user-1', 100);
    Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: webcrypto.subtle });
    displayedSource = null;
    sourceRead.mockImplementation(async () => {
        const displayed = displayedSource ?? FOCUS;
        return { data: { product: displayed.product, ai_suggestions: {
            version: displayed.product === 'focus_points' ? 'gemini_coaching_focus_v1' : 'gemini_coaching_v1',
            what_worked: 'Clear opening.', what_to_try_next: 'Name the price first.',
        } }, error: null };
    });
    loadReview.mockResolvedValue(FOCUS);
    setOpenAttempt.mockReturnValue(true);
    readPending.mockResolvedValue({ status: 'none' });
    recordAttempt.mockResolvedValue('attempt-1');
});

describe('#1548 — the saved review names the target actually measured by its linked repeat', () => {
    const persistedProgress: Extract<SessionProgressResult, { status: 'eligible' }> = {
        status: 'eligible', sessionId: 's1', recommendationId: 'rec-1', comparison: 'baseline',
        direction: { direction: 'baseline', deltaPoints: null, deltaPercent: null, reason: null, text: 'Baseline established.' },
        baselineContext: 'This is your first comparable session.', disclosure: null,
        takeaways: {
            whatWorked: 'A completed session', practiceThisNext: 'Cut filler words toward 7%',
            target: { metric: 'filler_rate', direction: 'decrease', targetValue: 7, units: 'percent of words' },
        },
        latestAttempt: null,
    };

    it('bare Progress acceptance stays metric-only and never reads or persists coaching intent', async () => {
        loadProgress.mockResolvedValue(persistedProgress);
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={client}><ProgressPanel session={{ id: 's1' }} /></QueryClientProvider>);
        fireEvent.click(await screen.findByTestId('progress-accept'));
        await waitFor(() => expect(navigate).toHaveBeenCalledWith('/session'));
        expect(sourceRead).not.toHaveBeenCalled();
        expect(setOpenAttempt).toHaveBeenCalledWith({ attemptId: 'attempt-1', userId: 'user-1', sourceSessionId: 's1', acceptedAtIso: expect.any(String) });
    });

    it.each([
        ['completed', 'moved', 'The stored repeat shows movement in the practiced direction.'],
        ['completed', 'did_not_move', 'The stored repeat did not show movement in the practiced direction.'],
        ['not_comparable', 'not_comparable', 'The stored repeat was not comparable.'],
    ] as const)('accepts the saved target, then qualifies the reloaded %s/%s result without crediting unrelated AI advice', async (lifecycle, outcome, resultText) => {
        // The AI suggestion is deliberately unrelated to the persisted filler-rate target, whose 7% value
        // also differs from today's computed 3% default. Neither AI prose nor a new calculation is authority.
        loadProgress.mockResolvedValue(persistedProgress);
        const initial = renderReview(true);
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
        expect(screen.getByTestId('saved-review')).toHaveTextContent('Name the price first.');
        expect(screen.queryByTestId('progress-accept')).not.toBeInTheDocument();
        fireEvent.click(action());
        await waitFor(() => expect(navigate).toHaveBeenCalledWith('/session', PRACTICE_NAV));
        expect(recordAttempt).toHaveBeenCalledExactlyOnceWith('rec-1');
        expect(setOpenAttempt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            attemptId: 'attempt-1', userId: 'user-1', sourceSessionId: 's1', acceptedAtIso: expect.any(String),
            repeatTarget: expect.objectContaining({ version: 1, product: 'focus_points', instructionHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
        }));
        expect(JSON.stringify([practiceAction.mock.calls, practiceState.mock.calls, linkedAttempt.mock.calls])).not.toMatch(/Name the price|Pitch|\["One","Two"\]/);

        initial.unmount(); client.clear();
        loadProgress.mockResolvedValue({ ...persistedProgress, latestAttempt: { id: 'attempt-1', lifecycle, outcome } });
        renderReview(true);
        const result = await screen.findByTestId('progress-attempt-outcome');
        expect(result).toHaveTextContent(resultText);
        const measuredTarget = screen.getByTestId('progress-attempt-target');
        expect(measuredTarget).toHaveTextContent('Measured repeat target: Filler rate; decrease toward 7 percent of words.');
        expect(result.parentElement).toContainElement(measuredTarget);
        expect(measuredTarget).not.toHaveTextContent(/price|3 percent/);
        expect(screen.getByTestId('saved-review')).toHaveTextContent('Name the price first.');
        expect(screen.getAllByRole('button')).toHaveLength(1); // review still owns the only practice action
        expect(screen.queryByTestId('progress-accept')).not.toBeInTheDocument();
        expect(recordAttempt).toHaveBeenCalledTimes(1); // reloading the outcome never accepts another attempt
        expect(result.textContent?.includes('shows movement')).toBe(outcome === 'moved');
    });
});

describe('#1258 Codex P1 r4273670998 — acceptance time is the PRESS, not the end of the network calls', () => {
    it('a slow pending-attempt readback and attempt create do not move acceptedAtIso past the press', async () => {
        loadProgress.mockResolvedValue(ELIGIBLE);
        const pressedAt = new Date('2026-10-14T12:00:00.000Z');
        // Both server calls take time: by the time the handoff is stored, the wall clock is 40 s later.
        readPending.mockImplementation(async () => { vi.setSystemTime(new Date('2026-10-14T12:00:20.000Z')); return { status: 'none' }; });
        recordAttempt.mockImplementation(async () => { vi.setSystemTime(new Date('2026-10-14T12:00:40.000Z')); return 'attempt-1'; });
        renderReview();
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(pressedAt);
            fireEvent.click(action());
            await waitFor(() => expect(setOpenAttempt).toHaveBeenCalledTimes(1));
        } finally {
            vi.useRealTimers();
        }
        expect(setOpenAttempt).toHaveBeenCalledWith(expect.objectContaining({ attemptId: 'attempt-1', acceptedAtIso: pressedAt.toISOString() }));
    });
});

describe('#1258 Codex P2 r4275718056 (PM 6178959404) — a reused attempt of unproved identity is accepted at THIS press', () => {
    /** Press the action at `at` (client clock) and wait until `settled`. */
    const pressAt = async (at: string, settled: () => void) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(new Date(at));
            staleClick(action());
            await waitFor(settled);
        } finally {
            vi.useRealTimers();
        }
    };
    /** A local create at 11:00:00 that fails, then a retry press at 11:01:00 that finds a pending attempt. */
    const failedLocalThenReuse = async (pending: Record<string, unknown>) => {
        loadProgress.mockResolvedValue(ELIGIBLE);
        recordAttempt.mockResolvedValueOnce(null);
        renderReview();
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
        await pressAt('2026-10-14T11:00:00.000Z', () => expect(linkedAttempt).toHaveBeenCalledTimes(1));
        expect(setOpenAttempt).not.toHaveBeenCalled();
        readPending.mockResolvedValue({ status: 'one', ...pending });
        await pressAt('2026-10-14T11:01:00.000Z', () => expect(setOpenAttempt).toHaveBeenCalledTimes(1));
        expect(recordAttempt).toHaveBeenCalledTimes(1);
        return setOpenAttempt.mock.calls[0][0] as { attemptId: string; acceptedAtIso: string };
    };
    it.each([
        // Another device accepted the same recommendation 30 s after the failed local press — inside any proximity window.
        ['another device, 30 s after the failed press', { attemptId: 'attempt-other-device', acceptedAtIso: '2026-10-14T11:00:30.000Z' }],
        // Clock skew either way: a server time just BEFORE the failed press, or well after it.
        ['a server clock behind the browser', { attemptId: 'attempt-x', acceptedAtIso: '2026-10-14T10:59:10.000Z' }],
        ['a server clock ahead of the browser', { attemptId: 'attempt-x', acceptedAtIso: '2026-10-14T11:00:55.000Z' }],
        ['an unknown server time', { attemptId: 'attempt-x', acceptedAtIso: null }],
        ['a malformed server time', { attemptId: 'attempt-x', acceptedAtIso: 'not-a-time' }],
        ['no server time at all', { attemptId: 'attempt-x' }],
    ])('%s → acceptance is the retry press, never the failed press nor the server time', async (_label, pending) => {
        const stored = await failedLocalThenReuse(pending);
        expect(stored).toMatchObject({ attemptId: pending.attemptId, acceptedAtIso: '2026-10-14T11:01:00.000Z' });
    });
    it('exact association — the create answered with its id — keeps that create\'s own press', async () => {
        loadProgress.mockResolvedValue(ELIGIBLE);
        renderReview();
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
        await pressAt('2026-10-14T11:00:00.000Z', () => expect(setOpenAttempt).toHaveBeenCalledTimes(1));
        expect(setOpenAttempt).toHaveBeenCalledWith(expect.objectContaining({ attemptId: 'attempt-1', acceptedAtIso: '2026-10-14T11:00:00.000Z' }));
    });
    it('nothing is written on this device for a create whose answer has not arrived (no marker to borrow later)', async () => {
        loadProgress.mockResolvedValue(ELIGIBLE);
        recordAttempt.mockResolvedValueOnce(null);
        renderReview();
        await waitFor(() => expect(action()).toHaveAttribute('data-link-state', 'linked'));
        const before = Object.keys(localStorage).length;
        await pressAt('2026-10-14T11:00:00.000Z', () => expect(linkedAttempt).toHaveBeenCalledTimes(1));
        expect(Object.keys(localStorage).length).toBe(before);
    });
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
        // #1258 RH-13: the handoff also records WHEN it was accepted, so a reconcile round can bind it to the right take.
        expect(setOpenAttempt).toHaveBeenCalledWith(expect.objectContaining({ attemptId: 'attempt-1', userId: 'user-1', sourceSessionId: 's1', acceptedAtIso: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), repeatTarget: expect.objectContaining({ product: 'focus_points' }) }));
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
        await waitFor(() => expect(action()).toHaveTextContent('Practice again?'));
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
        await waitFor(() => expect(action()).toHaveTextContent('Practice again?'));
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
        await waitFor(() => expect(action()).toHaveTextContent('Practice again?'));
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
        expect(action()).toHaveTextContent('Practice again?');
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
