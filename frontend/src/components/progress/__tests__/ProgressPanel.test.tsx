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
const readPendingRecommendationAttempt = vi.fn();
vi.mock('@/services/progress/recordProgress', () => ({
    recordRecommendationAttempt: (...a: unknown[]) => recordRecommendationAttempt(...a),
    abandonRecommendationAttempt: (...a: unknown[]) => abandonRecommendationAttempt(...a),
    readPendingRecommendationAttempt: (...a: unknown[]) => readPendingRecommendationAttempt(...a),
}));
const setOpenAttempt = vi.fn();
const clearOpenAttemptIfMatches = vi.fn();
vi.mock('@/services/progress/openAttempt', () => ({
    setOpenAttempt: (...a: unknown[]) => setOpenAttempt(...a),
    clearOpenAttemptIfMatches: (...a: unknown[]) => clearOpenAttemptIfMatches(...a),
}));
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
    readPendingRecommendationAttempt.mockReset(); clearOpenAttemptIfMatches.mockReset();
    recordRecommendationAttempt.mockResolvedValue('att-1');
    readPendingRecommendationAttempt.mockResolvedValue({ status: 'none' });
    setOpenAttempt.mockReturnValue(true);
    abandonRecommendationAttempt.mockResolvedValue(true);
    clearOpenAttemptIfMatches.mockReturnValue(true);
});

