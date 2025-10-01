// src/test/mocks/browser.ts - For E2E tests
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

// Setup the worker with only the active, correct handlers.
// The legacy `anonymousHandlers` have been removed as they were preventing
// the MSW worker from initializing correctly and causing test timeouts.
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