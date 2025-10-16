import React, { useState, useEffect, ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { UserProfile } from '../types/user';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthContext, AuthContextType } from './AuthContext';
import { getSyncSession } from '../lib/utils';

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
  // Initialize session state SYNCHRONOUSLY from localStorage
  const [session, setSessionState] = useState<Session | null>(() => {
    if (initialSession !== undefined) return initialSession;
    return getSyncSession();
  });

  const [profile, setProfile] = useState<UserProfile | null>(null);
  // Start with loading=false as we have a sync session
  const [loading] = useState(false);

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
    // If we have a session (either sync or from props), fetch the profile
    if (session?.user) {
      getProfileFromDb(session.user.id).then(setProfile);
    }

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        // Still use the listener to react to real-time changes
        await updateSession(newSession);
      }
    );

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, [session?.user]);

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
