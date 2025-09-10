// src/test/mocks/browser.ts - For E2E tests
import { setupWorker } from 'msw/browser';
import { handlers, anonymousHandlers } from './handlers';

// Set up the worker with our handlers
export const worker = setupWorker(...handlers);

// For anonymous user flows
export const anonymousWorker = setupWorker(...handlers, ...anonymousHandlers);

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
