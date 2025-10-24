import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { AuthProvider } from './contexts/AuthProvider';
import { SessionProvider } from './contexts/SessionProvider';
import { Toaster } from './components/ui/sonner';
import { getSyncSession } from './lib/utils';
import { ErrorBoundary } from './components/ErrorBoundary';
import * as Sentry from '@sentry/react';

const initializeApp = async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isTestMode = urlParams.get('test') === 'true' || urlParams.get('e2e') === 'true';

  if (isTestMode) {
    console.log('[E2E] Test mode detected from URL, preparing mock service worker...');
    const { worker } = await import('./mocks/browser');
    await worker.start();
    window.mswReady = true;
    console.log('[E2E] MSW ready, now rendering app');
  } else {
    // Sentry initialization for non-test environments
    if (import.meta.env.VITE_SENTRY_DSN) {
      Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
        tracesSampleRate: 1.0,
        replaysOnErrorSampleRate: 1.0,
        replaysSessionSampleRate: 0.1,
      });
    }
  }

  const initialSession = getSyncSession();

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider initialSession={initialSession}>
            <SessionProvider>
              <App />
              <Toaster />
            </SessionProvider>
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>
  );
};

initializeApp();
