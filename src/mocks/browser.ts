// src/mocks/browser.ts
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

// This configures a Service Worker with the given request handlers.
export const worker = setupWorker(...handlers);

/**
 * Starts the MSW worker in the browser.
 * This function is designed to be called from the application's entry point
 * during test mode. It sets a global flag `window.mswReady` that resolves
 * to `true` when the worker is ready, allowing Playwright tests to wait for it.
 */
export async function startMockWorker() {
  // Do not start in non-browser environments.
  if (typeof window === 'undefined') {
    return;
  }

  // Set an initial flag. Tests can wait for this to become `true`.
  (window as any).mswReady = false;

  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: {
      url: '/mockServiceWorker.js',
    },
  });

  // Once the worker is ready, set the flag to true.
  (window as any).mswReady = true;
  console.log('[MSW] Mock Service Worker is ready.');
}