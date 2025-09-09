import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Session } from '@supabase/supabase-js';
import logger from '../lib/logger';
import { toast } from 'sonner';

type Profile = {
  id: string;
  subscription_status: 'free' | 'pro' | 'premium';
  preferred_mode?: 'cloud' | 'on-device';
};

type AuthContextType = {
  session: Session | null;
  user: any | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const getProfileFromDb = useCallback(async (user_id: string): Promise<Profile | null> => {
    try {
      const { data, error } = await supabase.from('user_profiles').select('*').eq('id', user_id).single();
      if (error) throw error;

      // For local development, allow overriding the subscription status
      if (data && import.meta.env.DEV && import.meta.env.VITE_DEV_PREMIUM_ACCESS === 'true') {
        data.subscription_status = 'premium';
      }
      return data;
    } catch (err) {
      logger.error({ err }, 'Error fetching profile');
      toast.error('Could not fetch your profile.');
      return null;
    }
  }, []);

  useEffect(() => {
    const setData = async () => {
      try {
        const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        setSession(currentSession);
        if (currentSession) {
          const userProfile = await getProfileFromDb(currentSession.user.id);
          setProfile(userProfile);
        }
      } catch (err) {
        logger.error({ err }, 'Error setting initial auth data');
        setSession(null);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    };

    setData();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        if (newSession?.user) {
          const userProfile = await getProfileFromDb(newSession.user.id);
          setProfile(userProfile);
        } else {
          setProfile(null);
        }
      }
    );

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, [getProfileFromDb]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  };

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signOut,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
