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
const queryClient = new QueryClient();

const renderApp = (initialSession: Session | null = null) => {
  if (rootElement && !window._speakSharpRootInitialized) {
    window._speakSharpRootInitialized = true;

    if (areEnvVarsPresent()) {
      import('./App').then(({ default: App }) => {
        console.log('[E2E DIAGNOSTIC] ./App imported successfully:', !!App);
        // 🛑 Skip ALL analytics in E2E mode
        if (import.meta.env.VITE_TEST_MODE !== 'true') {
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
        } else {
          console.warn('[E2E MODE] Analytics disabled entirely.');
        }


        const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY!);

        const sessionToUse = window.__E2E_MOCK_SESSION__ ? ({
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
        } as Session) : initialSession;

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
      });
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
  if (import.meta.env.VITE_TEST_MODE === 'true') {
    window.__E2E_MODE__ = true;

    const startMsw = async () => {
      const { worker } = await import('./mocks/browser');
      await worker.start({ onUnhandledRequest: 'bypass' });
      console.log('[MSW] Mock Service Worker is ready.');
    };

    window.mswReady = false;
    await startMsw();
    window.mswReady = true;
    console.log('[E2E] MSW ready, now rendering app');
    renderApp();
  } else {
    renderApp();
  }
};

initialize();
