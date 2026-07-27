import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PracticeContinuity } from '../PracticeContinuity';
import type { PracticeSession } from '@/types/session';

const makeSession = (over: Partial<PracticeSession> = {}): PracticeSession => ({
    id: 'sess-1',
    user_id: 'u1',
    created_at: '2026-07-20T12:00:00.000Z',
    duration: 305,
    wpm: 132,
    total_words: 400,
    ...over,
}) as PracticeSession;

describe('PracticeContinuity (#1042 PR4)', () => {
    it('returning user: heading + truthful summary (duration + WPM) + both actions fire', () => {
        const onReviewLast = vi.fn();
        const onViewAnalytics = vi.fn();
        render(<PracticeContinuity loading={false} lastSession={makeSession()} onReviewLast={onReviewLast} onViewAnalytics={onViewAnalytics} />);
        expect(screen.getByRole('heading', { name: /ready for your next practice/i })).toBeInTheDocument();
        const summary = screen.getByTestId('practice-continuity-summary');
        expect(summary).toHaveTextContent('5:05'); // 305s → m:ss
        expect(summary).toHaveTextContent('132 WPM');
        fireEvent.click(screen.getByTestId('practice-continuity-review'));
        expect(onReviewLast).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('practice-continuity-analytics'));
        expect(onViewAnalytics).toHaveBeenCalledTimes(1);
    });

    it('omits WPM when the stored value is absent — never fabricates a metric', () => {
        render(<PracticeContinuity loading={false} lastSession={makeSession({ wpm: null as unknown as number })} onReviewLast={vi.fn()} onViewAnalytics={vi.fn()} />);
        expect(screen.getByTestId('practice-continuity-summary')).not.toHaveTextContent(/WPM/);
    });

    it('omits duration when absent (nullable column) — never shows a fabricated 0:00', () => {
        render(<PracticeContinuity loading={false} lastSession={makeSession({ duration: null as unknown as number, wpm: null as unknown as number })} onReviewLast={vi.fn()} onViewAnalytics={vi.fn()} />);
        const summary = screen.getByTestId('practice-continuity-summary');
        expect(summary).not.toHaveTextContent(/0:00/);
        expect(summary).not.toHaveTextContent(/\d+:\d\d/);
    });

    it('load FAILURE shows a truthful error state — never the false "no sessions" empty state', () => {
        render(<PracticeContinuity loading={false} error={true} lastSession={null} onReviewLast={vi.fn()} onViewAnalytics={vi.fn()} />);
        const err = screen.getByTestId('practice-continuity-error');
        expect(err).toHaveTextContent(/couldn.t load your recent practice/i);
        expect(screen.queryByTestId('practice-continuity-empty')).not.toBeInTheDocument();
        expect(screen.queryByTestId('practice-continuity')).not.toBeInTheDocument();
        expect(err.textContent ?? '').not.toMatch(/no sessions yet/i);
    });

    it('new user: truthful empty state — no numbers, no dead actions', () => {
        render(<PracticeContinuity loading={false} lastSession={null} onReviewLast={vi.fn()} onViewAnalytics={vi.fn()} />);
        const empty = screen.getByTestId('practice-continuity-empty');
        expect(empty).toHaveTextContent(/no sessions yet/i);
        expect(screen.queryByTestId('practice-continuity-review')).not.toBeInTheDocument();
        expect(screen.queryByTestId('practice-continuity-analytics')).not.toBeInTheDocument();
        expect(empty.textContent ?? '').not.toMatch(/\d+\s*WPM|\d+:\d\d/);
    });

    it('loading: neutral placeholder, no summary or actions (never flashes fabricated data)', () => {
        render(<PracticeContinuity loading={true} lastSession={null} onReviewLast={vi.fn()} onViewAnalytics={vi.fn()} />);
        expect(screen.getByTestId('practice-continuity-loading')).toBeInTheDocument();
        expect(screen.queryByTestId('practice-continuity-summary')).not.toBeInTheDocument();
        expect(screen.queryByTestId('practice-continuity-empty')).not.toBeInTheDocument();
    });
});
