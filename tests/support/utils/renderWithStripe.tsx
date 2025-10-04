import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { vi } from 'vitest';
import { Elements } from '@stripe/react-stripe-js';
import { Stripe } from '@stripe/stripe-js';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';

// A simplified mock of the Stripe object.
const mockStripe: Partial<Stripe> = {
  elements: vi.fn().mockReturnValue({
    getElement: vi.fn(),
    create: vi.fn(),
    destroy: vi.fn(),
  }),
  // Add other Stripe methods as needed by your components under test
  createToken: vi.fn(),
  createPaymentMethod: vi.fn(),
};

export function renderWithStripe(ui: ReactElement, options?: RenderOptions) {
  return render(
    <MemoryRouter>
      <Elements stripe={mockStripe as Stripe}>
        {ui}
        <Toaster />
      </Elements>
    </MemoryRouter>,
    options
  );
}
