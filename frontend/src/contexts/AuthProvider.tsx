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
  isGuest: boolean;
  signOut: () => Promise<void>;
  setSession: (s: Session | null) => void;
  enterGuestMode: () => Promise<void>;
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
  const [isGuest, setIsGuest] = useState(false);

  const supabase = getSupabaseClient();

  useEffect(() => {
    if (!supabase) {
      // In a real app, you might want to throw an error or handle this state gracefully
      console.error('Supabase client is not available.');
      setLoading(false);
      return;
    }

    const fetchAndSetProfile = async (session: Session | null) => {
      console.log('[AuthProvider] fetchAndSetProfile called with session:', session?.user?.id);
      if (session?.user?.id) {
        try {
          const { data, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();

          if (error) {
            console.error('[AuthProvider] Error fetching user profile:', error);
            setProfile(null);
          } else if (data) {
            console.log('[AuthProvider] Profile loaded:', data.id);
            setProfile(data as UserProfile);
            // --- ARCHITECTURAL FIX: Dispatch event AFTER profile is confirmed set ---
            if (import.meta.env.MODE === 'test' || import.meta.env.VITE_TEST_MODE === 'true') {
              console.log(`[E2E DIAGNOSTIC] Profile found for ${data.id}, dispatching event.`);
              document.dispatchEvent(new CustomEvent('e2e-profile-loaded', { detail: data }));
            }
          }
        } catch (e) {
          console.error('[AuthProvider] An unexpected error occurred while fetching the profile:', e);
          setProfile(null);
        }
      } else {
        console.log('[AuthProvider] No session user ID, clearing profile');
        setProfile(null);
      }
      setSessionState(session);
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        fetchAndSetProfile(newSession);
      }
    );

    // Handle initial session if provided
    if (initialSession) {
      fetchAndSetProfile(initialSession);
    }

    return () => {
      subscription?.unsubscribe();
    };
  }, [initialSession, supabase]);

  const signOut = useCallback(async () => {
    if (!isGuest) {
      await supabase.auth.signOut();
    }
    setSessionState(null);
    setProfile(null);
    setIsGuest(false);
  }, [supabase, isGuest]);

  const enterGuestMode = useCallback(async () => {
    setLoading(true);
    // Create a mock guest user and profile
    const guestUser = {
      id: 'guest-user',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'guest@example.com',
      email_confirmed_at: new Date().toISOString(),
      phone: '',
      confirmation_sent_at: '',
      confirmed_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
      app_metadata: { provider: 'email' },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as User;

    const guestProfile: UserProfile = {
      id: 'guest-user',
      email: 'guest@example.com',
      full_name: 'Guest User',
      subscription_tier: 'free',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      onboarding_completed: true,
      preferences: {}
    };

    // Simulate network delay for better UX
    await new Promise(resolve => setTimeout(resolve, 500));

    setSessionState({
      user: guestUser,
      access_token: 'mock-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      token_type: 'bearer'
    });
    setProfile(guestProfile);
    setIsGuest(true);
    setLoading(false);
  }, []);

  const value = useMemo((): AuthContextType => ({
    session,
    user: session?.user ?? null,
    profile,
    loading,
    isGuest,
    signOut,
    setSession: setSessionState,
    enterGuestMode,
  }), [session, profile, loading, isGuest, signOut, enterGuestMode]);

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
