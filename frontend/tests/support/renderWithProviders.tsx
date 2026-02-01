import React, { ReactElement } from 'react';
import { AuthProvider } from '@/contexts/AuthProvider';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  session?: Session | null;
}

const queryClient = new QueryClient();

// This test helper is used to wrap components under test with necessary providers.
export function renderWithProviders(ui: ReactElement, { route = '/', session = null, ...renderOptions }: CustomRenderOptions = {}) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider initialSession={session}>
          {children}
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
