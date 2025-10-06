// tests/e2e/testEnv.ts

// Extend the Window interface to include our custom promise for MSW readiness.
declare global {
  interface Window {
    mswReady?: Promise<ServiceWorkerRegistration | undefined>;
  }
}

async function initializeMocks() {
  console.log('[testEnv] Initializing Mock Service Worker for E2E tests.');
  // Use the 'tests/' alias for a robust, non-relative path.
  const { worker } = await import('tests/support/mocks/browser');

  // The worker.start() method returns a promise that resolves when the service worker is ready.
  // We attach this promise to the window object so that our Playwright tests can wait for it.
  window.mswReady = worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: {
      url: '/mockServiceWorker.js',
    },
  });

  console.log('[testEnv] Mock Service Worker initialization promise has been set on window.mswReady.');
}

// Initialize the mocks. This file is only imported when VITE_TEST_MODE is true.
if (typeof window !== 'undefined') {
  initializeMocks();
}

// Export an empty object to ensure this file is treated as a module.
// This is necessary for the `declare global` to work correctly.
export {};