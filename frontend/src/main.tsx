// src/main.tsx
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import logger from './lib/logger';
import { scrubConsoleBreadcrumb } from './lib/logRedaction';
import { AuthProvider } from './contexts/AuthProvider';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import type { Session } from '@supabase/supabase-js';
import * as Sentry from "@sentry/react";
import ConfigurationNeededPage from "./pages/ConfigurationNeededPage";
import InvalidEnvironmentPage from "./pages/InvalidEnvironmentPage";
import App from './App';
import { ENV } from './config/TestFlags';
import { useReadinessStore } from './stores/useReadinessStore';
import { getDevEnvironmentStatus } from './lib/devEnvironmentGuard';
import { publishAppRuntimeConfig } from './config/appRuntimeConfig';

declare global {
  interface Window {
    _speakSharpRootInitialized?: boolean;
    __APP_BOOTED__?: boolean;
    __e2e_e2e_msw_ready_fired__?: boolean;
  }
}

// STT release-proof config-discipline: publish the canonical runtime environment
// (port/mode/auth/releaseProofEligible) so the test-agent proof preflight can validate it
// before recording. releaseProofEligible is true only for manual mode on 5174 with real auth.
publishAppRuntimeConfig();

// 🛡️ INITIAL BOOT BARRIER: Set to false before any rendering logic starts.
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-app-ready', 'false');
  document.documentElement.setAttribute('data-app-visible-ready', 'false');
  window.__APP_BOOTED__ = false;
}

// Deterministic Mock Data (CI/E2E)
if (ENV.isTest) {
  // Simple LCG for deterministic Math.random() in CI/E2E
  let seed = 42;
  Math.random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  logger.debug('[main.tsx] Seeded random initialized for CI/E2E');
}

// Only the env that the CORE app genuinely cannot run without gates boot.
// Supabase (auth + DB) is mandatory. Stripe and Sentry are intentionally NOT
// here: Sentry already no-ops without a DSN (see init below), and payment
// surfaces are hidden when the Stripe key is missing (arePaymentsEnabled),
// so the app boots and core STT works without either configured.
const REQUIRED_ENV_VARS: string[] = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
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
if (ENV.isTest) {
  (window as unknown as { queryClient: typeof queryClient }).queryClient = queryClient;
}
logger.debug('[React Query] QueryClient initialized');

// CRITICAL: Initialize Sentry FIRST before any async operations
// This ensures errors during initialization are captured
const sentryDSN = import.meta.env.VITE_SENTRY_DSN;
const isTestMode = ENV.isTest || import.meta.env.VITE_TEST_MODE === 'true';
const skipSentry = isTestMode || !sentryDSN || sentryDSN.includes('example.invalid');
const enableSentryTracing = import.meta.env.VITE_ENABLE_SENTRY_TRACING === 'true';
const enableSentryReplay = import.meta.env.VITE_ENABLE_SENTRY_REPLAY === 'true';
const enableSentryConsoleCapture = import.meta.env.VITE_ENABLE_SENTRY_CONSOLE_CAPTURE === 'true';

logger.debug({ isTestMode, hasSentryDsn: Boolean(sentryDSN), skipSentry }, '[main.tsx] Sentry Initialization Check');

if (!skipSentry) {
  try {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      integrations: [
        ...(enableSentryTracing ? [Sentry.browserTracingIntegration()] : []),
        ...(enableSentryReplay ? [Sentry.replayIntegration()] : []),
      ],
      environment: import.meta.env.MODE,
      tracesSampleRate: enableSentryTracing ? 0.1 : 0,
      replaysSessionSampleRate: enableSentryReplay ? 0.1 : 0,
      replaysOnErrorSampleRate: enableSentryReplay ? 1.0 : 0,
      // Privacy: never PII by default. Transcript text (esp. Private mode) must not
      // leave the device via Sentry. sendDefaultPii previously true — disabled.
      sendDefaultPii: false,
      // Drop ALL console breadcrumbs so transcript text logged to console can never
      // be exfiltrated to Sentry on error (defense layer 2; layer 1 is redactTranscript).
      beforeBreadcrumb: scrubConsoleBreadcrumb,
    });
    logger.debug('[Sentry] Initialized successfully (early init)');
  } catch (err) {
    logger.warn({ err }, '[Sentry] ⚠️ Failed to initialize');
  }
} else if (isTestMode) {
  logger.info('[Sentry] Skipped in test environment');
  logger.warn('[Sentry] No DSN provided (expected in test mode)');
} else {
  logger.warn('[Sentry] No DSN provided - error tracking disabled');
}

import { setupGlobalErrorHandlers } from './lib/globalErrorHandlers';

// Global Error Handlers (Safety Net)
setupGlobalErrorHandlers();

