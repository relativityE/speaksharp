import React, { useState, useEffect, useRef, ReactNode, useMemo, useCallback, useContext, createContext } from 'react';
import { getSupabaseClient } from '../lib/supabaseClient';
import { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { ENV } from '../config/TestFlags';
import logger from '../lib/logger';
import { useSessionStore } from '@/stores/useSessionStore';
import { useReadinessStore } from '@/stores/useReadinessStore';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { markIdentitySettled, resetIdentitySettlement } from '@/services/transcription/modelAcquisitionTelemetry';

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

const isStructurallyValidSession = (session: unknown): session is Session => {
  if (!session || typeof session !== 'object') return false;
  const candidate = session as Partial<Session> & { user?: Partial<User> };
  if (!candidate.access_token || typeof candidate.access_token !== 'string') return false;
  if (!candidate.user || typeof candidate.user !== 'object') return false;
  if (!candidate.user.id || typeof candidate.user.id !== 'string') return false;
  if (!candidate.user.email || typeof candidate.user.email !== 'string') return false;
  if (candidate.access_token.split('.').length !== 3) return false;
  return true;
};

export function AuthProvider({ children, initialSession = null }: AuthProviderProps) {
  const supabase = getSupabaseClient();
  const queryClient = useQueryClient();
  const initialCheckRef = useRef(false);
  const identifiedAnalyticsUserRef = useRef<string | null>(null);

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
        if (isStructurallyValidSession(parsed)) return parsed;
        logger.warn({ storageKey }, '[AuthProvider] Ignoring malformed stored auth session');
      }
    } catch (err: unknown) {
      logger.error({ err }, '[AuthProvider] Error reading sync session');
    }
    return null;
  }, [initialSession]);

  const [sessionState, setSessionState] = useState<Session | null | undefined>(getInjectedSession);
  const sessionStateRef = useRef<Session | null | undefined>(sessionState);
  // In E2E mock mode with no real session, skip the loading state entirely.
  const isE2EMockMode = ENV.isE2E;
  const [loading, setLoading] = useState(!getInjectedSession() && !isE2EMockMode);

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  // Account-linked analytics identity. Identify the authenticated user to PostHog/Sentry by the
  // stable Supabase user.id ONLY — NO email or other PII (privacy-first posture; matches the v4
  // telemetry sanitizer that drops email). This gives PostHog an account-linked person so feature
  // flags can be targeted via an operator cohort on user.id; on sign-out we reset to a fresh
  // anonymous id so a shared device never inherits the prior account's identity/flags.
  // #1259 — the SERVER'S internal-tester claim, derived here so the effect below depends on a stable
  // BOOLEAN. Depending on `sessionState?.user` would re-run the identity effect whenever that object's
  // identity changed, which is a behaviour change to the identity path this fix has no business making.
  //
  // `app_metadata` is assigned SERVER-SIDE with the service role and travels inside the signed JWT, so
  // a visitor cannot set it through the normal client authentication APIs. That is a narrowing, NOT a
  // guarantee — this is client-emitted telemetry, and nothing in it is unforgeable by someone who
  // controls the browser. What it buys is that ordinary sign-up and profile editing cannot produce the
  // classification. `user_metadata` would be the wrong field and a real hazard:
  // it IS user-writable, so reading it would let anyone label their own traffic internal and vanish
  // from the customer funnel. This replaces a `VITE_*` account allowlist, which would have compiled
  // the tester account ids into the public browser bundle.
  const internalTesterClaim = (sessionState?.user as { app_metadata?: Record<string, unknown> } | undefined)
    ?.app_metadata?.internal_tester === true;
  const canaryClaim = (sessionState?.user as { app_metadata?: Record<string, unknown> } | undefined)
    ?.app_metadata?.canary === true;

  useEffect(() => {
    // NOT SETTLED WHILE AUTHENTICATION IS STILL LOADING.
    //
    // On an ordinary boot `sessionState` is undefined and `loading` is true, and the old code read that
    // as "signed out": it released every queued acquisition event anonymously, and `getSession()` then
    // resolved an authenticated user seconds later. The events the queue exists to protect were the
    // exact ones it lost. "We do not know yet" and "there is definitively nobody" are different states,
    // and only the second one settles anything.
    if (loading) return;

    const userId = sessionState?.user?.id ?? null;
    if (!userId) {
      // No active session. Clear a persisted PostHog identity if EITHER this mount identified someone
      // OR PostHog still carries a prior user's account-linked identity from an EARLIER visit. The
      // ref starts null on every fresh mount, but PostHog persists distinct_id across page loads — so
      // an anonymous/no-session boot on a shared device or after an expired session would otherwise
      // keep events/flags attached to the previous user. We gate on isIdentified() so a genuinely
      // fresh anonymous visitor is left untouched (no needless anonymous-id churn).
      if (identifiedAnalyticsUserRef.current || analyticsBuffer.isIdentified()) {
        // An account is LEAVING. Anything still queued was produced under it, so it must not be
        // released under the anonymous identity that replaces it.
        resetIdentitySettlement();
        // The claim belongs to the account that is leaving. Carrying it into the anonymous session
        // would classify a real visitor on a shared device as internal.
        analyticsBuffer.setInternalTesterClaim(false);
        analyticsBuffer.setCanaryClaim(false);
        analyticsBuffer.resetIdentity();
      }
      identifiedAnalyticsUserRef.current = null;
      // #1259s — a DEFINITIVELY signed-out visitor is a settled identity too. Model setup begins during
      // page initialisation, so acquisition events wait for this moment; without releasing them here a
      // signed-out visitor's events would queue forever and never be measured.
      markIdentitySettled(null);
      return;
    }
    if (identifiedAnalyticsUserRef.current === userId) return;
    // ACCOUNT TRANSITION ONLY. Retiring the settlement discards the queue, which is right when account
    // A's events would otherwise land on account B — and wrong on a FIRST authentication, where the
    // queue holds this user's own boot-time load and is precisely what we are waiting to attribute.
    if (identifiedAnalyticsUserRef.current && identifiedAnalyticsUserRef.current !== userId) {
      resetIdentitySettlement();
    }
    // #1259 — the SERVER'S internal-tester claim, recorded before identify so the very first event
    // under this account is already classified.
    //
    // `app_metadata` is assigned SERVER-SIDE with the service role. A visitor cannot set it through
    // the normal client authentication APIs — a narrowing, not a guarantee, since this is
    // client-emitted telemetry. `user_metadata` would be the wrong field and a real
    // hazard: it IS user-writable, so reading it would let anyone label their own traffic internal and
    // vanish from the customer funnel. This replaces a `VITE_*` account allowlist, which would have
    // compiled the tester account ids into the public browser bundle.
    analyticsBuffer.setInternalTesterClaim(internalTesterClaim);
    analyticsBuffer.setCanaryClaim(canaryClaim);
    analyticsBuffer.identify(userId); // user.id only — no email/PII to PostHog
    identifiedAnalyticsUserRef.current = userId;
    // IDENTIFY FIRST, THEN RELEASE. Flushing before identify would attribute a returning user's cold
    // load to anonymous traffic while their warm load landed under their own identity, so the two could
    // never be compared — the exact question this telemetry exists to answer. The account is named, so
    // the queue's own epoch check can retire events that were waiting for a DIFFERENT one — a check a
    // remount cannot forget, unlike the ref above.
    markIdentitySettled(userId);
  }, [sessionState?.user?.id, loading, internalTesterClaim, canaryClaim]);

  useEffect(() => {
    const injectedSession = getInjectedSession();

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
        if (initialSession || injectedSession) {
          setLoading(false);
          return;
        }

        const { data: { session }, error } = await supabase.auth.getSession();
        const duration = Date.now() - initStartTime;

        if (error) {
          logger.error({ error: error.message, durationMs: duration }, '[AuthProvider] getSession fallback failed');
        } else if (session) {
          logger.info({ userId: session.user.id, durationMs: duration }, '[AuthProvider] getSession fallback resolved');
          sessionStateRef.current = session;
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
          setSessionState(prev => {
            const next = prev === undefined ? null : prev;
            sessionStateRef.current = next;
            return next;
          });
          return false;
        }
        return currentLoading;
      });
    }, AUTH_TIMEOUT);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        const timestamp = new Date().toISOString();
        const assignSession = (nextSession: Session | null) => {
          sessionStateRef.current = nextSession;
          setSessionState(nextSession);
        };

        if (event === 'INITIAL_SESSION' && !newSession && (initialSession || sessionStateRef.current)) {
          logger.debug('[AuthProvider] Ignoring INITIAL_SESSION(null) because a session is already present');
          return;
        }

        logger.info({
          event,
          userId: newSession?.user?.id,
          expiresAt: newSession?.expires_at,
          timestamp
        }, `[Supabase Auth] 🔐 Auth event: ${event}`);

        switch (event) {
          case 'SIGNED_OUT':
            logger.info({ timestamp }, '[AuthProvider] User signed out or refresh failed, clearing state');
            assignSession(null);
            setLoading(false);
            break;
          case 'TOKEN_REFRESHED':
            logger.info({ expiresAt: newSession?.expires_at, timestamp }, '[AuthProvider] Token successfully refreshed');
            assignSession(newSession);
            break;
          case 'USER_UPDATED':
            logger.info({ userId: newSession?.user?.id }, '[AuthProvider] User metadata updated');
            assignSession(newSession);
            break;
          case 'PASSWORD_RECOVERY':
            // The user arrived via a password-reset email link. With `detectSessionInUrl: true`
            // the client consumes the recovery token from the URL and fires this event during app
            // boot — BEFORE the lazy-loaded /auth/reset page mounts — and then clears the hash. So
            // record a durable, single-use marker that ResetPasswordPage can read to authorize the
            // set-new-password form even after the token is gone and the event has already fired.
            // A normal signed-in user never triggers PASSWORD_RECOVERY, so this stays reset-only.
            try { sessionStorage.setItem('ss_password_recovery', '1'); } catch { /* sessionStorage may be unavailable */ }
            assignSession(newSession);
            setLoading(false);
            break;
          case 'SIGNED_IN':
            logger.info({ userId: newSession?.user?.id }, '[AuthProvider] User signed in');
            assignSession(newSession);
            setLoading(false);
            break;
          case 'INITIAL_SESSION':
            assignSession(newSession);
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
    if (ENV.isE2E && !sessionState) {
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
    sessionStateRef.current = null;
    setSessionState(null);
  }, [supabase, queryClient]);

  const value = useMemo((): AuthContextType => ({
    session: sessionState ?? null,
    user: sessionState?.user ?? null,
    loading,
    signOut,
    setSession: (s: Session | null) => {
      sessionStateRef.current = s;
      setSessionState(s);
    },
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
