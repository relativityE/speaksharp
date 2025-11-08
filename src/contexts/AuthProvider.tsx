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
    const supabase = getSupabaseClient();
    if (!supabase) {
      console.error('[AuthProvider] Supabase client is null. Cannot proceed.');
      setLoading(false);
      return;
    }

    // Immediately get the session and update loading state
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionState(session);
      if (!session) {
        setLoading(false);
      }
    });

    // Listen for auth state changes
    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSessionState(newSession);
        if (newSession?.user) {
          const userProfile = await getProfileFromDb(newSession.user.id);
          setProfile(userProfile);
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    );

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (import.meta.env.MODE === 'test' && profile) {
      console.log('[E2E] Profile loaded successfully:', {
        email: session?.user?.email,
        id: profile?.id
      });
      document.dispatchEvent(new CustomEvent('e2e-profile-loaded'));
    }
  }, [profile, session]);

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
