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
    if (error) return null;
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
  const [session, setSession] = useState<Session | null>(initialSession || null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // In test mode, we start with loading as false to prevent the skeleton from appearing
  // and blocking the tests. In other modes, it starts as true.
  const [loading, setLoading] = useState(import.meta.env.MODE !== 'test');

  useEffect(() => {
    const updateAuthData = async (s: Session | null) => {
      const userProfile = s?.user ? await getProfileFromDb(s.user.id) : null;
      setProfile(userProfile);
      setSession(s);
      if (import.meta.env.VITE_TEST_MODE) {
        (window as WindowWithUser).__USER__ = userProfile;
      }
      setLoading(false);
    };

    // In non-test modes, fetch the initial session to check for an existing user.
    // In test mode, we skip this, as loading is already false and tests will handle authentication explicitly.
    if (import.meta.env.MODE !== 'test') {
      supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
        updateAuthData(currentSession);
      });
    }

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        updateAuthData(newSession);
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
    signOut: () => supabase.auth.signOut(),
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}