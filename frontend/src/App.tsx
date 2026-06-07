import React, { Suspense, useEffect } from 'react';
import { Navigate, Routes, Route, useLocation } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { useCheckoutNotifications } from '@/hooks/useCheckoutNotifications';
import Navigation from './components/Navigation';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ProfileGuard } from './components/ProfileGuard';
import ErrorBoundary from '@/components/ErrorBoundary';
import SttIdentityBadge from '@/components/SttIdentityBadge';
import { AnimatePresence } from 'framer-motion';
import { PageTransition } from './components/ui/PageTransition';
import { useReadinessStore } from '@/stores/useReadinessStore';
import { useCriticalQueries } from './hooks/useCriticalQueries';
import { SSE2EWindow } from './config/TestFlags';
import type { TranscriptionState, TranscriptionEvent } from './services/transcription/TranscriptionFSM';
import { setAppVisibleReady } from '@/lib/forensicAnchors';
import { useSessionStore } from '@/stores/useSessionStore';
import { speechRuntimeController } from '@/services/SpeechRuntimeController';
import logger from '@/lib/logger';

const showTestModeBadge =
  !import.meta.env.PROD &&
  (import.meta.env.MODE === 'test' || import.meta.env.VITE_TEST_MODE === 'true');

/**
 * ARCHITECTURE:
 * RouteReadinessManager handles the final signal for E2E determinism.
 * It monitors critical queries (Auth, Profile) and sets the store state.
 */
const RouteReadinessManager: React.FC = () => {
  const { isResolved } = useCriticalQueries();
  const setReady = useReadinessStore(s => s.setReady);
  const location = useLocation();

  useEffect(() => {
    if (isResolved) {
      // Wrap in requestAnimationFrame to ensure the DOM is painted 
      // before signaling route readiness to E2E tests.
      requestAnimationFrame(() => {
        setReady('router');
      });
    }
  }, [isResolved, setReady, location.pathname]);

  return null;
};

// Lazy load pages for better performance
const Index = React.lazy(() => import('./pages/Index'));
const SessionPage = React.lazy(() => import('./pages/SessionPage'));
const AnalyticsPage = React.lazy(() => import('./pages/AnalyticsPage'));
const SignInPage = React.lazy(() => import('./pages/SignInPage'));
const AuthPage = React.lazy(() => import('./pages/AuthPage'));
const DesignSystemPage = React.lazy(() => import('./pages/DesignSystemPage'));
const OpsStatusPage = React.lazy(() => import('./pages/OpsStatusPage').then(module => ({ default: module.OpsStatusPage })));
const PricingPage = React.lazy(() => import('./pages/PricingPage').then(module => ({ default: module.PricingPage })));
const TranscriptionProvider = React.lazy(() => import('./providers/TranscriptionProvider').then(module => ({ default: module.TranscriptionProvider })));
const NotFoundPage = React.lazy(() => import('./pages/NotFoundPage').then(module => ({ default: module.NotFoundPage })));
const TermsPage = React.lazy(() => import('./pages/LegalPage').then(module => ({ default: module.TermsPage })));
const PrivacyPage = React.lazy(() => import('./pages/LegalPage').then(module => ({ default: module.PrivacyPage })));

const internalRoutesEnabled =
  !import.meta.env.PROD ||
  import.meta.env.VITE_ENABLE_INTERNAL_ROUTES === 'true';

const InternalRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return internalRoutesEnabled ? <>{children}</> : <NotFoundPage />;
};

const PageLoader = () => (
  <div className="min-h-[calc(100vh-var(--header-height))] w-full bg-background px-4 pb-16 pt-28">
    <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <div className="h-7 w-56 rounded-lg bg-white shadow-sm" />
        <div className="h-4 w-80 max-w-full rounded bg-white shadow-sm" />
        <div className="mt-6 h-12 rounded-xl border border-border bg-white shadow-sm" />
        <div className="h-80 rounded-2xl border border-border bg-white shadow-sm" />
      </div>
      <div className="hidden h-80 rounded-2xl border border-border bg-white shadow-sm lg:block" />
    </div>
  </div>
);

