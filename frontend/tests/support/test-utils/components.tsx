import React, { ReactNode } from 'react';
import { MemoryRouter, Routes, Route, Location } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthContext, AuthContextType } from '@/contexts/AuthProvider';
import { Toaster } from '@/components/ui/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ProfileProvider } from '@/contexts/ProfileContext';
import { UserProfile } from '@/types/user';
import { TranscriptionProvider } from '@/providers/TranscriptionProvider';

export const MockElements = ({ children }: { children: ReactNode }) => <>{children}</>;

export const MockAuthProvider = ({ children, mockValue }: { children: ReactNode, mockValue: Partial<AuthContextType> }) => (
  <AuthContext.Provider value={mockValue as AuthContextType}>{children}</AuthContext.Provider>
);

interface AllTheProvidersProps {
  children: ReactNode;
  authMock?: Partial<AuthContextType>;
  profileMock?: Partial<UserProfile>; // ✅ Added
  route?: string | Partial<Location>;
  path?: string;
}

export const AllTheProviders = ({ children, authMock, profileMock, route = '/', path }: AllTheProvidersProps) => {
  // ✅ FIX: Instantiate QueryClient INSIDE component to ensure isolation (Strategy 16)
  // This prevents cache leaking between tests
  const [queryClient] = React.useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: false, // Fail fast in tests
        gcTime: 0, // No garbage collection delay
      },
    },
  }));

  const initialEntries = [typeof route === 'string' ? { pathname: route } : route];

  const defaultAuthMock: AuthContextType = {
    session: null,
    user: null,
    loading: false,
    signOut: vi.fn().mockResolvedValue(undefined),
    setSession: vi.fn(),
  };

  // ✅ Default Profile Mock
  const defaultProfile: UserProfile = {
    id: 'test-user-id',
    email: 'test@example.com',
    subscription_status: 'free',
    usage_seconds: 0,
    usage_reset_date: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...profileMock
  };

  const content = path ? <Routes><Route path={path} element={<>{children}</>} /></Routes> : children;

  return (
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={queryClient}>
        <MockAuthProvider mockValue={{ ...defaultAuthMock, ...authMock }}>
          <ProfileProvider value={{ profile: defaultProfile, isVerified: true }}>
            <TranscriptionProvider>
              <MockElements>
                {content}
                <Toaster />
              </MockElements>
            </TranscriptionProvider>
          </ProfileProvider>
        </MockAuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
};
