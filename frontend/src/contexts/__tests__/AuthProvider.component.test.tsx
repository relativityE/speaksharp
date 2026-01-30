import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
});
