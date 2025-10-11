// The redundant readiness check that caused a race condition has been removed.
// The waiting logic is now correctly handled inside AuthProvider.

import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import logger from '@/lib/logger';
import { AuthProvider } from './contexts/AuthProvider';
import { SessionProvider } from './contexts/SessionProvider';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { Session } from '@supabase/supabase-js';
import * as Sentry from "@sentry/react";
import ConfigurationNeededPage from "./pages/ConfigurationNeededPage";

const REQUIRED_ENV_VARS: string[] = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_STRIPE_PUBLISHABLE_KEY',
];

const areEnvVarsPresent = (): boolean => {
  return REQUIRED_ENV_VARS.every(varName => {
    const value = import.meta.env[varName];
    return value && value !== '';
  });
};

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("Could not find root element with id 'root'");
}

const root = ReactDOM.createRoot(rootElement);

const renderApp = async () => {
  if (rootElement && !window._speakSharpRootInitialized) {
    window._speakSharpRootInitialized = true;

    // Conditionally initialize the MSW for E2E testing.
    // This must happen before the main application renders to intercept all requests.
    if (import.meta.env.VITE_TEST_MODE === 'true') {
      const { worker } = await import('./mocks/browser');
      window.mswReady = worker.start({
        onUnhandledRequest: 'bypass',
      }).then(() => {
        console.log('[MSW] Mock Service Worker is ready.');
        return true;
      });
    }

    if (areEnvVarsPresent()) {
      // Environment variables are present, load the main application.
      const { default: App } = await import('./App');

      // Initialize services
      try {
        // Disable PostHog in E2E test mode to prevent network errors
        if (import.meta.env.VITE_POSTHOG_KEY && import.meta.env.VITE_POSTHOG_HOST && !window.__E2E_MOCK_SESSION__) {
          posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
            api_host: import.meta.env.VITE_POSTHOG_HOST,
            capture_exceptions: true,
            debug: import.meta.env.MODE === 'development',
          });
        }
      } catch (error) {
        logger.warn({ error }, "PostHog failed to initialize:");
      }

      const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY!);

      try {
        // Disable Sentry in E2E test mode
        if (!window.__E2E_MOCK_SESSION__) {
          Sentry.init({
            dsn: import.meta.env.VITE_SENTRY_DSN,
            integrations: [
              Sentry.browserTracingIntegration(),
              Sentry.replayIntegration(),
            ],
            environment: import.meta.env.MODE,
            tracesSampleRate: 1.0,
            replaysSessionSampleRate: 0.1,
            replaysOnErrorSampleRate: 1.0,
            sendDefaultPii: true,
          });
        }
      } catch (error) {
        logger.warn({ error }, "Sentry failed to initialize:");
      }

      // In E2E test mode, we might want to inject a mock session.
      const mockSession = window.__E2E_MOCK_SESSION__ ? ({
        user: {
          id: 'mock-user-id',
          email: 'test@example.com',
          aud: 'authenticated',
          role: 'authenticated',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          app_metadata: {
            provider: 'email',
            providers: ['email'],
          },
          user_metadata: { subscription_status: 'free' },
        },
        access_token: 'mock-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
      } as Session) : null;

      root.render(
        <StrictMode>
          <BrowserRouter>
            <PostHogProvider client={posthog}>
              <AuthProvider initialSession={mockSession}>
                <SessionProvider>
                  <Elements stripe={stripePromise}>
                    <Sentry.ErrorBoundary fallback={<div>An error has occurred. Please refresh the page.</div>}>
                      <App />
                    </Sentry.ErrorBoundary>
                  </Elements>
                </SessionProvider>
              </AuthProvider>
            </PostHogProvider>
          </BrowserRouter>
        </StrictMode>
      );
    } else {
      // Missing environment variables, render the configuration needed page.
      root.render(
        <StrictMode>
          <ConfigurationNeededPage />
        </StrictMode>
      );
    }
  }
};

renderApp();