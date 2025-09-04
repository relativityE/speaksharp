import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthContext';
import { SessionProvider } from '../contexts/SessionContext';

// This is a wrapper that provides all the necessary contexts for a component.
// It's used to avoid having to wrap every single component in every single test.
const AllTheProviders = ({ children }) => {
  return (
    <MemoryRouter>
      <AuthProvider>
        <SessionProvider>
          {children}
        </SessionProvider>
      </AuthProvider>
    </MemoryRouter>
  );
};

// This is a custom render function that uses the AllTheProviders wrapper.
const customRender = (ui, options) =>
  render(ui, { wrapper: AllTheProviders, ...options });

// Re-export everything from react-testing-library
export * from '@testing-library/react';

// Override the render method with our custom one
export { customRender as render };
