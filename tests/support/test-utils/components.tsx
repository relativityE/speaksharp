import React, { ReactNode } from 'react';
import { MemoryRouter, Routes, Route, Location } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthContext, AuthContextType } from '@/contexts/AuthContext';
import { Toaster } from '@/components/ui/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export const MockElements = ({ children }: { children: ReactNode }) => <>{children}</>;

export const MockAuthProvider = ({ children, mockValue }: { children: ReactNode, mockValue: Partial<AuthContextType> }) => (
  <AuthContext.Provider value={mockValue as AuthContextType}>{children}</AuthContext.Provider>
);

interface AllTheProvidersProps {
  children: ReactNode;
  authMock?: Partial<AuthContextType>;
  route?: string | Partial<Location>;
  path?: string;
}

const queryClient = new QueryClient();

export const AllTheProviders = ({ children, authMock, route = '/', path }: AllTheProvidersProps) => {
  const initialEntries = [typeof route === 'string' ? { pathname: route } : route];

  const defaultAuthMock: AuthContextType = {
    session: null,
    user: null,
    profile: null,
    loading: false,
    signOut: vi.fn().mockResolvedValue({ error: null }),
    setSession: vi.fn(),
  };

  const content = path ? <Routes><Route path={path} element={<>{children}</>} /></Routes> : children;

  return (
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={queryClient}>
        <MockAuthProvider mockValue={{ ...defaultAuthMock, ...authMock }}>
          <MockElements>
            {content}
            <Toaster />
          </MockElements>
        </MockAuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
};
