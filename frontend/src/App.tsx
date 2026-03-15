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
import { useReadinessStore } from './stores/useReadinessStore';
import { useSessionStore } from './stores/useSessionStore';

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

  // Deterministically hide loading spinner once React component mounts
  useEffect(() => {
    // 🚀 PHASE 8: Signal Layout Readiness
    useReadinessStore.getState().setReady('layout');

    // Use requestAnimationFrame to ensure this runs after the next paint
    requestAnimationFrame(() => {
      document.body.classList.add('app-loaded');
    });
  }, []);

  // Handle DOM synchronization for E2E testing
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Unified Event Listeners (from #744)
    const handleEngineReady = () => {
      document.body.dataset.sttEngine = 'ready';
    };

    const handleSpeechRuntimeState = (event: Event) => {
      const customEvent = event as CustomEvent<{ state: string }>;
      document.body.setAttribute('data-recording-state', customEvent.detail.state.toLowerCase());
    };

    window.addEventListener('stt-engine-ready', handleEngineReady);
    window.addEventListener('speech-runtime-state', handleSpeechRuntimeState);

    // 2. Reactive Store Subscription (from #742)
    const unsub = useSessionStore.subscribe((state) => {
      if (typeof document !== 'undefined') {
        if (state.activeEngine) document.body.setAttribute('data-stt-policy', state.activeEngine);
        else document.body.removeAttribute('data-stt-policy');

        if (state.modelLoadingProgress !== null) document.body.setAttribute('data-download-progress', String(state.modelLoadingProgress));
        else document.body.removeAttribute('data-download-progress');
      }
    });

    return () => {
      window.removeEventListener('stt-engine-ready', handleEngineReady);
      window.removeEventListener('speech-runtime-state', handleSpeechRuntimeState);
      unsub();
    };
  }, []);

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
        <TranscriptionProvider>
          <Navigation />
          <main data-testid="app-main" className="relative z-10">
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
