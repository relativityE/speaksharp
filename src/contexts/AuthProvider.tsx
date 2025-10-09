import React, { useState, useEffect, ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { UserProfile } from '../types/user';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthContext, AuthContextType } from './AuthContext';

interface WindowWithUser extends Window {
  __USER__?: UserProfile | null;
  __E2E_MOCK_SESSION__?: boolean;
}

const getProfileFromDb = async (userId: string): Promise<UserProfile | null> => {
  try {
    const { data, error } = await supabase.from('user_profiles').select('*').eq('id', userId).single();
    if (error) {
      console.error('Error fetching profile in test:', error.message);
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

const SESSION_STORAGE_KEY = 'speaksharp-session';

export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const [session, setSessionState] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const setSession = async (s: Session | null) => {
    setSessionState(s);
    if (s?.user) {
      const userProfile = await getProfileFromDb(s.user.id);
      setProfile(userProfile);
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s));
      if (import.meta.env.MODE === 'test') {
        (window as WindowWithUser).__USER__ = userProfile;
      }
    } else {
      setProfile(null);
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  };

  useEffect(() => {
    const bootstrapAuth = async () => {
      setLoading(true);
      // E2E test optimization: If a mock session is injected, use it directly.
      if (import.meta.env.MODE === 'test' && (window as any).__E2E_MOCK_SESSION__) {
        const storedSession = localStorage.getItem(SESSION_STORAGE_KEY);
        if (storedSession) {
          const sessionData = JSON.parse(storedSession);
          setSessionState(sessionData.currentSession);
          // In test mode, we trust the profile cache injected by programmaticLogin
          const profileCache = localStorage.getItem('user-profile-cache');
          if (profileCache) {
            setProfile(JSON.parse(profileCache));
          }
        }
      } else {
        // Standard auth flow for production and development
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        await setSession(currentSession);
      }
      setLoading(false);
    };

    bootstrapAuth();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setLoading(true);
        await setSession(newSession);
        setLoading(false);
      }
    );

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="w-full h-screen flex justify-center items-center">
        <Skeleton className="h-24 w-24 rounded-full" />
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
      await setSession(null);
      return { error };
    },
    setSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}