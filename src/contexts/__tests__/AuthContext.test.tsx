// src/contexts/__tests__/AuthContext.test.tsx
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import { vi, Mock } from 'vitest';
import React from 'react';
import { Session } from '@supabase/supabase-js';

// Mock the supabase client
const mockSupabase = {
  auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
  },
  from: vi.fn(),
};

vi.mock('../../lib/supabaseClient', () => ({
  getSupabaseClient: () => mockSupabase,
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
  const { session, profile, loading } = useAuth();
  if (loading) {
    return <div>Loading...</div>;
  }
  return (
    <div>
      <div data-testid="session-email">{session?.user?.email || 'No session'}</div>
      <div data-testid="profile-status">{profile?.subscription_status || 'No profile'}</div>
    </div>
  );
};

describe('AuthContext', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should provide session and profile when user is authenticated', async () => {
    // Arrange
    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockSingle = vi.fn().mockResolvedValue({ data: mockProfile, error: null });

    (mockSupabase.from as Mock).mockReturnValue({
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
    await waitFor(() => {
      expect(screen.getByTestId('session-email')).toHaveTextContent(mockSession.user.email as string);
      expect(screen.getByTestId('profile-status')).toHaveTextContent(mockProfile.subscription_status);
    });
  });

  it('should provide null session and profile when user is not authenticated', async () => {
    // Arrange
    (mockSupabase.auth.getSession as Mock).mockResolvedValue({ data: { session: null } });

    // Act
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Assert
    await waitFor(() => {
      expect(screen.getByTestId('session-email')).toHaveTextContent('No session');
      expect(screen.getByTestId('profile-status')).toHaveTextContent('No profile');
    });
  });
});