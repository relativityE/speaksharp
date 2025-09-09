import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

import { AuthContext } from '../contexts/AuthContext';
import { SessionContext } from '../contexts/SessionContext';
import { Toaster } from '@/components/ui/sonner';

// Mock the Elements provider to do nothing but render its children.
// This avoids needing a complex and brittle mock of the entire Stripe object.
const MockElements = ({ children }) => <>{children}</>;

// Create a mock AuthProvider that provides a value directly
const MockAuthProvider = ({ children, mockValue }) => (
  <AuthContext.Provider value={mockValue}>{children}</AuthContext.Provider>
);

// Create a mock SessionProvider that provides a value directly
const MockSessionProvider = ({ children, mockValue }) => (
  <SessionContext.Provider value={mockValue}>{children}</SessionContext.Provider>
);

const AllTheProviders = ({ children, authMock, sessionMock, route = '/' }) => {
  const initialEntries = [typeof route === 'string' ? { pathname: route } : route];

  // Provide default mocks if none are passed
  const defaultAuthMock = { user: null, profile: null, loading: false, signOut: vi.fn() };
  const defaultSessionMock = { sessionHistory: [], loading: false, error: null, addSession: vi.fn() };

  return (
    <MemoryRouter initialEntries={initialEntries}>
      <MockAuthProvider mockValue={authMock || defaultAuthMock}>
        <MockSessionProvider mockValue={sessionMock || defaultSessionMock}>
          <MockElements>
            {children}
            <Toaster />
          </MockElements>
        </MockSessionProvider>
      </MockAuthProvider>
    </MemoryRouter>
  );
};

const renderWithAllProviders = (ui, options = {}) => {
  const { authMock, sessionMock, route, ...renderOptions } = options;
  const Wrapper = ({ children }) => (
    <AllTheProviders authMock={authMock} sessionMock={sessionMock} route={route}>
      {children}
    </AllTheProviders>
  );

  return render(ui, { wrapper: Wrapper, ...renderOptions });
};

// Re-export everything from testing-library
export * from '@testing-library/react';

// Override the render method with our custom one
export { renderWithAllProviders as render };
