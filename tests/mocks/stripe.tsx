// tests/mocks/stripe.tsx
import React from 'react';
import type { Stripe } from '@stripe/stripe-js';

// Fake stripe instance (any truthy object works)
export const mockStripe = { _mock: true } as unknown as Stripe;

export async function loadStripe(): Promise<Stripe | null> {
  return Promise.resolve(mockStripe);
}

interface ElementsProps {
  children: React.ReactNode;
  stripe?: Promise<Stripe | null> | Stripe | null;
  options?: any;
}

export const Elements: React.FC<ElementsProps> = ({ children }) => {
  return <>{children}</>;
};

export const useStripe = () => {
  return { _mock: true };
};

export const useElements = () => {
  return {};
};

export default {
  Elements,
  useStripe,
  useElements,
  loadStripe,
};
