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
    // Handle the 'dev' user role for testing purposes
    if (import.meta.env.VITE_DEV_USER === 'true') {
      const devUser = {
        id: 'dev-user-id',
        email: 'dev@example.com',
        aud: 'authenticated',
        role: 'authenticated',
      };
      const devSession = {
        access_token: 'dev-access-token',
        refresh_token: 'dev-refresh-token',
        user: devUser,
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };
      const devProfile = {
        id: 'dev-user-id',
        subscription_status: 'premium',
      };

      setSession(devSession as any);
      setProfile(devProfile);
      setLoading(false);
      return; // Skip real auth logic for dev user
    }

    const setData = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Error getting session:", error);
      } else if (session?.user) {
        const userProfile = await getProfileFromDb(session.user.id);
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
          const userProfile = await getProfileFromDb(newSession.user.id);
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
