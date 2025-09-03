import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import logger from '../lib/logger';

// Define a more specific type for our context
type AuthContextType = {
  session: object | null;
  user: object | null;
  profile: object | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({
  children,
  enableSubscription = true,
  initialSession = null,
}) {
  const [session, setSession] = useState(initialSession);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const setData = async (currentSession) => {
      if (currentSession) {
        setSession(currentSession);
        if (currentSession.user) {
          try {
            const { data: profileData, error } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', currentSession.user.id)
              .single();

            if (error) {
              logger.error({ error }, 'Error fetching profile');
              setProfile(null);
            } else {
              setProfile(profileData);
            }
          } catch (e) {
            logger.error(e, 'Catastrophic error fetching profile');
            setProfile(null);
          }
        }
      } else {
        setSession(null);
        setProfile(null);
      }
      setLoading(false);
    };

    const setupAuth = async () => {
      if (initialSession) {
        await setData(initialSession);
        return { subscription: null };
      }

      if (!enableSubscription) {
        setLoading(false);
        return { subscription: null };
      }

      const { data: { session: currentSession } } = await supabase.auth.getSession();
      await setData(currentSession);

      const { data: authListener } = supabase.auth.onAuthStateChange(
        async (_event, session) => {
          await setData(session);
        }
      );
      return authListener;
    };

    const authListenerPromise = setupAuth();

    return () => {
      authListenerPromise.then(authListener => {
        authListener?.subscription?.unsubscribe();
      });
    };
  }, [enableSubscription, initialSession]);

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
