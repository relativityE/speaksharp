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
import { useCriticalQueries } from './hooks/useCriticalQueries';
import { useE2EAttributes } from './hooks/useE2EAttributes';

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
        setReady('route');
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

  // 0. Layout Readiness
  useEffect(() => {
    useReadinessStore.getState().setReady('layout');
    document.body.classList.add('app-loaded');
  }, []);

  // 1. Reset route readiness on navigation
  useEffect(() => {
    useReadinessStore.getState().resetRouteReady();
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
