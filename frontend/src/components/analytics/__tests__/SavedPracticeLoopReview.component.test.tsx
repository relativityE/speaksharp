import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { SavedSessionReview } from '@/services/review/savedSessionReview';

const load = vi.fn<(id: string) => Promise<SavedSessionReview>>();
vi.mock('@/services/review/savedSessionReview', () => ({ loadSavedSessionReview: (id: string) => load(id) }));
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
// #1258 (Codex r4191751371): every practice navigation carries its press's action_seq in router state.
const PRACTICE_NAV = { state: { practiceActionSeq: expect.any(Number) } };
const accept = vi.fn(async (after: () => void) => { after(); });
let recommendationId: string | null = null;
// Codex r4195165663: a refetch that FAILS after an earlier success — TanStack keeps the old data and sets isError.
let cachedView: { status: string } | undefined;
let queryIsError = false;
vi.mock('@/hooks/useLinkedRepeat', () => ({
    // A settled progress answer: `linked` when an eligible recommendation exists, else a terminal `direct`. The
    // pending/error/single-flight paths run against the REAL hook in SavedPracticeLoopReview.linkedRepeat.test.tsx.
    useLinkedRepeat: () => ({
        recommendationId, linkState: queryIsError ? 'error' : recommendationId ? 'linked' : 'direct', view: cachedView,
        query: { refetch: vi.fn(), isFetching: false, isPending: false, isError: queryIsError },
        accept, accepting: false, actionError: null, retryBlocked: false,
    }),
}));
const revisited = vi.fn();
const practiceSelected = vi.fn();
const practiceAction = vi.fn();
const practiceState = vi.fn();
vi.mock('@/services/reviewSurfaceTelemetry', () => ({
    trackSavedReviewRevisited: (...args: unknown[]) => revisited(...args),
    trackSavedReviewPracticeSelected: (...args: unknown[]) => practiceSelected(...args),
    trackSavedReviewPracticeAction: (...args: unknown[]) => practiceAction(...args),
    trackSavedReviewPracticeState: (...args: unknown[]) => practiceState(...args),
}));
const setActiveObjectiveBrief = vi.fn();
vi.mock('@/stores/useSessionStore', () => ({ useSessionStore: { getState: () => ({ setActiveObjectiveBrief }) } }));

const { SavedPracticeLoopReview } = await import('../SavedPracticeLoopReview');

const PAIR = { kind: 'review' as const, review: { whatWorked: 'Opening definition landed clearly.', whatToTryNext: 'Name point three before point two.' } };
const base: SavedSessionReview = { coaching: PAIR, product: 'open_mic', evidence: ['6.2 filler words a minute, above your target.'], focusBrief: null, focusPoints: [] };

beforeEach(() => { load.mockReset(); navigate.mockReset(); accept.mockClear(); setActiveObjectiveBrief.mockReset(); revisited.mockReset(); practiceSelected.mockReset(); practiceAction.mockReset(); practiceState.mockReset(); recommendationId = null; cachedView = undefined; queryIsError = false; });

