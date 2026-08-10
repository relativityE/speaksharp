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

        // #1046 G6/G7: onReady now carries the topic (the goal) so slot D can render it above the points.
        await waitFor(() => expect(onReady).toHaveBeenCalledWith({ briefId: 'b1', projectId: 'p1', points: ['Name the price'], topic: 'Sales or product pitch' }));
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