const App: React.FC = () => {
  const location = useLocation();
  const isListening = useSessionStore(state => state.isListening);
  const [isMobileViewport, setIsMobileViewport] = React.useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );
  const isSessionRoute = location.pathname.startsWith('/session');
  const toastOffset = isMobileViewport
    ? "5.25rem"
    : (isSessionRoute ? "1.5rem" : "4.75rem");

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const updateViewport = () => setIsMobileViewport(query.matches);
    updateViewport();
    query.addEventListener('change', updateViewport);
    return () => query.removeEventListener('change', updateViewport);
  }, []);

  useEffect(() => {
    if (!isListening) return;

    // UX-NAV-1: a hard navigation (URL bar, refresh, tab close) cannot await the async
    // Private stop→decode→save, so the in-progress transcript would be lost. We can't
    // save the full session here, but we CAN synchronously persist a recovery draft to
    // localStorage before the page unloads; SessionPage restores it on next load. Write
    // it in both `pagehide` (fires on real teardown, incl. bfcache) and `beforeunload`
    // (where the snapshot is freshest) — the write is idempotent and cleared on a normal
    // stop+save, so it never resurrects an already-saved session.
    const flushRecoveryDraft = () => {
      try {
        speechRuntimeController.persistActiveRecoveryDraft();
      } catch (error) {
        logger.error({ error }, '[App] Failed to persist recovery draft on unload');
      }
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      flushRecoveryDraft();
      event.preventDefault();
      event.returnValue = '';
    };

    // `visibilitychange`→hidden is the most reliable "page is going away" signal (it fires for
    // tab close, app switch, and navigation where beforeunload/pagehide can be unreliable).
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flushRecoveryDraft();
    };

    // Belt-and-suspenders: a throttled heartbeat persists the draft DURING recording, so a hard
    // reload / crash recovers the latest transcript even if no unload event fires (the prior
    // unload-only approach failed the real-auth reload proof). localStorage writes are cheap and
    // idempotent; persistActiveRecoveryDraft no-ops until there is non-empty transcript.
    const heartbeat = window.setInterval(flushRecoveryDraft, 2000);

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', flushRecoveryDraft);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', flushRecoveryDraft);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isListening]);

  useEffect(() => {
    if (!isListening || !isSessionRoute) return;

    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return;

      const nextUrl = new URL(anchor.href, window.location.href);
      if (nextUrl.origin !== window.location.origin || nextUrl.pathname === '/session') return;

      event.preventDefault();
      event.stopPropagation();

      const shouldLeave = window.confirm(
        'A recording is still active. Stop and save this session before leaving?'
      );
      if (!shouldLeave) return;

      void speechRuntimeController.stopRecording()
        .then(() => {
          window.location.assign(nextUrl.href);
        })
        .catch((error) => {
          logger.error({ error }, '[App] Failed to stop recording before route exit');
          window.alert('We could not stop and save the recording yet. Please stop the session before leaving.');
        });
    };

    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [isListening, isSessionRoute]);

  // --- E2E AUTHORITATIVE SIGNALING ---

  // Forensic Side-Car Activation (v0.6.15)
  // __SS_E2E__ is injected by setupE2EManifest's addInitScript BEFORE the app mounts.
  useEffect(() => {
    const g = window as unknown as SSE2EWindow;

    if (typeof window !== 'undefined' && g.__SS_E2E__) {
      void import('@/services/transcription/SessionManager').then(({ sessionManager }) => {
        const getService = () => sessionManager.getActiveService();
        const getController = () => g.__TRANSCRIPTION_SERVICE__;

        // Forensic Side-Car — Scoped to App.tsx, does NOT touch TestFlags.ts
        type ForensicBridge = typeof g.__SS_E2E__ & {
          startRecording?: () => void;
          stopRecording?: () => void;
          getFSMState?: () => string;
          destroyService?: () => Promise<void>;
          onStateChange?: (cb: (state: string) => void) => (() => void) | void;
          pauseAtState: (state: TranscriptionState) => void;
        };

        const bridge = (g.__SS_E2E__ || { isActive: true }) as ForensicBridge;

        bridge.startRecording = () => { void getController()?.startRecording(); };
        bridge.stopRecording = () => { void getController()?.stopRecording(); };
        bridge.getFSMState = () => getService()?.fsm.getState() || 'IDLE';
        bridge.destroyService = () => sessionManager.destroySession();
        bridge.emitTranscript = (text: string, isFinal: boolean = true) => {
          const activeCallbacks = g.__SS_E2E__?._activeCallbacks;
          activeCallbacks?.onTranscriptUpdate?.({
            transcript: isFinal ? { final: text } : { partial: text },
            isFinal,
            isPartial: !isFinal,
            timestamp: Date.now(),
          });
        };
        bridge.onStateChange = (cb) => {
          const s = getService();
          return s?.fsm.subscribe(cb);
        };
        bridge.pauseAtState = (state: TranscriptionState) => {
          const s = getService();
          if (s && s.fsm) {
            // Diagnostic hook: Intercept transition to the target state
            const originalTransition = s.fsm.transition.bind(s.fsm);
            s.fsm.transition = (params: TranscriptionEvent) => {
              if (params.type === 'ENGINE_INIT_SUCCESS' && state === 'ENGINE_INITIALIZING') {
                logger.debug(`[TRACE] Pausing mid-transition as requested: ${state}`);
                return true; // Halt transition (Deterministic pause)
              }
              return originalTransition(params);
            };
          }
        };

        g.__SS_E2E__ = bridge;
        logger.debug('[App] ✅ Forensic E2E Bridge activated (0.6.15-HARDENED)');
      });
    }
  }, []);

  // 2. Layout Readiness
  useEffect(() => {
    useReadinessStore.getState().setReady('layout');
    document.body.classList.add('app-loaded');
    
    // 🛡️ AUTHORITATIVE BOOT BARRIER: React App Shell is mounted and interactive.
    // Signal now managed centrally in main.tsx (Final Directive v0.8.3).
  }, []);

  // 1. Reset route readiness on navigation
  useEffect(() => {
    useReadinessStore.getState().resetRouterReady();
    setAppVisibleReady(false);
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const visibleText = document.body?.innerText?.trim() ?? '';
        setAppVisibleReady(visibleText.length > 0);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);

  // ✅ STRUCTURAL FIX: Hard Termination Boundary (Step 4)
  // Ensure the engine is definitively destroyed ONLY on route exit.
  const prevPathRef = React.useRef(location.pathname);
  const routeExitVersionRef = React.useRef(0);
  useEffect(() => {
    const prevPath = prevPathRef.current;
    const currentPath = location.pathname;
    
    // Logic: If leaving /session -> Hard Termination
    if (prevPath === '/session' && currentPath !== '/session') {
      const routeExitVersion = ++routeExitVersionRef.current;
      logger.debug(`[DIAGNOSTIC] 🏁 Route Exit Detected: ${prevPath} -> ${currentPath}`);
      void import('@/services/transcription/SessionManager').then(({ sessionManager }) => {
        const activeService = sessionManager.getActiveService();
        logger.debug(`[DIAGNOSTIC] 🧨 Triggering Hard Termination for Session: ${activeService?.serviceId || 'NONE'}`);
        const stopBeforeDestroy = isListening
          ? speechRuntimeController.stopRecording().catch((error) => {
            logger.error({ error }, '[App] Failed to stop recording before route-exit teardown');
          })
          : Promise.resolve();

        void stopBeforeDestroy.finally(() => {
          if (routeExitVersion !== routeExitVersionRef.current) return;
          void sessionManager.destroySession();
        });
      });
    }
    
    prevPathRef.current = currentPath;
  }, [isListening, location.pathname]);

  // Handle Checkout Notifications (extracted hook)
  useCheckoutNotifications();

  return (
    <div className="min-h-screen bg-background font-sans antialiased relative">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[120] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-lg focus:ring-2 focus:ring-primary"
      >
        Skip to content
      </a>
      {showTestModeBadge && (
        <div className="fixed left-3 top-3 z-[100] rounded-md border border-amber-600 bg-amber-100 px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide text-amber-950 shadow">
          Test Mode · Mock Auth
        </div>
      )}
      {/* STT-IDENTITY-DIAG: dev/test-only; self-gates on the debug flag (renders null otherwise). */}
      <SttIdentityBadge />
      <Toaster
        position={isMobileViewport ? "top-center" : (isSessionRoute ? "bottom-right" : "top-right")}
        expand={false}
        duration={3500}
        visibleToasts={isMobileViewport || isSessionRoute ? 1 : 2}
        offset={toastOffset}
      />
      <ProfileGuard>
        <RouteReadinessManager />
        <Navigation />
        <main
          id="main-content"
          data-testid="app-main"
          tabIndex={-1}
          className="relative z-10"
        >
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <AnimatePresence mode="wait">
                <Routes location={location} key={location.pathname}>
                  <Route path="/" element={<PageTransition><Index /></PageTransition>} />
                  <Route path="/pricing" element={<PageTransition><PricingPage /></PageTransition>} />
                  <Route path="/terms" element={<PageTransition><TermsPage /></PageTransition>} />
                  <Route path="/privacy" element={<PageTransition><PrivacyPage /></PageTransition>} />
                  <Route path="/design" element={<InternalRoute><PageTransition><DesignSystemPage /></PageTransition></InternalRoute>} />
                  <Route path="/admin/ops-status" element={<InternalRoute><PageTransition><OpsStatusPage /></PageTransition></InternalRoute>} />
                  <Route path="/auth" element={<Navigate to="/auth/signin" replace />} />
                  <Route path="/signup" element={<Navigate to="/auth/signup" replace />} />
                  <Route path="/auth/signin" element={<PageTransition><SignInPage /></PageTransition>} />
                  <Route path="/auth/signup" element={<PageTransition><AuthPage /></PageTransition>} />
                  <Route path="/session" element={
                    <ProtectedRoute>
                      <TranscriptionProvider>
                        <PageTransition><SessionPage /></PageTransition>
                      </TranscriptionProvider>
                    </ProtectedRoute>
                  } />
                  <Route path="/analytics" element={
                    <ProtectedRoute>
                      <TranscriptionProvider>
                        <PageTransition><AnalyticsPage /></PageTransition>
                      </TranscriptionProvider>
                    </ProtectedRoute>
                  } />
                  <Route path="/analytics/:sessionId" element={
                    <ProtectedRoute>
                      <TranscriptionProvider>
                        <PageTransition><AnalyticsPage /></PageTransition>
                      </TranscriptionProvider>
                    </ProtectedRoute>
                  } />
                  <Route path="*" element={<PageTransition><NotFoundPage /></PageTransition>} />
                </Routes>
              </AnimatePresence>
            </Suspense>
          </ErrorBoundary>
        </main>
      </ProfileGuard>
    </div>
  );
}

export default App;
