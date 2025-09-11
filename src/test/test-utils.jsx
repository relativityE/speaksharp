import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthContext } from '../contexts/AuthContext';
import { SessionContext } from '../contexts/SessionContext';
import { Toaster } from '@/components/ui/sonner';

// Mock the Elements provider to do nothing but render its children.
const MockElements = ({ children }) => <>{children}</>;

// Create a mock AuthProvider that provides a value directly
export const MockAuthProvider = ({ children, mockValue }) => (
  <AuthContext.Provider value={mockValue}>{children}</AuthContext.Provider>
);

// Create a mock SessionProvider that provides a value directly
export const MockSessionProvider = ({ children, mockValue }) => (
  <SessionContext.Provider value={mockValue}>{children}</SessionContext.Provider>
);

import { Routes, Route } from 'react-router-dom';

const AllTheProviders = ({ children, authMock, sessionMock, route = '/', path }) => {
  const initialEntries = [typeof route === 'string' ? { pathname: route } : route];

  // Provide default mocks if none are passed
  // FIXED: Complete auth mock matching AuthContext shape
  const defaultAuthMock = {
    session: null,
    user: null,
    profile: null,
    loading: false,  // Critical: false so components render immediately in tests
    signOut: vi.fn().mockResolvedValue(undefined)
  };

  const defaultSessionMock = {
    sessionHistory: [],
    loading: false,
    error: null,
    addSession: vi.fn()
  };

  const content = path ? <Routes><Route path={path} element={children} /></Routes> : children;

  return (
    <MemoryRouter initialEntries={initialEntries}>
      <MockAuthProvider mockValue={authMock || defaultAuthMock}>
        <MockSessionProvider mockValue={sessionMock || defaultSessionMock}>
          <MockElements>
            {content}
            <Toaster />
          </MockElements>
        </MockSessionProvider>
      </MockAuthProvider>
    </MemoryRouter>
  );
};

const renderWithAllProviders = (ui, options = {}) => {
  const { authMock, sessionMock, route, path, ...renderOptions } = options;
  const Wrapper = ({ children }) => (
    <AllTheProviders authMock={authMock} sessionMock={sessionMock} route={route} path={path}>
      {children}
    </AllTheProviders>
  );
  return render(ui, { wrapper: Wrapper, ...renderOptions });
};

// Re-export everything from testing-library
// eslint-disable-next-line react-refresh/only-export-components
export * from '@testing-library/react';
// Override the render method with our custom one
// eslint-disable-next-line react-refresh/only-export-components
export { renderWithAllProviders as render };
