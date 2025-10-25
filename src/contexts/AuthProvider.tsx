import React, { useState, useEffect, ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { UserProfile } from '../types/user';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthContext, AuthContextType } from './AuthContext';

const getProfileFromDb = async (userId: string): Promise<UserProfile | null> => {
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
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSessionState] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Custom event listener for E2E tests to manually trigger session updates
    const handleE2ESessionInject = (event: Event) => {
      const customEvent = event as CustomEvent<Session>;
      const newSession = customEvent.detail;
      console.log('[E2E] Manually setting session from custom event:', newSession);
      setSessionState(newSession);
    };

    if ((window as any).__E2E_MODE__) {
      window.addEventListener('__E2E_SESSION_INJECTED__', handleE2ESessionInject);
    }

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSessionState(newSession);
        if (newSession?.user) {
          if ((window as any).__E2E_MODE__) (window as any).__E2E_PROFILE_LOADED__ = false;
          const userProfile = await getProfileFromDb(newSession.user.id);
          setProfile(userProfile);
          if ((window as any).__E2E_MODE__) (window as any).__E2E_PROFILE_LOADED__ = true;
        } else {
          setProfile(null);
          if ((window as any).__E2E_MODE__) (window as any).__E2E_PROFILE_LOADED__ = true;
        }
        setLoading(false);
      }
    );

    return () => {
      listener?.subscription.unsubscribe();
      if ((window as any).__E2E_MODE__) {
        window.removeEventListener('__E2E_SESSION_INJECTED__', handleE2ESessionInject);
      }
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
    signOut: () => supabase.auth.signOut(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
