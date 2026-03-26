import React, { useState, useEffect, useRef, ReactNode, useMemo, useCallback, useContext, createContext } from 'react';
import { getSupabaseClient } from '../lib/supabaseClient';
import { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { ENV } from '../config/TestFlags';
import logger from '../lib/logger';
import { useSessionStore } from '../stores/useSessionStore';
import { useReadinessStore } from '../stores/useReadinessStore';

/**
 * AUTHENTICATION PROVIDER
 * 
 * Provides session management and authentication state.
 */

export interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  setSession: (s: Session | null) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
  initialSession?: Session | null;
}

export function AuthProvider({ children, initialSession = null }: AuthProviderProps) {
  const supabase = getSupabaseClient();
  const queryClient = useQueryClient();
  const initialCheckRef = useRef(false);

  const getInjectedSession = useCallback(() => {
    if (initialSession) return initialSession;
    if (typeof window === 'undefined') return null;

    try {
      const url = import.meta.env.VITE_SUPABASE_URL;
      if (!url) return null;
      const projectRef = new URL(url).hostname.split('.')[0];
      const storageKey = `sb-${projectRef}-auth-token`;

      const keys = Object.keys(window.localStorage);
      logger.debug({ storageKey, url, keys }, '[AuthProvider] Sync session sync check');

      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.access_token && parsed?.user) return parsed;
      }
    } catch (err: unknown) {
      logger.error({ err }, '[AuthProvider] Error reading sync session');
    }
    return null;
  }, [initialSession]);

  const [sessionState, setSessionState] = useState<Session | null | undefined>(getInjectedSession);
  // In E2E mock mode with no real session, skip the loading state entirely.
  const isE2EMockMode = ENV.isE2E;
  const [loading, setLoading] = useState(!getInjectedSession() && !isE2EMockMode);

  useEffect(() => {
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

    const initAuth = async () => {
      if (initialCheckRef.current) return;
      initialCheckRef.current = true;

      const initStartTime = Date.now();
      try {
        // If we already have a session (from initialSession or sync), skip fetch
        if (initialSession || getInjectedSession()) {
          setLoading(false);
          return;
        }

        const { data: { session }, error } = await supabase.auth.getSession();
        const duration = Date.now() - initStartTime;

        if (error) {
          logger.error({ error: error.message, durationMs: duration }, '[AuthProvider] getSession fallback failed');
        } else if (session) {
          logger.info({ userId: session.user.id, durationMs: duration }, '[AuthProvider] getSession fallback resolved');
          setSessionState(session);
        }
      } catch (err: unknown) {
        logger.error({ err }, '[AuthProvider] AUTH FATAL: Could not resolve session');
      } finally {
        setLoading(false);
      }
    };

    void initAuth();

    const AUTH_TIMEOUT = (import.meta.env.VITE_AUTH_TIMEOUT ? parseInt(import.meta.env.VITE_AUTH_TIMEOUT) : (import.meta.env.MODE === 'test' ? 8000 : 3000));

    const timeoutId = setTimeout(() => {
      setLoading(currentLoading => {
        if (currentLoading) {
          logger.warn({ timeout: AUTH_TIMEOUT }, '[AuthProvider] Safety timeout reached, forcing boot');
          setSessionState(prev => prev === undefined ? null : prev);
          return false;
        }
        return currentLoading;
      });
    }, AUTH_TIMEOUT);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        const timestamp = new Date().toISOString();
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

        switch (event) {
          case 'SIGNED_OUT':
            logger.info({ timestamp }, '[AuthProvider] User signed out or refresh failed, clearing state');
            setLoading(false);
            break;
          case 'TOKEN_REFRESHED':
            logger.info({ expiresAt: newSession?.expires_at, timestamp }, '[AuthProvider] Token successfully refreshed');
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
  }, [initialSession, supabase, queryClient, getInjectedSession]);

  // Signal Auth Readiness (Top-level Hook)
  useEffect(() => {
    // Fast-path: In E2E mock mode with no real session, signal auth readiness immediately.
    // The Core Probe validates infrastructure only — it does not require a real Supabase session.
    const isE2EMockMode = ENV.isE2E;
    if (isE2EMockMode && !sessionState) {
      useReadinessStore.getState().setReady('auth');
      logger.info('[AuthProvider] ✅ Auth Ready Signal (E2E Mock Mode — no session required)');
      return;
    }

    if (!loading) {
      useReadinessStore.getState().setReady('auth');
      logger.info({ userId: sessionState?.user?.id }, '[AuthProvider] ✅ Auth Ready Signal');
    }
  }, [loading, sessionState]);

  const signOut = useCallback(async () => {
    try {
      queryClient.clear();
      logger.info('[AuthProvider] QueryClient cache cleared');
      useSessionStore.getState().resetSession();
      logger.info('[AuthProvider] Zustand session memory purged');
      window.localStorage.clear();
      window.sessionStorage.clear();
      logger.info('[AuthProvider] Window storage cleared');
      await supabase.auth.signOut();
    } catch (err: unknown) {
      logger.error({ err }, '[AuthProvider] Error during signOut');
    }
    setSessionState(null);
  }, [supabase, queryClient]);

  const value = useMemo((): AuthContextType => ({
    session: sessionState ?? null,
    user: sessionState?.user ?? null,
    loading,
    signOut,
    setSession: (s: Session | null) => setSessionState(s),
  }), [sessionState, loading, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuthProvider = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthProvider must be used within an AuthProvider');
  }
  return context;
};