describe('#1047 U2 ProgressPanel', () => {
    it('renders loading without coaching or success navigation', () => {
        loadSessionProgress.mockReturnValue(new Promise(() => undefined));
        renderPanel();
        expect(screen.getByTestId('progress-loading')).toHaveTextContent('Loading progress');
        expect(screen.queryByTestId('progress-what-worked')).toBeNull();
        expect(navigate).not.toHaveBeenCalled();
    });

    it('shows honest insufficient evidence instead of a blank panel', async () => {
        loadSessionProgress.mockResolvedValue({ status: 'insufficient', sessionId: 's1' });
        renderPanel();
        expect(await screen.findByText(/More evidence is needed/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Practice again' }));
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith('/session');
        expect(screen.queryByTestId('progress-what-worked')).toBeNull();
    });

    it('shows an ineligibility reason and exactly one neutral collection action', async () => {
        loadSessionProgress.mockResolvedValue({ status: 'ineligible', sessionId: 's1', reasons: ['too_few_words'] });
        renderPanel();
        expect(await screen.findByText(/needs more spoken words/i)).toBeTruthy();
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Collect more evidence' })).toBeTruthy();
        expect(screen.queryByTestId('progress-what-worked')).toBeNull();
    });

    it('renders a retryable load error without coaching and restores focus after success', async () => {
        loadSessionProgress
            .mockResolvedValueOnce({ status: 'error', sessionId: 's1', message: 'Progress could not be loaded.' })
            .mockResolvedValueOnce(VIEW);
        renderPanel();
        const retry = await screen.findByRole('button', { name: 'Retry' });
        expect(screen.queryByTestId('progress-what-worked')).toBeNull();
        fireEvent.click(retry);
        const heading = await screen.findByRole('heading', { name: 'Your progress' });
        await waitFor(() => expect(heading).toHaveFocus());
    });

    it('renders missing server recommendation as retryable unavailable, never synthesized coaching', async () => {
        loadSessionProgress.mockResolvedValue({ status: 'unavailable', sessionId: 's1', message: 'Your next action is not available yet.' });
        renderPanel();
        expect(await screen.findByRole('alert')).toHaveTextContent(/not available/i);
        expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
        expect(screen.queryByTestId('progress-practice-next')).toBeNull();
        expect(screen.queryByTestId('progress-accept')).toBeNull();
    });

    it('shows exactly two eligible takeaways and the canonical action', async () => {
        loadSessionProgress.mockResolvedValue(VIEW);
        renderPanel();
        expect(await screen.findByTestId('progress-direction')).toHaveTextContent('moved up 4 points');
        expect(screen.getByTestId('progress-what-worked')).toHaveTextContent('Very few filler words');
        expect(screen.getByTestId('progress-practice-next')).toHaveTextContent('Cut filler words toward 3%');
        expect(screen.getByTestId('progress-accept')).toHaveTextContent('Practice this next');
        expect(loadSessionProgress).toHaveBeenCalledWith('s1');
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

    it('adopts one authoritative pending attempt after a lost acceptance response without creating again', async () => {
        loadSessionProgress.mockResolvedValue(VIEW);
        readPendingRecommendationAttempt
            .mockResolvedValueOnce({ status: 'none' })
            .mockResolvedValueOnce({ status: 'one', attemptId: 'att-committed' });
        recordRecommendationAttempt.mockResolvedValueOnce(null);
        renderPanel();
        fireEvent.click(await screen.findByTestId('progress-accept'));
        fireEvent.click(await screen.findByRole('button', { name: /Retry Practice this next/i }));
        await waitFor(() => expect(setOpenAttempt).toHaveBeenCalledWith(expect.objectContaining({ attemptId: 'att-committed' })));
        expect(recordRecommendationAttempt).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith('/session');
    });

    it('fails closed when pending-attempt readback is ambiguous or unavailable', async () => {
        loadSessionProgress.mockResolvedValue(VIEW);
        readPendingRecommendationAttempt.mockResolvedValue({ status: 'blocked' });
        renderPanel();
        fireEvent.click(await screen.findByTestId('progress-accept'));
        expect(await screen.findByRole('alert')).toHaveTextContent(/could not be linked/i);
        expect(recordRecommendationAttempt).not.toHaveBeenCalled();
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

    it('fails closed without a second attempt when compensation fails', async () => {
        loadSessionProgress.mockResolvedValue(VIEW);
        setOpenAttempt.mockReturnValue(false);
        abandonRecommendationAttempt.mockResolvedValue(false);
        renderPanel();
        fireEvent.click(await screen.findByTestId('progress-accept'));
        expect(await screen.findByRole('alert')).toHaveTextContent(/Retry is unavailable/i);
        expect(screen.queryByRole('button', { name: /Retry Practice this next/i })).toBeNull();
        expect(recordRecommendationAttempt).toHaveBeenCalledTimes(1);
        expect(navigate).not.toHaveBeenCalled();
    });

    it('renders the persisted server outcome on reopen', async () => {
        loadSessionProgress.mockResolvedValue({
            ...VIEW,
            latestAttempt: { id: 'att-complete', lifecycle: 'completed', outcome: 'moved' },
        });
        renderPanel();
        expect(await screen.findByTestId('progress-attempt-outcome')).toHaveTextContent(/stored repeat shows movement/i);
    });

    it('reload recovers an authoritative pending attempt and blocks a second attempt until terminal cleanup', async () => {
        const pendingView = { ...VIEW, latestAttempt: { id: 'att-orphan', lifecycle: 'pending', outcome: null } };
        loadSessionProgress.mockResolvedValueOnce(pendingView).mockResolvedValue(VIEW);
        abandonRecommendationAttempt.mockResolvedValue(true);
        renderPanel();
        expect(await screen.findByText(/previous repeat is still pending/i)).toBeTruthy();
        expect(screen.queryByTestId('progress-accept')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Close pending repeat' }));
        await waitFor(() => expect(abandonRecommendationAttempt).toHaveBeenCalledWith('att-orphan'));
        expect(clearOpenAttemptIfMatches).toHaveBeenCalledWith('user-1', 'att-orphan');
        expect(recordRecommendationAttempt).not.toHaveBeenCalled();
        expect(await screen.findByTestId('progress-accept')).toBeTruthy();
    });

    it('reload stays blocked when authoritative pending-attempt cleanup still fails', async () => {
        loadSessionProgress.mockResolvedValue({
            ...VIEW,
            latestAttempt: { id: 'att-orphan', lifecycle: 'pending', outcome: null },
        });
        abandonRecommendationAttempt.mockResolvedValue(false);
        renderPanel();
        fireEvent.click(await screen.findByRole('button', { name: 'Close pending repeat' }));
        expect(await screen.findByText(/New attempts remain blocked/i)).toBeTruthy();
        expect(recordRecommendationAttempt).not.toHaveBeenCalled();
        expect(clearOpenAttemptIfMatches).not.toHaveBeenCalled();
        expect(screen.queryByTestId('progress-accept')).toBeNull();
    });

    it('stays blocked when server abandonment succeeds but matching local cleanup fails', async () => {
        loadSessionProgress.mockResolvedValue({
            ...VIEW,
            latestAttempt: { id: 'att-orphan', lifecycle: 'pending', outcome: null },
        });
        abandonRecommendationAttempt.mockResolvedValue(true);
        clearOpenAttemptIfMatches.mockReturnValue(false);
        renderPanel();
        fireEvent.click(await screen.findByRole('button', { name: 'Close pending repeat' }));
        expect(await screen.findByText(/local handoff could not be cleared/i)).toBeTruthy();
        expect(loadSessionProgress).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('progress-accept')).toBeNull();
    });
});
