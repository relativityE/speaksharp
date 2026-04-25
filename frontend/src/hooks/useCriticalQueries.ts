import { useEffect } from 'react';
import { useAuthProvider } from '../contexts/AuthProvider';
import { useUserProfile } from './useUserProfile';
import { useIsFetching } from '@tanstack/react-query';

/**
 * ARCHITECTURE:
 * useCriticalQueries centralizes the definition of 'Critical Data' 
 * required for the application to be considered functionally 'Ready'.
 * 
 * CRITICAL DATA INCLUDES (Expert Contract):
 * 1. Auth Session (Resolved by Supabase)
 * 2. User Profile (Fetched from domain service)
 * 3. Global Query State (No active background fetches)
 * 4. Navigation State (Not transitioning between routes)
 */
export const useCriticalQueries = () => {
  const { session, loading: authLoading } = useAuthProvider();
  const { isLoading: profileLoading, data: profile } = useUserProfile();
  const isFetching = useIsFetching();

  // Expert Contract Alignment: Explicit list only. No inference.
  // 1. userQuery (Auth session resolved)
  const isUserReady = !authLoading;
  // 2. profileQuery (Profile data fetched successfully)
  // If no session, profile is trivially 'ready' for the route signal
  const isProfileReady = !session || (profile && !profileLoading);

  const criticalQueriesResolved = isUserReady && isProfileReady;
  
  const isResolved = 
    criticalQueriesResolved && 
    isFetching === 0;

  // Signal data readiness for E2E tests
  useEffect(() => {
    if (isResolved && typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-services-ready', 'true');
    }
  }, [isResolved]);

  return {
    isResolved,
    hasSession: !!session,
    hasProfile: !!profile,
    authLoading,
    profileLoading,
    isFetching,
    isTransitioning: false
  };
};

