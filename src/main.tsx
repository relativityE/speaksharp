import "./testEnv"; // Must be the first import

// This check ensures that the E2E test environment fails loudly and immediately
// if the mock server does not initialize, preventing silent timeouts.
if (import.meta.env.MODE === 'test') {
  // We wait for a short period to give the async `initializeMocks` function
  // in testEnv.ts a chance to run and attach the `mswReady` promise to the window.
  setTimeout(() => {
    if (!window.mswReady) {
      const errorMessage = `
        [E2E TEST FATAL ERROR]
        The MSW mock server did not initialize.
        This is a critical failure in the test environment setup.

        Root Cause: The 'import "./testEnv.ts"' statement in 'main.tsx' was likely tree-shaken by Vite,
        so the mock server was never started.

        Solution: To fix this, you must prevent Vite from tree-shaking this import in test mode.
        Add the following configuration to 'vite.config.mjs':

        build: {
          // ... other build options
          treeshake: {
            moduleSideEffects: (id) => id.endsWith('testEnv.ts')
          }
        }

        This test cannot proceed until the environment is fixed.
      `;

      // Display a prominent error message in the DOM for visual debugging in Playwright.
      const root = document.getElementById('root');
      if (root) {
        root.innerHTML = `<div style="color: red; font-family: monospace; white-space: pre; padding: 2rem; background-color: #fff0f0; border: 2px solid red;">${errorMessage}</div>`;
      }

      // Throw a fatal error to crash the test runner and print the message to the console.
      throw new Error(errorMessage);
    }
  }, 500); // 500ms is a generous wait time.
}

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

    if (areEnvVarsPresent()) {
      // Environment variables are present, load the main application.
      const { default: App } = await import('./App');

      // Initialize services
      try {
        if (import.meta.env.VITE_POSTHOG_KEY && import.meta.env.VITE_POSTHOG_HOST) {
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
      } catch (error) {
        logger.warn({ error }, "Sentry failed to initialize:");
      }

      const initialSession = window.__E2E_MOCK_SESSION__ ? {
        access_token: 'mock-token',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'mock-refresh-token',
        user: {
          id: 'mock-user-id',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'test@example.com',
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      } : null;

      root.render(
        <StrictMode>
          <BrowserRouter>
            <PostHogProvider client={posthog}>
              <AuthProvider initialSession={initialSession}>
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
