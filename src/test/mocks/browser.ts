// src/test/mocks/browser.ts - For E2E tests
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

// Combine all handlers for a single, comprehensive worker.
// The obsolete anonymousHandlers have been removed to prevent conflicting mocks.
export const worker = setupWorker(...handlers);

// Browser setup function for E2E tests
export async function setupMSW() {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    await worker.start({
      onUnhandledRequest: 'warn',
      serviceWorker: {
        url: '/mockServiceWorker.js',
        options: {
          scope: '/',
        },
      },
    });
  }
}
