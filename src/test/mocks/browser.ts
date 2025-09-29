// src/test/mocks/browser.ts - For E2E tests
import { setupWorker } from 'msw/browser';
import { handlers, anonymousHandlers } from './handlers';

// Combine all handlers for a single, comprehensive worker.
// This is the critical fix: the anonymous handlers were previously excluded,
// causing the test environment to hang during initialization.
export const worker = setupWorker(...handlers, ...anonymousHandlers);

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