const renderApp = async (initialSession: Session | null = null) => {
  if (rootElement && !window._speakSharpRootInitialized) {
    window._speakSharpRootInitialized = true;
    logger.debug('[main.tsx] Starting app render...');

    if (areEnvVarsPresent()) {
      logger.debug({ appExists: !!App }, '[E2E DIAGNOSTIC] ./App imported successfully');

      const devEnvironmentStatus = getDevEnvironmentStatus();
      if (!devEnvironmentStatus.valid) {
        logger.error({ devEnvironmentStatus }, '[main.tsx] Invalid local environment blocked');
        root.render(
          <StrictMode>
            <InvalidEnvironmentPage status={devEnvironmentStatus} />
          </StrictMode>
        );

        if (typeof document !== 'undefined') {
          document.documentElement.setAttribute('data-app-ready', 'true');
          document.documentElement.setAttribute('data-app-visible-ready', 'true');
          window.__APP_BOOTED__ = true;
        }
        return;
      }

      // 🛑 Skip ALL analytics in test mode (Sentry already initialized above)
      if (!isTestMode) {
        // Initialize PostHog SYNCHRONOUSLY, before root.render() mounts <AuthProvider>.
        // Gate B / FAIL_AUTH_POSTHOG_IDENTIFY root cause: AuthProvider's identity effect calls
        // posthog.identify(user.id) on its first commit. When init() was deferred (previously
        // wrapped in setTimeout(…, 0)), identify() could run BEFORE init on a restored-session
        // boot — that sets the local distinct_id (so a browser localStorage check passes) but
        // NEVER sends the server-side $identify event, so no PostHog person is materialized at the
        // Supabase user.id and feature-flag targeting can never match. Server-side evidence pre-fix:
        // 0 web $identify events and 0 events under the user.id. Running init() synchronously here
        // guarantees the SDK is ready before any identify() call. The empirical gate remains runtime
        // Phase-1 server-ingestion sanity (a web $identify + queryable person at the user.id).
        if (import.meta.env.VITE_POSTHOG_KEY && import.meta.env.VITE_POSTHOG_HOST) {
          try {
            posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
              api_host: import.meta.env.VITE_POSTHOG_HOST,
              autocapture: false,
              capture_pageview: false,
              capture_exceptions: enableSentryConsoleCapture,
              capture_performance: false,
              disable_session_recording: true,
              debug: import.meta.env.MODE === 'development',
            });
            logger.debug('[PostHog] Initialized successfully');
          } catch (error) {
            logger.warn({ error }, "PostHog failed to initialize:");
          }
        }
      } else {
        logger.warn('[E2E MODE] Analytics disabled entirely.');
      }

      // Get initial session (mock if in E2E mode)
      const sessionToUse = initialSession;
      if (ENV.isTest) {
        // Non-blocking bridge import - use window flag for session if available
        import('@/lib/e2e-bridge').then(m => {
          const session = m.getInitialSession(initialSession);
          if (session && !sessionToUse) {
            // This is a race condition fallback, but atomic injection 
            // via localStorage is the primary source of truth.
            logger.debug('[E2E] Bridge session resolved asynchronously');
          }
        }).catch((err) => {
          logger.error({ err }, '[E2E] Failed to initialize e2e-bridge');
        });
      }

      root.render(
        <StrictMode>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <PostHogProvider client={posthog}>
                <AuthProvider initialSession={sessionToUse}>
                  <Sentry.ErrorBoundary fallback={<div>An error has occurred. Please refresh the page.</div>}>
                    <App />
                  </Sentry.ErrorBoundary>
                </AuthProvider>
              </PostHogProvider>
            </BrowserRouter>
          </QueryClientProvider>
        </StrictMode>
      );

      // 🛡️ FINAL BOOT SIGNAL: React boot/render path reached. Unconditional.
      // This does not prove visible route content is committed; tests that need
      // user-visible readiness must wait for data-app-visible-ready.
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-app-ready', 'true');
        window.__APP_BOOTED__ = true;
      }
    } else {
      root.render(
        <StrictMode>
          <ConfigurationNeededPage />
        </StrictMode>
      );

      // 🛡️ FINAL BOOT SIGNAL: Config path render reached. Unconditional.
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-app-ready', 'true');
        document.documentElement.setAttribute('data-app-visible-ready', 'true');
        window.__APP_BOOTED__ = true;
      }
    }
  }
};

// Readiness contract initialization

const startInitializing = async () => {
  // Bootstrap: Initialize E2E Environment if in test mode

  logger.debug('[main.tsx] Initialize started');

  // Defer heavy WASM initialization to avoid competing with React hydration
  const initSTT = () => {
    // Lazy import of SpeechRuntimeController
    void import('./services/SpeechRuntimeController').then(({ speechRuntimeController }) => {
      speechRuntimeController.initializeInfrastructure()
        .then(() => {
          logger.debug('[main.tsx] STT Infrastructure Ready');
        })
        .catch(err => {
          logger.error({ err }, '[main.tsx] ❌ SpeechRuntimeController failed');
        });
    });

  };

  if (isTestMode) {
    const { initE2EConfig } = await import('../../tests/types/e2eConfig');
    initE2EConfig({});

    // Start STT infrastructure after E2E config is ready
    initSTT();

    const { initializeE2EEnvironment } = await import('./lib/e2e-bridge');
    await initializeE2EEnvironment();

    const skipMSW = import.meta.env.VITE_SKIP_MSW === 'true' || import.meta.env.VITE_USE_LIVE_DB === 'true';
    if (skipMSW) {
      Object.assign(window, { mswReady: true });
      window.__e2e_e2e_msw_ready_fired__ = true;
      window.dispatchEvent(new CustomEvent('e2e:msw-ready'));
      useReadinessStore.getState().setReady('msw');
    }
    await renderApp();
  } else {
    // Standard Production Path
    initSTT();
    useReadinessStore.getState().setReady('msw'); // Always ready in production (no MSW)
    await renderApp();
  }

  // SIGNAL BOOT READINESS
  useReadinessStore.getState().setReady('app');
};
// Subscriptions handled in App.tsx for consolidated signaling
void startInitializing();
