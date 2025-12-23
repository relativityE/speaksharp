/* eslint-disable react-refresh/only-export-components */
import React, { useState, useEffect, ReactNode, useMemo, useCallback, useContext, createContext } from 'react';
import { getSupabaseClient } from '../lib/supabaseClient';
import { Session, User } from '@supabase/supabase-js';
import { UserProfile } from '@/types/user';
import { fetchWithRetry } from '@/utils/fetchWithRetry';
import { getTestConfig, setTestFlag, dispatchTestEvent } from '@/config/test.config';

/**
 * P1 TECH DEBT: Auth Context Overreach
 * 
 * Current implementation: Single context provides both session AND profile
 * - All consumers re-render when either changes
 * - Acceptable for alpha with limited component tree
 * 
 * Future optimization:
 * - Split into SessionContext (auth state) and ProfileContext (user data)
 * - Use useSyncExternalStore for fine-grained subscriptions
 * - Memoize context values more granularly
 * 
 * Migration path:
 * 1. Create separate SessionProvider and ProfileProvider
 * 2. Update consumers to import from appropriate context
 * 3. Use React DevTools profiler to verify reduced re-renders
 */

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
      const devUserId = '00000000-0000-0000-0000-000000000000';
      const mockSession = {
        access_token: 'dev-bypass-token',
        refresh_token: 'dev-bypass-refresh',
        expires_in: 3600,
        expires_at: Date.now() / 1000 + 3600,
        token_type: 'bearer',
        user: {
          id: devUserId,
          email: 'dev@speaksharp.app',
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        }
      } as Session;
      setSessionState(mockSession);
      setProfile({ id: devUserId, subscription_status: 'free' } as UserProfile);
      setLoading(false);
      return;
    }

    if (!supabase) {
      console.error('Supabase client is not available.');
      setLoading(false);
      return;
    }

    // Initialize session
    if (initialSession) {
      setSessionState(initialSession);
    } else {
      supabase.auth.getSession().then(({ data: { session }, error }) => {
        if (error) {
          console.error('[AuthProvider] Error getting initial session:', error);
        }
        setSessionState(session);
        // If no session, loading is done. If session exists, profile fetch will handle loading.
        if (!session) setLoading(false);
      });
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        console.log(`[Supabase Auth] 🔐 Auth state changed: ${_event}`, newSession?.user?.id ? `User: ${newSession.user.id.slice(0, 8)}...` : 'No user');
        setSessionState(newSession);
        if (!newSession) {
          setProfile(null);
          setLoading(false);
        }
      }
    );

    return () => {
      subscription?.unsubscribe();
    };
  }, [initialSession, supabase]);

  // Effect to fetch profile when session changes
  useEffect(() => {
    const userId = sessionState?.user?.id;
    if (!userId || !supabase) {
      setProfile(null);
      return;
    }

    let active = true;

    const fetchProfile = async () => {
      try {
        console.log('[AuthProvider] Fetching profile for:', userId);
        const data = await fetchWithRetry(async () => {
          const { data, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', userId)
            .single();
          if (error) throw error;
          return data;
        }, 5, 100);

        if (active) {
          console.log('[AuthProvider] Profile loaded:', data.id);
          setProfile(data as UserProfile);
          setLoading(false);

          // Test mode notifications
          const { isTestMode } = getTestConfig();
          if (isTestMode) {
            console.log(`[E2E DIAGNOSTIC] Profile found for ${data.id}, setting flag and dispatching event.`);
            setTestFlag('__e2eProfileLoaded', true);
            dispatchTestEvent('e2e-profile-loaded', data);
          }
        }
      } catch (e) {
        console.error('[AuthProvider] Failed to fetch profile after retries:', e);
        if (active) {
          setProfile(null); // Valid session but failed profile fetch
          setLoading(false);
        }
      }
    };

    fetchProfile();

    return () => {
      active = false;
    };
  }, [sessionState?.user?.id, supabase]);

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
