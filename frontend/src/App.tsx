import React, { Suspense, useEffect } from 'react';
import { Navigate, Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import Navigation from './components/Navigation';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Loader2 } from 'lucide-react';

// Lazy load pages for better performance
const Index = React.lazy(() => import('./pages/Index'));
const AnalyticsPage = React.lazy(() => import('./pages/AnalyticsPage').then(module => ({ default: module.AnalyticsPage })));
const SignInPage = React.lazy(() => import('./pages/SignInPage'));
const SignUpPage = React.lazy(() => import('./pages/SignUpPage'));
const SessionPage = React.lazy(() => import('./pages/SessionPage').then(module => ({ default: module.SessionPage })));

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

  return (
    <div>
      <Toaster />
      <Navigation />
      <main data-testid="app-main">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Navigate to="/auth/signin" replace />} />
            <Route path="/auth/signin" element={<SignInPage />} />
            <Route path="/auth/signup" element={<SignUpPage />} />
            <Route path="/session" element={<SessionPage />} />
            <Route path="/analytics" element={
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
