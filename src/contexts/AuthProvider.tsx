import React, { useState, useEffect, ReactNode } from 'react';
import { getSupabaseClient } from '../lib/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthContext, AuthContextType } from './AuthContext';
import { useMemo, useCallback } from 'react';

interface AuthProviderProps {
  children: ReactNode;
  initialSession?: Session | null;
}

export function AuthProvider({ children, initialSession = null }: AuthProviderProps) {
  const [session, setSessionState] = useState<Session | null>(initialSession);
  const [loading, setLoading] = useState(!initialSession);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      console.error('[AuthProvider] Supabase client is null. Cannot proceed.');
      setLoading(false);
      return;
    }

    // The onAuthStateChange listener provides the single source of truth for auth events.
    // It fires immediately on registration, so we don't need a separate getSession call.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSessionState(newSession);
        setLoading(false);
      }
    );

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  // Dispatch a custom event when the session is loaded, for E2E testing.
  useEffect(() => {
    if (import.meta.env.MODE === 'test' && session) {
      document.dispatchEvent(new CustomEvent('e2e-profile-loaded'));
    }
  }, [session]);

  const signOut = useCallback(() => {
    getSupabaseClient().auth.signOut();
  }, []);

  const value = useMemo((): AuthContextType => ({
    session,
    user: session?.user ?? null,
    profile: null, // Profile is now fetched via useUserProfile
    loading,
    signOut,
    setSession: setSessionState,
  }), [session, loading, signOut]);

  if (loading) {
    return (
      <div className="w-full h-screen flex justify-center items-center" data-testid="loading-skeleton-container">
        <Skeleton className="h-24 w-24 rounded-full" data-testid="loading-skeleton" />
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
