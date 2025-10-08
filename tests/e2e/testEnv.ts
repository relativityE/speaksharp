// tests/e2e/testEnv.ts

// Extend the Window interface to include our custom promise for MSW readiness.
declare global {
  interface Window {
    mswIsReady?: boolean;
  }
}

async function initializeMocks() {
  // MSW is now initialized in the global setup. This file is still needed
  // to ensure the browser has the correct environment context.
  console.log('[testEnv] MSW initialization is now handled globally.');
}

// Initialize the mocks. This file is only imported when VITE_TEST_MODE is true.
if (typeof window !== 'undefined') {
  initializeMocks();
}

// Treat this file as a module to allow global augmentation.
export {};