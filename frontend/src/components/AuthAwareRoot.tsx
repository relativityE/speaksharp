import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthProvider } from '../contexts/AuthProvider';
import { Loader2 } from 'lucide-react';

interface AuthAwareRootProps {
  /** The shared canonical page (PracticePage), rendered here ONLY for anonymous visitors. */
  children: React.ReactNode;
}

/**
 * Root route `/` — auth-aware home (#1061: ONE canonical page for both states).
 *
 *  - while auth is still resolving  → the same centered loader used for protected routes (never flash
 *    the page and never redirect prematurely, so there is no redirect loop);
 *  - authenticated session          → the authenticated home is `/practice` (replace: a Back press
 *    should not bounce the user between `/` and `/practice`);
 *  - no authenticated session       → render the SHARED PracticePage in its anonymous state (same hero +
 *    product choices; Freeform routes through account access; no session history/account actions).
 *
 * The decision is made ONLY from the resolved auth session — never from PostHog or any feature flag.
 * This does not affect other protected routes: `/session`, `/analytics`, `/analytics/:sessionId`
 * keep their own `ProtectedRoute` wrappers and are never force-redirected from here.
 */
export const AuthAwareRoot: React.FC<AuthAwareRootProps> = ({ children }) => {
  const { user, loading } = useAuthProvider();

  if (loading) {
    return (
      <div className="flex h-[50vh] w-full items-center justify-center" data-testid="root-auth-loading">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/practice" replace />;
  }

  return <>{children}</>;
};
