import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Elements } from '@stripe/react-stripe-js';
import { vi } from 'vitest';

import { AuthProvider } from '../contexts/AuthContext';
import { SessionProvider } from '../contexts/SessionContext';
import { Toaster } from '@/components/ui/sonner';

// A more robust mock for the Stripe object that satisfies the <Elements> provider
const mockStripePromise = Promise.resolve({
  elements: vi.fn(() => ({
    create: vi.fn(),
    getElement: vi.fn(),
    update: vi.fn(),
    fetchUpdates: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
  })),
  createPaymentMethod: vi.fn(),
  confirmCardPayment: vi.fn(),
});

const AllTheProviders = ({ children, initialSession, route = '/' }) => {
  // The 'route' can be a string or a location object with state
  const initialEntries = [typeof route === 'string' ? { pathname: route } : route];

  return (
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider enableSubscription={false} initialSession={initialSession}>
        <SessionProvider>
          <Elements stripe={mockStripePromise}>
            {children}
            <Toaster />
          </Elements>
        </SessionProvider>
      </AuthProvider>
    </MemoryRouter>
  );
};

const renderWithAllProviders = (ui, options = {}) => {
  const { initialSession, route, ...renderOptions } = options;
  const Wrapper = ({ children }) => (
    <AllTheProviders initialSession={initialSession} route={route}>
      {children}
    </AllTheProviders>
  );

  return render(ui, { wrapper: Wrapper, ...renderOptions });
};

// Re-export everything from testing-library
export * from '@testing-library/react';

// Override the render method with our custom one
export { renderWithAllProviders as render };
