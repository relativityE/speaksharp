import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));
let authUserId = 'user-1';
vi.mock('@/contexts/AuthProvider', () => ({ useAuthProvider: () => ({ user: { id: authUserId } }) }));
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
    direction: { direction: 'improved', deltaPoints: 4, deltaPercent: 5, reason: null, text: 'Clearer than your previous comparable session: 80% → 84%.' },
    baselineContext: 'Clearer than your first comparable session: 80% → 90%.',
    disclosure: {
        referenceSessionId: 's0', referenceRole: 'previous comparable session', alsoFirstComparable: false,
        cohortKey: 'private|v2|base|clarity_v1', currentClarityPoints: 84, referenceClarityPoints: 80,
        deltaPoints: 4, deltaPercent: 5, units: 'clear-delivery points',
    },
    takeaways: { whatWorked: 'Very few filler words', practiceThisNext: 'Cut filler words toward 3%', target: { metric: 'filler_rate', direction: 'decrease', targetValue: 3, units: 'percent of words' } },
    recommendationId: 'rec-1',
};

function renderPanel(nextActionOwnedByReview = false) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}><MemoryRouter><ProgressPanel session={{ id: 's1' }} nextActionOwnedByReview={nextActionOwnedByReview} /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
    authUserId = 'user-1';
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
    it.each([
        ['filler_rate', 'decrease', 7, 'percent of words', 'Filler rate (saved target: decrease toward 7 percent of words)'],
        ['pace', 'increase', 130, 'words per minute', 'Pace (saved target: increase toward 130 words per minute)'],
        ['clear_delivery', 'maintain', 94, 'clear-delivery points', 'Clear delivery (saved target: maintain at 94 clear-delivery points)'],
        ['clear_delivery', 'maintain', 98.78048780487805, 'points', 'Clear delivery (saved target: maintain at 99 points)'],
        ['clear_delivery', 'maintain', 98.78048780487805, 'clear-delivery points', 'Clear delivery (saved target: maintain at 99 clear-delivery points)'],
        ['filler_rate', 'decrease', 2.75, 'percent of words', 'Filler rate (saved target: decrease toward 2.75 percent of words)'],
    ] as const)('#1548 A2: labels the stored %s comparison as separate delivery evidence when the saved review owns the action (row %#)', async (metric, direction, targetValue, units, label) => {
        loadSessionProgress.mockResolvedValue({
            ...VIEW,
            takeaways: { ...VIEW.takeaways, target: { metric, direction, targetValue, units } },
            latestAttempt: { id: 'att-1', lifecycle: 'completed', outcome: 'moved' },
        });
        renderPanel(true);
        const target = await screen.findByTestId('progress-attempt-target');
        expect(target).toHaveTextContent(`Separate delivery comparison: ${label}.`);
        expect(screen.getByTestId('progress-attempt-scope'))
            .toHaveTextContent('This comparison measures delivery, not whether the coaching tip was followed.');
        expect(screen.getByTestId('progress-attempt-outcome').parentElement).toContainElement(target);
        // The persisted value is labelled as a saved target, never an observed measurement; neither the practised tip nor
        // reaching the target is claimed from the metric.
        expect(target.parentElement).not.toHaveTextContent(/practiced direction|Measured repeat target|recorded at|improv|reached|met the/i);
        expect(screen.queryByTestId('progress-practice-next')).not.toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it.each([
        ['filler_rate', 'decrease', 'completed', 'moved', 'Filler rate was lower on the repeat than in the original session.'],
        ['filler_rate', 'decrease', 'completed', 'did_not_move', 'Filler rate was not lower on the repeat than in the original session.'],
        ['pace', 'increase', 'completed', 'moved', 'Pace was higher on the repeat than in the original session.'],
        ['pace', 'increase', 'completed', 'did_not_move', 'Pace was not higher on the repeat than in the original session.'],
        // The server counts maintain equality as `moved` (v_next_val >= source), so equality reads as "stayed the same".
        ['clear_delivery', 'maintain', 'completed', 'moved', 'Clear delivery stayed the same or increased compared with the original session.'],
        ['clear_delivery', 'maintain', 'completed', 'did_not_move', 'Clear delivery decreased compared with the original session.'],
        ['filler_rate', 'decrease', 'not_comparable', 'not_comparable', 'Filler rate could not be compared for this repeat.'],
        ['pace', 'increase', 'abandoned', null, 'The stored repeat was not completed.'],
    ] as const)('#1548 A2: review-owned %s/%s %s/%s states only the stored delivery result', async (metric, direction, lifecycle, outcome, copy) => {
        loadSessionProgress.mockResolvedValue({
            ...VIEW,
            takeaways: { ...VIEW.takeaways, target: { metric, direction, targetValue: 5, units: 'units' } },
            latestAttempt: { id: 'att-state', lifecycle, outcome },
        });
        renderPanel(true);
        const line = await screen.findByTestId('progress-attempt-outcome');
        expect(line).toHaveTextContent(copy);
        expect(line).not.toHaveTextContent(/practiced direction|improv|target/i);
        expect(screen.queryByTestId('progress-practice-next')).not.toBeInTheDocument();
        expect(screen.queryByTestId('progress-accept')).not.toBeInTheDocument();
    });

    it('#1548 A2: a review-owned pending repeat stays pending and keeps its Close control, never a second next action', async () => {
        loadSessionProgress.mockResolvedValue({ ...VIEW, latestAttempt: { id: 'att-pending', lifecycle: 'pending', outcome: null } });
        renderPanel(true);
        expect(await screen.findByTestId('progress-attempt-outcome')).toHaveTextContent('Your linked repeat is pending.');
        expect(screen.getByRole('button', { name: 'Close pending repeat' })).toBeTruthy();
        expect(screen.queryByTestId('progress-practice-next')).not.toBeInTheDocument();
        expect(screen.queryByTestId('progress-accept')).not.toBeInTheDocument();
    });

    it('#1254: renders the loader\'s comparison takeaway naming the previous COMPARABLE session, never "last session"', async () => {
        // The string is what loadSessionProgress produces for s2 vs its persisted previous comparable s0 when an ineligible
        // s1 sits between them (loadSessionProgress.test.ts '#1254'); this asserts the panel renders it verbatim.
        loadSessionProgress.mockResolvedValue({
            ...VIEW,
            takeaways: { ...VIEW.takeaways, whatWorked: 'Clearer than your previous comparable session' },
        });
        renderPanel(true);
        const worked = await screen.findByTestId('progress-what-worked');
        expect(worked).toHaveTextContent('Clearer than your previous comparable session');
        expect(worked).not.toHaveTextContent(/last session/i);
    });

    it.each([
        [true, 'Separate delivery comparison: Clear delivery (saved target: maintain at 99 points).', 'Clear delivery decreased compared with the original session.'],
        [false, 'Clear delivery; maintain at 99 points.', 'The stored repeat did not show movement in the practiced direction.'],
    ] as const)('rounds only the clarity label while retaining the raw target and stored comparison outcome (review-owned: %s)', async (reviewOwned, label, outcome) => {
        const target = Object.freeze({ metric: 'clear_delivery', direction: 'maintain', targetValue: 98.78048780487805, units: 'points' });
        loadSessionProgress.mockResolvedValue({
            ...VIEW,
            takeaways: { ...VIEW.takeaways, target },
            latestAttempt: { id: 'att-fractional', lifecycle: 'completed', outcome: 'did_not_move' },
        });
        renderPanel(reviewOwned);
        expect(await screen.findByTestId('progress-attempt-target')).toHaveTextContent(label);
        expect(screen.getByTestId('progress-attempt-outcome')).toHaveTextContent(outcome);
        expect(target.targetValue).toBe(98.78048780487805);
    });

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

    it('provides a precise label for every persisted exclusion reason', async () => {
        const labels = {
            not_completed: 'This session was not completed, so it cannot be compared.',
            too_short: 'This session was too short for a reliable comparison.',
            too_few_words: 'This session needs more spoken words for a reliable comparison.',
            no_transcript: 'No transcript was available for this session.',
            no_clarity_evidence: 'Clear-delivery evidence was not available for this session.',
            unverified_attribution: 'The recording evidence could not be verified.',
            engine_not_comparable: 'This recording setup cannot be compared with the earlier setup.',
            unknown: 'This session did not meet the comparison evidence requirements.',
        } as const;
        const reasons = Object.keys(labels) as Array<keyof typeof labels>;
        loadSessionProgress.mockResolvedValue({ status: 'ineligible', sessionId: 's1', reasons });
        renderPanel();
        for (const reason of reasons) expect(await screen.findByText(labels[reason])).toBeTruthy();
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
        expect(await screen.findByTestId('progress-direction')).toHaveTextContent('Clearer than your previous comparable session: 80% → 84%.');
        expect(screen.getByTestId('progress-baseline-context')).toHaveTextContent('Clearer than your first comparable session: 80% → 90%.');
        expect(screen.getByTestId('progress-what-worked')).toHaveTextContent('Very few filler words');
        expect(screen.getByTestId('progress-practice-next')).toHaveTextContent('Cut filler words toward 3%');
        expect(screen.getByTestId('progress-accept')).toHaveTextContent('Practice this next');
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(loadSessionProgress).toHaveBeenCalledWith('s1');
    });

    it('renders an inspectable evidence disclosure: reference session, cohort, inputs, and units', async () => {
        loadSessionProgress.mockResolvedValue(VIEW);
        renderPanel();
        const disclosure = await screen.findByTestId('progress-disclosure');
        expect(disclosure).toBeTruthy();
        // The validated reference session, the cohort/mode, and the raw inputs with their units are all present.
        expect(screen.getByTestId('progress-disclosure-reference')).toHaveTextContent('previous comparable session (session s0)');
        expect(screen.getByTestId('progress-disclosure-cohort')).toHaveTextContent('private|v2|base|clarity_v1');
        expect(screen.getByTestId('progress-disclosure-inputs')).toHaveTextContent('this session 84 vs 80 clear-delivery points');
        expect(screen.getByTestId('progress-disclosure-inputs')).toHaveTextContent('+4 clear-delivery points');
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

    it.each([
        ['completed', 'did_not_move', /did not show movement/i],
        ['not_comparable', 'not_comparable', /was not comparable/i],
        ['abandoned', null, /was not completed/i],
    ] as const)('renders stored %s/%s lifecycle truth without converting it to success', async (lifecycle, outcome, copy) => {
        loadSessionProgress.mockResolvedValue({
            ...VIEW,
            latestAttempt: { id: 'att-terminal', lifecycle, outcome },
        });
        renderPanel();
        expect(await screen.findByTestId('progress-attempt-outcome')).toHaveTextContent(copy);
        expect(screen.getByTestId('progress-attempt-outcome')).not.toHaveTextContent(/shows movement in/i);
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

    // #1258 G20 (PM 2026-09-25): the saved review owns the page's ONE next action; the panel keeps its metrics.
    it('when the review owns the next action: metrics stay, the competing sentence and button do not', async () => {
        loadSessionProgress.mockResolvedValue(VIEW);
        renderPanel(true);
        expect(await screen.findByTestId('progress-direction')).toHaveTextContent('Clearer than your previous comparable session');
        expect(screen.getByTestId('progress-what-worked')).toBeInTheDocument();
        expect(screen.queryByTestId('progress-practice-next')).not.toBeInTheDocument();
        expect(screen.queryByTestId('progress-accept')).not.toBeInTheDocument();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });
});

describe('#1548 the linked repeat shows the same target before → after', () => {
    const completed = { id: 'att-done', lifecycle: 'completed', outcome: 'moved' } as const;
    const available = (over: Record<string, unknown> = {}) => ({
        status: 'available', metric: 'filler_rate', direction: 'decrease', units: 'percent of words', before: 4.5, after: 3.2, ...over,
    });

    it.each([true, false])('states both stored values in the stored units, without claiming the target was reached (review-owned: %s)', async (reviewOwned) => {
        loadSessionProgress.mockResolvedValue({ ...VIEW, latestAttempt: completed, repeatResult: available() });
        renderPanel(reviewOwned);
        const values = await screen.findByTestId('progress-attempt-values');
        expect(values).toHaveTextContent('Filler rate: 4.5 → 3.2 percent of words (original session → linked repeat).');
        expect(values).not.toHaveTextContent(/reached|met the|achiev|improv|success/i);
        // The values sit with the stored outcome and, review-owned, with the delivery-only scope line.
        expect(screen.getByTestId('progress-attempt-outcome').parentElement).toContainElement(values);
        // Review-owned, the delivery-only scope line stays beside the values.
        expect(screen.queryAllByText('This comparison measures delivery, not whether the coaching tip was followed.'))
            .toHaveLength(reviewOwned ? 1 : 0);
    });

    it.each([
        ['pace', 'words per minute', 160.4, 151, 'Pace: 160 → 151 words per minute'],
        ['clear_delivery', 'points', 88.2, 93.4, 'Clear delivery: 88 → 93 points'],
        // Different stored values never print alike: precision grows until they differ.
        ['filler_rate', 'percent of words', 3.04, 3.01, 'Filler rate: 3.04 → 3.01 percent of words'],
        ['pace', 'words per minute', 150.2, 150.4, 'Pace: 150.2 → 150.4 words per minute'],
        ['filler_rate', 'percent of words', 3, 3, 'Filler rate: 3.0 → 3.0 percent of words'],
        // Sam 1793055143.755569: 3/1000 vs 3/1001 of words (the real filler formula) print alike at three decimals.
        ['filler_rate', 'percent of words', (3 / 1000) * 100, (3 / 1001) * 100, 'Filler rate: 0.3000 → 0.2997 percent of words'],
        // Sam 1793055247.293479: a recommendation-realistic pair that strict server comparison calls "decreased" but
        // that prints 6.100 → 6.100 at three decimals.
        ['filler_rate', 'percent of words', (61 / 1000) * 100, (33 / 541) * 100, 'Filler rate: 6.1000 → 6.0998 percent of words'],
    ] as const)('formats %s %s → %s', async (metric, units, before, after, text) => {
        loadSessionProgress.mockResolvedValue({ ...VIEW, latestAttempt: completed, repeatResult: available({ metric, units, before, after }) });
        renderPanel(true);
        const values = await screen.findByTestId('progress-attempt-values');
        expect(values).toHaveTextContent(text);
        expect(values).not.toHaveTextContent('displayed precision');
    });

    it('says a stored change below the displayed precision is below it, never printing two identical values as a change', async () => {
        const before = 0.3;
        const after = 0.3 - 4e-8; // a real stored difference smaller than six decimals
        loadSessionProgress.mockResolvedValue({ ...VIEW, latestAttempt: completed, repeatResult: available({ before, after }) });
        renderPanel(true);
        const values = await screen.findByTestId('progress-attempt-values');
        expect(values).toHaveTextContent('Filler rate: 0.300000 → 0.300000 percent of words (original session → linked repeat). The stored values differ by less than the displayed precision.');
        // The server's stored outcome is shown unchanged beside it.
        expect(screen.getByTestId('progress-attempt-outcome')).toHaveTextContent('Filler rate was lower on the repeat than in the original session.');
    });

    it.each([true, false])('says the values are unavailable — never a zero — when the evidence is gone (review-owned: %s)', async (reviewOwned) => {
        loadSessionProgress.mockResolvedValue({ ...VIEW, latestAttempt: completed, repeatResult: { status: 'unavailable' } });
        renderPanel(reviewOwned);
        const values = await screen.findByTestId('progress-attempt-values');
        expect(values).toHaveTextContent('The original and repeat values for this comparison are not available.');
        expect(values).not.toHaveTextContent(/\d/);
        expect(screen.getByTestId('progress-attempt-outcome')).toBeInTheDocument();
    });

    it.each([
        ['pending', { id: 'att-p', lifecycle: 'pending', outcome: null }],
        ['not comparable', { id: 'att-n', lifecycle: 'not_comparable', outcome: 'not_comparable' }],
        ['abandoned', { id: 'att-a', lifecycle: 'abandoned', outcome: 'not_completed' }],
    ] as const)('shows no values line for a %s attempt', async (_label, latestAttempt) => {
        loadSessionProgress.mockResolvedValue({ ...VIEW, latestAttempt, repeatResult: null });
        renderPanel(true);
        await screen.findByTestId('progress-attempt-outcome');
        expect(screen.queryByTestId('progress-attempt-values')).not.toBeInTheDocument();
    });

    it("a late response for account A never shows A's values after switching to account B", async () => {
        let resolveA: (value: unknown) => void = () => undefined;
        loadSessionProgress.mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
        loadSessionProgress.mockResolvedValueOnce({ ...VIEW, latestAttempt: completed, repeatResult: available({ before: 7.5, after: 6 }) });
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const tree = () => <QueryClientProvider client={qc}><MemoryRouter><ProgressPanel session={{ id: 's1' }} nextActionOwnedByReview /></MemoryRouter></QueryClientProvider>;
        const { rerender } = render(tree());
        await waitFor(() => expect(loadSessionProgress).toHaveBeenCalledTimes(1));
        authUserId = 'user-2';
        rerender(tree());
        expect(await screen.findByTestId('progress-attempt-values')).toHaveTextContent('Filler rate: 7.5 → 6.0 percent of words');
        resolveA({ ...VIEW, latestAttempt: completed, repeatResult: available({ before: 4.5, after: 3.2 }) });
        await new Promise((r) => setTimeout(r, 0));
        expect(screen.getByTestId('progress-attempt-values')).toHaveTextContent('Filler rate: 7.5 → 6.0 percent of words');
        expect(screen.queryByText(/4\.5 → 3\.2/)).not.toBeInTheDocument();
    });
});
