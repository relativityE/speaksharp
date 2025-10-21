import React, { useState, useEffect, ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { UserProfile } from '../types/user';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthContext, AuthContextType } from './AuthContext';
import { getSyncSession } from '../lib/utils';

const getProfileFromDb = async (userId: string): Promise<UserProfile | null> => {
  // In E2E mode, return a mock profile immediately (no DB call)
  // @ts-ignore
  if (window.__E2E_MODE__) {
    console.log('[E2E] Returning mock user profile');
    return {
      id: userId,
      subscription_status: 'pro',
      preferred_mode: 'cloud',
    };
  }

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

export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const [session, setSessionState] = useState<Session | null>(() => getSyncSession());
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initializeSession = async () => {
      const currentSession = initialSession !== undefined ? initialSession : getSyncSession();
      setSessionState(currentSession);

      if (currentSession?.user) {
        // @ts-ignore
        window.__E2E_PROFILE_LOADED__ = false;
        const userProfile = await getProfileFromDb(currentSession.user.id);
        setProfile(userProfile);
        // @ts-ignore
        window.__E2E_PROFILE_LOADED__ = true;
      } else {
        // This is a critical fix: ensure the flag is set even when there is no
        // session, so that tests awaiting this flag can proceed.
        // @ts-ignore
        window.__E2E_PROFILE_LOADED__ = true;
      }
      setLoading(false);
    };
    initializeSession();
  }, [initialSession]);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSessionState(newSession);
        if (newSession?.user) {
          // @ts-ignore
          window.__E2E_PROFILE_LOADED__ = false;
          const userProfile = await getProfileFromDb(newSession.user.id);
          setProfile(userProfile);
          // @ts-ignore
          window.__E2E_PROFILE_LOADED__ = true;
        } else {
          setProfile(null);
          // @ts-ignore
          window.__E2E_PROFILE_LOADED__ = true;
        }
      }
    );

    return () => {
      listener?.subscription.unsubscribe();
    };
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
    signOut: async () => {
      const { error } = await supabase.auth.signOut();
      setSessionState(null);
      setProfile(null);
      return { error };
    },
    setSession: async (s: Session | null) => {
        setSessionState(s);
        if (s?.user) {
            // @ts-ignore
            window.__E2E_PROFILE_LOADED__ = false;
            const userProfile = await getProfileFromDb(s.user.id);
            setProfile(userProfile);
            // @ts-ignore
            window.__E2E_PROFILE_LOADED__ = true;
        } else {
            setProfile(null);
            // @ts-ignore
            window.__E2E_PROFILE_LOADED__ = true;
        }
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
