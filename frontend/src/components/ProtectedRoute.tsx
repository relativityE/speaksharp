import React, { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthProvider } from '../contexts/AuthProvider';
import { Loader2 } from 'lucide-react';
import logger from '../lib/logger';

interface ProtectedRouteProps {
  children: ReactNode;
}

/**
 * ProtectedRoute - Wraps pages that require authentication
 * 
 * Design: Auth loading state is shown HERE (at the route level), not in AuthProvider.
 * This allows public pages to render immediately while protected pages wait for auth.
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, loading } = useAuthProvider();
  const location = useLocation();

  // Show loading state for protected routes - this is the RIGHT place for it
  if (loading) {
    logger.debug('[ProtectedRoute] Auth loading...');
    return (
      <div className="flex h-[50vh] w-full items-center justify-center" data-testid="protected-route-loading">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    logger.info({ from: location.pathname }, '[ProtectedRoute] No user, redirecting to /auth');
    // Redirect them to the /auth page, but save the current location they were
    // trying to go to. This allows us to send them back after login.
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  logger.debug('[ProtectedRoute] User authenticated, rendering children');

  return <>{children}</>;
};

