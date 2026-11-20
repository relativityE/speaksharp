import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

/**
 * Outcome 4 copy parity. `ProgressPanel.tsx` stays byte-identical while AHT-01 pins it, so `repeatOutcomeCopy.ts` holds a
 * copy of its stored-repeat copy. This renders the REAL `ProgressPanel` (original session, review-owned) and the repeat's
 * `RepeatOriginSection` over the same stored result: the outcome line must match exactly, and the values line may differ
 * only in naming the repeat ("this repeat" on its own page, "linked repeat" on the original's).
 */
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => vi.fn() }));
vi.mock('@/contexts/AuthProvider', () => ({ useAuthProvider: () => ({ user: { id: 'user-1' } }) }));
const loadSessionProgress = vi.fn();
vi.mock('@/services/progress/loadSessionProgress', () => ({ loadSessionProgress: (...a: unknown[]) => loadSessionProgress(...a) }));
const loadRepeatOrigin = vi.fn();
vi.mock('@/services/progress/loadRepeatOrigin', () => ({ loadRepeatOrigin: (...a: unknown[]) => loadRepeatOrigin(...a) }));
vi.mock('@/services/progress/recordProgress', () => ({
    recordRecommendationAttempt: vi.fn(), abandonRecommendationAttempt: vi.fn(),
    readPendingRecommendationAttempt: vi.fn(async () => ({ status: 'none' })),
}));
vi.mock('@/services/progress/openAttempt', () => ({
    setOpenAttempt: vi.fn(), clearOpenAttemptIfMatches: vi.fn(),
    subscribeOpenAttempt: () => () => undefined, openAttemptSnapshot: () => null,
}));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));
import { ProgressPanel } from '../ProgressPanel';
import { RepeatOriginSection } from '../RepeatOriginSection';

type Metric = 'filler_rate' | 'pace' | 'clear_delivery';
type Direction = 'decrease' | 'increase' | 'maintain';
type Outcome = 'moved' | 'did_not_move' | 'not_comparable';
type Result = { status: 'available'; before: number; after: number } | { status: 'unavailable' } | null;

const UNITS: Record<Metric, string> = { filler_rate: 'percent of words', pace: 'words per minute', clear_delivery: 'clear-delivery points' };

function renderBoth(metric: Metric, direction: Direction, outcome: Outcome, result: Result) {
    const target = { metric, direction, targetValue: 3, units: UNITS[metric] };
    const lifecycle = outcome === 'not_comparable' ? 'not_comparable' : 'completed';
    const repeatResult = result?.status === 'available'
        ? { status: 'available', metric, direction, units: UNITS[metric], before: result.before, after: result.after }
        : result;
    loadSessionProgress.mockResolvedValue({
        status: 'eligible', sessionId: 'A', comparison: 'baseline', disclosure: null, recommendationId: 'rec-1',
        direction: { direction: 'baseline', deltaPoints: null, deltaPercent: null, reason: null, text: 'Baseline established.' },
        baselineContext: 'This is your first comparable session.',
        takeaways: { whatWorked: 'Steady pace', practiceThisNext: 'Try again', target },
        latestAttempt: { id: 'att-1', lifecycle, outcome }, repeatResult,
    });
    loadRepeatOrigin.mockResolvedValue({
        status: 'repeat', sessionId: 'B', originalSessionId: 'A', originalCreatedAt: '2025-01-17T14:00:00.000Z',
        target, lifecycle, outcome, repeatResult, tip: { status: 'saved', text: 'Pause instead of saying um.' },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}><MemoryRouter>
            <ProgressPanel session={{ id: 'A' }} nextActionOwnedByReview />
            <RepeatOriginSection sessionId="B" />
        </MemoryRouter></QueryClientProvider>,
    );
}

beforeEach(() => { cleanup(); loadSessionProgress.mockReset(); loadRepeatOrigin.mockReset(); });

describe('outcome 4: the repeat page states the stored result in ProgressPanel\'s own words', () => {
    const cases: Array<[Metric, Direction, Outcome, Result]> = [
        ['filler_rate', 'decrease', 'moved', { status: 'available', before: (4 / 245) * 100, after: 0.8 }],
        ['filler_rate', 'decrease', 'did_not_move', { status: 'available', before: 0.8, after: 1.2 }],
        ['filler_rate', 'decrease', 'did_not_move', { status: 'available', before: 0.3, after: 0.3 }],
        ['filler_rate', 'decrease', 'moved', { status: 'available', before: 0.3, after: 0.3 - 1e-9 }],
        ['pace', 'increase', 'moved', { status: 'available', before: 128.4, after: 140.6 }],
        ['pace', 'increase', 'did_not_move', { status: 'available', before: 140, after: 132 }],
        ['clear_delivery', 'maintain', 'moved', { status: 'available', before: 88, after: 88 }],
        ['clear_delivery', 'maintain', 'did_not_move', { status: 'available', before: 88.4, after: 87.9 }],
    ];
    for (const [metric, direction, outcome, result] of cases) {
        it(`${metric} ${direction} ${outcome} ${result?.status === 'available' ? `${result.before}→${result.after}` : ''}`, async () => {
            renderBoth(metric, direction, outcome, result);
            const panelOutcome = await screen.findByTestId('progress-attempt-outcome');
            const repeatOutcome = await screen.findByTestId('repeat-origin-outcome');
            expect(repeatOutcome.textContent).toBe(panelOutcome.textContent);
            const panelValues = screen.getByTestId('progress-attempt-values').textContent ?? '';
            const repeatValues = screen.getByTestId('repeat-origin-values').textContent ?? '';
            expect(panelValues).toContain('(original session → linked repeat).');
            expect(repeatValues).toBe(panelValues.replace('(original session → linked repeat).', '(original session → this repeat).'));
            expect(screen.getByTestId('repeat-origin-scope').textContent).toBe(screen.getByTestId('progress-attempt-scope').textContent);
        });
    }

    it('not comparable: the same sentence on both pages', async () => {
        for (const metric of ['filler_rate', 'pace', 'clear_delivery'] as const) {
            cleanup();
            renderBoth(metric, 'decrease', 'not_comparable', null);
            const repeatOutcome = await screen.findByTestId('repeat-origin-outcome');
            expect(repeatOutcome.textContent).toBe(screen.getByTestId('progress-attempt-outcome').textContent);
        }
    });

    it('unreadable values: the same not-available sentence on both pages', async () => {
        renderBoth('filler_rate', 'decrease', 'moved', { status: 'unavailable' });
        const repeatValues = await screen.findByTestId('repeat-origin-values');
        expect(repeatValues.textContent).toBe(screen.getByTestId('progress-attempt-values').textContent);
    });
});
