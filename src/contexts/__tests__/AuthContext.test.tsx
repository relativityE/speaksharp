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
  user: { id: '123', email: 'test@test.com' },
  // ... other session properties
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
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Assert
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('session-email')).toHaveTextContent('test@test.com');
    expect(screen.getByTestId('profile-status')).toHaveTextContent('pro');
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