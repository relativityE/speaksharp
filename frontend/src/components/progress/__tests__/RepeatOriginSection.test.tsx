import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

let authUserId: string | null = 'user-1';
vi.mock('@/contexts/AuthProvider', () => ({ useAuthProvider: () => ({ user: authUserId ? { id: authUserId } : null }) }));
const loadRepeatOrigin = vi.fn();
vi.mock('@/services/progress/loadRepeatOrigin', () => ({ loadRepeatOrigin: (...a: unknown[]) => loadRepeatOrigin(...a) }));
import { RepeatOriginSection } from '../RepeatOriginSection';
import { clearOpenAttemptIfMatches, setOpenAttempt } from '@/services/progress/openAttempt';
import { formatOriginalSessionLabel } from '../repeatOutcomeCopy';

const ORIGINAL_AT = '2025-01-17T14:00:00.000Z';
const TARGET = { metric: 'filler_rate', direction: 'decrease', targetValue: 2, units: 'percent of words' } as const;
const repeat = (over: Record<string, unknown> = {}) => ({
    status: 'repeat', sessionId: 'B', originalSessionId: 'A', originalCreatedAt: ORIGINAL_AT, target: TARGET,
    lifecycle: 'completed', outcome: 'moved',
    repeatResult: { status: 'available', metric: 'filler_rate', direction: 'decrease', units: 'percent of words', before: (4 / 245) * 100, after: 0.8 },
    tip: { status: 'unavailable' },
    ...over,
});

function renderSection(sessionId = 'B') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter><RepeatOriginSection sessionId={sessionId} /></MemoryRouter>
        </QueryClientProvider>,
    );
}

const FORBIDDEN = /improv|reached|caused|because of|met the/i;

beforeEach(() => {
    authUserId = 'user-1';
    loadRepeatOrigin.mockReset();
    localStorage.clear();
});

