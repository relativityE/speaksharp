// test-utils/renderWithStripe.jsx
import React from 'react';
import { render } from '@testing-library/react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';

// ✅ Use a dummy pk_test key – Stripe just needs it to be truthy & valid format
const stripePromise = loadStripe('pk_test_12345dummy');

export function renderWithStripe(ui, options) {
  return render(
    <MemoryRouter>
        <Elements stripe={stripePromise}>
            {ui}
            <Toaster />
        </Elements>
    </MemoryRouter>,
    options
  );
}
