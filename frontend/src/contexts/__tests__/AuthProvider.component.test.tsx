import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, AuthContext } from '../AuthProvider';
import React, { useContext } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as supabaseClient from '../../lib/supabaseClient';

// Mock dependencies
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(),
}));

vi.mock('../../utils/fetchWithRetry', () => ({
    fetchWithRetry: vi.fn((fn) => fn()),
}));

// Account-linked analytics identity (PostHog/Sentry) — assert the AuthProvider identifies by user.id.
// isIdentified() reports whether PostHog still holds a persisted (cross-boot) account-linked identity.
const analyticsMock = vi.hoisted(() => ({
    identify: vi.fn(),
    resetIdentity: vi.fn(),
    isIdentified: vi.fn(() => false),
}));
vi.mock('@/services/AnalyticsBuffer', () => ({ analyticsBuffer: analyticsMock }));

// Test consumer component
const TestConsumer = () => {
    const context = useContext(AuthContext);
    if (!context) return <div>No Context</div>;

    if (context.loading) return <div>Loading...</div>;
    if (!context.session) return <div>Unauthenticated</div>;
    return (
        <div>
            <div data-testid="user-id">{context.session.user.id}</div>
            <button onClick={() => { void context.signOut(); }}>Sign Out</button>
        </div>
    );
};

const queryClient = new QueryClient();

