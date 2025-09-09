import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Session } from '@supabase/supabase-js';

type Profile = {
  id: string;
  subscription_status: 'free' | 'pro' | 'premium';
};

type AuthContextType = {
  session: Session | null;
  user: any | null; // Replace 'any' with a more specific User type if available
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

const getProfileFromDb = async (user_id: string): Promise<Profile | null> => {
  const { data, error } = await supabase.from('user_profiles').select('*').eq('id', user_id).single();
  if (error) {
    console.error('Error fetching profile:', error);
    return null;
  }
  return data;
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const setData = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Error getting session:", error);
      } else if (session?.user) {
        let userProfile = await getProfileFromDb(session.user.id);
        // For local development, allow overriding the subscription status to 'premium'
        if (userProfile && import.meta.env.DEV && import.meta.env.VITE_DEV_PREMIUM_ACCESS === 'true') {
            console.log("Developer premium access override enabled.");
            userProfile.subscription_status = 'premium';
        }
        setProfile(userProfile);
      }
      setSession(session);
      setLoading(false);
    };

    setData();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        if (newSession?.user) {
          setLoading(true);
          let userProfile = await getProfileFromDb(newSession.user.id);
          // For local development, allow overriding the subscription status to 'premium'
          if (userProfile && import.meta.env.DEV && import.meta.env.VITE_DEV_PREMIUM_ACCESS === 'true') {
            console.log("Developer premium access override enabled.");
            userProfile.subscription_status = 'premium';
          }
          setProfile(userProfile);
          setLoading(false);
        } else {
          setProfile(null);
        }
      }
    );

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

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
