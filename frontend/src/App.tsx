import React, { Suspense, useEffect } from 'react';
import { Navigate, Routes, Route, useLocation } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { useCheckoutNotifications } from '@/hooks/useCheckoutNotifications';
import Navigation from './components/Navigation';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ProfileGuard } from './components/ProfileGuard';
import { Loader2 } from 'lucide-react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { TranscriptionProvider } from './providers/TranscriptionProvider';
import { AnimatePresence } from 'framer-motion';
import { PageTransition } from './components/ui/PageTransition';
import { useReadinessStore } from '@/stores/useReadinessStore';
import { useCriticalQueries } from './hooks/useCriticalQueries';
import { SSE2EWindow } from './config/TestFlags';
import { TranscriptionState, TranscriptionEvent } from './services/transcription/TranscriptionFSM';
import { useE2EAttributes } from './hooks/useE2EAttributes';
import { sessionManager } from '@/services/transcription/SessionManager';

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

const PageLoader = () => (
  <div className="flex h-[50vh] w-full items-center justify-center">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const App: React.FC = () => {
  const location = useLocation();

  // --- E2E AUTHORITATIVE SIGNALING ---
  useE2EAttributes();

  // Forensic Side-Car Activation (v0.6.15)
  // __SS_E2E__ is injected by setupE2EManifest's addInitScript BEFORE the app mounts.
  useEffect(() => {
    const g = window as unknown as SSE2EWindow;

    if (typeof window !== 'undefined' && g.__SS_E2E__) {
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
               console.warn(`[TRACE] ⏸️ Pausing mid-transition as requested: ${state}`);
               return true; // Halt transition (Deterministic pause)
            }
            return originalTransition(params);
          };
        }
      };

      g.__SS_E2E__ = bridge;
      console.info('[App] ✅ Forensic E2E Bridge activated (0.6.15-HARDENED)');
    }
  }, []);

  // 2. Layout Readiness
  useEffect(() => {
    useReadinessStore.getState().setReady('layout');
    document.body.classList.add('app-loaded');
  }, []);

  // 1. Reset route readiness on navigation
  useEffect(() => {
    useReadinessStore.getState().resetRouterReady();
  }, [location.pathname]);

  // ✅ STRUCTURAL FIX: Hard Termination Boundary (Step 4)
  // Ensure the engine is definitively destroyed ONLY on route exit.
  const prevPathRef = React.useRef(location.pathname);
  useEffect(() => {
    const prevPath = prevPathRef.current;
    const currentPath = location.pathname;
    
    // Logic: If leaving /session -> Hard Termination
    if (prevPath === '/session' && currentPath !== '/session') {
      const activeService = sessionManager.getActiveService();
      console.warn(`[DIAGNOSTIC] 🏁 Route Exit Detected: ${prevPath} -> ${currentPath}`);
      console.warn(`[DIAGNOSTIC] 🧨 Triggering Hard Termination for Session: ${activeService?.serviceId || 'NONE'}`);
      void sessionManager.destroySession();
    }
    
    prevPathRef.current = currentPath;
  }, [location.pathname]);

  // Handle Checkout Notifications (extracted hook)
  useCheckoutNotifications();

  return (
    <div className="min-h-screen bg-background font-sans antialiased bg-gradient-radial relative">
      <div className="fixed inset-0 bg-grid opacity-20 pointer-events-none" />
      <Toaster
        position="top-right"
        expand={false}
        duration={5000}
        offset="25vh"
      />
      <ProfileGuard>
        <RouteReadinessManager />
        <TranscriptionProvider>
          <Navigation />
          <main
            data-testid="app-main"
            className="relative z-10"
          >
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <AnimatePresence mode="wait">
                  <Routes location={location} key={location.pathname}>
                    <Route path="/" element={<PageTransition><Index /></PageTransition>} />
                    <Route path="/design" element={<PageTransition><DesignSystemPage /></PageTransition>} />
                    <Route path="/auth" element={<Navigate to="/auth/signin" replace />} />
                    <Route path="/auth/signin" element={<PageTransition><SignInPage /></PageTransition>} />
                    <Route path="/auth/signup" element={<PageTransition><AuthPage /></PageTransition>} />
                    <Route path="/session" element={
                      <ProtectedRoute>
                        <PageTransition><SessionPage /></PageTransition>
                      </ProtectedRoute>
                    } />
                    <Route path="/analytics" element={
                      <ProtectedRoute>
                        <PageTransition><AnalyticsPage /></PageTransition>
                      </ProtectedRoute>
                    } />
                    <Route path="/analytics/:sessionId" element={
                      <ProtectedRoute>
                        <PageTransition><AnalyticsPage /></PageTransition>
                      </ProtectedRoute>
                    } />
                  </Routes>
                </AnimatePresence>
              </Suspense>
            </ErrorBoundary>
          </main>
        </TranscriptionProvider>
      </ProfileGuard>
    </div>
  );
}

export default App;
