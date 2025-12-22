import React, { Suspense, useEffect } from 'react';
import { Navigate, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import Navigation from './components/Navigation';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

// Lazy load pages for better performance
const Index = React.lazy(() => import('./pages/Index'));
const AnalyticsPage = React.lazy(() => import('./pages/AnalyticsPage').then(module => ({ default: module.AnalyticsPage })));
const SignInPage = React.lazy(() => import('./pages/SignInPage'));
const AuthPage = React.lazy(() => import('./pages/AuthPage'));
const SessionPage = React.lazy(() => import('./pages/SessionPage').then(module => ({ default: module.SessionPage })));
const DesignSystemPage = React.lazy(() => import('./pages/DesignSystemPage').then(module => ({ default: module.DesignSystemPage })));

const PageLoader = () => (
  <div className="flex h-[50vh] w-full items-center justify-center">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const App: React.FC = () => {
  const location = useLocation();

  // Deterministically hide loading spinner once React component mounts
  useEffect(() => {
    // Use requestAnimationFrame to ensure this runs after the next paint
    requestAnimationFrame(() => {
      document.body.classList.add('app-loaded');
    });
  }, []);

  const navigate = useNavigate();
  const lastToastId = React.useRef<string | null>(null);

  // Handle Checkout Toasts
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const checkoutStatus = params.get('checkout');

    // Create a unique key for this specific toast event to prevent duplicates in StrictMode
    const currentToastId = checkoutStatus ? `${checkoutStatus}-${location.search}` : null;

    if (checkoutStatus && lastToastId.current !== currentToastId) {
      lastToastId.current = currentToastId;

      console.log(`[App] 🔔 Triggering checkout toast: ${checkoutStatus}`);

      if (checkoutStatus === 'success') {
        toast.success('Welcome to Pro!', {
          description: 'Your account has been upgraded successfully.',
          icon: <CheckCircle2 className="h-5 w-5 text-secondary-foreground" />,
          duration: 8000,
        });
      } else if (checkoutStatus === 'cancelled') {
        toast.error("Payment couldn't be processed", {
          description: "You're on the Free plan - click 'Upgrade to Pro' anytime to try again.",
          icon: <AlertCircle className="h-5 w-5 text-destructive-foreground" />,
          duration: 8000,
        });
      }

      // Clear the checkout parameter from the URL to prevent double toasts on mount/refresh
      // and to ensure subsequent navigations don't re-trigger
      const newParams = new URLSearchParams(location.search);
      newParams.delete('checkout');
      const search = newParams.toString();

      setTimeout(() => {
        navigate({
          pathname: location.pathname,
          search: search ? `?${search}` : ''
        }, { replace: true });
      }, 100);
    }
  }, [location.search, location.pathname, navigate]);

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
