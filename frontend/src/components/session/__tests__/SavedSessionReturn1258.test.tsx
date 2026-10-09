/**
 * #1258 PR 4 (Rev 2 §4.2) — the completed session restored read-only from its saved row.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PracticeSession } from '@/types/session';

vi.mock('@/components/analytics/SavedPracticeLoopReview', () => ({
    SavedPracticeLoopReview: ({ sessionId }: { sessionId: string }) => <section data-testid="saved-review" data-session={sessionId} />,
}));
vi.mock('@/components/analytics/SavedFocusPointsCoverage', () => ({
    SavedFocusPointsCoverage: ({ sessionId }: { sessionId: string }) => <div data-testid="saved-fp" data-session={sessionId} />,
}));

const { SavedSessionReturn } = await import('../SavedSessionReturn');

const row = (over: Partial<PracticeSession>): PracticeSession => ({
    id: 'a1b2c3d4-0000-4000-8000-000000000001', user_id: 'u', created_at: '2026-10-07T18:12:00Z', duration: 95,
    total_words: 190, wpm: 120, filler_counts: { um: 2, uh: 1 }, transcript_state: 'available', transcript: 'The saved words.',
    ...over,
} as PracticeSession);

describe('SavedSessionReturn', () => {
    it('shows THIS session\'s saved review, transcript and THIS RUN from the row, and no Start control', () => {
        const onSeeAll = vi.fn();
        render(<SavedSessionReturn session={row({})} onSeeAllSessions={onSeeAll} />);
        expect(screen.getByTestId('saved-session-return')).toHaveAttribute('data-session-id', 'a1b2c3d4-0000-4000-8000-000000000001');
        expect(screen.getByTestId('saved-review')).toHaveAttribute('data-session', 'a1b2c3d4-0000-4000-8000-000000000001');
        expect(screen.getByTestId('review-transcript')).toHaveTextContent('The saved words.');
        expect(screen.getByText(/190 words/)).toBeInTheDocument();
        expect(screen.getByTestId('this-run-card-fillers').textContent).toBe('3');
        expect(screen.queryByTestId('mic-start')).toBeNull();
        fireEvent.click(screen.getByTestId('saved-session-return-see-all'));
        expect(onSeeAll).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['expired', 'This transcript is no longer available; session metrics are unaffected.'],
        ['not_captured', 'No transcript was captured for this session. Session metrics are unaffected.'],
    ] as const)('a %s transcript says so with the Analytics copy, and never renders stale text', (state, copy) => {
        render(<SavedSessionReturn session={row({ transcript_state: state, transcript: 'stale words' })} onSeeAllSessions={() => {}} />);
        expect(screen.getByTestId(`saved-session-return-transcript-${state}`)).toHaveTextContent(copy);
        expect(screen.queryByText('stale words')).toBeNull();
    });

    it('unmeasured fillers are omitted, never a fabricated zero (ThisRunCard\'s existing rule)', () => {
        render(<SavedSessionReturn session={row({ filler_counts: null as unknown as PracticeSession['filler_counts'] })} onSeeAllSessions={() => {}} />);
        expect(screen.queryByTestId('this-run-card-fillers')).toBeNull();
        expect(screen.getByTestId('this-run-card-words').textContent).toBe('190');
    });
});
