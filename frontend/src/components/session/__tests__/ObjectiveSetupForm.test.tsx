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

    it('starts with a goal input and three focus-point rows, submit disabled', () => {
        render(<ObjectiveSetupForm />);
        expect(screen.getByTestId('objective-goal-input')).toBeInTheDocument();
        expect(screen.getAllByRole('listitem')).toHaveLength(3);
        expect(screen.getByTestId('objective-setup-submit')).toBeDisabled();
    });

    it('enables submit only once a goal AND at least one labelled point exist', () => {
        render(<ObjectiveSetupForm />);
        const submit = screen.getByTestId('objective-setup-submit');

        fireEvent.change(screen.getByTestId('objective-goal-input'), { target: { value: 'Pitch' } });
        expect(submit).toBeDisabled(); // goal alone is not enough

        fireEvent.change(screen.getByTestId('objective-point-label-0'), { target: { value: 'Name the price' } });
        expect(submit).toBeEnabled();
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
        // starts at 3; add until the control is gone
        for (let i = 0; i < 10; i++) {
            const add = screen.queryByTestId('objective-add-point');
            if (!add) break;
            fireEvent.click(add);
        }
        expect(screen.getAllByRole('listitem')).toHaveLength(7);
        expect(screen.queryByTestId('objective-add-point')).toBeNull();
    });

    it('submits goal + labelled points and calls onReady with the ids', async () => {
        startObjectiveBrief.mockResolvedValue({ ok: true, briefId: 'b1', projectId: 'p1' });
        const onReady = vi.fn();
        render(<ObjectiveSetupForm onReady={onReady} />);

        fireEvent.change(screen.getByTestId('objective-goal-input'), { target: { value: 'Sales pitch' } });
        fireEvent.change(screen.getByTestId('objective-point-label-0'), { target: { value: 'Name the price' } });
        fireEvent.click(screen.getByTestId('objective-setup-submit'));

        await waitFor(() => expect(onReady).toHaveBeenCalledWith({ briefId: 'b1', projectId: 'p1' }));
        expect(startObjectiveBrief).toHaveBeenCalledWith({
            goal: 'Sales pitch',
            points: [{ label: 'Name the price', cue: '' }],
        });
    });

    it('shows honest copy on a capability failure and does NOT call onReady', async () => {
        startObjectiveBrief.mockResolvedValue({ ok: false, reason: 'capability' });
        const onReady = vi.fn();
        render(<ObjectiveSetupForm onReady={onReady} />);

        fireEvent.change(screen.getByTestId('objective-goal-input'), { target: { value: 'g' } });
        fireEvent.change(screen.getByTestId('objective-point-label-0'), { target: { value: 'p' } });
        fireEvent.click(screen.getByTestId('objective-setup-submit'));

        await waitFor(() => expect(screen.getByTestId('objective-setup-error')).toBeInTheDocument());
        expect(screen.getByTestId('objective-setup-error')).toHaveTextContent(/isn.t available on your account/i);
        expect(onReady).not.toHaveBeenCalled();
        // Re-enabled so the user can retry.
        expect(screen.getByTestId('objective-setup-submit')).toBeEnabled();
    });
});
