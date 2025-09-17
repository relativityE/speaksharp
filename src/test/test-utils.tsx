import React, { ReactElement, ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Location } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthContext, AuthContextType } from '../contexts/AuthContext';
import { SessionContext, SessionContextValue } from '../contexts/SessionContext';
import { Toaster } from '@/components/ui/sonner';

// --- Mock Components ---

const MockElements = ({ children }: { children: ReactNode }) => <>{children}</>;

const MockAuthProvider = ({ children, mockValue }: { children: ReactNode, mockValue: Partial<AuthContextType> }) => (
  <AuthContext.Provider value={mockValue as AuthContextType}>{children}</AuthContext.Provider>
);

const MockSessionProvider = ({ children, mockValue }: { children: ReactNode, mockValue: Partial<SessionContextValue> }) => (
  <SessionContext.Provider value={mockValue as SessionContextValue}>{children}</SessionContext.Provider>
);

// --- AllTheProviders Wrapper ---

interface AllTheProvidersProps {
  children: ReactNode;
  authMock?: Partial<AuthContextType>;
  sessionMock?: Partial<SessionContextValue>;
  route?: string | Partial<Location>;
  path?: string;
}

const AllTheProviders = ({ children, authMock, sessionMock, route = '/', path }: AllTheProvidersProps) => {
  const initialEntries = [typeof route === 'string' ? { pathname: route } : route];

  const defaultAuthMock: AuthContextType = {
    session: null,
    user: null,
    profile: null,
    loading: false,
    signOut: vi.fn().mockResolvedValue(undefined),
    is_anonymous: true,
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

// --- Custom Render Function ---

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  authMock?: Partial<AuthContextType>;
  sessionMock?: Partial<SessionContextValue>;
  route?: string | Partial<Location>;
  path?: string;
}

const renderWithAllProviders = (ui: ReactElement, options: CustomRenderOptions = {}) => {
  const { authMock, sessionMock, route, path, ...renderOptions } = options;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AllTheProviders authMock={authMock} sessionMock={sessionMock} route={route} path={path}>
      {children}
    </AllTheProviders>
  );
  return render(ui, { wrapper: Wrapper, ...renderOptions });
};

// Re-export everything from testing-library and override render
export * from '@testing-library/react';
export { renderWithAllProviders as render };
