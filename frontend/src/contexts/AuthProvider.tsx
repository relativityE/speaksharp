import React, { useState, useEffect, ReactNode, useMemo, useCallback, useContext, createContext } from 'react';
import { getSupabaseClient } from '../lib/supabaseClient';
import { Session, User } from '@supabase/supabase-js';

/**
 * AUTHENTICATION PROVIDER
 * 
 * Provides session management and authentication state.
 * 
 * NOTE (Gap Remediation 2026-01-05):
 * This provider has been refactored to focus exclusively on session management.
 * The User Profile state (formerly part of this context) is now managed by the 
 * `useUserProfile` hook, reducing unnecessary re-renders in components that 
 * only need auth status (like Navigation).
 */

// Define the context value type right inside the provider file
export interface AuthContextType {
  session: Session | null;
  user: User | null;
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
        // 🧪 E2E FIX: If we provided an initialSession (mock), don't let 
        // INITIAL_SESSION event overwrite it with 'null' if Supabase 
        // hasn't picked up the localStorage yet.
        if (_event === 'INITIAL_SESSION' && initialSession && !newSession) {
          console.log('[AuthProvider] 🧪 E2E: Ignoring INITIAL_SESSION(null) because initialSession is present');
          return;
        }

        console.log(`[Supabase Auth] 🔐 Auth state changed: ${_event}`, newSession?.user?.id ? `User: ${newSession.user.id.slice(0, 8)}...` : 'No user');
        setSessionState(newSession);
        if (!newSession) {
          setLoading(false);
        }
      }
    );

    return () => {
      subscription?.unsubscribe();
    };
  }, [initialSession, supabase]);

  // Loading state management
  useEffect(() => {
    if (sessionState !== undefined) {
      setLoading(false);
    }
  }, [sessionState]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSessionState(null);
  }, [supabase]);

  const value = useMemo((): AuthContextType => ({
    session: sessionState,
    user: sessionState?.user ?? null,
    loading,
    signOut,
    setSession: setSessionState,
  }), [sessionState, loading, signOut]);

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
