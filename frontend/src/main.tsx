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
import { useReadinessStore } from './stores/useReadinessStore';
 
 declare global {
   interface Window {
     _speakSharpRootInitialized?: boolean;
     __e2e_e2e_msw_ready_fired__?: boolean;
   }
 }

const REQUIRED_ENV_VARS: string[] = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_STRIPE_PUBLISHABLE_KEY',
  'VITE_SENTRY_DSN',
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
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 2,
    },
  },
});
if (IS_TEST_ENVIRONMENT) {
  (window as unknown as { queryClient: typeof queryClient }).queryClient = queryClient;
}
logger.info('[React Query] ✅ QueryClient initialized');

// 🔴 CRITICAL: Initialize Sentry FIRST before any async operations
// This ensures errors during initialization are captured
if (!IS_TEST_ENVIRONMENT && import.meta.env.VITE_SENTRY_DSN) {
  try {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration(),
        // Capture console.error and console.warn calls
        // Since Pino uses pino-pretty which outputs to console, this captures logger.error/warn
        Sentry.consoleLoggingIntegration({
          levels: ['error', 'warn'],
        }),
      ],
      environment: import.meta.env.MODE,
      tracesSampleRate: 1.0,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      sendDefaultPii: true,
    });
    logger.info('[Sentry] ✅ Initialized successfully (early init)');
  } catch (err) {
    logger.warn({ err }, '[Sentry] ⚠️ Failed to initialize');
  }
} else if (IS_TEST_ENVIRONMENT) {
  logger.info('[Sentry] ⏭️ Skipped in test environment');
  logger.warn('[Sentry] ⚠️ No DSN provided (expected in test mode)');
} else {
  logger.warn('[Sentry] ⚠️ No DSN provided - error tracking disabled');
}

import { setupGlobalErrorHandlers } from './lib/globalErrorHandlers';

// 🌍 Global Error Handlers (Safety Net)
setupGlobalErrorHandlers();

const renderApp = async (initialSession: Session | null = null) => {
  if (rootElement && !window._speakSharpRootInitialized) {
    window._speakSharpRootInitialized = true;
    logger.info('[main.tsx] 🚀 Starting app render...');

    if (areEnvVarsPresent()) {
      logger.info({ appExists: !!App }, '[E2E DIAGNOSTIC] ./App imported successfully');

      // 🛑 Skip ALL analytics in test mode (Sentry already initialized above)
      if (!IS_TEST_ENVIRONMENT) {
        // Defer PostHog initialization
        if (import.meta.env.VITE_POSTHOG_KEY && import.meta.env.VITE_POSTHOG_HOST) {
          setTimeout(() => {
            try {
              posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
                api_host: import.meta.env.VITE_POSTHOG_HOST,
                capture_exceptions: true,
                debug: import.meta.env.MODE === 'development',
              });
              logger.info('[PostHog] ✅ Initialized successfully');
            } catch (error) {
              logger.warn({ error }, "PostHog failed to initialize:");
            }
          }, 0);
        }
      } else {
        logger.warn('[E2E MODE] Analytics disabled entirely.');
      }

      // Defer Stripe loading - create promise but don't await it
      // Stripe will be loaded when Elements component mounts
      // Skip Stripe in test mode to avoid iframe interference with automated testing
      const stripePromise = IS_TEST_ENVIRONMENT
        ? Promise.resolve(null)
        : import('@stripe/stripe-js').then(({ loadStripe }) =>
          loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY!)
        ).catch((error) => {
          // Gracefully handle ad-blocker blocking Stripe CDN
          logger.warn({ error }, '[Stripe] ⚠️ Failed to load (possibly blocked by ad-blocker)');
          return null;
        });

      // Get initial session (mock if in E2E mode)
      const sessionToUse = initialSession;
      if (IS_TEST_ENVIRONMENT) {
        // Non-blocking bridge import - use window flag for session if available
        import('@/lib/e2e-bridge').then(m => {
          const session = m.getInitialSession(initialSession);
          if (session && !sessionToUse) {
            // This is a race condition fallback, but atomic injection 
            // via localStorage is the primary source of truth.
            logger.info('[E2E] Bridge session resolved asynchronously');
          }
        }).catch(() => { });
      }

      root.render(
        <StrictMode>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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

// 🚀 PHASE 8: Deterministic Readiness Contract (Initialized in useReadinessStore)

const startInitializing = async () => {
  logger.info('[main.tsx] 🏁 Initialize started');

  // Defer heavy WASM initialization to avoid competing with React hydration
  const warmUpSTT = () => {
    import('@/services/SpeechRuntimeController').then(({ speechRuntimeController }) => {
      speechRuntimeController.warmUp()
        .then(() => {
          useReadinessStore.getState().setReady('stt');
        })
        .catch(err => {
          logger.error({ err }, '[main.tsx] ❌ SpeechRuntimeController failed');
        });
    });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => warmUpSTT(), { timeout: 5000 });
  } else {
    setTimeout(warmUpSTT, 100);
  }

  if (IS_TEST_ENVIRONMENT) {
    const { initE2EConfig } = await import('../../tests/types/e2eConfig');
    initE2EConfig({});

    const { initializeE2EEnvironment } = await import('./lib/e2e-bridge');
    await initializeE2EEnvironment();
    
    // Analytics is handled by initializeE2EEnvironment or manually here if needed
    useReadinessStore.getState().setReady('analytics');

    const skipMSW = import.meta.env.VITE_SKIP_MSW === 'true' || import.meta.env.VITE_USE_LIVE_DB === 'true';
    if (skipMSW) {
      Object.assign(window, { mswReady: true });
      window.__e2e_e2e_msw_ready_fired__ = true;
      window.dispatchEvent(new CustomEvent('e2e:msw-ready'));
      useReadinessStore.getState().setReady('msw');
    }
    await renderApp();
  } else {
    useReadinessStore.getState().setReady('analytics');
    useReadinessStore.getState().setReady('msw'); // Always ready in production (no MSW)
    await renderApp();
  }

  // ✅ SIGNAL BOOT READINESS
  useReadinessStore.getState().setReady('boot');
};

// 🛡️ The application only signals readiness to Playwright
// AFTER all critical subsystems have confirmed they are ready.
useReadinessStore.subscribe((state) => {
  const { boot, layout, auth, analytics, stt, msw } = state.signals;
  if (boot && layout && auth && analytics && stt && msw) {
    if (document.documentElement.getAttribute('data-app-ready') !== 'true') {
      logger.info('[main.tsx] 🚀 ALL SYSTEMS READY. Signaling Playwright.');
      document.documentElement.setAttribute('data-app-ready', 'true');
    }
  }
});

startInitializing();
