import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const startObjectiveBrief = vi.fn();
vi.mock('@/services/objective/objectiveBriefService', async (orig) => ({
    ...(await orig<typeof import('@/services/objective/objectiveBriefService')>()),
    startObjectiveBrief: (...args: unknown[]) => startObjectiveBrief(...args),
}));

import { ObjectiveSetupForm } from '../ObjectiveSetupForm';

describe('#1046 ObjectiveSetupForm (capture UI)', () => {
    beforeEach(() => { startObjectiveBrief.mockReset(); cleanup(); });

    it('starts with a topic dropdown and three focus-point rows, submit disabled', () => {
        render(<ObjectiveSetupForm />);
        // #1046: "What are you rehearsing?" is a topic dropdown (4 presets + Other), not free text by default.
        expect(screen.getByTestId('objective-goal-select')).toBeInTheDocument();
        expect(screen.queryByTestId('objective-goal-input')).toBeNull(); // free text only under "Other"
        expect(screen.getAllByRole('listitem')).toHaveLength(3);
        expect(screen.getByTestId('objective-setup-submit')).toBeDisabled();
        expect(screen.getByTestId('objective-setup-submit')).toHaveTextContent('Proceed to session');
        expect(screen.queryByText(/Name what you.re rehearsing/i)).not.toBeInTheDocument();
    });

    it('picking a preset topic sets the goal; submit enables once a point is labelled', () => {
        render(<ObjectiveSetupForm />);
        const submit = screen.getByTestId('objective-setup-submit');

        fireEvent.change(screen.getByTestId('objective-goal-select'), { target: { value: 'Job interview' } });
        expect(submit).toBeDisabled(); // topic alone is not enough

        fireEvent.change(screen.getByTestId('objective-point-label-0'), { target: { value: 'Name the price' } });
        expect(submit).toBeEnabled();
    });

    it('"Other" reveals a free-text goal field', () => {
        render(<ObjectiveSetupForm />);
        expect(screen.queryByTestId('objective-goal-input')).toBeNull();
        fireEvent.change(screen.getByTestId('objective-goal-select'), { target: { value: 'other' } });
        expect(screen.getByTestId('objective-goal-input')).toBeInTheDocument();
    });

    it('has no per-point "optional reminder" field (the point IS the reminder)', () => {
        render(<ObjectiveSetupForm />);
        expect(screen.queryByTestId('objective-point-cue-0')).toBeNull();
    });

    it('adds and removes focus-point rows (never below one)', () => {
        render(<ObjectiveSetupForm />);
        fireEvent.click(screen.getByTestId('objective-add-point'));
        expect(screen.getAllByRole('listitem')).toHaveLength(4);
        fireEvent.click(screen.getByTestId('objective-point-remove-0'));
        expect(screen.getAllByRole('listitem')).toHaveLength(3);
    });

    it('caps focus points at the maximum (add control disappears)', () => {
        render(<ObjectiveSetupForm />);
        for (let i = 0; i < 10; i++) {
            const add = screen.queryByTestId('objective-add-point');
            if (!add) break;
            fireEvent.click(add);
        }
        expect(screen.getAllByRole('listitem')).toHaveLength(7);
        expect(screen.queryByTestId('objective-add-point')).toBeNull();
    });

    it('submits the chosen topic + labelled points (no cue) and calls onReady with the ids', async () => {
        startObjectiveBrief.mockResolvedValue({ ok: true, briefId: 'b1', projectId: 'p1' });
        const onReady = vi.fn();
        render(<ObjectiveSetupForm onReady={onReady} />);

        fireEvent.change(screen.getByTestId('objective-goal-select'), { target: { value: 'Sales or product pitch' } });
        fireEvent.change(screen.getByTestId('objective-point-label-0'), { target: { value: 'Name the price' } });
        fireEvent.click(screen.getByTestId('objective-setup-submit'));

        // #1046 G6/G7: onReady now carries the topic (the goal) + the pace guide (default 1 min/point = 60s)
        // so slot D can render the topic and slot C can project pace.
        await waitFor(() => expect(onReady).toHaveBeenCalledWith({ briefId: 'b1', projectId: 'p1', points: ['Name the price'], topic: 'Sales or product pitch', paceGuideSecPerPoint: 60 }));
        expect(startObjectiveBrief).toHaveBeenCalledWith({
            goal: 'Sales or product pitch',
            points: [{ label: 'Name the price' }],
        });
    });

    it('shows honest copy on a capability failure and does NOT call onReady', async () => {
        startObjectiveBrief.mockResolvedValue({ ok: false, reason: 'capability' });
        const onReady = vi.fn();
        render(<ObjectiveSetupForm onReady={onReady} />);

        fireEvent.change(screen.getByTestId('objective-goal-select'), { target: { value: 'Job interview' } });
        fireEvent.change(screen.getByTestId('objective-point-label-0'), { target: { value: 'p' } });
        fireEvent.click(screen.getByTestId('objective-setup-submit'));

        await waitFor(() => expect(screen.getByTestId('objective-setup-error')).toBeInTheDocument());
        expect(screen.getByTestId('objective-setup-error')).toHaveTextContent(/isn.t available on your account/i);
        expect(onReady).not.toHaveBeenCalled();
        expect(screen.getByTestId('objective-setup-submit')).toBeEnabled();
    });
});

