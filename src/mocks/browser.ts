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