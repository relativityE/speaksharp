import React, { useState, useEffect, ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { UserProfile } from '../types/user';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthContext, AuthContextType } from './AuthContext';
import { getSyncSession } from '../lib/utils';

const getProfileFromDb = async (userId: string): Promise<UserProfile | null> => {
  // In E2E mode, return a mock profile immediately (no DB call)
  if (window.__E2E_MODE__) {
    if (window.__E2E_MOCK_PROFILE__) {
      console.log('[E2E] Returning mock user profile from window variable');
      return window.__E2E_MOCK_PROFILE__;
    }
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
        window.__E2E_PROFILE_LOADED__ = false;
        const userProfile = await getProfileFromDb(currentSession.user.id);
        setProfile(userProfile);
        window.__E2E_PROFILE_LOADED__ = true;
      } else {
        // This is a critical fix: ensure the flag is set even when there is no
        // session, so that tests awaiting this flag can proceed.
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
          window.__E2E_PROFILE_LOADED__ = false;
          const userProfile = await getProfileFromDb(newSession.user.id);
          setProfile(userProfile);
          window.__E2E_PROFILE_LOADED__ = true;
        } else {
          setProfile(null);
          window.__E2E_PROFILE_LOADED__ = true;
        }
      }
    );

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  // --- ADD THIS BLOCK ---
  useEffect(() => {
    if (typeof window !== 'undefined' && window.__E2E_MODE__) {
      console.log('[AuthProvider] E2E mode detected — setting up __setSupabaseSession');

      window.__setSupabaseSession = async (fakeSession: Session) => {
        console.log('[E2E] Applying fake Supabase session');
        await supabase.auth.setSession({
          access_token: fakeSession.access_token,
          refresh_token: fakeSession.refresh_token,
        });

        // Manually propagate to React state to ensure UI consistency
        setSessionState(fakeSession);
        if (fakeSession.user) {
          window.__E2E_PROFILE_LOADED__ = false;
          const userProfile = await getProfileFromDb(fakeSession.user.id);
          setProfile(userProfile);
          window.__E2E_PROFILE_LOADED__ = true;
        } else {
          setProfile(null);
          window.__E2E_PROFILE_LOADED__ = true;
        }
      };
    }
  }, []);
  // --- END ADDITION ---

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
            window.__E2E_PROFILE_LOADED__ = false;
            const userProfile = await getProfileFromDb(s.user.id);
            setProfile(userProfile);
            window.__E2E_PROFILE_LOADED__ = true;
        } else {
            setProfile(null);
            window.__E2E_PROFILE_LOADED__ = true;
        }
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
