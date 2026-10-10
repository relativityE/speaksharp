/**
 * #1258 PR 4 (Rev 2 §4.2) — the completed session restored read-only from its saved row.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PracticeSession } from '@/types/session';

// The stub stands for a session with NO saved coaching whose review resolved the product to `resolvedProduct`.
let resolvedProduct: 'open_mic' | 'focus_points' | null = 'open_mic';
let retryReady = true;
type Fallback = (ctx: { action: React.ReactNode; product: 'open_mic' | 'focus_points' | null; retryReady: boolean }) => React.ReactNode;
vi.mock('@/components/analytics/SavedPracticeLoopReview', () => ({
    SavedPracticeLoopReview: ({ sessionId, noneFallback }: { sessionId: string; noneFallback?: Fallback }) =>
        <section data-testid="saved-review" data-session={sessionId}>
            {noneFallback?.({ action: <button data-testid="saved-review-practice">Practice again?</button>, product: resolvedProduct, retryReady })}
        </section>,
}));
vi.mock('../AISuggestions', () => ({ default: () => <div data-testid="ai-suggestions-stub" /> }));
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
    it('CASUALTY #1472 (saved/reloaded review): an empty filler map over saved words shows no "0" Fillers row', () => {
        render(<SavedSessionReturn session={row({ filler_counts: {} as PracticeSession['filler_counts'], total_words: 190 })} onSeeAllSessions={vi.fn()} />);
        expect(screen.queryByTestId('this-run-card-fillers')).toBeNull();
        expect(screen.getByTestId('this-run-card')).toBeInTheDocument();
    });

    it('CONTROL #1472: observed counts on the restored review keep their truthful Fillers row', () => {
        render(<SavedSessionReturn session={row({})} onSeeAllSessions={vi.fn()} />);
        expect(screen.getByTestId('this-run-card-fillers')).toHaveTextContent('3');
    });

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

    // PO 2026-10-09: no saved coaching → Try again only while the row still keeps its transcript; otherwise terminal.
    it.each([
        ['available', true],
        ['expired', false],
        ['not_captured', false],
    ] as const)('no saved coaching, transcript %s → Try again offered: %s', (state, offered) => {
        render(<SavedSessionReturn session={row({ transcript_state: state })} onSeeAllSessions={() => {}} />);
        expect(screen.getByTestId('restored-review-retry')).toHaveAttribute('data-retry', offered ? 'available' : 'unavailable');
        expect(screen.queryAllByTestId('restored-review-retry-button')).toHaveLength(offered ? 1 : 0);
        expect(screen.queryAllByTestId('restored-review-not-available')).toHaveLength(offered ? 0 : 1);
    });

    it('CASUALTY (Codex 4235188543): a legacy row with no product marker but resolved Focus Points gets the Focus disclosure', () => {
        resolvedProduct = 'focus_points';
        render(<SavedSessionReturn session={row({ product: null as unknown as PracticeSession['product'] })} onSeeAllSessions={() => {}} />);
        expect(screen.getByTestId('restored-review-retry')).toHaveTextContent('your Focus Points topic and points');
        expect(screen.getByTestId('saved-review-practice')).toBeInTheDocument();
        resolvedProduct = 'open_mic';
    });

    it('CASUALTY (Codex 4235535994): no resolved and no row product → terminal, no Try again, practice action kept', () => {
        resolvedProduct = null;
        render(<SavedSessionReturn session={row({ product: null as unknown as PracticeSession['product'] })} onSeeAllSessions={() => {}} />);
        expect([screen.queryAllByTestId('restored-review-retry-button').length, screen.queryAllByTestId('restored-review-not-available').length])
            .toEqual([0, 1]);
        expect(screen.getByTestId('saved-review-practice')).toBeInTheDocument();
        resolvedProduct = 'open_mic';
    });

    it('CASUALTY (Codex 4236200867): a Focus session without saved results is terminal on the reopened page', () => {
        resolvedProduct = 'focus_points';
        retryReady = false;
        render(<SavedSessionReturn session={row({ product: 'focus_points' })} onSeeAllSessions={() => {}} />);
        expect([screen.queryAllByTestId('restored-review-retry-button').length, screen.queryAllByTestId('restored-review-not-available').length])
            .toEqual([0, 1]);
        expect(screen.getByTestId('saved-review-practice')).toBeInTheDocument();
        resolvedProduct = 'open_mic';
        retryReady = true;
    });

    it('unmeasured fillers are omitted, never a fabricated zero (ThisRunCard\'s existing rule)', () => {
        render(<SavedSessionReturn session={row({ filler_counts: null as unknown as PracticeSession['filler_counts'] })} onSeeAllSessions={() => {}} />);
        expect(screen.queryByTestId('this-run-card-fillers')).toBeNull();
        expect(screen.getByTestId('this-run-card-words').textContent).toBe('190');
    });
});
