import React, { useState, useEffect, ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { UserProfile } from '../types/user';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthContext, AuthContextType } from './AuthContext';

interface WindowWithUser extends Window {
  __USER__?: UserProfile | null;
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

// Key for storing session in localStorage
const SESSION_STORAGE_KEY = 'speaksharp-session';

export function AuthProvider({ children, initialSession = null }: AuthProviderProps) {
  const [session, setSessionState] = useState<Session | null>(() => {
    try {
      const storedSession = localStorage.getItem(SESSION_STORAGE_KEY);
      if (storedSession) {
        return JSON.parse(storedSession);
      }
    } catch (error) {
      console.warn('Could not parse session from localStorage:', error);
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    return initialSession;
  });

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // This is the new manual setter that also persists the session.
  const setSession = async (s: Session | null) => {
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
    setSessionState(s);
  };

  useEffect(() => {
    // The onAuthStateChange listener is still the source of truth for the live app.
    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        await setSession(newSession);
        setLoading(false);
      }
    );

    // On initial load, if we don't have a session from localStorage,
    // check with Supabase.
    const initialize = async () => {
      if (!session) {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        await setSession(currentSession);
      } else {
        // If we have a session from localStorage, just update the profile.
        await setSession(session);
      }
      setLoading(false);
    };

    initialize();

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
      await supabase.auth.signOut();
      await setSession(null);
    },
    setSession,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}