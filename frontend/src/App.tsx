import React, { Suspense, useEffect } from 'react';
import { Navigate, Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { useCheckoutNotifications } from '@/hooks/useCheckoutNotifications';
import Navigation from './components/Navigation';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Loader2 } from 'lucide-react';

// Lazy load pages for better performance
const Index = React.lazy(() => import('./pages/Index'));
const AnalyticsPage = React.lazy(() => import('./pages/AnalyticsPage'));
const SignInPage = React.lazy(() => import('./pages/SignInPage'));
const AuthPage = React.lazy(() => import('./pages/AuthPage'));
const SessionPage = React.lazy(() => import('./pages/SessionPage'));
const DesignSystemPage = React.lazy(() => import('./pages/DesignSystemPage'));

const PageLoader = () => (
  <div className="flex h-[50vh] w-full items-center justify-center">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const App: React.FC = () => {


  // Deterministically hide loading spinner once React component mounts
  useEffect(() => {
    // Use requestAnimationFrame to ensure this runs after the next paint
    requestAnimationFrame(() => {
      document.body.classList.add('app-loaded');
    });
  }, []);

  // Handle Checkout Notifications (extracted hook)
  useCheckoutNotifications();

  return (
    <div>
      <Toaster />
      <Navigation />
      <main data-testid="app-main">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/design" element={<DesignSystemPage />} />
            <Route path="/auth" element={<Navigate to="/auth/signin" replace />} />
            <Route path="/auth/signin" element={<SignInPage />} />
            <Route path="/auth/signup" element={<AuthPage />} />
            <Route path="/session" element={
              <ProtectedRoute>
                <SessionPage />
              </ProtectedRoute>
            } />
            <Route path="/analytics" element={
              <ProtectedRoute>
                <AnalyticsPage />
              </ProtectedRoute>
            } />
            <Route path="/analytics/:sessionId" element={
              <ProtectedRoute>
                <AnalyticsPage />
              </ProtectedRoute>
            } />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default App;
