import React, { useState, useEffect, ReactNode, useMemo, useCallback } from 'react';
import { getSupabaseClient } from '../lib/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthContext, AuthContextType } from './AuthContext';
import { UserProfile } from '@/types/user';

interface AuthProviderProps {
  children: ReactNode;
  initialSession?: Session | null;
}

export function AuthProvider({ children, initialSession = null }: AuthProviderProps) {
  const [session, setSessionState] = useState<Session | null>(initialSession);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(!initialSession);

  const supabase = getSupabaseClient();

  useEffect(() => {
    if (!supabase) {
      throw new Error('Supabase client is not available. The application cannot initialize.');
    }

    // Set initial session if provided.
    if (initialSession) {
      setSessionState(initialSession);
      setLoading(false);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSessionState(newSession);
        if (!newSession) {
          setProfile(null); // Clear profile on logout.
        }
        setLoading(false);
      }
    );

    return () => {
      subscription?.unsubscribe();
    };
  }, [initialSession, supabase]);

  // Fetch the user profile when the session is available.
  useEffect(() => {
    if (session?.user?.id) {
      const fetchProfile = async () => {
        try {
          const { data, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();

          if (error) {
            console.error('Error fetching user profile:', error);
            setProfile(null);
          } else if (data) {
            setProfile(data as UserProfile);
          }
        } catch (e) {
          console.error('An unexpected error occurred while fetching the profile:', e);
          setProfile(null);
        }
      };

      fetchProfile();
    }
  }, [session, supabase]);

  // Dispatch the E2E event *after* the profile is loaded.
  useEffect(() => {
    if (import.meta.env.MODE === 'test' && profile) {
      document.dispatchEvent(new CustomEvent('e2e-profile-loaded', { detail: profile }));
    }
  }, [profile]);


  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSessionState(null);
    setProfile(null);
  }, [supabase]);

  const value = useMemo((): AuthContextType => ({
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signOut,
    setSession: setSessionState,
  }), [session, profile, loading, signOut]);

  // Show a loading skeleton while the session and profile are being fetched.
  if (loading) {
    return (
      <div className="w-full h-screen flex justify-center items-center" data-testid="auth-provider-loading">
        <Skeleton className="h-24 w-24 rounded-full" data-testid="loading-skeleton" />
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
