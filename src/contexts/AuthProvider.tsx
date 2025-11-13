// src/contexts/AuthProvider.tsx
import React, { useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
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
  const isE2EMode = typeof window !== 'undefined' && !!(window as any).__E2E_MODE__;

  // Use a mock Supabase client in E2E mode.
  const supabase = useMemo(() => {
    if (isE2EMode && (window as any).getSupabaseClient) {
      return (window as any).getSupabaseClient();
    }
    return getSupabaseClient();
  }, [isE2EMode]);

  // Set session immediately in E2E mode or use provided initialSession.
  const [session, setSessionState] = useState<Session | null>(
    isE2EMode ? (window as any).__E2E_MOCK_SESSION__ ?? null : initialSession
  );

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(!session);

  // Sync Auth state for non-E2E mode
  useEffect(() => {
    if (isE2EMode) return;

    if (!supabase) throw new Error('Supabase client is not available.');

    if (initialSession) {
      setSessionState(initialSession);
      setLoading(false);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSessionState(newSession);
        if (!newSession) setProfile(null);
        setLoading(false);
      }
    );

    return () => subscription?.unsubscribe();
  }, [initialSession, supabase, isE2EMode]);

  // Fetch profile from Supabase or return mocked profile in E2E mode
  useEffect(() => {
    if (!session?.user?.id) return;

    const fetchProfile = async () => {
      if (isE2EMode && (window as any).__E2E_PROFILE__) {
        setProfile((window as any).__E2E_PROFILE__);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (error || !data) {
          console.error('Error fetching user profile:', error);
          setProfile(null);
        } else {
          setProfile(data as UserProfile);
        }
      } catch (e) {
        console.error('Unexpected error fetching profile:', e);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [session, supabase, isE2EMode]);

  // Dispatch E2E-ready event
  useEffect(() => {
    if (isE2EMode && profile) {
      document.dispatchEvent(new CustomEvent('e2e-profile-loaded', { detail: profile }));
    }
  }, [profile, isE2EMode]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSessionState(null);
    setProfile(null);
  }, [supabase]);

  const value = useMemo<AuthContextType>(() => ({
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signOut,
    setSession: setSessionState,
  }), [session, profile, loading, signOut]);

  if (loading) {
    return (
      <div className="w-full h-screen flex justify-center items-center" data-testid="auth-provider-loading">
        <Skeleton className="h-24 w-24 rounded-full" data-testid="loading-skeleton" />
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
