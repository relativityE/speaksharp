import React, { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface ProtectedRouteProps {
  children: ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    // You can render a loading spinner here if you want
    return null;
  }

  if (!user) {
    // Redirect them to the /auth page, but save the current location they were
    // trying to go to. This allows us to send them back after login.
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};
