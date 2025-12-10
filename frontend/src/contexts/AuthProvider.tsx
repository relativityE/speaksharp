/* eslint-disable react-refresh/only-export-components */
import React, { useState, useEffect, ReactNode, useMemo, useCallback, useContext, createContext } from 'react';
import { getSupabaseClient } from '../lib/supabaseClient';
import { Session, User } from '@supabase/supabase-js';
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
  const [sessionState, setSessionState] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = getSupabaseClient();

  useEffect(() => {
    // DEV BYPASS: Add ?devBypass=true to URL to skip auth for UI testing
    if (import.meta.env.DEV && window.location.search.includes('devBypass=true')) {
      console.log('[AuthProvider] DEV BYPASS ENABLED - using mock session');
      const mockSession = {
        access_token: 'dev-bypass-token',
        refresh_token: 'dev-bypass-refresh',
        expires_in: 3600,
        expires_at: Date.now() / 1000 + 3600,
        token_type: 'bearer',
        user: {
          id: 'dev-bypass-user-id',
          email: 'dev@speaksharp.app',
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        }
      } as Session;
      setSessionState(mockSession);
      setProfile({ id: 'dev-bypass-user-id', subscription_status: 'free' } as UserProfile);
      setLoading(false);
      return;
    }

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
            // --- ARCHITECTURAL FIX: Set flag AND dispatch event AFTER profile is confirmed set ---
            if (import.meta.env.MODE === 'test' || import.meta.env.VITE_TEST_MODE === 'true') {
              console.log(`[E2E DIAGNOSTIC] Profile found for ${data.id}, setting flag and dispatching event.`);
              // Set window flag for waitForFunction polling
              (window as Window & { __e2eProfileLoaded?: boolean }).__e2eProfileLoaded = true;
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
        // In E2E test mode, don't let Supabase auth state changes override the mock session
        // The mock session is set via initialSession from e2e-bridge.ts
        if (import.meta.env.MODE === 'test' || import.meta.env.VITE_TEST_MODE === 'true') {
          if (initialSession && !newSession) {
            console.log('[AuthProvider] Ignoring empty session in test mode - keeping mock session');
            return; // Don't clear the mock session
          }
        }
        fetchAndSetProfile(newSession);
      }
    );

    // Handle initial session if provided (e.g., from E2E tests)
    if (initialSession) {
      fetchAndSetProfile(initialSession);
    } else {
      // CRITICAL FIX: Fetch initial session to properly set loading state
      // Without this, loading stays true forever and page stays blank
      supabase.auth.getSession().then(({ data: { session }, error }) => {
        if (error) {
          console.error('[AuthProvider] Error getting initial session:', error);
          setLoading(false); // Still need to set loading false so landing page shows
        } else {
          fetchAndSetProfile(session);
        }
      });
    }

    return () => {
      subscription?.unsubscribe();
    };
  }, [initialSession, supabase]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSessionState(null);
    setProfile(null);
  }, [supabase]);



  const value = useMemo((): AuthContextType => ({
    session: sessionState,
    user: sessionState?.user ?? null,
    profile,
    loading,
    signOut,
    setSession: setSessionState,
  }), [sessionState, profile, loading, signOut]);

  // Don't block app rendering while loading - landing page is PUBLIC
  // Individual protected routes will handle their own loading states
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
