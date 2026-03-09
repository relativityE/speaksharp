import React, { ReactElement } from 'react';
import { AuthProvider } from '@/contexts/AuthProvider';
import { ProfileProvider } from '@/contexts/ProfileContext';
import { TranscriptionProvider } from '@/providers/TranscriptionProvider';
import { render, renderHook, RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserProfile } from '@/types/user';

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  session?: Session | null;
  authMock?: Partial<import('@/contexts/AuthProvider').AuthContextType>;
  profileMock?: Partial<UserProfile>;
}

const queryClient = new QueryClient();

// This test helper is used to wrap components under test with necessary providers.
export function renderWithProviders(ui: ReactElement, { route = '/', session = null, authMock, profileMock, ...renderOptions }: CustomRenderOptions = {}) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    const defaultProfile: UserProfile = {
      id: session?.user?.id || authMock?.session?.user?.id || 'test-user-id',
      subscription_status: 'pro',
      usage_seconds: 0,
      usage_reset_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      ...profileMock
    };

    return (
      <MemoryRouter initialEntries={[route]}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider initialSession={session || (authMock?.session as Session)}>
            <ProfileProvider value={{ profile: defaultProfile, isVerified: true }}>
              <TranscriptionProvider>
                {children}
              </TranscriptionProvider>
            </ProfileProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  };

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

export function renderHookWithProviders<Result, Props>(
  render: (initialProps: Props) => Result,
  { route = '/', session = null, authMock, profileMock, ...renderOptions }: CustomRenderOptions = {}
) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    const defaultProfile: UserProfile = {
      id: session?.user?.id || authMock?.session?.user?.id || 'test-user-id',
      subscription_status: 'pro',
      usage_seconds: 0,
      usage_reset_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      ...profileMock
    };

    return (
      <MemoryRouter initialEntries={[route]}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider initialSession={session || (authMock?.session as Session)}>
            <ProfileProvider value={{ profile: defaultProfile, isVerified: true }}>
              <TranscriptionProvider>
                {children}
              </TranscriptionProvider>
            </ProfileProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  };

  return renderHook(render, { wrapper: Wrapper, ...renderOptions });
}