/**
 * #1429 E1/E2 — the user chooses how many Focus Points they enter, and every one of them survives.
 *
 * THE REQUIREMENT: every point the user enters is captured. There is no criteria count, and no case
 * in which an entered point may go missing. Three rows is the INITIAL UI count, not a specification.
 * The counts sampled below show the behaviour does not depend on how many points were entered.
 *
 * The defect this guards against is silent truncation: the user enters seven, the brief stores fewer,
 * and coverage then reports against a set the user never agreed to.
 *
 * OPEN DISCREPANCY, flagged rather than resolved here: the shipped code caps entry at
 * `OBJECTIVE_MAX_POINTS = 7` (`objectiveBriefService.ts`) and hides the add control there, while the
 * stated product expectation is that the user may enter any number they want. These tests describe
 * the CURRENT cap; they do not endorse it. Removing the cap is a product decision with layout
 * consequences and is not made in this lane.
 */
describe('#1429 — every entered Focus Point reaches the brief, in order', () => {
    const SEVEN = [
        'Name the price',
        'State the guarantee',
        'Cover the timeline',
        'Explain the onboarding',
        'Mention the support team',
        'Describe the migration plan',
        'Confirm the renewal terms',
    ];

    const enter = (labels: string[]) => {
        for (let i = 3; i < labels.length; i++) {
            fireEvent.click(screen.getByTestId('objective-add-point'));
        }
        for (let i = labels.length; i < 3; i++) {
            fireEvent.click(screen.getByTestId(`objective-point-remove-${labels.length}`));
        }
        labels.forEach((label, index) => {
            fireEvent.change(screen.getByTestId(`objective-point-label-${index}`), { target: { value: label } });
        });
    };

    it.each([1, 3, 4, 7])('stores all %i entered points in the order they were typed', async (count) => {
        startObjectiveBrief.mockResolvedValue({ ok: true, briefId: 'b1', projectId: 'p1' });
        const onReady = vi.fn();
        render(<ObjectiveSetupForm onReady={onReady} />);
        const labels = SEVEN.slice(0, count);

        fireEvent.change(screen.getByTestId('objective-goal-select'), { target: { value: 'Sales or product pitch' } });
        enter(labels);
        fireEvent.click(screen.getByTestId('objective-setup-submit'));

        await waitFor(() => expect(onReady).toHaveBeenCalled());
        expect(onReady.mock.calls[0][0].points).toEqual(labels);
        expect(startObjectiveBrief.mock.calls[0][0].points).toEqual(labels.map((label) => ({ label })));
    });

    it('CASUALTY: seven entered points are not silently truncated to the three initial rows', async () => {
        startObjectiveBrief.mockResolvedValue({ ok: true, briefId: 'b1', projectId: 'p1' });
        const onReady = vi.fn();
        render(<ObjectiveSetupForm onReady={onReady} />);

        fireEvent.change(screen.getByTestId('objective-goal-select'), { target: { value: 'Sales or product pitch' } });
        enter(SEVEN);
        fireEvent.click(screen.getByTestId('objective-setup-submit'));

        await waitFor(() => expect(onReady).toHaveBeenCalled());
        const stored = onReady.mock.calls[0][0].points as string[];
        expect(stored).toHaveLength(7);
        // Named, so a truncation reports WHICH points were dropped rather than only a count.
        expect(SEVEN.filter((label) => !stored.includes(label))).toEqual([]);
    });

    it('CASUALTY: reordering matters — the stored order is the typed order, not a sorted one', async () => {
        startObjectiveBrief.mockResolvedValue({ ok: true, briefId: 'b1', projectId: 'p1' });
        const onReady = vi.fn();
        render(<ObjectiveSetupForm onReady={onReady} />);
        const reversed = [...SEVEN.slice(0, 4)].reverse();

        fireEvent.change(screen.getByTestId('objective-goal-select'), { target: { value: 'Sales or product pitch' } });
        enter(reversed);
        fireEvent.click(screen.getByTestId('objective-setup-submit'));

        await waitFor(() => expect(onReady).toHaveBeenCalled());
        expect(onReady.mock.calls[0][0].points).toEqual(reversed);
        expect(onReady.mock.calls[0][0].points).not.toEqual([...reversed].sort());
    });

    it('a blank row is dropped without disturbing the order of the points that were entered', async () => {
        startObjectiveBrief.mockResolvedValue({ ok: true, briefId: 'b1', projectId: 'p1' });
        const onReady = vi.fn();
        render(<ObjectiveSetupForm onReady={onReady} />);

        fireEvent.change(screen.getByTestId('objective-goal-select'), { target: { value: 'Sales or product pitch' } });
        fireEvent.change(screen.getByTestId('objective-point-label-0'), { target: { value: SEVEN[0] } });
        // row 1 deliberately left blank
        fireEvent.change(screen.getByTestId('objective-point-label-2'), { target: { value: SEVEN[2] } });
        fireEvent.click(screen.getByTestId('objective-setup-submit'));

        await waitFor(() => expect(onReady).toHaveBeenCalled());
        expect(onReady.mock.calls[0][0].points).toEqual([SEVEN[0], SEVEN[2]]);
    });
});
