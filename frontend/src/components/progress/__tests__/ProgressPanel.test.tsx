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
const abandonRecommendationAttempt = vi.fn();
vi.mock('@/services/progress/recordProgress', () => ({
    recordRecommendationAttempt: (...a: unknown[]) => recordRecommendationAttempt(...a),
    abandonRecommendationAttempt: (...a: unknown[]) => abandonRecommendationAttempt(...a),
}));
const setOpenAttempt = vi.fn();
vi.mock('@/services/progress/openAttempt', () => ({ setOpenAttempt: (...a: unknown[]) => setOpenAttempt(...a) }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));
import { ProgressPanel } from '../ProgressPanel';

const VIEW = {
    status: 'eligible', sessionId: 's1', comparison: 'previous', latestAttempt: null,
    direction: { direction: 'improved', deltaPoints: 4, reason: null, text: 'Clear delivery moved up 4 points.' },
    takeaways: { whatWorked: 'Very few filler words', practiceThisNext: 'Cut filler words toward 3%', target: { metric: 'filler_rate', direction: 'decrease', targetValue: 3, units: 'percent of words' } },
    recommendationId: 'rec-1',
};

function renderPanel() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}><MemoryRouter><ProgressPanel session={{ id: 's1' }} /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
    navigate.mockReset(); recordRecommendationAttempt.mockReset(); setOpenAttempt.mockReset();
    abandonRecommendationAttempt.mockReset(); loadSessionProgress.mockReset();
    recordRecommendationAttempt.mockResolvedValue('att-1');
    setOpenAttempt.mockReturnValue(true);
    abandonRecommendationAttempt.mockResolvedValue(true);
});

describe('#1047 U2 ProgressPanel', () => {
    it('shows honest insufficient evidence instead of a blank panel', async () => {
        loadSessionProgress.mockResolvedValue({ status: 'insufficient', sessionId: 's1' });
        renderPanel();
        expect(await screen.findByText(/More evidence is needed/)).toBeTruthy();
    });

    it('shows exactly two eligible takeaways and the canonical action', async () => {
        loadSessionProgress.mockResolvedValue(VIEW);
        renderPanel();
        expect(await screen.findByTestId('progress-direction')).toHaveTextContent('moved up 4 points');
        expect(screen.getByTestId('progress-what-worked')).toHaveTextContent('Very few filler words');
        expect(screen.getByTestId('progress-practice-next')).toHaveTextContent('Cut filler words toward 3%');
        expect(screen.getByTestId('progress-accept')).toHaveTextContent('Practice this next');
    });

    it('navigates only after server attempt and durable local handoff succeed', async () => {
        loadSessionProgress.mockResolvedValue(VIEW);
        renderPanel();
        fireEvent.click(await screen.findByTestId('progress-accept'));
        await waitFor(() => expect(setOpenAttempt).toHaveBeenCalledWith(expect.objectContaining({ attemptId: 'att-1', userId: 'user-1', sourceSessionId: 's1' })));
        expect(navigate).toHaveBeenCalledWith('/session');
    });

    it('does not navigate when server attempt creation fails', async () => {
        loadSessionProgress.mockResolvedValue(VIEW);
        recordRecommendationAttempt.mockResolvedValue(null);
        renderPanel();
        fireEvent.click(await screen.findByTestId('progress-accept'));
        expect(await screen.findByRole('alert')).toHaveTextContent(/could not be linked/i);
        expect(setOpenAttempt).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
    });

    it('abandons a created attempt when local handoff fails and stays on review', async () => {
        loadSessionProgress.mockResolvedValue(VIEW);
        setOpenAttempt.mockReturnValue(false);
        renderPanel();
        fireEvent.click(await screen.findByTestId('progress-accept'));
        await waitFor(() => expect(abandonRecommendationAttempt).toHaveBeenCalledWith('att-1'));
        expect(navigate).not.toHaveBeenCalled();
    });
});
