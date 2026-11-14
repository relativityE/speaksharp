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
    user: { id: 'owner' } as { id: string } | null,
    e2e: false,
    take: { runtimeState: 'IDLE' as string, engineSelectionLocked: false, pendingResolutionKind: null as string | null },
}));
vi.mock('@/hooks/useUsageLimit', () => ({ useUsageLimit: () => state.query }));
vi.mock('@/config/appRuntimeConfig', () => ({ arePaymentsEnabled: () => state.payments }));
vi.mock('@/contexts/AuthProvider', () => ({ useAuthProvider: () => ({ user: state.user }) }));
vi.mock('@/config/TestFlags', () => ({ ENV: { get isE2E() { return state.e2e; } } }));
vi.mock('@/stores/useSessionStore', () => ({
    useSessionStore: (select: (s: typeof state.take) => unknown) => select(state.take),
}));

function Service() {
    state.mounted();
    return <div>PRIVATE SAVED WORK</div>;
}
const tree = (allowTakeToFinish = false) => (
    <MemoryRouter><TrialServiceBoundary allowTakeToFinish={allowTakeToFinish}><Service /></TrialServiceBoundary></MemoryRouter>
);
const sessionTree = () => tree(true);
const permit = { can_start: true, trial_active: false, trial_seconds_remaining: 0 };

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    state.mounted.mockReset();
    state.refetch.mockReset().mockResolvedValue({});
    state.payments = false;
    state.user = { id: 'owner' };
    state.e2e = false;
    state.take = { runtimeState: 'IDLE', engineSelectionLocked: false, pendingResolutionKind: null };
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
        // A neutral loader, not the payment wall, while the first answer is pending.
        expect(screen.getByTestId('trial-access-checking')).toBeInTheDocument();
        expect(screen.queryByTestId('trial-payment-wall')).not.toBeInTheDocument();
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

    it('keeps a confirmed page mounted through a failed or in-flight revalidation; only a refusal closes it', () => {
        state.query.data = permit;
        const view = render(tree());
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
        state.query = { ...state.query, isFetching: true };
        view.rerender(tree());
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
        state.query = { ...state.query, isFetching: false, error: new Error('network blip') };
        view.rerender(tree());
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
        state.query = { ...state.query, error: null, data: { can_start: false, error: 'trial_expired' }, dataUpdatedAt: 3 };
        view.rerender(tree());
        expect(screen.queryByText('PRIVATE SAVED WORK')).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Your free trial has ended' })).toBeInTheDocument();
    });

    it('on the recording route, a take live while confirmed finishes at expiry, then the wall shows', () => {
        state.query.data = permit;
        state.take = { runtimeState: 'RECORDING', engineSelectionLocked: true, pendingResolutionKind: null };
        const view = render(sessionTree());
        state.query = { ...state.query, data: { can_start: false, error: 'trial_expired' }, dataUpdatedAt: 2 };
        view.rerender(sessionTree());
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
        // Stopping is still the take: its stop and save outcome stays on the page.
        state.take = { runtimeState: 'STOPPING', engineSelectionLocked: true, pendingResolutionKind: null };
        view.rerender(sessionTree());
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
        // A leftover save retry or engine lock is not a live take: once the take settles, the wall shows.
        state.take = { runtimeState: 'IDLE', engineSelectionLocked: true, pendingResolutionKind: 'full_save' };
        view.rerender(sessionTree());
        expect(screen.queryByText('PRIVATE SAVED WORK')).not.toBeInTheDocument();
        expect(screen.getByTestId('trial-payment-wall')).toBeInTheDocument();
    });

    it('a live take keeps no other route open after a refusal', () => {
        state.query.data = permit;
        state.take = { runtimeState: 'RECORDING', engineSelectionLocked: true, pendingResolutionKind: 'full_save' };
        const view = render(tree());
        state.query = { ...state.query, data: { can_start: false, error: 'trial_expired' }, dataUpdatedAt: 2 };
        view.rerender(tree());
        expect(screen.queryByText('PRIVATE SAVED WORK')).not.toBeInTheDocument();
        expect(screen.getByTestId('trial-payment-wall')).toBeInTheDocument();
    });

    it('a parked start that resumes after the refusal gets no exception', () => {
        state.query.data = permit;
        const view = render(sessionTree());
        state.query = { ...state.query, data: { can_start: false, error: 'trial_expired' }, dataUpdatedAt: 2 };
        view.rerender(sessionTree());
        expect(screen.queryByText('PRIVATE SAVED WORK')).not.toBeInTheDocument();
        state.take = { runtimeState: 'RECORDING', engineSelectionLocked: true, pendingResolutionKind: null };
        view.rerender(sessionTree());
        expect(screen.queryByText('PRIVATE SAVED WORK')).not.toBeInTheDocument();
        expect(screen.getByTestId('trial-payment-wall')).toBeInTheDocument();
    });

    it('a live take never opens a page that was not confirmed on this mount', () => {
        state.take = { runtimeState: 'RECORDING', engineSelectionLocked: true, pendingResolutionKind: 'full_save' };
        state.query.data = { can_start: false, error: 'trial_expired' };
        render(sessionTree());
        expect(state.mounted).not.toHaveBeenCalled();
        expect(screen.getByTestId('trial-payment-wall')).toBeInTheDocument();
    });

    it('a trial answer with no seconds value is not an expiry: the page stays open and is rechecked', async () => {
        // The shape the E2E and MSW mocks return.
        state.query.data = { can_start: true, trial_active: true };
        render(tree());
        await act(async () => { vi.advanceTimersByTime(130_000); });
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
        expect(state.refetch).toHaveBeenCalled();
    });

    it('a failed revalidation does not extend the trial deadline', async () => {
        state.query = { ...state.query, data: { ...permit, trial_active: true, trial_seconds_remaining: 90 }, errorUpdatedAt: 0 };
        const view = render(tree());
        await act(async () => { vi.advanceTimersByTime(60_000); });
        expect(state.refetch).toHaveBeenCalledOnce();
        state.query = { ...state.query, error: new Error('offline'), errorUpdatedAt: 61_000 };
        view.rerender(tree());
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
        await act(async () => { vi.advanceTimersByTime(30_000); });
        expect(screen.queryByText('PRIVATE SAVED WORK')).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Your free trial has ended' })).toBeInTheDocument();
    });

    it('keeps rechecking a long trial after a failed revalidation', async () => {
        state.query = { ...state.query, data: { ...permit, trial_active: true, trial_seconds_remaining: 600 }, errorUpdatedAt: 0 };
        const view = render(tree());
        await act(async () => { vi.advanceTimersByTime(60_000); });
        expect(state.refetch).toHaveBeenCalledTimes(1);
        state.query = { ...state.query, error: new Error('offline'), errorUpdatedAt: 61_000 };
        view.rerender(tree());
        await act(async () => { vi.advanceTimersByTime(60_000); });
        expect(state.refetch).toHaveBeenCalledTimes(2);
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
    });

    it('after the deadline, a failing server is asked once per answer, not in a loop', async () => {
        state.query = { ...state.query, data: { ...permit, trial_active: true, trial_seconds_remaining: 2 }, errorUpdatedAt: 0 };
        const view = render(tree());
        await act(async () => { vi.advanceTimersByTime(2000); });
        expect(state.refetch).toHaveBeenCalledTimes(1);
        for (let i = 1; i <= 3; i += 1) {
            state.query = { ...state.query, error: new Error('offline'), errorUpdatedAt: 2000 + i };
            view.rerender(tree());
            await act(async () => { vi.advanceTimersByTime(3000); });
        }
        expect(state.refetch).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('trial-payment-wall')).toBeInTheDocument();
    });

    it('a fresh 30-day trial stays open: no timer is scheduled past the browser limit (Codex P1)', async () => {
        const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
        state.query.data = { ...permit, trial_active: true, trial_seconds_remaining: 30 * 24 * 60 * 60 };
        render(tree());
        await act(async () => { vi.advanceTimersByTime(1); });
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
        for (let minute = 0; minute < 3; minute += 1) {
            await act(async () => { vi.advanceTimersByTime(60_000); });
        }
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
        expect(state.refetch).toHaveBeenCalledTimes(3);
        const delays = setTimeoutSpy.mock.calls.map(([, ms]) => ms ?? 0);
        expect(Math.max(...delays)).toBeLessThanOrEqual(2_147_483_647);
        setTimeoutSpy.mockRestore();
    });

    it('a trial that ends while the page is open closes on time, not up to a minute late', async () => {
        state.query.data = { ...permit, trial_active: true, trial_seconds_remaining: 150 };
        render(tree());
        await act(async () => { vi.advanceTimersByTime(149_000); });
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
        await act(async () => { vi.advanceTimersByTime(1_000); });
        expect(screen.queryByText('PRIVATE SAVED WORK')).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Your free trial has ended' })).toBeInTheDocument();
    });

    it('a successful answer without can_start true is a refusal, even on a confirmed page', () => {
        state.query.data = permit;
        const view = render(tree());
        state.query = { ...state.query, data: { can_start: null }, dataUpdatedAt: 2 };
        view.rerender(tree());
        expect(screen.queryByText('PRIVATE SAVED WORK')).not.toBeInTheDocument();
        expect(screen.getByTestId('trial-payment-wall')).toBeInTheDocument();
    });

    it('a confirmation for one account does not carry over to another', () => {
        state.query.data = permit;
        const view = render(tree());
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
        state.user = { id: 'someone-else' };
        state.query = { ...state.query, isFetchedAfterMount: false, isFetching: true };
        view.rerender(tree());
        expect(screen.queryByText('PRIVATE SAVED WORK')).not.toBeInTheDocument();
        // Switching back does not revive the earlier confirmation; it needs a fresh answer.
        state.user = { id: 'owner' };
        view.rerender(tree());
        expect(screen.queryByText('PRIVATE SAVED WORK')).not.toBeInTheDocument();
    });

    it('offers billing and deletion from the wall, and no saved-work route', () => {
        state.query.data = { can_start: false, error: 'trial_expired' };
        render(tree());
        expect(screen.getByRole('link', { name: 'Manage billing' })).toHaveAttribute('href', '/account');
        expect(screen.getByRole('link', { name: 'Delete account' })).toHaveAttribute('href', '/account/delete');
        const hrefs = screen.getAllByRole('link').map(link => link.getAttribute('href'));
        expect(hrefs.sort()).toEqual(['/account', '/account/delete', '/pricing']);
    });

    it('passes through only in the E2E no-session probe path, never for a signed-out production render', () => {
        state.user = null;
        state.query = { ...state.query, data: undefined, isPending: true, isFetchedAfterMount: false };
        const view = render(tree());
        expect(state.mounted).not.toHaveBeenCalled();
        state.e2e = true;
        view.rerender(tree());
        expect(screen.getByText('PRIVATE SAVED WORK')).toBeInTheDocument();
    });
});
