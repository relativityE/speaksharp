// src/testEnv.ts

// Extend the Window interface to include our custom promise for MSW readiness.
declare global {
  interface Window {
    mswReady?: Promise<ServiceWorkerRegistration | undefined>;
  }
}

export async function initializeMocks() {
  // We only want to initialize mocks in the 'test' environment.
  if (import.meta.env.MODE === 'test') {
    console.log('[testEnv] Initializing Mock Service Worker for E2E tests.');
    const { worker } = await import('./test/mocks/browser');

    // The worker.start() method returns a promise that resolves when the service worker is ready.
    // We attach this promise to the window object so that our Playwright tests can wait for it.
    console.log('[testEnv] Attaching mswReady promise to window.');
    window.mswReady = (async () => {
      try {
        console.log('[testEnv] Calling worker.start()...');
        const registration = await worker.start({
          onUnhandledRequest: 'bypass',
          serviceWorker: {
            url: '/mockServiceWorker.js',
          },
        });
        console.log('[testEnv] MSW worker.start() resolved successfully.');
        return registration;
      } catch (error) {
        console.error('[testEnv] MSW worker.start() FAILED:', error);
        // Re-throw the error to ensure the promise rejects and the test fails.
        throw error;
      }
    })();

    console.log('[testEnv] Mock Service Worker initialization promise has been set on window.mswReady.');
  }
}