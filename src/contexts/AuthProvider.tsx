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
  enableSubscription?: boolean;
}

export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(initialSession || null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSessionAndProfile = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;

        let userProfile: UserProfile | null = null;
        if (session?.user) {
          userProfile = await getProfileFromDb(session.user.id);
        }
        setProfile(userProfile);
        if (import.meta.env.VITE_TEST_MODE) {
          (window as WindowWithUser).__USER__ = userProfile;
        }
        setSession(session);
      } catch (e) {
        console.error('Error fetching session and profile:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchSessionAndProfile();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        let userProfile: UserProfile | null = null;
        if (newSession?.user) {
          userProfile = await getProfileFromDb(newSession.user.id);
        }
        setProfile(userProfile);
        if (import.meta.env.VITE_TEST_MODE) {
          (window as WindowWithUser).__USER__ = userProfile;
        }
        setSession(newSession);
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
    is_anonymous: !session?.user || (session.user.is_anonymous ?? false),
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
