/* eslint-disable react-refresh/only-export-components */
import React, { useState, useEffect, ReactNode, useMemo, useCallback, useContext, createContext } from 'react';
import { getSupabaseClient } from '../lib/supabaseClient';
import { Session, User } from '@supabase/supabase-js';
import { Skeleton } from '@/components/ui/skeleton';
import { UserProfile } from '@/types/user';

// Define the context value type right inside the provider file
export interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  setSession: (s: Session | null) => void;
}

// Create the context here
export const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
  initialSession?: Session | null;
}

export function AuthProvider({ children, initialSession = null }: AuthProviderProps) {
  const [session, setSessionState] = useState<Session | null>(initialSession);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(!initialSession);

  const supabase = getSupabaseClient();

  useEffect(() => {
    if (!supabase) {
      // In a real app, you might want to throw an error or handle this state gracefully
      console.error('Supabase client is not available.');
      setLoading(false);
      return;
    }

    if (initialSession) {
      setSessionState(initialSession);
      setLoading(false);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSessionState(newSession);
        if (!newSession) {
          setProfile(null);
        }
        setLoading(false);
      }
    );

    return () => {
      subscription?.unsubscribe();
    };
  }, [initialSession, supabase]);

  useEffect(() => {
    if (session?.user?.id) {
      const fetchProfile = async () => {
        try {
          const { data, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();

          if (error) {
            console.error('Error fetching user profile:', error);
            setProfile(null);
          } else if (data) {
            setProfile(data as UserProfile);
          }
        } catch (e) {
          console.error('An unexpected error occurred while fetching the profile:', e);
          setProfile(null);
        }
      };

      fetchProfile();
    }
  }, [session, supabase]);

  useEffect(() => {
    console.log('[E2E DIAGNOSTIC] Profile changed:', profile);
    if (import.meta.env.MODE === 'test' && profile) {
      console.log('[E2E DIAGNOSTIC] Dispatching e2e-profile-loaded event.');
      document.dispatchEvent(new CustomEvent('e2e-profile-loaded', { detail: profile }));
    }
  }, [profile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSessionState(null);
    setProfile(null);
  }, [supabase]);

  const value = useMemo((): AuthContextType => ({
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signOut,
    setSession: setSessionState,
  }), [session, profile, loading, signOut]);

  if (loading) {
    return (
      <div className="w-full h-screen flex justify-center items-center" data-testid="auth-provider-loading">
        <Skeleton className="h-24 w-24 rounded-full" data-testid="loading-skeleton" />
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Export the custom hook from the same file
export const useAuthProvider = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthProvider must be used within an AuthProvider');
  }
  return context;
};
