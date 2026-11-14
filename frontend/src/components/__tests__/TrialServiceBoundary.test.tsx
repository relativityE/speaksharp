// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TrialServiceBoundary } from '../TrialServiceBoundary';

const state = vi.hoisted(() => ({
    query: {} as Record<string, unknown>,
    payments: false,
    refetch: vi.fn(),
    mounted: vi.fn(),
}));
vi.mock('@/hooks/useUsageLimit', () => ({ useUsageLimit: () => state.query }));
vi.mock('@/config/appRuntimeConfig', () => ({ arePaymentsEnabled: () => state.payments }));

function Service() {
    state.mounted();
    return <div>PRIVATE SAVED WORK</div>;
}
const tree = () => <MemoryRouter><TrialServiceBoundary><Service /></TrialServiceBoundary></MemoryRouter>;
const permit = { can_start: true, trial_active: false, trial_seconds_remaining: 0 };

beforeEach(() => {
    vi.useFakeTimers();
    state.mounted.mockReset();
    state.refetch.mockReset().mockResolvedValue({});
    state.payments = false;
    state.query = {
        data: undefined, dataUpdatedAt: 1, error: null, isPending: false,
        isFetching: false, isFetchedAfterMount: true, refetch: state.refetch,
    };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('trial service payment wall', () => {
    it('does not mount service from an unknown, stale or failed answer', () => {
        state.query.isPending = true;
        const view = render(tree());
        expect(state.mounted).not.toHaveBeenCalled();
        state.query = { ...state.query, isPending: false, data: permit, isFetchedAfterMount: false };
        view.rerender(tree());
        expect(state.mounted).not.toHaveBeenCalled();
        state.query = { ...state.query, isFetchedAfterMount: true, error: new Error('network') };
        view.rerender(tree());
        expect(state.mounted).not.toHaveBeenCalled();
        expect(screen.getByRole('link', { name: 'Delete account' })).toHaveAttribute('href', '/account/delete');
    });

    it('blocks all saved content and retains payment/deletion escape routes on expiry', () => {
        state.query.data = { can_start: false, error: 'trial_expired' };
        render(tree());
        expect(screen.getByRole('heading', { name: 'Your free trial has ended' })).toBeInTheDocument();
        expect(state.mounted).not.toHaveBeenCalled();
        expect(screen.getByRole('link', { name: 'View payment options' })).toHaveAttribute('href', '/pricing');
        expect(screen.getByRole('link', { name: 'Delete account' })).toHaveAttribute('href', '/account/delete');
        expect(screen.getByText(/Paid continuation is not open yet/)).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /Progress|History|Export/ })).not.toBeInTheDocument();
    });

    it('does not treat a payment retry click as authorization; only the refreshed answer opens access', () => {
        state.query.data = { can_start: false, error: 'trial_expired' };
        const view = render(tree());
        fireEvent.click(screen.getByRole('button', { name: 'Check payment / retry' }));
        expect(state.refetch).toHaveBeenCalledOnce();
        expect(state.mounted).not.toHaveBeenCalled();
        state.query = { ...state.query, data: permit, dataUpdatedAt: 2 };
        view.rerender(tree());
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
    });

    it('closes access at the server-relative expiry while revalidation is pending', async () => {
        state.query.data = { ...permit, trial_active: true, trial_seconds_remaining: 2 };
        render(tree());
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
        await act(async () => { vi.advanceTimersByTime(2000); });
        expect(screen.queryByText('PRIVATE SAVED WORK')).not.toBeInTheDocument();
        expect(state.refetch).toHaveBeenCalledOnce();
    });

    it('revalidates long trials without interrupting an authorized recording every minute', async () => {
        state.query.data = { ...permit, trial_active: true, trial_seconds_remaining: 300 };
        render(tree());
        await act(async () => { vi.advanceTimersByTime(60_000); });
        expect(state.refetch).toHaveBeenCalledOnce();
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
    });

    it('paid confirmation opens service and a later refusal closes it', () => {
        state.query.data = permit;
        const view = render(tree());
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
        state.query = { ...state.query, data: { can_start: false, error: 'trial_expired' }, dataUpdatedAt: 2 };
        view.rerender(tree());
        expect(screen.queryByText('PRIVATE SAVED WORK')).not.toBeInTheDocument();
    });
});
