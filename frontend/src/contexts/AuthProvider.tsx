/* eslint-disable react-refresh/only-export-components */
import React, { useState, useEffect, ReactNode, useMemo, useCallback, useContext, createContext, useRef } from 'react';
import { getSupabaseClient } from '../lib/supabaseClient';
import { Session, User } from '@supabase/supabase-js';
import { UserProfile } from '@/types/user';
import { fetchWithRetry } from '@/utils/fetchWithRetry';

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

  // P1 FIX: Track in-flight profile fetch to prevent race conditions
  const pendingProfileFetch = useRef<string | null>(null);
  const fetchIdCounter = useRef(0);

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

    const fetchAndSetProfile = async (session: Session | null) => {
      const userId = session?.user?.id;
      console.log('[AuthProvider] fetchAndSetProfile called with session:', userId);

      // P1 FIX: Generate unique fetch ID and track it
      fetchIdCounter.current += 1;
      const currentFetchId = `fetch-${fetchIdCounter.current}`;

      if (userId) {
        // P1 FIX: If there's already a pending fetch for this user, skip
        if (pendingProfileFetch.current === userId) {
          console.log('[AuthProvider] Profile fetch already in progress for:', userId);
          return;
        }

        pendingProfileFetch.current = userId;

        try {
          // Use fetchWithRetry to handle cold starts and transient network failures
          const data = await fetchWithRetry(async () => {
            const { data, error } = await supabase
              .from('user_profiles')
              .select('*')
              .eq('id', userId)
              .single();
            if (error) throw error;
            return data;
          }, 5, 100); // 5 retries, starting at 100ms with exponential backoff

          // P1 FIX: Only update state if this is still the current fetch
          if (pendingProfileFetch.current === userId) {
            console.log('[AuthProvider] Profile loaded:', data.id);
            setProfile(data as UserProfile);
            setSessionState(session);

            // Test mode notifications
            if (import.meta.env.MODE === 'test' || import.meta.env.VITE_TEST_MODE === 'true') {
              console.log(`[E2E DIAGNOSTIC] Profile found for ${data.id}, setting flag and dispatching event.`);
              (window as Window & { __e2eProfileLoaded?: boolean }).__e2eProfileLoaded = true;
              document.dispatchEvent(new CustomEvent('e2e-profile-loaded', { detail: data }));
            }
          } else {
            console.log('[AuthProvider] Stale fetch discarded:', currentFetchId);
          }
        } catch (e) {
          console.error('[AuthProvider] Failed to fetch profile after retries:', e);
          if (pendingProfileFetch.current === userId) {
            setProfile(null);
            setSessionState(session);
          }
        } finally {
          // P1 FIX: Clear pending fetch only if it was ours
          if (pendingProfileFetch.current === userId) {
            pendingProfileFetch.current = null;
          }
        }
      } else {
        console.log('[AuthProvider] No session user ID, clearing profile');
        pendingProfileFetch.current = null;
        setProfile(null);
        setSessionState(session);
      }
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        console.log(`[Supabase Auth] 🔐 Auth state changed: ${_event}`, newSession?.user?.id ? `User: ${newSession.user.id.slice(0, 8)}...` : 'No user');
        // In E2E test mode, don't let Supabase auth state changes override the mock session
        if (import.meta.env.MODE === 'test' || import.meta.env.VITE_TEST_MODE === 'true') {
          if (initialSession && !newSession) {
            console.log('[AuthProvider] Ignoring empty session in test mode - keeping mock session');
            return;
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
      supabase.auth.getSession().then(({ data: { session }, error }) => {
        if (error) {
          console.error('[AuthProvider] Error getting initial session:', error);
          setLoading(false);
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
    pendingProfileFetch.current = null;
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
