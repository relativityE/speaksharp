import React, { useState, useEffect, ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { UserProfile } from '../types/user';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthContext, AuthContextType } from './AuthContext';

const getProfileFromDb = async (userId: string): Promise<UserProfile | null> => {
  try {
    const { data, error } = await supabase.from('user_profiles').select('*').eq('id', userId).single();
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
  const [session, setSessionState] = useState<Session | null>(initialSession === undefined ? null : initialSession);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(initialSession === undefined);

  const updateSession = async (s: Session | null) => {
    setSessionState(s);
    if (s?.user) {
      const userProfile = await getProfileFromDb(s.user.id);
      setProfile(userProfile);
    } else {
      setProfile(null);
    }
  };

  useEffect(() => {
    if (initialSession !== undefined) {
      // When initialSession is provided, we assume a controlled testing environment.
      // The session is already set, so we can skip the async bootstrap.
      if(initialSession) {
        updateSession(initialSession);
      }
      setLoading(false);
      return;
    }

    const bootstrapAuth = async () => {
      setLoading(true);
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      await updateSession(currentSession);
      setLoading(false);
    };

    bootstrapAuth();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setLoading(true);
        await updateSession(newSession);
        setLoading(false);
      }
    );

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, [initialSession]);

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
      await updateSession(null);
      return { error };
    },
    setSession: updateSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}