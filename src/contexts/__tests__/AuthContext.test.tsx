import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { vi } from 'vitest';
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
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
    })),
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
      <div data-testid="session-email">{session?.user?.email}</div>
      <div data-testid="profile-status">{profile?.subscription_status}</div>
    </div>
  );
};

describe('AuthContext', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // it('should provide session and profile when user is authenticated', async () => {
  //   // Arrange
  //   (supabase.auth.getSession as any).mockResolvedValue({ data: { session: mockSession } });
  //   (supabase.from('user_profiles').select().eq().single as any).mockResolvedValue({ data: mockProfile, error: null });

  //   // Act
  //   render(
  //     <AuthProvider>
  //       <TestConsumer />
  //     </AuthProvider>
  //   );

  //   // Assert
  //   expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
  //   await waitFor(() => {
  //     expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
  //   });
  //   expect(screen.getByTestId('session-email')).toHaveTextContent('test@test.com');
  //   expect(screen.getByTestId('profile-status')).toHaveTextContent('pro');
  // });

  it('should provide null session and profile when user is not authenticated', async () => {
    // Arrange
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null } });

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
    expect(screen.getByTestId('session-email')).toBeEmptyDOMElement();
    expect(screen.getByTestId('profile-status')).toBeEmptyDOMElement();
  });
});
