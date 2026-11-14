import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session, User } from '@supabase/supabase-js';
import { AuthContext, type AuthContextType } from '@/contexts/AuthProvider';
import App from '../App';
import { useProgressReconciliation } from '../hooks/useProgressReconciliation';

/**
 * PO 2026-11-14 payment wall, through the REAL App routes, ProtectedRoute and TrialServiceBoundary.
 * "No usage after the 1st month if no payment": an expired, unpaid account reaches no product or saved-work
 * route (Practice, Session, Progress, an exact Progress deep link, the authenticated home), while billing,
 * payment and account deletion stay reachable. Paid confirmation opens the same routes again.
 */
const state = vi.hoisted(() => ({ query: {} as Record<string, unknown> }));

vi.mock('@/hooks/useUsageLimit', () => ({ useUsageLimit: () => state.query, useCachedUsageLimit: () => state.query }));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => null }));
vi.mock('../hooks/useUserProfile', () => ({ useUserProfile: () => ({ data: { id: 'owner' }, isLoading: false, error: null, refetch: vi.fn() }) }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => ({ data: { id: 'owner' }, isLoading: false, error: null, refetch: vi.fn() }) }));
vi.mock('../hooks/useProgressReconciliation', () => ({ useProgressReconciliation: vi.fn() }));
vi.mock('../components/Navigation', () => ({ default: () => <nav data-testid="navigation" /> }));
vi.mock('../components/ui/PageTransition', () => ({
    PageTransition: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));
vi.mock('@/hooks/useCheckoutNotifications', () => ({ useCheckoutNotifications: vi.fn() }));
vi.mock('../hooks/useCriticalQueries', () => ({ useCriticalQueries: () => ({ isResolved: true }) }));
vi.mock('../providers/TranscriptionProvider', () => ({
    TranscriptionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('framer-motion', () => ({
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
        get: () => ({ children, initial: _i, animate: _a, transition: _t, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => (
            <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>
        ),
    }),
}));
const page = (id: string) => ({ default: () => <div data-testid={id} /> });
vi.mock('../pages/PracticePage', () => page('practice-page'));
vi.mock('../pages/SessionPage', () => page('session-page'));
vi.mock('../pages/AnalyticsPage', () => page('progress-page'));
vi.mock('../pages/AccountPage', () => page('account-page'));
vi.mock('../pages/AccountDeletionPage', () => page('account-deletion-page'));
vi.mock('../pages/PricingPage', () => ({ PricingPage: () => <div data-testid="pricing-page" /> }));

const user = { id: 'owner' } as User;
const session = { user, access_token: 'test-bearer-owner' } as Session;
const expired = { can_start: false, is_pro: false, error: 'trial_expired', trial_active: false };
const paid = { can_start: true, is_pro: true, trial_active: false, trial_seconds_remaining: 0 };

function renderAt(path: string, signedIn = true) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const value = { session: signedIn ? session : null, user: signedIn ? user : null, loading: false, signOut: vi.fn(), setSession: vi.fn() } as unknown as AuthContextType;
    return render(
        <MemoryRouter initialEntries={[path]}>
            <QueryClientProvider client={client}>
                <AuthContext.Provider value={value}><App /></AuthContext.Provider>
            </QueryClientProvider>
        </MemoryRouter>,
    );
}

const answer = (data: unknown) => {
    state.query = {
        data, dataUpdatedAt: 1, error: null, isPending: false, isFetching: false,
        isFetchedAfterMount: true, refetch: vi.fn().mockResolvedValue({}),
    };
};

beforeEach(() => { answer(expired); vi.mocked(useProgressReconciliation).mockClear(); });

const walled: Array<[string, string]> = [
    ['/practice', 'practice-page'],
    ['/session', 'session-page'],
    ['/session?product=focus-points', 'session-page'],
    ['/progress', 'progress-page'],
    ['/progress/11111111-1111-4111-8111-111111111111', 'progress-page'],
];

describe('payment wall routing on the real App', () => {
    it.each(walled)('an expired unpaid account at %s gets the payment page, not the product', async (path, testId) => {
        renderAt(path);
        expect(await screen.findByTestId('trial-payment-wall')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Your free trial has ended' })).toBeInTheDocument();
        expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    });

    it('the next sign-in lands on the payment page: the authenticated home goes to the wall', async () => {
        renderAt('/');
        expect(await screen.findByTestId('trial-payment-wall')).toBeInTheDocument();
        expect(screen.queryByTestId('practice-page')).not.toBeInTheDocument();
    });

    it.each([
        ['/account', 'account-page'],
        ['/account/delete', 'account-deletion-page'],
        ['/pricing', 'pricing-page'],
    ])('billing, deletion and payment stay reachable after expiry: %s', async (path, testId) => {
        renderAt(path);
        expect(await screen.findByTestId(testId)).toBeInTheDocument();
        expect(screen.queryByTestId('trial-payment-wall')).not.toBeInTheDocument();
    });

    it.each(walled)('server-confirmed paid access restores %s', async (path, testId) => {
        answer(paid);
        renderAt(path);
        expect(await screen.findByTestId(testId)).toBeInTheDocument();
        expect(screen.queryByTestId('trial-payment-wall')).not.toBeInTheDocument();
    });

    it.each(['/account', '/account/delete', '/pricing', '/practice'])(
        'saved-work reconciliation never runs for an expired unpaid account (%s)', async (path) => {
            renderAt(path);
            await screen.findByTestId(path === '/practice' ? 'trial-payment-wall' : path === '/pricing' ? 'pricing-page' : path === '/account' ? 'account-page' : 'account-deletion-page');
            expect(useProgressReconciliation).not.toHaveBeenCalled();
        });

    it('saved-work reconciliation runs once the server confirms access', async () => {
        answer(paid);
        renderAt('/account');
        await screen.findByTestId('account-page');
        expect(useProgressReconciliation).toHaveBeenCalled();
    });

    it('signed out, the reconciler still mounts so the anonymous Start gate resolves', async () => {
        state.query = { data: undefined, dataUpdatedAt: 0, error: null, isPending: true, isFetching: false, isFetchedAfterMount: false, refetch: vi.fn() };
        renderAt('/pricing', false);
        await screen.findByTestId('pricing-page');
        expect(useProgressReconciliation).toHaveBeenCalled();
    });

    it('a bare pro label the server does not confirm (can_start false) still gets the wall', async () => {
        answer({ ...expired, subscription_status: 'pro' });
        renderAt('/practice');
        expect(await screen.findByTestId('trial-payment-wall')).toBeInTheDocument();
    });
});
