// src/types/ambient.d.ts
import { SetupWorkerApi } from 'msw/browser';

declare global {
  interface Window {
    mswReady: Promise<ServiceWorkerRegistration | undefined>;
    _speakSharpRootInitialized?: boolean;
    __E2E_MOCK_SESSION__?: boolean;
    __USER__?: {
      id: string;
      email: string;
      subscription_status: 'free' | 'pro';
    };
  }
}

// This is necessary to make the file a module.
export {};