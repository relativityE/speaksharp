/**
 * #1258 D5 (Rev 2 §5.2, §5.4) — the top of Progress: the ink header (unnamed greeting, owns the h1) and "Your latest
 * review", which shows the newest session's SAVED pair only — nothing at all when none was saved.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { SavedSessionReview } from '@/services/review/savedSessionReview';
import { ProgressHeader } from '../ProgressHeader';

const load = vi.fn<(id: string) => Promise<SavedSessionReview>>();
vi.mock('@/services/review/savedSessionReview', () => ({ loadSavedSessionReview: (id: string) => load(id) }));
vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn(),
    Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => <a href={to} {...rest}>{children}</a>,
}));
vi.mock('@/hooks/useLinkedRepeat', () => ({
    useLinkedRepeat: () => ({
        recommendationId: null, linkState: 'direct', view: undefined,
        query: { refetch: vi.fn(), isFetching: false, isPending: false, isError: false },
        accept: vi.fn(), accepting: false, actionError: null, retryBlocked: false,
    }),
}));
const revisited = vi.fn();
vi.mock('@/services/reviewSurfaceTelemetry', () => ({
    trackSavedReviewRevisited: (...args: unknown[]) => revisited(...args),
    trackSavedReviewPracticeSelected: vi.fn(),
    trackSavedReviewPracticeAction: vi.fn(),
    trackSavedReviewPracticeState: vi.fn(),
}));
vi.mock('@/stores/useSessionStore', () => ({ useSessionStore: { getState: () => ({ setActiveObjectiveBrief: vi.fn() }) } }));

const { SavedPracticeLoopReview } = await import('../SavedPracticeLoopReview');

const PAIR = { kind: 'review' as const, review: { whatWorked: 'Clear, concrete update for the team.', whatToTryNext: 'Pick up the pace slightly.' } };
const base: SavedSessionReview = { coaching: PAIR, product: 'open_mic', evidence: [], focusBrief: null, focusPoints: [] };
const thisYear = new Date().getFullYear();
const at = (month: number, day: number) => new Date(thisYear, month, day, 18, 12).toISOString();

beforeEach(() => { load.mockReset(); revisited.mockReset(); });

describe('#1258 D5 ProgressHeader (unnamed greeting)', () => {
    const control = <button type="button">Choose focus</button>;

    it('owns the page h1 "Your progress" with the kept test id, and names the focus on the latest line', () => {
        render(<ProgressHeader sessionCount={10} firstSessionAt={at(7, 10)} latest={{ product: 'open_mic', createdAt: at(9, 7) }} focusLabel="Sound Confident" focusControl={control} />);
        const h1 = screen.getByRole('heading', { level: 1 });
        expect(h1).toHaveTextContent('Your progress');
        expect(h1).toHaveAttribute('data-testid', 'dashboard-heading');
        expect(screen.getByTestId('progress-header-line')).toHaveTextContent("You've done 10 sessions since 10 Aug.");
        expect(screen.getByTestId('progress-header-latest')).toHaveTextContent('Latest: Open Mic, 7 Oct · Working on Sound Confident');
        expect(screen.getByRole('button', { name: 'Choose focus' })).toBeInTheDocument();
    });

    it('one session reads "Your first session is in."; none shows no line', () => {
        const { rerender } = render(<ProgressHeader sessionCount={1} firstSessionAt={null} latest={null} focusLabel="Sound Confident" focusControl={null} />);
        expect(screen.getByTestId('progress-header-line')).toHaveTextContent('Your first session is in.');
        rerender(<ProgressHeader sessionCount={0} firstSessionAt={null} latest={null} focusLabel="Sound Confident" focusControl={null} />);
        expect(screen.queryByTestId('progress-header-line')).toBeNull();
        expect(screen.queryByTestId('progress-header-latest')).toBeNull();
    });

    it('without the oldest date the line is withheld, never reworded or guessed', () => {
        render(<ProgressHeader sessionCount={4} firstSessionAt={null} latest={{ product: 'focus_points', createdAt: at(9, 7) }} focusLabel="Custom" focusControl={null} />);
        expect(screen.queryByTestId('progress-header-line')).toBeNull();
        expect(screen.getByTestId('progress-header-latest')).toHaveTextContent('Latest: Focus Points, 7 Oct · Working on Custom');
    });

    it('a legacy latest session with no persisted product names only its date; no name is ever shown', () => {
        render(<ProgressHeader sessionCount={2} firstSessionAt={at(9, 1)} latest={{ product: null, createdAt: at(9, 7) }} focusLabel="Sound Confident" focusControl={null} />);
        expect(screen.getByTestId('progress-header-latest')).toHaveTextContent('Latest: 7 Oct · Working on Sound Confident');
        expect(screen.getByTestId('progress-header-line').textContent).toMatch(/^You've done 2 sessions since 1 Oct\.$/);
    });
});

describe('#1258 D5 Your latest review (onlyWhenSaved)', () => {
    const latest = (id = 's-new') => (
        <SavedPracticeLoopReview sessionId={id} sessionLabel="7 Oct, 6:12 pm" eyebrow="Your latest review"
            footerLink={{ to: `/analytics/${id}`, label: 'Open this session' }} onlyWhenSaved />
    );

    it('shows the saved pair with the eyebrow and an "Open this session" link, and records one revisit', async () => {
        load.mockResolvedValue(base);
        render(latest());
        await waitFor(() => expect(screen.getByTestId('saved-review')).toHaveAttribute('data-review-state', 'review'));
        expect(screen.getByRole('heading', { name: 'Your latest review' })).toBeInTheDocument();
        expect(screen.getByTestId('review-try-next')).toHaveTextContent('Pick up the pace slightly.');
        expect(screen.getByTestId('saved-review-footer-link')).toHaveAttribute('href', '/analytics/s-new');
        expect(screen.getByTestId('saved-review-footer-link')).toHaveTextContent('Open this session');
        await waitFor(() => expect(revisited).toHaveBeenCalledTimes(1));
        expect(load).toHaveBeenCalledWith('s-new');
    });

    it.each(['none', 'expired', 'error', 'unverified'] as const)('CASUALTY: a %s state renders nothing and reports no revisit', async (kind) => {
        load.mockResolvedValue({ ...base, coaching: { kind } } as SavedSessionReview);
        const { container } = render(latest());
        await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByText(/No coaching was saved/)).toBeNull();
        expect(revisited).not.toHaveBeenCalled();
    });

    it('renders nothing while the saved review is still loading', () => {
        load.mockReturnValue(new Promise(() => { }));
        const { container } = render(latest());
        expect(container).toBeEmptyDOMElement();
    });

    it('the session detail keeps its defaults: "Practice Loop review" eyebrow, state copy and no footer link', async () => {
        load.mockResolvedValue({ ...base, coaching: { kind: 'none' } } as SavedSessionReview);
        render(<SavedPracticeLoopReview sessionId="s1" />);
        expect(await screen.findByText('No coaching was saved for this session.')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Practice Loop review' })).toBeInTheDocument();
        expect(screen.queryByTestId('saved-review-footer-link')).toBeNull();
    });
});
