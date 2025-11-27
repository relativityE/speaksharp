// src/main.tsx
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import logger from '@/lib/logger';
import { AuthProvider } from './contexts/AuthProvider';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { Elements } from '@stripe/react-stripe-js';
import { Session } from '@supabase/supabase-js';
import * as Sentry from "@sentry/react";
import ConfigurationNeededPage from "./pages/ConfigurationNeededPage";
import App from './App';
import { IS_TEST_ENVIRONMENT } from '@/config/env';

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
const queryClient = new QueryClient();

const renderApp = async (initialSession: Session | null = null) => {
  if (rootElement && !window._speakSharpRootInitialized) {
    window._speakSharpRootInitialized = true;

    if (areEnvVarsPresent()) {
      console.log('[E2E DIAGNOSTIC] ./App imported successfully:', !!App);
      // 🛑 Skip ALL analytics in test mode
      if (!IS_TEST_ENVIRONMENT) {
        if (import.meta.env.VITE_SENTRY_DSN) {
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
          } catch (err) {
            console.warn('[Sentry Disabled] Invalid DSN:', err);
          }
        } else {
          console.warn('[Sentry Disabled] No DSN provided');
        }

        // Defer PostHog initialization
        if (import.meta.env.VITE_POSTHOG_KEY && import.meta.env.VITE_POSTHOG_HOST) {
          setTimeout(() => {
            try {
              posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
                api_host: import.meta.env.VITE_POSTHOG_HOST,
                capture_exceptions: true,
                debug: import.meta.env.MODE === 'development',
              });
            } catch (error) {
              logger.warn({ error }, "PostHog failed to initialize:");
            }
          }, 0);
        }
      } else {
        console.warn('[E2E MODE] Analytics disabled entirely.');
      }

      // Defer Stripe loading - create promise but don't await it
      // Stripe will be loaded when Elements component mounts
      const stripePromise = import('@stripe/stripe-js').then(({ loadStripe }) =>
        loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY!)
      );

      // Get initial session (mock if in E2E mode)
      let sessionToUse = initialSession;
      if (IS_TEST_ENVIRONMENT) {
        const { getInitialSession } = await import('@/lib/e2e-bridge');
        sessionToUse = getInitialSession(initialSession);
      }

      root.render(
        <StrictMode>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <PostHogProvider client={posthog}>
                <AuthProvider initialSession={sessionToUse}>
                  <Elements stripe={stripePromise}>
                    <Sentry.ErrorBoundary fallback={<div>An error has occurred. Please refresh the page.</div>}>
                      <App />
                    </Sentry.ErrorBoundary>
                  </Elements>
                </AuthProvider>
              </PostHogProvider>
            </BrowserRouter>
          </QueryClientProvider>
        </StrictMode>
      );
    } else {
      root.render(
        <StrictMode>
          <ConfigurationNeededPage />
        </StrictMode>
      );
    }
  }
};

const initialize = async () => {
  if (IS_TEST_ENVIRONMENT) {
    const { initializeE2EEnvironment } = await import('@/lib/e2e-bridge');
    await initializeE2EEnvironment();
    console.log('[E2E] Environment ready, now rendering app');
    await renderApp();

    // Signal that the app is fully mounted and ready for interaction
    const { dispatchE2EEvent } = await import('@/lib/e2e-bridge');
    dispatchE2EEvent('e2e:app-ready');
  } else {
    await renderApp();
  }
};

initialize();
