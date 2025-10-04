import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);

export async function setupMSW() {
  if (typeof window === 'undefined') {
    console.error('[MSW] Window is undefined. Cannot start MSW in Node environment.');
    throw new Error('MSW can only run in browser context');
  }
  console.log('[MSW] Starting Service Worker...');
  try {
    await worker.start({
      onUnhandledRequest: 'error', // Fail loudly on unhandled requests
      serviceWorker: { url: '/mockServiceWorker.js', options: { scope: '/' } },
    });
    console.log('[MSW] Service Worker started successfully');
  } catch (err) {
    console.error('[MSW] Failed to start Service Worker', err);
    throw err;
  }
}