describe('outcome 4 RepeatOriginSection', () => {
    it('completed with readable values: link to the original, before → after, outcome, delivery-only line', async () => {
        loadRepeatOrigin.mockResolvedValue(repeat());
        renderSection();
        const link = await screen.findByTestId('repeat-origin-link');
        expect(loadRepeatOrigin).toHaveBeenCalledWith('B', 'user-1');
        expect(link).toHaveTextContent(`Repeat of your ${formatOriginalSessionLabel(ORIGINAL_AT)} session`);
        expect(link).toHaveAttribute('href', '/progress/A');
        expect(screen.getByTestId('repeat-origin-values'))
            .toHaveTextContent('Filler rate: 1.6 → 0.8 percent of words (original session → this repeat).');
        expect(screen.getByTestId('repeat-origin-outcome'))
            .toHaveTextContent('Filler rate was lower on the repeat than in the original session.');
        expect(screen.getByTestId('repeat-origin-scope'))
            .toHaveTextContent('This comparison measures delivery, not whether the coaching tip was followed.');
        expect(screen.getByTestId('repeat-origin')).not.toHaveTextContent(FORBIDDEN);
    });

    it('completed, did not move: states the stored observation without a verdict', async () => {
        loadRepeatOrigin.mockResolvedValue(repeat({ outcome: 'did_not_move', repeatResult: { status: 'available', metric: 'pace', direction: 'increase', units: 'wpm', before: 140, after: 132 }, target: { ...TARGET, metric: 'pace', direction: 'increase', units: 'wpm' } }));
        renderSection();
        expect(await screen.findByTestId('repeat-origin-values')).toHaveTextContent('Pace: 140 → 132 wpm (original session → this repeat).');
        expect(screen.getByTestId('repeat-origin-outcome')).toHaveTextContent('Pace was not higher on the repeat than in the original session.');
        expect(screen.getByTestId('repeat-origin')).not.toHaveTextContent(FORBIDDEN);
    });

    it('values that print alike say they differ below the displayed precision', async () => {
        loadRepeatOrigin.mockResolvedValue(repeat({ repeatResult: { status: 'available', metric: 'filler_rate', direction: 'decrease', units: 'percent of words', before: 0.3, after: 0.3 - 1e-9 } }));
        renderSection();
        expect(await screen.findByTestId('repeat-origin-values')).toHaveTextContent('The stored values differ by less than the displayed precision.');
    });

    it('completed with unreadable values: link and the not-available line only', async () => {
        loadRepeatOrigin.mockResolvedValue(repeat({ repeatResult: { status: 'unavailable' } }));
        renderSection();
        expect(await screen.findByTestId('repeat-origin-link')).toHaveAttribute('href', '/progress/A');
        expect(screen.getByTestId('repeat-origin-values'))
            .toHaveTextContent('The original and repeat values for this comparison are not available.');
        expect(screen.queryByTestId('repeat-origin-outcome')).toBeNull();
        expect(screen.queryByTestId('repeat-origin-scope')).toBeNull();
        expect(screen.getByTestId('repeat-origin')).not.toHaveTextContent(/\d → \d/);
    });

    it('not comparable: link and "[Metric] could not be compared for this repeat."', async () => {
        loadRepeatOrigin.mockResolvedValue(repeat({ lifecycle: 'not_comparable', outcome: 'not_comparable', repeatResult: null }));
        renderSection();
        expect(await screen.findByTestId('repeat-origin-link')).toHaveAttribute('href', '/progress/A');
        expect(screen.getByTestId('repeat-origin-outcome')).toHaveTextContent('Filler rate could not be compared for this repeat.');
        expect(screen.queryByTestId('repeat-origin-values')).toBeNull();
        expect(screen.queryByTestId('repeat-origin-scope')).toBeNull();
    });

    it('an original with no usable date still links, without inventing one', async () => {
        loadRepeatOrigin.mockResolvedValue(repeat({ originalCreatedAt: null }));
        renderSection();
        expect(await screen.findByTestId('repeat-origin-link')).toHaveTextContent('Repeat of your earlier session');
    });

    it('not a repeat: renders nothing', async () => {
        loadRepeatOrigin.mockResolvedValue({ status: 'none', sessionId: 'B' });
        const { container } = renderSection();
        await waitFor(() => expect(loadRepeatOrigin).toHaveBeenCalled());
        await waitFor(() => expect(container).toBeEmptyDOMElement());
        expect(screen.queryByTestId('repeat-origin-error')).toBeNull();
    });

    it('a read failure is never "not a repeat": a one-line retry that reads again', async () => {
        loadRepeatOrigin.mockResolvedValueOnce({ status: 'error', sessionId: 'B' }).mockResolvedValueOnce(repeat());
        renderSection();
        const alert = await screen.findByTestId('repeat-origin-error');
        expect(alert).toHaveAttribute('role', 'alert');
        expect(alert).toHaveTextContent('Whether this session repeats an earlier one could not be checked.');
        expect(screen.queryByTestId('repeat-origin')).toBeNull();
        fireEvent.click(screen.getByTestId('repeat-origin-retry'));
        expect(await screen.findByTestId('repeat-origin-link')).toHaveAttribute('href', '/progress/A');
        expect(loadRepeatOrigin).toHaveBeenCalledTimes(2);
    });

    it('a thrown read shows the same retry line', async () => {
        loadRepeatOrigin.mockRejectedValue(new Error('network'));
        renderSection();
        expect(await screen.findByTestId('repeat-origin-error')).toBeInTheDocument();
    });

    it('reads nothing and renders nothing without a signed-in owner', async () => {
        authUserId = null;
        const { container } = renderSection();
        expect(container).toBeEmptyDOMElement();
        expect(loadRepeatOrigin).not.toHaveBeenCalled();
    });

    it('a repeat still resolving when the page opened appears once its attempt resolves, without a reload', async () => {
        // The save bound this take to the open attempt; the non-blocking advance has not finished yet.
        expect(setOpenAttempt({ attemptId: 'att-1', userId: 'user-1', sourceSessionId: 'A', resolutionSessionId: 'B' })).toBe(true);
        loadRepeatOrigin.mockResolvedValueOnce({ status: 'none', sessionId: 'B' }).mockResolvedValue(repeat());
        renderSection();
        await waitFor(() => expect(loadRepeatOrigin).toHaveBeenCalledTimes(1));
        expect(screen.queryByTestId('repeat-origin')).toBeNull();
        // The advance succeeded: `advanceBoundAttempt` clears exactly this handoff.
        expect(clearOpenAttemptIfMatches('user-1', 'att-1')).toBe(true);
        expect(await screen.findByTestId('repeat-origin-link')).toHaveAttribute('href', '/progress/A');
        expect(loadRepeatOrigin).toHaveBeenCalledTimes(2);
    });

    it('a handoff change on a page already showing its repeat does not read again', async () => {
        loadRepeatOrigin.mockResolvedValue(repeat());
        renderSection();
        await screen.findByTestId('repeat-origin-link');
        expect(setOpenAttempt({ attemptId: 'att-9', userId: 'user-1', sourceSessionId: 'B' })).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(loadRepeatOrigin).toHaveBeenCalledTimes(1);
    });

    it('the tip it practised is shown as practised, in its own line, with the measured lines unchanged', async () => {
        const tipText = 'Pause and breathe instead of saying um.';
        loadRepeatOrigin.mockResolvedValue(repeat({ tip: { status: 'saved', text: tipText } }));
        renderSection();
        expect(await screen.findByTestId('repeat-origin-tip')).toHaveTextContent(`Tip you practised: “${tipText}”`);
        expect(screen.getByTestId('repeat-origin-values'))
            .toHaveTextContent('Filler rate: 1.6 → 0.8 percent of words (original session → this repeat).');
        expect(screen.getByTestId('repeat-origin-outcome'))
            .toHaveTextContent('Filler rate was lower on the repeat than in the original session.');
        expect(screen.getByTestId('repeat-origin-scope'))
            .toHaveTextContent('This comparison measures delivery, not whether the coaching tip was followed.');
        // Never a verdict about the tip; the tip's own words are the user's coaching and are not checked.
        const ownCopy = (screen.getByTestId('repeat-origin').textContent ?? '').replace(tipText, '');
        expect(ownCopy).not.toMatch(FORBIDDEN);
        expect(screen.queryByTestId('progress-practice-next')).toBeNull();
    });

    it('a tip that would read as a verdict is still only quoted', async () => {
        loadRepeatOrigin.mockResolvedValue(repeat({ tip: { status: 'saved', text: 'You improved, keep it up.' } }));
        renderSection();
        expect(await screen.findByTestId('repeat-origin-tip')).toHaveTextContent('Tip you practised: “You improved, keep it up.”');
        expect((screen.getByTestId('repeat-origin').textContent ?? '').replace('You improved, keep it up.', '')).not.toMatch(FORBIDDEN);
    });

    it('a not-comparable repeat shows its tip too', async () => {
        loadRepeatOrigin.mockResolvedValue(repeat({ lifecycle: 'not_comparable', outcome: 'not_comparable', repeatResult: null, tip: { status: 'saved', text: 'Slow down.' } }));
        renderSection();
        expect(await screen.findByTestId('repeat-origin-tip')).toHaveTextContent('Tip you practised: “Slow down.”');
    });

    it('no saved tip says so plainly', async () => {
        loadRepeatOrigin.mockResolvedValue(repeat({ tip: { status: 'not_saved' } }));
        renderSection();
        expect(await screen.findByTestId('repeat-origin-tip')).toHaveTextContent('No coaching tip was saved for this repeat.');
    });

    it('before the migration (column unavailable): no tip line at all', async () => {
        loadRepeatOrigin.mockResolvedValue(repeat());
        renderSection();
        await screen.findByTestId('repeat-origin-link');
        expect(screen.queryByTestId('repeat-origin-tip')).toBeNull();
    });
});
