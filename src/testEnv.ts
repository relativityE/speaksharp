// src/testEnv.ts

/**
 * This file is imported only in test environments and is used to set up the
 * Mock Service Worker (MSW) for intercepting network requests in Playwright tests.
 * It uses `setupWorker` from `msw/browser` to run in the browser context.
 */
import { setupWorker } from 'msw/browser';
import { handlers } from './test/mocks/handlers';

console.log('[testEnv] Initializing Mock Service Worker for E2E tests.');

// This configures a Service Worker with the given request handlers.
export const worker = setupWorker(...handlers);

// We need to extend the window type to include our custom promise
declare global {
  interface Window {
    mswReady?: Promise<ServiceWorkerRegistration | undefined>;
  }
}

// Start the worker and attach its "ready" promise to the window object.
// The application entry point (`main.tsx`) will await this promise
// to ensure that the mock server is fully initialized before the app renders.
window.mswReady = worker.start({
  // Use a 'quiet' startup to avoid flooding the console with MSW logs.
  quiet: true,
  // Fallback to original behavior for any unhandled requests.
  onUnhandledRequest: 'bypass',
});

console.log('[testEnv] Mock Service Worker initialization promise has been set on window.mswReady.');