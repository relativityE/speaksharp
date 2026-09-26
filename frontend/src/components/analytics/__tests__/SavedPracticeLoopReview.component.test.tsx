import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { SavedSessionReview } from '@/services/review/savedSessionReview';

const load = vi.fn<(id: string) => Promise<SavedSessionReview>>();
vi.mock('@/services/review/savedSessionReview', () => ({ loadSavedSessionReview: (id: string) => load(id) }));
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
const accept = vi.fn(async (after: () => void) => { after(); });
let recommendationId: string | null = null;
vi.mock('@/hooks/useLinkedRepeat', () => ({
    // A settled progress answer: `linked` when an eligible recommendation exists, else a terminal `direct`. The
    // pending/error/single-flight paths run against the REAL hook in SavedPracticeLoopReview.linkedRepeat.test.tsx.
    useLinkedRepeat: () => ({
        recommendationId, linkState: recommendationId ? 'linked' : 'direct', query: { refetch: vi.fn(), isFetching: false },
        accept, accepting: false, actionError: null, retryBlocked: false,
    }),
}));
const revisited = vi.fn();
const practiceSelected = vi.fn();
vi.mock('@/services/reviewSurfaceTelemetry', () => ({
    trackSavedReviewRevisited: (...args: unknown[]) => revisited(...args),
    trackSavedReviewPracticeSelected: (...args: unknown[]) => practiceSelected(...args),
}));
const setActiveObjectiveBrief = vi.fn();
vi.mock('@/stores/useSessionStore', () => ({ useSessionStore: { getState: () => ({ setActiveObjectiveBrief }) } }));

const { SavedPracticeLoopReview } = await import('../SavedPracticeLoopReview');

const PAIR = { kind: 'review' as const, review: { whatWorked: 'Opening definition landed clearly.', whatToTryNext: 'Name point three before point two.' } };
const base: SavedSessionReview = { coaching: PAIR, product: 'open_mic', evidence: ['6.2 filler words a minute, above your target.'], focusBrief: null, focusPoints: [] };

beforeEach(() => { load.mockReset(); navigate.mockReset(); accept.mockClear(); setActiveObjectiveBrief.mockReset(); revisited.mockReset(); practiceSelected.mockReset(); recommendationId = null; });

describe('SavedPracticeLoopReview (Analytics detail, #1258 G20)', () => {
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
        expect(navigate).toHaveBeenCalledWith('/session');
        expect(accept).not.toHaveBeenCalled();
    });

    it('Focus Points: rebinds THIS session’s saved point set, never a different one', async () => {
        load.mockResolvedValue({ ...base, product: 'focus_points', evidence: ['Detected: point 1 at 0:21.'], focusBrief: { briefId: 'b1', projectId: 'p1', topic: 'Weekly handoff' }, focusPoints: ['One', 'Two'] });
        render(<SavedPracticeLoopReview sessionId="s1" />);
        fireEvent.click(await screen.findByTestId('saved-review-practice'));
        expect(setActiveObjectiveBrief).toHaveBeenCalledWith({ projectId: 'p1', briefId: 'b1', points: ['One', 'Two'], topic: 'Weekly handoff', paceGuideSecPerPoint: null });
        expect(navigate).toHaveBeenCalledWith('/session');
    });

    it('Focus Points without its saved set opens Focus Points setup instead of guessing', async () => {
        load.mockResolvedValue({ ...base, product: 'focus_points', focusBrief: null, focusPoints: [] });
        render(<SavedPracticeLoopReview sessionId="s1" />);
        fireEvent.click(await screen.findByTestId('saved-review-practice'));
        expect(setActiveObjectiveBrief).not.toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledWith('/practice?product=focus-points');
    });

    it('with a valid linked recommendation, the linked repeat runs first and then opens the session’s product', async () => {
        recommendationId = 'rec1';
        load.mockResolvedValue({ ...base, product: 'focus_points', focusBrief: { briefId: 'b1', projectId: 'p1', topic: 'T' }, focusPoints: ['One'] });
        render(<SavedPracticeLoopReview sessionId="s1" />);
        fireEvent.click(await screen.findByTestId('saved-review-practice'));
        expect(accept).toHaveBeenCalledTimes(1);
        expect(setActiveObjectiveBrief).toHaveBeenCalledWith(expect.objectContaining({ briefId: 'b1' }));
        expect(navigate).toHaveBeenCalledWith('/session');
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
});
