import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PracticeContinuity, type RecentSession } from '../PracticeContinuity';

const makeSession = (over: Partial<RecentSession> = {}): RecentSession => ({
    id: 'sess-1',
    created_at: '2026-07-20T12:00:00.000Z',
    duration: 305,
    status: 'completed',
    ...over,
});

describe('PracticeContinuity (#1042 PR4)', () => {
    it('returning user: heading + "Last practice" + date + duration only (no WPM) + both actions fire', () => {
        const onReviewLast = vi.fn();
        const onViewAnalytics = vi.fn();
        render(<PracticeContinuity loading={false} lastSession={makeSession()} onReviewLast={onReviewLast} onViewAnalytics={onViewAnalytics} />);
        expect(screen.getByRole('heading', { name: /ready for your next practice/i })).toBeInTheDocument();
        const summary = screen.getByTestId('practice-continuity-summary');
        expect(summary).toHaveTextContent(/Last practice/);
        expect(summary).toHaveTextContent('5:05'); // 305s → m:ss
        expect(summary).not.toHaveTextContent(/WPM/i);
        fireEvent.click(screen.getByTestId('practice-continuity-review'));
        expect(onReviewLast).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('practice-continuity-analytics'));
        expect(onViewAnalytics).toHaveBeenCalledTimes(1);
    });

    it('supports a legacy null-status row (still a reviewable returning session)', () => {
        render(<PracticeContinuity loading={false} lastSession={makeSession({ status: null })} onReviewLast={vi.fn()} onViewAnalytics={vi.fn()} />);
        expect(screen.getByTestId('practice-continuity')).toBeInTheDocument();
    });

    it('omits duration when absent (nullable column) — never shows a fabricated 0:00', () => {
        render(<PracticeContinuity loading={false} lastSession={makeSession({ duration: null as unknown as number })} onReviewLast={vi.fn()} onViewAnalytics={vi.fn()} />);
        const summary = screen.getByTestId('practice-continuity-summary');
        expect(summary).toHaveTextContent(/Last practice/);
        expect(summary).not.toHaveTextContent(/\d+:\d\d/);
    });

    it('new user: approved heading + reassurance copy, no numbers, no dead actions', () => {
        render(<PracticeContinuity loading={false} lastSession={null} onReviewLast={vi.fn()} onViewAnalytics={vi.fn()} />);
        const empty = screen.getByTestId('practice-continuity-empty');
        expect(within(empty).getByRole('heading', { name: /start your first practice/i })).toBeInTheDocument();
        expect(empty).toHaveTextContent(/your completed sessions and progress will appear here after you finish/i);
        expect(screen.queryByTestId('practice-continuity-review')).not.toBeInTheDocument();
        expect(screen.queryByTestId('practice-continuity-analytics')).not.toBeInTheDocument();
        expect(empty.textContent ?? '').not.toMatch(/\d+:\d\d/);
    });

    it('load FAILURE: honest error copy (no "sessions are safe" claim), never the empty state', () => {
        render(<PracticeContinuity loading={false} error={true} lastSession={null} onReviewLast={vi.fn()} onViewAnalytics={vi.fn()} />);
        const err = screen.getByTestId('practice-continuity-error');
        expect(err).toHaveTextContent(/we couldn.t load your recent practice\. you can still start freestyle practice below\./i);
        expect(err.textContent ?? '').not.toMatch(/sessions are safe|no sessions yet/i);
        expect(screen.queryByTestId('practice-continuity-empty')).not.toBeInTheDocument();
        expect(screen.queryByTestId('practice-continuity')).not.toBeInTheDocument();
    });

    it('loading: neutral placeholder, no summary/empty/error/actions', () => {
        render(<PracticeContinuity loading={true} lastSession={null} onReviewLast={vi.fn()} onViewAnalytics={vi.fn()} />);
        expect(screen.getByTestId('practice-continuity-loading')).toBeInTheDocument();
        expect(screen.queryByTestId('practice-continuity-summary')).not.toBeInTheDocument();
        expect(screen.queryByTestId('practice-continuity-empty')).not.toBeInTheDocument();
    });
});
