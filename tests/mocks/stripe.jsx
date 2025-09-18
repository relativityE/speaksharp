// tests/mocks/stripe.js
import React from 'react';

// Fake stripe instance (any truthy object works)
export const mockStripe = { _mock: true };

export async function loadStripe() {
  return mockStripe;
}

export const Elements = ({ children }) => <>{children}</>;
export const useStripe = () => ({ mock: true });
export const useElements = () => ({});

export default {
  Elements,
  useStripe,
  useElements,
  loadStripe,
};
