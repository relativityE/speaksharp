// src/types/ambient.d.ts

// This file provides global type definitions for custom properties attached to the window object.
// These are used for testing, environment flags, and browser-specific APIs.

declare global {
  interface Window {
    // MSW promise for E2E tests to await
    mswReady: Promise<ServiceWorkerRegistration | undefined>;

    // General app state
    _speakSharpRootInitialized?: boolean;

    // E2E testing flags and data
    __E2E_MOCK_SESSION__?: boolean;
    __USER__?: {
      id: string;
      email?: string;
      subscription_status: 'free' | 'pro';
    } | null;

    // Browser-specific speech recognition APIs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SpeechRecognition?: new () => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webkitSpeechRecognition?: new () => any;

    // General test mode flag
    TEST_MODE?: boolean;

    // Supabase client stub for tests
    supabase?: any;
  }
}

// This is necessary to make the file a module.
export {};