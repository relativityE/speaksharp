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
      console.error('[AuthProvider] Error fetching profile:', error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.error('[AuthProvider] Error fetching profile:', e);
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
    console.log('[AuthProvider] Initializing...');

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        console.error('[AuthProvider] Supabase client is null. Cannot proceed.');
        setLoading(false);
        return;
      }

      // Get initial session
      supabase.auth.getSession().then(({ data: { session } }) => {
        console.log('[AuthProvider] Initial session:', !!session);
        setSessionState(session);
        if (!session) {
          setLoading(false);
        }
      });

      // Listen for auth changes (this handles test session injection too!)
      const { data: listener } = supabase.auth.onAuthStateChange(
        async (event, newSession) => {
          console.log('[AuthProvider] Auth state changed:', event, 'has session:', !!newSession);
          setSessionState(newSession);

          if (newSession?.user) {
            console.log('[AuthProvider] Fetching profile for user:', newSession.user.id);
            const userProfile = await getProfileFromDb(newSession.user.id);
            console.log('[AuthProvider] Profile fetched:', !!userProfile, userProfile?.email);
            setProfile(userProfile);

            // ✅ CRITICAL: Dispatch event immediately after profile is set
            if (import.meta.env.MODE === 'test' && userProfile) {
              console.log('[AuthProvider] ✅ E2E: Dispatching profile-loaded event');
              document.dispatchEvent(new CustomEvent('e2e-profile-loaded'));
            }
          } else {
            console.log('[AuthProvider] No session, clearing profile');
            setProfile(null);
          }

          setLoading(false);
          console.log('[AuthProvider] Auth state update complete');
        }
      );

      return () => {
        console.log('[AuthProvider] Cleanup - unsubscribing from auth changes');
        listener?.subscription.unsubscribe();
      };
    } catch (error) {
      console.error('[AuthProvider] CRITICAL ERROR in useEffect:', error);
      setLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div
        className="w-full h-screen flex justify-center items-center"
        data-testid="loading-skeleton-container"
      >
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