describe('AuthProvider', () => {
    let mockSupabase: {
        auth: { getSession: Mock; onAuthStateChange: Mock; signOut: Mock };
        from: Mock;
        select: Mock;
        eq: Mock;
        single: Mock;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // clearAllMocks clears call history but not implementations — restore the default so a prior
        // test's mockReturnValue(true) cannot leak a persisted-identity signal into the next test.
        analyticsMock.isIdentified.mockReturnValue(false);

        // Mock Supabase Client structure
        mockSupabase = {
            auth: {
                getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
                onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
                signOut: vi.fn().mockResolvedValue({ error: null }),
            },
            from: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
        };

        (supabaseClient.getSupabaseClient as unknown as Mock).mockReturnValue(mockSupabase);
    });


    it('renders unauthenticated when no session exists', async () => {
        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

        render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <TestConsumer />
                </AuthProvider>
            </QueryClientProvider>
        );

        await waitFor(() => expect(screen.getByText('Unauthenticated')).toBeInTheDocument());
    });

    it('renders authenticated user', async () => {
        const mockSession = { user: { id: 'user-123' } };

        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: mockSession }, error: null });

        render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <TestConsumer />
                </AuthProvider>
            </QueryClientProvider>
        );

        await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('user-123'));
    });

    it('handles sign out', async () => {
        const mockSession = { user: { id: 'user-123' } };
        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: mockSession }, error: null });

        render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <TestConsumer />
                </AuthProvider>
            </QueryClientProvider>
        );

        await waitFor(() => expect(screen.getByText('Sign Out')).toBeInTheDocument());

        screen.getByText('Sign Out').click();

        await waitFor(() => expect(mockSupabase.auth.signOut).toHaveBeenCalled());
    });

    it('identifies the authenticated user to analytics by user.id ONLY (no email/PII)', async () => {
        const mockSession = { user: { id: 'user-123', email: 'tester@example.com' } };
        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: mockSession }, error: null });

        render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <TestConsumer />
                </AuthProvider>
            </QueryClientProvider>
        );

        await waitFor(() => expect(analyticsMock.identify).toHaveBeenCalledWith('user-123'));
        // The session has an email, but it must NOT be forwarded to analytics.
        expect(analyticsMock.identify).not.toHaveBeenCalledWith('user-123', expect.objectContaining({ email: expect.anything() }));
    });

    it('resets analytics identity on sign out', async () => {
        const mockSession = { user: { id: 'user-123' } };
        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: mockSession }, error: null });

        render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <TestConsumer />
                </AuthProvider>
            </QueryClientProvider>
        );

        await waitFor(() => expect(analyticsMock.identify).toHaveBeenCalledWith('user-123'));
        screen.getByText('Sign Out').click();
        await waitFor(() => expect(analyticsMock.resetIdentity).toHaveBeenCalled());
    });

    it('clears a PERSISTED PostHog identity on an anonymous boot (shared device / expired session)', async () => {
        // No session this boot, but PostHog still carries a prior user's account-linked identity
        // persisted across page loads. The mount ref starts null, so the fix must rely on
        // isIdentified() to clear the stale identity — otherwise events/flags leak to the prior user.
        analyticsMock.isIdentified.mockReturnValue(true);
        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

        render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <TestConsumer />
                </AuthProvider>
            </QueryClientProvider>
        );

        await waitFor(() => expect(screen.getByText('Unauthenticated')).toBeInTheDocument());
        await waitFor(() => expect(analyticsMock.resetIdentity).toHaveBeenCalled());
        expect(analyticsMock.identify).not.toHaveBeenCalled();
    });

    it('does NOT reset on a fresh anonymous boot with no persisted identity (no anonymous-id churn)', async () => {
        // No session and PostHog is already anonymous — resetting here would needlessly mint a new
        // anonymous distinct_id and fragment returning-anonymous-visitor analytics.
        analyticsMock.isIdentified.mockReturnValue(false);
        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

        render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <TestConsumer />
                </AuthProvider>
            </QueryClientProvider>
        );

        await waitFor(() => expect(screen.getByText('Unauthenticated')).toBeInTheDocument());
        expect(analyticsMock.resetIdentity).not.toHaveBeenCalled();
        expect(analyticsMock.identify).not.toHaveBeenCalled();
    });

    it('does not re-identify the same user on token refresh / re-render (no duplicate identify)', async () => {
        const mockSession = { user: { id: 'user-123' } };
        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: mockSession }, error: null });

        let authStateCallback: (event: string, session: unknown) => void;
        mockSupabase.auth.onAuthStateChange.mockImplementation((callback: (event: string, session: unknown) => void) => {
            authStateCallback = callback;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
        });

        render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <TestConsumer />
                </AuthProvider>
            </QueryClientProvider>
        );

        await waitFor(() => expect(analyticsMock.identify).toHaveBeenCalledWith('user-123'));
        expect(analyticsMock.identify).toHaveBeenCalledTimes(1);

        // A token refresh for the SAME user id (new session object, identical user.id) must NOT
        // trigger a second identify — the ref-equality guard short-circuits the effect.
        act(() => {
            authStateCallback('TOKEN_REFRESHED', { user: { id: 'user-123' } });
        });

        await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('user-123'));
        expect(analyticsMock.identify).toHaveBeenCalledTimes(1);
        expect(analyticsMock.resetIdentity).not.toHaveBeenCalled();
    });

    it('handles getSession error gracefully', async () => {
        mockSupabase.auth.getSession.mockResolvedValue({
            data: { session: null },
            error: { message: 'Network error', status: 500 }
        });

        render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <TestConsumer />
                </AuthProvider>
            </QueryClientProvider>
        );

        // Should complete loading and show unauthenticated state
        await waitFor(() => expect(screen.getByText('Unauthenticated')).toBeInTheDocument());
    });

    it('uses initialSession when provided', async () => {
        const injectedSession = { user: { id: 'injected-user' } };

        render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider initialSession={injectedSession as Parameters<typeof AuthProvider>[0]['initialSession']}>
                    <TestConsumer />
                </AuthProvider>
            </QueryClientProvider>
        );

        // Should immediately show the injected session without calling getSession
        await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('injected-user'));
    });

    it('handles session refresh via onAuthStateChange', async () => {
        // Start with no session
        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

        // Capture the auth state change callback
        let authStateCallback: (event: string, session: unknown) => void;
        mockSupabase.auth.onAuthStateChange.mockImplementation((callback: (event: string, session: unknown) => void) => {
            authStateCallback = callback;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
        });

        render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <TestConsumer />
                </AuthProvider>
            </QueryClientProvider>
        );

        // Initially unauthenticated
        await waitFor(() => expect(screen.getByText('Unauthenticated')).toBeInTheDocument());

        // Simulate token refresh event
        act(() => {
            authStateCallback('TOKEN_REFRESHED', { user: { id: 'refreshed-user' } });
        });

        // Should now show the refreshed user
        await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('refreshed-user'));
    });

    it('does not let INITIAL_SESSION(null) overwrite an existing session', async () => {
        const mockSession = { user: { id: 'user-123' } };
        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: mockSession }, error: null });

        let authStateCallback: (event: string, session: unknown) => void;
        mockSupabase.auth.onAuthStateChange.mockImplementation((callback: (event: string, session: unknown) => void) => {
            authStateCallback = callback;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
        });

        render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <TestConsumer />
                </AuthProvider>
            </QueryClientProvider>
        );

        await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('user-123'));

        act(() => {
            authStateCallback('INITIAL_SESSION', null);
        });

        await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('user-123'));
    });

    it('ignores devBypass query parameters in the manual auth provider path', async () => {
        window.history.pushState({}, '', '/session?devBypass=true');
        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

        render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <TestConsumer />
                </AuthProvider>
            </QueryClientProvider>
        );

        await waitFor(() => expect(screen.getByText('Unauthenticated')).toBeInTheDocument());
        expect(screen.queryByText('dev@speaksharp.app')).not.toBeInTheDocument();
    });

    it('ignores malformed stored sessions before they can pollute backend requests', async () => {
        const projectRef = new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0];
        window.localStorage.setItem(`sb-${projectRef}-auth-token`, JSON.stringify({
            access_token: 'dev-token',
            user: { id: '00000000-0000-0000-0000-000000000000', email: 'dev@speaksharp.app' },
        }));
        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

        render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <TestConsumer />
                </AuthProvider>
            </QueryClientProvider>
        );

        await waitFor(() => expect(screen.getByText('Unauthenticated')).toBeInTheDocument());
        expect(screen.queryByText('dev@speaksharp.app')).not.toBeInTheDocument();
    });

    it('handles session expiry via onAuthStateChange', async () => {
        const mockSession = { user: { id: 'user-123' } };
        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: mockSession }, error: null });

        // Capture the auth state change callback
        let authStateCallback: (event: string, session: unknown) => void;
        mockSupabase.auth.onAuthStateChange.mockImplementation((callback: (event: string, session: unknown) => void) => {
            authStateCallback = callback;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
        });

        render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <TestConsumer />
                </AuthProvider>
            </QueryClientProvider>
        );

        // Initially authenticated
        await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('user-123'));

        // Simulate session expiry (SIGNED_OUT event)
        act(() => {
            authStateCallback('SIGNED_OUT', null);
        });

        // Should now show unauthenticated
        await waitFor(() => expect(screen.getByText('Unauthenticated')).toBeInTheDocument());
    });
});
