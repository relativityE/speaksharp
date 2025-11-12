// src/contexts/__tests__/AuthContext.test.tsx
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import { vi } from 'vitest';
import React from 'react';
import { Session } from '@supabase/supabase-js';

// Mock the supabase client
const mockAuthStateChange = vi.fn();
const mockGetSession = vi.fn();
const mockSetSession = vi.fn();
const mockSignOut = vi.fn();

vi.mock('../../lib/supabaseClient', () => ({
  getSupabaseClient: vi.fn(() => ({
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        mockAuthStateChange(callback);
        // Immediately call callback with initial state
        setTimeout(() => callback('INITIAL_SESSION', null), 0);
        return {
          data: {
            subscription: {
              unsubscribe: vi.fn()
            }
          }
        };
      },
      setSession: mockSetSession,
      signOut: mockSignOut,
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: null })
        })
      })
    })
  }))
}));

// Cast the mock to the full Session type to ensure type safety.
const mockSession: Session = {
  user: {
    id: '123',
    email: 'test@test.com',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  },
  access_token: 'mock-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  refresh_token: 'mock-refresh-token',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
};

// A simple component to consume and display auth context values
const TestConsumer = () => {
  const { session, loading } = useAuth();
  if (loading) {
    return <div data-testid="loading-skeleton">Loading...</div>;
  }
  return (
    <div>
      <div data-testid="session-email">{session?.user?.email || 'Not authenticated'}</div>
    </div>
  );
};

describe('AuthContext', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should provide session when user is authenticated', async () => {
    // Act
    render(
      <AuthProvider initialSession={mockSession}>
        <TestConsumer />
      </AuthProvider>
    );

    // Assert
    await waitFor(() => {
      expect(screen.getByTestId('session-email')).toHaveTextContent(mockSession.user.email as string);
    });
  });

  it('should provide null session when user is not authenticated', async () => {
    // Setup mock to return no session
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
    });

    // Now check for the content
    await waitFor(() => {
      expect(screen.getByTestId('session-email')).toHaveTextContent('Not authenticated');
    });
  });
});
