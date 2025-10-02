import React, { ReactElement } from 'react';
import { AuthProvider } from '../contexts/AuthProvider';
import { SessionProvider } from '../contexts/SessionProvider';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  session?: Session | null;
}

// This test helper is used to wrap components under test with necessary providers.
// The key part is `enableSubscription={false}`, which prevents the real Supabase
// auth listener from being created, solving the memory leak in the test environment.
export function renderWithProviders(ui: ReactElement, { route = '/', session = null, ...renderOptions }: CustomRenderOptions = {}) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider initialSession={session}>
        <SessionProvider>
          {children}
        </SessionProvider>
      </AuthProvider>
    </MemoryRouter>
  );

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
