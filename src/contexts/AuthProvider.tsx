import React, { useState, useEffect, ReactNode } from 'react';
import { getSupabaseClient } from '../lib/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { UserProfile } from '../types/user';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthContext, AuthContextType } from './AuthContext';

const getProfileFromDb = async (userId: string): Promise<UserProfile | null> => {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching profile:', error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.error('Error fetching profile:', e);
    return null;
  }
};

interface AuthProviderProps {
  children: ReactNode;
  initialSession?: Session | null;
}

export function AuthProvider({ children, initialSession = null }: AuthProviderProps) {
  const [session, setSessionState] = useState<Session | null>(initialSession);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(!initialSession);

  useEffect(() => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        console.error('[AuthProvider] Supabase client is null. Cannot proceed.');
        setLoading(false);
        return;
      }

      supabase.auth.getSession().then(({ data: { session } }) => {
        setSessionState(session);
        if (!session) {
          setLoading(false);
        }
      });

      const { data: listener } = supabase.auth.onAuthStateChange(
        async (_event, newSession) => {
          setSessionState(newSession);
          if (newSession?.user) {
            if ((window as { __E2E_MODE__?: boolean }).__E2E_MODE__) (window as { __E2E_PROFILE_LOADED__?: boolean }).__E2E_PROFILE_LOADED__ = false;
            const userProfile = await getProfileFromDb(newSession.user.id);
            setProfile(userProfile);
            if ((window as { __E2E_MODE__?: boolean }).__E2E_MODE__) {
              (window as { __E2E_PROFILE_LOADED__?: boolean }).__E2E_PROFILE_LOADED__ = true;
            }
          } else {
            setProfile(null);
            if ((window as { __E2E_MODE__?: boolean }).__E2E_MODE__) {
              (window as { __E2E_PROFILE_LOADED__?: boolean }).__E2E_PROFILE_LOADED__ = true;
            }
          }
          setLoading(false);
        }
      );

      return () => {
        listener?.subscription.unsubscribe();
      };
    } catch (error) {
      console.error('[AuthProvider] CRITICAL ERROR in useEffect:', error);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleSessionInject = async () => {
      setLoading(true);
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getSession();
      setSessionState(data.session);
      if (data.session?.user) {
        const userProfile = await getProfileFromDb(data.session.user.id);
        setProfile(userProfile);
        (window as any).__E2E_PROFILE_LOADED__ = true;
      }
      if ((window as any).authReadyResolve) {
        (window as any).authReadyResolve();
      }
      setLoading(false);
    };

    if ((window as any).__E2E_MODE__) {
      document.addEventListener('__E2E_SESSION_INJECTED__', handleSessionInject);
      return () => {
        document.removeEventListener('__E2E_SESSION_INJECTED__', handleSessionInject);
      };
    }
  }, []);

  if (loading) {
    return (
      <div className="w-full h-screen flex justify-center items-center" data-testid="loading-skeleton-container">
        <Skeleton className="h-24 w-24 rounded-full" data-testid="loading-skeleton" />
      </div>
    );
  }

  const value: AuthContextType = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signOut: () => getSupabaseClient().auth.signOut(),
    setSession: setSessionState,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
