import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { BrowserRouter } from 'react-router-dom';
import logger from '@/lib/logger';
import { AuthProvider } from './contexts/AuthProvider';
import { SessionProvider } from './contexts/SessionProvider';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import * as Sentry from "@sentry/react";
import ConfigurationNeededPage from "./pages/ConfigurationNeededPage";

// React DnD imports
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

// MSW browser worker (only runs in dev/test)
async function enableMocking() {
  if (import.meta.env.MODE === "development" || import.meta.env.MODE === "test") {
    const { worker } = await import("./test/mocks/browser");

    const mswReady = new Promise<void>((resolve, reject) => {
      worker
        .start({
          onUnhandledRequest: "bypass",
        })
        .then(() => {
          console.log("[E2E] MSW initialized successfully.");
          (window as any).mswReady = true;
          resolve();
        })
        .catch((err) => {
          console.error("[E2E ERROR] MSW failed to start:", err);
          (window as any).__E2E_MSW_ERROR = err;
          reject(err);
        });
    });

    return mswReady;
  }
  return Promise.resolve();
}

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

enableMocking().finally(() => {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error("Could not find root element with id 'root'");
  const root = ReactDOM.createRoot(rootElement);

  if (areEnvVarsPresent()) {
    // Initialize PostHog
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

    // Initialize Sentry
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

    const initialSession = (window as any).__E2E_MOCK_SESSION__ ? {
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
      <React.StrictMode>
        <BrowserRouter>
          <PostHogProvider client={posthog}>
            <AuthProvider initialSession={initialSession}>
              <SessionProvider>
                <Elements stripe={stripePromise}>
                  <Sentry.ErrorBoundary fallback={<div>An error has occurred. Please refresh the page.</div>}>
                    {/* Added DnD Provider to fix registerBackend error */}
                    <DndProvider backend={HTML5Backend}>
                      <App />
                    </DndProvider>
                  </Sentry.ErrorBoundary>
                </Elements>
              </SessionProvider>
            </AuthProvider>
          </PostHogProvider>
        </BrowserRouter>
      </React.StrictMode>
    );
  } else {
    // Missing env vars, show config page
    root.render(
      <React.StrictMode>
        <ConfigurationNeededPage />
      </React.StrictMode>
    );
  }
});