describe('SavedPracticeLoopReview (Analytics detail, #1258 G20)', () => {
    // #1538 (Codex P1 r4117321439, PM 5860714332): an old generic pair on a Focus take is never shown as its Focus review.
    it('#1538 CASUALTY: an UNVERIFIED Focus coaching state shows the truthful notice, no pair, a non-qualifying revisit, and the practice action', async () => {
        load.mockResolvedValue({ ...base, product: 'focus_points', coaching: { kind: 'unverified' }, evidence: ['Detected: point 1 at 0:21.'], focusBrief: { briefId: 'b1', projectId: 'p1', topic: 'T' }, focusPoints: ['One'] });
        render(<SavedPracticeLoopReview sessionId="s1" />);
        await waitFor(() => expect(screen.getByTestId('saved-review')).toHaveAttribute('data-review-state', 'unverified'));
        expect(screen.getByTestId('saved-review-unverified')).toHaveTextContent('saved before Focus Points coaching was available');
        expect(screen.queryByTestId('review-what-went-well')).not.toBeInTheDocument();
        // The revisit is sent from a passive effect that can run after the DOM already shows the state; wait for it, as the
        // other revisit assertions in this file do (CI runs 36371746026 and 36375138994 failed on the synchronous form).
        await waitFor(() => expect(revisited).toHaveBeenCalledWith('focus_points', 'none', false));
        expect(screen.getByTestId('saved-review-practice')).toBeInTheDocument();
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('shows the saved pair word for word, the product label, evidence and ONE practice action', async () => {
        load.mockResolvedValue(base);
        render(<SavedPracticeLoopReview sessionId="s1" sessionLabel="Session 6 · 24 Sep" />);
        await waitFor(() => expect(screen.getByTestId('saved-review')).toHaveAttribute('data-review-state', 'review'));
        expect(load).toHaveBeenCalledWith('s1');
        expect(screen.getByTestId('saved-review-label')).toHaveTextContent('Session 6 · 24 Sep · Open Mic');
        expect(screen.getByTestId('review-what-went-well')).toHaveTextContent('Opening definition landed clearly.');
        expect(screen.getByTestId('review-try-next')).toHaveTextContent('Name point three before point two.');
        expect(screen.getByTestId('review-evidence')).toHaveTextContent('6.2 filler words a minute');
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('Open Mic: opens Open Mic with no Focus Points brief left bound', async () => {
        load.mockResolvedValue(base);
        render(<SavedPracticeLoopReview sessionId="s1" />);
        fireEvent.click(await screen.findByTestId('saved-review-practice'));
        expect(setActiveObjectiveBrief).toHaveBeenCalledWith(null);
        expect(navigate).toHaveBeenCalledWith('/session', PRACTICE_NAV);
        expect(accept).not.toHaveBeenCalled();
    });

    it('Focus Points: rebinds THIS session’s saved point set, never a different one', async () => {
        load.mockResolvedValue({ ...base, product: 'focus_points', evidence: ['Detected: point 1 at 0:21.'], focusBrief: { briefId: 'b1', projectId: 'p1', topic: 'Weekly handoff' }, focusPoints: ['One', 'Two'] });
        render(<SavedPracticeLoopReview sessionId="s1" />);
        fireEvent.click(await screen.findByTestId('saved-review-practice'));
        expect(setActiveObjectiveBrief).toHaveBeenCalledWith({ projectId: 'p1', briefId: 'b1', points: ['One', 'Two'], topic: 'Weekly handoff', paceGuideSecPerPoint: null });
        expect(navigate).toHaveBeenCalledWith('/session', PRACTICE_NAV);
    });

    it('Focus Points without its saved set opens Focus Points setup instead of guessing', async () => {
        load.mockResolvedValue({ ...base, product: 'focus_points', focusBrief: null, focusPoints: [] });
        render(<SavedPracticeLoopReview sessionId="s1" />);
        fireEvent.click(await screen.findByTestId('saved-review-practice'));
        expect(setActiveObjectiveBrief).not.toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledWith('/practice?product=focus-points', PRACTICE_NAV);
    });

    it('#1535 Codex P2: an UNKNOWN product (no durable authority) opens the product chooser — never Open Mic, and no brief is cleared', async () => {
        load.mockResolvedValue({ ...base, product: 'unknown', evidence: [] });
        render(<SavedPracticeLoopReview sessionId="s1" />);
        fireEvent.click(await screen.findByTestId('saved-review-practice'));
        expect(navigate).toHaveBeenCalledWith('/practice', PRACTICE_NAV);
        expect(navigate).not.toHaveBeenCalledWith('/session', expect.anything());
        expect(setActiveObjectiveBrief).not.toHaveBeenCalled();
        expect(screen.queryByText(/Open Mic/), 'no product is claimed').toBeNull();
    });

    it('with a valid linked recommendation, the linked repeat runs first and then opens the session’s product', async () => {
        recommendationId = 'rec1';
        load.mockResolvedValue({ ...base, product: 'focus_points', focusBrief: { briefId: 'b1', projectId: 'p1', topic: 'T' }, focusPoints: ['One'] });
        render(<SavedPracticeLoopReview sessionId="s1" />);
        fireEvent.click(await screen.findByTestId('saved-review-practice'));
        expect(accept).toHaveBeenCalledTimes(1);
        expect(setActiveObjectiveBrief).toHaveBeenCalledWith(expect.objectContaining({ briefId: 'b1' }));
        expect(navigate).toHaveBeenCalledWith('/session', PRACTICE_NAV);
    });

    it.each([
        ['none', 'No coaching was saved for this session.'],
        ['expired', 'no longer available'],
        ['error', 'couldn’t be loaded'],
    ] as const)('A3 %s: says so, no stand-in lesson or evidence, the single practice action stays', async (kind, copy) => {
        load.mockResolvedValue({ ...base, coaching: { kind } });
        render(<SavedPracticeLoopReview sessionId="s1" />);
        await waitFor(() => expect(screen.getByTestId(`saved-review-${kind}`)).toHaveTextContent(copy));
        expect(screen.queryByTestId('review-try-next')).not.toBeInTheDocument();
        expect(screen.queryByTestId('review-evidence')).not.toBeInTheDocument();
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    // #1258 (PO 2026-10-09): the reopened session passes its Try again as `noneFallback` — it replaces ONLY the `none` band.
    it.each(['none', 'expired', 'error', 'review'] as const)('noneFallback renders only for a %s state of none', async (kind) => {
        load.mockResolvedValue({ ...base, coaching: kind === 'review' ? PAIR : { kind } });
        render(<SavedPracticeLoopReview sessionId="s1" noneFallback={<p data-testid="none-fallback">retry</p>} />);
        const settled = { none: 'none-fallback', review: 'review-try-next', expired: 'saved-review-expired', error: 'saved-review-error' }[kind];
        await waitFor(() => expect(screen.getByTestId(settled)).toBeInTheDocument());
        expect(screen.queryAllByTestId('none-fallback')).toHaveLength(kind === 'none' ? 1 : 0);
    });

    // #1258 (PM 2026-09-25): a saved review shown on Analytics is a REVISIT — once per session per view, never a generation.
    it('sends ONE content-free revisit per session view, and the practice action names its linked-repeat path', async () => {
        load.mockResolvedValue({ ...base, product: 'focus_points', evidence: ['Detected: point 1 at 0:21.'], focusBrief: { briefId: 'b1', projectId: 'p1', topic: 'T' }, focusPoints: ['One'] });
        const { rerender } = render(<SavedPracticeLoopReview sessionId="s1" sessionLabel="Session 1" />);
        await waitFor(() => expect(revisited).toHaveBeenCalledWith('focus_points', 'review', true));
        rerender(<SavedPracticeLoopReview sessionId="s1" sessionLabel="Session 1 · again" />);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(revisited).toHaveBeenCalledTimes(1);
        recommendationId = null;
        fireEvent.click(screen.getByTestId('saved-review-practice'));
        expect(practiceSelected).toHaveBeenCalledWith('focus_points', false);
    });

    it('a state without a review is still a revisit of THAT state (no evidence claimed)', async () => {
        load.mockResolvedValue({ ...base, coaching: { kind: 'expired' } });
        render(<SavedPracticeLoopReview sessionId="s2" />);
        await waitFor(() => expect(revisited).toHaveBeenCalledWith('open_mic', 'expired', false));
    });

    describe('#1258 every press is recorded with the branch it took', () => {
        it('Open Mic, terminal progress: open_session, link_state direct, action_seq 1 then 2', async () => {
            load.mockResolvedValue(base);
            render(<SavedPracticeLoopReview sessionId="s1" />);
            const button = await screen.findByTestId('saved-review-practice');
            fireEvent.click(button);
            fireEvent.click(button);
            expect(practiceAction.mock.calls.map(([p]) => [p.action, p.linkState, p.reviewState, p.product, p.actionSeq])).toEqual([
                ['open_session', 'direct', 'loaded', 'open_mic', 1],
                ['open_session', 'direct', 'loaded', 'open_mic', 2],
            ]);
            expect(navigate).toHaveBeenCalledWith('/session', PRACTICE_NAV);
        });

        it('linked recommendation: accept_linked, and the attempt carries the same action_seq', async () => {
            recommendationId = 'rec-1';
            load.mockResolvedValue(base);
            render(<SavedPracticeLoopReview sessionId="s1" />);
            fireEvent.click(await screen.findByTestId('saved-review-practice'));
            expect(practiceAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'accept_linked', linkState: 'linked', actionSeq: 1, intendedRoute: 'session' }));
            expect(accept).toHaveBeenCalledWith(expect.any(Function), 1, 'session');
        });

        it('Codex r4191751371: each navigation carries the SAME action_seq its press recorded — direct and linked', async () => {
            load.mockResolvedValue(base);
            const { unmount } = render(<SavedPracticeLoopReview sessionId="s1" />);
            const button = await screen.findByTestId('saved-review-practice');
            fireEvent.click(button);
            fireEvent.click(button);
            expect(practiceAction.mock.calls.map(([p]) => p.actionSeq)).toEqual([1, 2]);
            expect(navigate.mock.calls).toEqual([
                ['/session', { state: { practiceActionSeq: 1 } }],
                ['/session', { state: { practiceActionSeq: 2 } }],
            ]);
            unmount();
            navigate.mockReset(); practiceAction.mockReset();
            recommendationId = 'rec-1';
            render(<SavedPracticeLoopReview sessionId="s1" />);
            fireEvent.click(await screen.findByTestId('saved-review-practice'));
            await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
            expect(practiceAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'accept_linked', actionSeq: 1 }));
            expect(navigate).toHaveBeenCalledWith('/session', { state: { practiceActionSeq: 1 } });
        });

        it('Codex r4195165663: a FAILED refetch records read_error — never the stale cached status the page no longer trusts', async () => {
            cachedView = { status: 'eligible' };
            queryIsError = true;
            load.mockResolvedValue(base);
            render(<SavedPracticeLoopReview sessionId="s1" />);
            fireEvent.click(await screen.findByTestId('saved-review-practice'));
            expect(practiceAction).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'refetch_progress', linkState: 'error', progressStatus: 'read_error' }));
        });

        it('the recorded target matches the navigation: Focus without its set → open_focus_setup; unknown → open_practice', async () => {
            load.mockResolvedValue({ ...base, product: 'focus_points', focusBrief: null, focusPoints: [] });
            const { unmount } = render(<SavedPracticeLoopReview sessionId="s1" />);
            fireEvent.click(await screen.findByTestId('saved-review-practice'));
            expect(practiceAction).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'open_focus_setup', product: 'focus_points', intendedRoute: 'focus_setup' }));
            expect(navigate).toHaveBeenLastCalledWith('/practice?product=focus-points', PRACTICE_NAV);
            unmount();
            load.mockResolvedValue({ ...base, product: 'unknown', evidence: [] });
            render(<SavedPracticeLoopReview sessionId="s2" />);
            fireEvent.click(await screen.findByTestId('saved-review-practice'));
            expect(practiceAction).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'open_practice', product: 'unknown', intendedRoute: 'practice' }));
            expect(navigate).toHaveBeenLastCalledWith('/practice', PRACTICE_NAV);
        });
    });
});
