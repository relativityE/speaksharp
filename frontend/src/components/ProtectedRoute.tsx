import React, { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthProvider } from '../contexts/AuthProvider';

interface ProtectedRouteProps {
  children: ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, loading } = useAuthProvider();
  const location = useLocation();

  if (loading) {
    console.log('[ProtectedRoute] Auth loading...');
    // You can render a loading spinner here if you want
    return null;
  }

  if (!user) {
    console.log('[ProtectedRoute] No user, redirecting to /auth. Location:', location);
    // Redirect them to the /auth page, but save the current location they were
    // trying to go to. This allows us to send them back after login.
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  console.log('[ProtectedRoute] User authenticated, rendering children');

  return <>{children}</>;
};
