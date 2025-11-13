import React, { useState, useEffect, ReactNode, useMemo, useCallback } from 'react';
import { getSupabaseClient } from '../lib/supabaseClient';
import type { Session, AuthChangeEvent, SupabaseClient } from '@supabase/supabase-js';
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

  const supabase: SupabaseClient = getSupabaseClient();

  useEffect(() => {
    if (!supabase) {
      throw new Error('Supabase client is not available. The application cannot initialize.');
    }

    if (initialSession) {
      setSessionState(initialSession);
      setLoading(false);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      async (_event: AuthChangeEvent, newSession: Session | null) => {
        setSessionState(newSession);
        if (!newSession) setProfile(null);
        setLoading(false);
      }
    );

    return () => {
      subscription?.unsubscribe();
    };
  }, [initialSession, supabase]);

  // Fetch user profile when the session changes
  useEffect(() => {
    if (session?.user?.id) {
      const fetchProfile = async (): Promise<void> => {
        try {
          const { data, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', session.user.id)
            .single<UserProfile>();

          if (error) {
            console.error('Error fetching user profile:', error);
            setProfile(null);
          } else {
            setProfile(data ?? null);
          }
        } catch (err: unknown) {
          console.error('Unexpected error while fetching profile:', err);
          setProfile(null);
        }
      };

      fetchProfile();
    }
  }, [session, supabase]);

  useEffect(() => {
    if (import.meta.env.MODE === 'test' && profile) {
      document.dispatchEvent(new CustomEvent('e2e-profile-loaded', { detail: profile }));
    }
  }, [profile]);

  const signOut = useCallback(async (): Promise<void> => {
    await supabase.auth.signOut();
    setSessionState(null);
    setProfile(null);
  }, [supabase]);

  const value: AuthContextType = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      signOut,
      setSession: setSessionState,
    }),
    [session, profile, loading, signOut]
  );

  if (loading) {
    return (
      <div className="w-full h-screen flex justify-center items-center" data-testid="auth-provider-loading">
        <Skeleton className="h-24 w-24 rounded-full" data-testid="loading-skeleton" />
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
