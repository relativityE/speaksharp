import React, { useState, useEffect, ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { UserProfile } from '../types/user';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthContext, AuthContextType } from './AuthContext';
import logger from '@/lib/logger';

interface WindowWithUser extends Window {
  __USER__?: UserProfile | null;
}

const getProfileFromDb = async (userId: string): Promise<UserProfile | null> => {
  try {
    logger.info({ userId }, '[AuthProvider] Fetching profile from DB...');
    const { data, error } = await supabase.from('user_profiles').select('*').eq('id', userId).single();
    if (error) {
      logger.error({ error }, 'Error fetching profile in test');
      return null;
    }
    logger.info({ data }, '[AuthProvider] Profile fetched successfully.');
    return data;
  } catch (e) {
    logger.error({ error: e }, 'Exception fetching profile');
    return null;
  }
};

interface AuthProviderProps {
  children: ReactNode;
  initialSession?: Session | null;
}

// Key for storing session in localStorage
const SESSION_STORAGE_KEY = 'speaksharp-session';

export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const [session, setSessionState] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const setSession = async (s: Session | null) => {
    logger.info(s ? { userId: s.user.id } : { session: null }, '[AuthProvider] setSession called.');
    if (s?.user) {
      const userProfile = await getProfileFromDb(s.user.id);
      logger.info({ userProfile }, '[AuthProvider] Setting user profile.');
      setProfile(userProfile);
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s));
      if (import.meta.env.MODE === 'test') {
        (window as WindowWithUser).__USER__ = userProfile;
      }
    } else {
      logger.info('[AuthProvider] Clearing user profile and session.');
      setProfile(null);
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    setSessionState(s);
  };

  useEffect(() => {
    const bootstrapAuth = async () => {
      logger.info('[AuthProvider] Bootstrapping authentication...');
      setLoading(true);
      if (initialSession) {
        logger.info('[AuthProvider] Using initialSession prop.');
        await setSession(initialSession);
      } else {
        try {
          const storedSession = localStorage.getItem(SESSION_STORAGE_KEY);
          if (storedSession) {
            logger.info('[AuthProvider] Found session in localStorage. Restoring...');
            await setSession(JSON.parse(storedSession));
          } else {
            logger.info('[AuthProvider] No session found in localStorage.');
          }
        } catch (error) {
          logger.warn({ error }, 'Could not parse session from localStorage.');
          localStorage.removeItem(SESSION_STORAGE_KEY);
        }
      }
      setLoading(false);
      logger.info('[AuthProvider] Bootstrap complete.');
    };

    bootstrapAuth();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        logger.info({ event: _event }, '[AuthProvider] onAuthStateChange triggered.');
        setLoading(true);
        await setSession(newSession);
        setLoading(false);
      }
    );

    return () => {
      logger.info('[AuthProvider] Unsubscribing from onAuthStateChange.');
      listener?.subscription.unsubscribe();
    };
  }, [initialSession]);

  if (loading) {
    return (
      <div className="w-full h-screen flex justify-center items-center">
        <Skeleton className="h-24 w-24 rounded-full" />
      </div>
    );
  }

  const value: AuthContextType = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signOut: async () => {
      logger.info('[AuthProvider] Signing out.');
      const { error } = await supabase.auth.signOut();
      await setSession(null);
      return { error };
    },
    setSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}