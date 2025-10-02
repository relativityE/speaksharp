// src/contexts/__tests__/AuthContext.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import { supabase } from '../../lib/supabaseClient';
import { vi, Mock } from 'vitest';
import React from 'react';

// Mock the supabase client
vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
    from: vi.fn(),
  },
}));

const mockSession = {
  user: { id: '123', email: 'test@test.com', created_at: '2024-01-01T00:00:00.000Z', aud: 'authenticated', app_metadata: {}, user_metadata: {} },
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
};

const mockProfile = {
  id: '123',
  subscription_status: 'pro',
};

// A simple component to consume and display auth context values
const TestConsumer = () => {
  const { session, profile, loading } = useAuth();
  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <div data-testid="session-email">{session?.user?.email || ''}</div>
      <div data-testid="profile-status">{profile?.subscription_status || ''}</div>
    </div>
  );
};

describe('AuthContext', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should provide session and profile when user is authenticated', async () => {
    // Arrange
    (supabase.auth.getSession as Mock).mockResolvedValue({
      data: { session: mockSession }
    });

    // Create a proper mock chain for the database query
    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockSingle = vi.fn().mockResolvedValue({ data: mockProfile, error: null });

    (supabase.from as Mock).mockReturnValue({
      select: mockSelect,
      eq: mockEq,
      single: mockSingle,
    });

    // Act
    render(
      <AuthProvider initialSession={mockSession}>
        <TestConsumer />
      </AuthProvider>
    );

    // Assert
    // The loading skeleton is intentionally not rendered in the test environment
    // to avoid race conditions. We directly wait for the final state.
    await waitFor(() => {
      expect(screen.getByTestId('session-email')).toHaveTextContent(mockSession.user.email as string);
      expect(screen.getByTestId('profile-status')).toHaveTextContent(mockProfile.subscription_status);
    });
  });

  it('should provide null session and profile when user is not authenticated', async () => {
    // Arrange
    (supabase.auth.getSession as Mock).mockResolvedValue({ data: { session: null } });

    // Act
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Assert
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('session-email')).toHaveTextContent('');
    expect(screen.getByTestId('profile-status')).toHaveTextContent('');
  });
});