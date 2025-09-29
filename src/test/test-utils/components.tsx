import React, { ReactNode } from 'react';
import { MemoryRouter, Routes, Route, Location } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthContext, AuthContextType } from '../../contexts/AuthContext';
import { SessionContext, SessionContextValue } from '../../contexts/SessionContext';
import { Toaster } from '@/components/ui/sonner';

export const MockElements = ({ children }: { children: ReactNode }) => <>{children}</>;

export const MockAuthProvider = ({ children, mockValue }: { children: ReactNode, mockValue: Partial<AuthContextType> }) => (
  <AuthContext.Provider value={mockValue as AuthContextType}>{children}</AuthContext.Provider>
);

export const MockSessionProvider = ({ children, mockValue }: { children: ReactNode, mockValue: Partial<SessionContextValue> }) => (
  <SessionContext.Provider value={mockValue as SessionContextValue}>{children}</SessionContext.Provider>
);

interface AllTheProvidersProps {
  children: ReactNode;
  authMock?: Partial<AuthContextType>;
  sessionMock?: Partial<SessionContextValue>;
  route?: string | Partial<Location>;
  path?: string;
}

export const AllTheProviders = ({ children, authMock, sessionMock, route = '/', path }: AllTheProvidersProps) => {
  const initialEntries = [typeof route === 'string' ? { pathname: route } : route];

  const defaultAuthMock: AuthContextType = {
    session: null,
    user: null,
    profile: null,
    loading: false,
    signOut: vi.fn().mockResolvedValue(undefined),
  };

  const defaultSessionMock: SessionContextValue = {
    sessionHistory: [],
    loading: false,
    error: null,
    addSession: vi.fn(),
    refreshHistory: vi.fn(),
    clearAnonymousSession: vi.fn(),
  };

  const content = path ? <Routes><Route path={path} element={<>{children}</>} /></Routes> : children;

  return (
    <MemoryRouter initialEntries={initialEntries}>
      <MockAuthProvider mockValue={{ ...defaultAuthMock, ...authMock }}>
        <MockSessionProvider mockValue={{ ...defaultSessionMock, ...sessionMock }}>
          <MockElements>
            {content}
            <Toaster />
          </MockElements>
        </MockSessionProvider>
      </MockAuthProvider>
    </MemoryRouter>
  );
};