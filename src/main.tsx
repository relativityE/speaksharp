import "./testEnv"; // Must be the first import

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
import App from './App';

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
  // In test mode, wait for the Mock Service Worker to be ready.
  if (import.meta.env.MODE === 'test') {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("MSW mock server did not become ready within 2 seconds.")), 2000);

      const checkMswReady = () => {
        if ((window as any).mswReady) {
          clearTimeout(timeout);
          resolve();
        } else {
          requestAnimationFrame(checkMswReady);
        }
      };
      checkMswReady();
    });
  }

  if (areEnvVarsPresent()) {
    const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY!);

    try {
      if (import.meta.env.VITE_POSTHOG_KEY && import.meta.env.VITE_POSTHOG_HOST) {
        posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
          api_host: import.meta.env.VITE_POSTHOG_HOST,
        });
      }
    } catch (error) {
      logger.warn({ error }, "PostHog failed to initialize:");
    }

    try {
      Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
        environment: import.meta.env.MODE,
      });
    } catch (error) {
      logger.warn({ error }, "Sentry failed to initialize:");
    }

    root.render(
      <StrictMode>
        <BrowserRouter>
          <PostHogProvider client={posthog}>
            <AuthProvider>
              <SessionProvider>
                <Elements stripe={stripePromise}>
                  <Sentry.ErrorBoundary fallback={<div>An error has occurred.</div>}>
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
    root.render(
      <StrictMode>
        <ConfigurationNeededPage />
      </StrictMode>
    );
  }
};

renderApp().catch(err => {
  console.error("Failed to render app:", err);
  if (rootElement) {
    const errorMessage = err instanceof Error ? err.stack || err.message : JSON.stringify(err);
    rootElement.innerHTML = `<div style="padding: 2rem; background-color: #fff0f0; border: 3px solid red; color: #d00; font-family: monospace; white-space: pre-wrap;"><h1>Render Error</h1><pre>${errorMessage}</pre></div>`;
  }
});