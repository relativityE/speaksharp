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
  const [sessionState, setSessionState] = useState<Session | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const supabase = getSupabaseClient();

  useEffect(() => {
    // DEV BYPASS: Add ?devBypass=true to URL to skip auth for UI testing
    if (import.meta.env.DEV && window.location.search.includes('devBypass=true')) {
      logger.info('[AuthProvider] DEV BYPASS ENABLED - using mock session');
      const devUserId = '00000000-0000-0000-0000-000000000000';
      const mockSession = {
        access_token: 'dev-bypass-token',
        refresh_token: 'dev-bypass-refresh',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
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
      logger.error('[AuthProvider] Supabase client is not available.');
      setLoading(false);
      return;
    }

    // Initialize session
    const initStartTime = Date.now();
    if (initialSession) {
      logger.info({ userId: initialSession.user.id }, '[AuthProvider] Using injected initialSession');
      setSessionState(initialSession);
      setLoading(false);
    } else {
      supabase.auth.getSession().then(({ data: { session }, error }) => {
        const duration = Date.now() - initStartTime;
        if (error) {
          logger.error({
            error: error.message,
            code: error.status,
            durationMs: duration
          }, '[AuthProvider] getSession failed');
          setSessionState(null);
        } else {
          logger.info({
            hasSession: !!session,
            userId: session?.user?.id,
            expiresAt: session?.expires_at,
            durationMs: duration
          }, '[AuthProvider] getSession complete');
          setSessionState(session);
        }
        setLoading(false);
      }).catch(err => {
        logger.error({ err }, '[AuthProvider] Fatal error in getSession');
        setSessionState(null);
        setLoading(false);
      });
    }

    // Safety timeout for loading state to prevent infinite spinner
    const timeoutId = setTimeout(() => {
      setLoading(currentLoading => {
        if (currentLoading) {
          logger.warn('[AuthProvider] Safety timeout reached, forcing loading false');
          setSessionState(prev => prev === undefined ? null : prev);
          return false;
        }
        return currentLoading;
      });
    }, 5000);

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
          expiresAt: newSession?.expires_at,
          timestamp
        }, `[Supabase Auth] 🔐 Auth event: ${event}`);

        setSessionState(newSession);

        // State-specific behavior
        switch (event) {
          case 'SIGNED_OUT':
            logger.info({ timestamp }, '[AuthProvider] User signed out or refresh failed, clearing state');
            setLoading(false);
            break;
          case 'TOKEN_REFRESHED':
            logger.info({
              expiresAt: newSession?.expires_at,
              timestamp
            }, '[AuthProvider] Token successfully refreshed');
            break;
          case 'USER_UPDATED':
            logger.info({ userId: newSession?.user?.id }, '[AuthProvider] User metadata updated');
            break;
          case 'SIGNED_IN':
            logger.info({ userId: newSession?.user?.id }, '[AuthProvider] User signed in');
            setLoading(false);
            break;
          case 'INITIAL_SESSION':
            setLoading(false);
            break;
        }
      }
    );

    return () => {
      clearTimeout(timeoutId);
      subscription?.unsubscribe();
    };
  }, [initialSession, supabase]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      logger.error({ err }, '[AuthProvider] Error during signOut');
    }
    setSessionState(null);
  }, [supabase]);

  const value = useMemo((): AuthContextType => ({
    session: sessionState ?? null,
    user: sessionState?.user ?? null,
    loading,
    signOut,
    setSession: (s: Session | null) => setSessionState(s),
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
