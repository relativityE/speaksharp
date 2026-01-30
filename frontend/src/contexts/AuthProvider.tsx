import React, { useState, useEffect, ReactNode, useMemo, useCallback, useContext, createContext } from 'react';
import { getSupabaseClient } from '../lib/supabaseClient';
import { Session, User } from '@supabase/supabase-js';
import logger from '../lib/logger';

/**
 * AUTHENTICATION PROVIDER
 * 
 * Provides session management and authentication state.
 * 
 * NOTE (Gap Remediation 2026-01-05):
 * This provider has been refactored to focus exclusively on session management.
 * 
 * ARCHITECTURE NOTE (Senior Architect):
 * - V5 Auth Token Refresh: Implemented structured logging for session events.
 * - Handles INITIAL_SESSION, SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED.
 * - Captures timing metrics for session initialization and refresh events.
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
    const initStartTime = Date.now();
    if (initialSession) {
      logger.info('[AuthProvider] Using injected initialSession');
      setSessionState(initialSession);
    } else {
      supabase.auth.getSession().then(({ data: { session }, error }) => {
        const duration = Date.now() - initStartTime;
        if (error) {
          logger.error({ error, durationMs: duration }, '[AuthProvider] getSession failed');
        } else {
          logger.info({
            hasSession: !!session,
            userId: session?.user?.id,
            durationMs: duration
          }, '[AuthProvider] getSession complete');
        }
        setSessionState(session);
        // If no session, loading is done. If session exists, profile fetch will handle loading.
        if (!session) setLoading(false);
      });
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        const timestamp = new Date().toISOString();

        // 🧪 E2E FIX: If we provided an initialSession (mock), don't let 
        // INITIAL_SESSION event overwrite it with 'null' if Supabase 
        // hasn't picked up the localStorage yet.
        if (event === 'INITIAL_SESSION' && initialSession && !newSession) {
          logger.debug('[AuthProvider] 🧪 E2E: Ignoring INITIAL_SESSION(null) because initialSession is present');
          return;
        }

        logger.info({
          event,
          userId: newSession?.user?.id,
          timestamp
        }, `[Supabase Auth] 🔐 Auth event: ${event}`);

        setSessionState(newSession);

        // State-specific behavior
        switch (event) {
          case 'SIGNED_OUT':
            logger.info('[AuthProvider] User signed out, clearing state');
            setLoading(false);
            break;
          case 'TOKEN_REFRESHED':
            logger.info('[AuthProvider] Token successfully refreshed');
            break;
          case 'USER_UPDATED':
            logger.info('[AuthProvider] User metadata updated');
            break;
          case 'SIGNED_IN':
            logger.info('[AuthProvider] User signed in');
            break;
          case 'INITIAL_SESSION':
            if (!newSession) setLoading(false);
            break;
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
