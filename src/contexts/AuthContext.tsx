// src/contexts/AuthContext.tsx - Debug Version
import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Session, User, AuthChangeEvent } from '@supabase/supabase-js';

type Profile = {
  id: string;
  subscription_status: 'free' | 'pro';
};

type AuthContextType = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
});

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

const getProfileFromDb = async (user_id: string): Promise<Profile | null> => {
  try {
    console.log('🔍 Fetching profile for user:', user_id);
    const { data, error } = await supabase.from('user_profiles').select('*').eq('id', user_id).single();

    if (error) {
      console.error('❌ Error fetching profile:', error);
      return null;
    }

    console.log('✅ Profile fetched:', data);
    return data;
  } catch (err) {
    console.error('💥 Exception in getProfileFromDb:', err);
    return null;
  }
};

import { ReactNode } from 'react';

type AuthProviderProps = {
  children: ReactNode;
  initialSession?: Session | null;
};

export function AuthProvider({ children, initialSession = null }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(initialSession);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(!initialSession);

  useEffect(() => {
    const handleAuthChange = async (session) => {
      setLoading(true);
      setSession(session);
      let userProfile = null;

      if (session?.user) {
        console.log(`[Auth] Session found for user ${session.user.id}. Fetching profile.`);
        userProfile = await getProfileFromDb(session.user.id);

        if (userProfile) {
          console.log(`[Auth] Profile set:`, userProfile);
        } else {
          console.warn(`[Auth] No profile found for user ${session.user.id}`);
        }
      } else {
        console.log('[Auth] No session or user, clearing profile.');
      }

      setProfile(userProfile);
      setLoading(false);
    };

    // Handle the initial state, whether from a mock or Supabase
    if (initialSession) {
      console.log('[Auth] Using initial (mock) session.');
      handleAuthChange(initialSession);
    } else {
      console.log('[Auth] No initial session, fetching from Supabase.');
      supabase.auth.getSession().then(({ data: { session } }) => {
        handleAuthChange(session);
      });
    }

    // Listen for subsequent auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log(`[Auth] Auth state changed, event: ${event}`);
      handleAuthChange(session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [initialSession]);

  const signOut = async () => {
    try {
      console.log('🚪 Signing out...');
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      console.log('✅ Signed out successfully');
    } catch (err) {
      console.error('💥 Error signing out:', err);
    }
  };

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signOut,
  };

  console.log('🔄 AuthProvider rendering with:', {
    hasSession: !!session,
    hasUser: !!session?.user,
    hasProfile: !!profile,
    loading
  });

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
