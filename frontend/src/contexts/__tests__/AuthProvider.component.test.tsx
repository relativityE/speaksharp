import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, AuthContext } from '../AuthProvider';
import React, { useContext } from 'react';
import * as supabaseClient from '../../lib/supabaseClient';

// Mock dependencies
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(),
}));

vi.mock('../../utils/fetchWithRetry', () => ({
    fetchWithRetry: vi.fn((fn) => fn()),
}));

// Test consumer component
const TestConsumer = () => {
    const context = useContext(AuthContext);
    if (!context) return <div>No Context</div>;

    if (context.loading) return <div>Loading...</div>;
    if (!context.session) return <div>Unauthenticated</div>;
    return (
        <div>
            <div data-testid="user-id">{context.session.user.id}</div>
            <button onClick={() => context.signOut()}>Sign Out</button>
        </div>
    );
};

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
            <AuthProvider>
                <TestConsumer />
            </AuthProvider>
        );

        await waitFor(() => expect(screen.getByText('Unauthenticated')).toBeInTheDocument());
    });

    it('renders authenticated user', async () => {
        const mockSession = { user: { id: 'user-123' } };

        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: mockSession }, error: null });

        render(
            <AuthProvider>
                <TestConsumer />
            </AuthProvider>
        );

        await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('user-123'));
    });

    it('handles sign out', async () => {
        const mockSession = { user: { id: 'user-123' } };
        mockSupabase.auth.getSession.mockResolvedValue({ data: { session: mockSession }, error: null });

        render(
            <AuthProvider>
                <TestConsumer />
            </AuthProvider>
        );

        await waitFor(() => expect(screen.getByText('Sign Out')).toBeInTheDocument());

        screen.getByText('Sign Out').click();

        await waitFor(() => expect(mockSupabase.auth.signOut).toHaveBeenCalled());
    });

    it('handles getSession error gracefully', async () => {
        mockSupabase.auth.getSession.mockResolvedValue({
            data: { session: null },
            error: { message: 'Network error', status: 500 }
        });

        render(
            <AuthProvider>
                <TestConsumer />
            </AuthProvider>
        );

        // Should complete loading and show unauthenticated state
        await waitFor(() => expect(screen.getByText('Unauthenticated')).toBeInTheDocument());
    });

    it('uses initialSession when provided', async () => {
        const injectedSession = { user: { id: 'injected-user' } };

        render(
            <AuthProvider initialSession={injectedSession as Parameters<typeof AuthProvider>[0]['initialSession']}>
                <TestConsumer />
            </AuthProvider>
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
            <AuthProvider>
                <TestConsumer />
            </AuthProvider>
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
            <AuthProvider>
                <TestConsumer />
            </AuthProvider>
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
