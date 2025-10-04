// src/testEnv.ts

// Extend the Window interface to include our custom promise for MSW readiness.
declare global {
  interface Window {
    mswReady?: Promise<ServiceWorkerRegistration | undefined>;
  }
}

async function initializeMocks() {
  console.log('[testEnv] Initializing Mock Service Worker for E2E tests.');
  // Using an absolute path from the project root for robustness.
  const { worker } = await import('/tests/support/mocks/browser.ts');

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