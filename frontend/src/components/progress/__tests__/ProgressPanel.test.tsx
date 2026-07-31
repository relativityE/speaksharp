import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));
vi.mock('@/contexts/AuthProvider', () => ({ useAuthProvider: () => ({ user: { id: 'user-1' } }) }));

const loadSessionProgress = vi.fn();
vi.mock('@/services/progress/loadSessionProgress', () => ({ loadSessionProgress: (...a: unknown[]) => loadSessionProgress(...a) }));

const recordRecommendationAttempt = vi.fn();
vi.mock('@/services/progress/recordProgress', () => ({ recordRecommendationAttempt: (...a: unknown[]) => recordRecommendationAttempt(...a) }));

const setOpenAttempt = vi.fn();
vi.mock('@/services/progress/openAttempt', () => ({ setOpenAttempt: (...a: unknown[]) => setOpenAttempt(...a) }));

vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

import { ProgressPanel } from '../ProgressPanel';

const VIEW = {
    sessionId: 's1',
    direction: { direction: 'improved', deltaPoints: 4, reason: null, text: 'Clear delivery moved up 4 points.' },
    takeaways: { whatWorked: 'Very few filler words', practiceThisNext: 'Cut filler words toward 3%', target: { metric: 'filler_rate', direction: 'decrease', targetValue: 3, units: 'percent of words' } },
    recommendationId: 'rec-1',
};

function renderPanel() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={qc}>
            <MemoryRouter>
                <ProgressPanel session={{ id: 's1' }} sessionHistory={[]} />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    navigate.mockReset(); recordRecommendationAttempt.mockReset(); setOpenAttempt.mockReset();
    loadSessionProgress.mockReset();
    recordRecommendationAttempt.mockResolvedValue('att-1');
});

describe('#1045 ProgressPanel — the tester-visible loop', () => {
    it('renders nothing when there is no eligible evaluation yet (incl. pre-migration)', async () => {
        loadSessionProgress.mockResolvedValue(null);
        const { container } = renderPanel();
        await waitFor(() => expect(loadSessionProgress).toHaveBeenCalled());
        expect(container.querySelector('[data-testid="progress-panel"]')).toBeNull();
    });

    it('shows direction, exactly two takeaways, and the Practice this next action', async () => {
        loadSessionProgress.mockResolvedValue(VIEW);
        renderPanel();
        await screen.findByTestId('progress-panel');
        expect(screen.getByTestId('progress-direction').textContent).toBe('Clear delivery moved up 4 points.');
        expect(screen.getByTestId('progress-what-worked').textContent).toContain('Very few filler words');
        expect(screen.getByTestId('progress-practice-next').textContent).toContain('Cut filler words toward 3%');
        // The action button carries the canonical label.
        expect(screen.getByTestId('progress-accept').textContent).toContain('Practice this next');
    });

    it('accepting records an attempt, stores it as the open attempt, and navigates to practice', async () => {
        loadSessionProgress.mockResolvedValue(VIEW);
        renderPanel();
        fireEvent.click(await screen.findByTestId('progress-accept'));
        await waitFor(() => expect(recordRecommendationAttempt).toHaveBeenCalledWith('rec-1'));
        expect(setOpenAttempt).toHaveBeenCalledWith(expect.objectContaining({ attemptId: 'att-1', userId: 'user-1', sourceSessionId: 's1' }));
        await waitFor(() => expect(navigate).toHaveBeenCalledWith('/session'));
    });
});
