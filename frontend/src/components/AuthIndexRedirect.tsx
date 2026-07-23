import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

/**
 * Index-redirect for /auth and /signup that PRESERVES `location.state`.
 *
 * ProtectedRoute redirects an unauthenticated deep-link to /auth carrying `state.from` (e.g. a /session
 * bookmark opened while signed out). A plain <Navigate to="/auth/signin"> would DROP that state, so the
 * protected deep-link would be lost and — now that /practice is the post-auth default — the user would land
 * on /practice instead of their intended destination. Forwarding `state` keeps the deep-link intact so it
 * still wins over the default.
 */
export const AuthIndexRedirect: React.FC<{ to: string }> = ({ to }) => {
  const location = useLocation();
  return <Navigate to={to} state={location.state} replace />;
};
