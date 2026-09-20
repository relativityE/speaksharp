/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

/**
 * G18 — THE CARD AND THE PANEL MUST MOVE TOGETHER, NOT MERELY READ THE SAME CALL (Consultant, 2026-09-20).
 *
 * Both surfaces state the same comparison. Asserting that each renders correctly against its own fixture
 * would pass even if they diverged — the projection-divergence class. So this perturbs the SHARED authority
 * (`loadSessionProgress`) and asserts BOTH surfaces change with it, in the same direction, with the same two
 * scores. If one surface keeps its own copy of the contract, or reverts to a percent-of-previous, exactly one
 * of these assertions fails.
 */
vi.mock('@/services/progress/loadSessionProgress', () => ({ loadSessionProgress: vi.fn() }));
vi.mock('@/contexts/AuthProvider', async (orig) => ({
    ...(await orig<typeof import('@/contexts/AuthProvider')>()),
    useAuthProvider: () => ({ user: { id: 'u1' } }),
}));
vi.mock('react-router-dom', async (orig) => ({
    ...(await orig<typeof import('react-router-dom')>()),
    useNavigate: () => vi.fn(),
}));
vi.mock('@/services/progress/recordProgress', () => ({
    acceptProgressRecommendation: vi.fn(),
    reconcileProgressRecommendation: vi.fn(),
}));

import { loadSessionProgress } from '@/services/progress/loadSessionProgress';
import { ProgressPanel } from '@/components/progress/ProgressPanel';
import { ClarityVsLastSessionCard } from '@/components/session/ClarityVsLastSessionCard';
import { useClarityMove } from '@/hooks/useClarityMove';
import type { PracticeSession } from '@/types/session';

const HISTORY = [
    { id: 's2', user_id: 'u1', created_at: '2026-09-20T10:00:00Z', duration: 90 },
    { id: 's1', user_id: 'u1', created_at: '2026-09-14T10:00:00Z', duration: 90 },
] as unknown as PracticeSession[];

/** One authority, two projections of it — built from the same clarity pair. */
const authority = (previous: number, current: number) => ({
    status: 'eligible' as const,
    sessionId: 's2',
    comparison: 'previous' as const,
    direction: {
        direction: current - previous >= 3 ? 'improved' as const : 'below_policy' as const,
        deltaPoints: current - previous,
        deltaPercent: ((current - previous) / previous) * 100,
        reason: null,
        text: current - previous >= 3
            ? `Clearer than your previous comparable session: ${previous}% → ${current}%.`
            : `Holding steady since your previous comparable session: ${previous}% → ${current}%.`,
    },
    baselineContext: `Clearer than your first comparable session: ${previous}% → ${current}%.`,
    disclosure: {
        referenceSessionId: 's1',
        referenceRole: 'previous comparable session' as const,
        alsoFirstComparable: false,
        cohortKey: 'private|v2|base|clarity_v1',
        currentClarityPoints: current,
        referenceClarityPoints: previous,
        deltaPoints: current - previous,
        deltaPercent: ((current - previous) / previous) * 100,
        units: 'clear-delivery points' as const,
    },
    takeaways: { whatWorked: 'Very few filler words', practiceThisNext: 'Cut filler words toward 3%', target: null },
    recommendationId: null,
    latestAttempt: null,
});

const Card = () => <ClarityVsLastSessionCard move={useClarityMove(HISTORY)} />;

const renderBoth = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <Card />
            <ProgressPanel session={{ id: 's2' } as PracticeSession} />
        </QueryClientProvider>,
    );
};

describe('G18 — the card and the Progress panel are two projections of ONE authority', () => {
    beforeEach(() => vi.mocked(loadSessionProgress).mockReset());

    it('CASUALTY: perturbing the authority moves BOTH surfaces, with the same two scores', async () => {
        vi.mocked(loadSessionProgress).mockResolvedValue(authority(82, 88));
        const first = renderBoth();
        await waitFor(() => expect(screen.getByTestId('clarity-vs-last-session-value')).toHaveTextContent(/82%\s*→\s*88%/));
        expect(screen.getByTestId('progress-direction')).toHaveTextContent('82% → 88%');
        first.unmount();

        // Same shape, different numbers: neither surface may keep the old pair or invent its own.
        vi.mocked(loadSessionProgress).mockResolvedValue(authority(71, 95));
        renderBoth();
        await waitFor(() => expect(screen.getByTestId('clarity-vs-last-session-value')).toHaveTextContent(/71%\s*→\s*95%/));
        expect(screen.getByTestId('progress-direction')).toHaveTextContent('71% → 95%');
        expect(screen.getByTestId('clarity-vs-last-session-value').textContent ?? '').not.toMatch(/82|88/);
    });

    it('CASUALTY: a sub-threshold move reaches BOTH surfaces as a comparison, and neither prints a percent-of-previous', async () => {
        vi.mocked(loadSessionProgress).mockResolvedValue(authority(88, 89));
        renderBoth();
        await waitFor(() => expect(screen.getByTestId('clarity-vs-last-session')).toHaveAttribute('data-progress-direction', 'held_steady'));
        expect(screen.getByTestId('clarity-vs-last-session-value')).toHaveTextContent(/88%\s*→\s*89%/);
        expect(screen.getByTestId('progress-direction')).toHaveTextContent('88% → 89%');
        // 1/88 = 1.136…% — the relative figure stays evidence, and must appear on neither surface.
        for (const testId of ['clarity-vs-last-session', 'progress-direction']) {
            expect(screen.getByTestId(testId).textContent ?? '').not.toMatch(/1\.1%|\+1\b/);
        }
    });
});
