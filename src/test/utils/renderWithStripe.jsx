// test-utils/renderWithStripe.jsx
import React from 'react';
import { render } from '@testing-library/react';
import { Elements } from '@stripe/react-stripe-js';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';

// ✅ Fake Stripe object that satisfies <Elements>
const mockStripe = {
  elements: () => ({
    getElement: vi.fn(),
    create: vi.fn(),
    destroy: vi.fn(),
  }),
};

export function renderWithStripe(ui, options) {
  return render(
    <MemoryRouter>
      <Elements stripe={mockStripe}>
        {ui}
        <Toaster />
      </Elements>
    </MemoryRouter>,
    options
  );
}
