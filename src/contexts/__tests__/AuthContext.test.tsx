// src/contexts/__tests__/AuthContext.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import { supabase } from '../../lib/supabaseClient';
import { vi, Mock } from 'vitest';
import React from 'react';
import { Session } from '@supabase/supabase-js';

// Mock the supabase client
vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      // getSession is no longer called by the provider in test mode, so we don't need to mock it.
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
    from: vi.fn(),
  },
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

const mockProfile = {
  id: '123',
  subscription_status: 'pro',
};

// A simple component to consume and display auth context values
const TestConsumer = () => {
  const { session, profile } = useAuth();
  // In test mode, loading is false, so we don't need a loading state check.
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
    // Mock the database query for the user's profile.
    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockSingle = vi.fn().mockResolvedValue({ data: mockProfile, error: null });

    (supabase.from as Mock).mockReturnValue({
      select: mockSelect,
      eq: mockEq,
      single: mockSingle,
    });

    // Act
    // The key fix: Pass the mock session directly to the provider.
    render(
      <AuthProvider initialSession={mockSession}>
        <TestConsumer />
      </AuthProvider>
    );

    // Assert
    // With the initialSession provided, the component renders the final state immediately.
    // The loading skeleton is intentionally not rendered in the test environment
    // to avoid race conditions. We directly wait for the final state.
    await waitFor(() => {
      expect(screen.getByTestId('session-email')).toHaveTextContent(mockSession.user.email as string);
      expect(screen.getByTestId('profile-status')).toHaveTextContent(mockProfile.subscription_status);
    });
  });

  it('should provide null session and profile when user is not authenticated', async () => {
    // Arrange: No session is provided, so initialSession is null by default.
    // Act
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Assert
    // We wait for a tick to ensure any async effects have settled.
    await waitFor(() => {
      expect(screen.getByTestId('session-email')).toHaveTextContent('');
      expect(screen.getByTestId('profile-status')).toHaveTextContent('');
    });
  });
});