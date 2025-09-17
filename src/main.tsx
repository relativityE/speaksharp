import "./testEnv"; // Must be the first import

import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import logger from '@/lib/logger';
import { AuthProvider } from './contexts/AuthContext';
import { SessionProvider } from './contexts/SessionContext';
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

      const initialSession = window.__E2E_MOCK_SESSION__ || null;

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
