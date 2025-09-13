// src/contexts/AuthContext.tsx - Debug Version
import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Session, User, AuthChangeEvent } from '@supabase/supabase-js';

type Profile = {
  id: string;
  subscription_status: 'free' | 'pro' | 'premium';
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
    // If a session is injected (e.g. in E2E tests), don't run the initial fetch.
    if (initialSession) {
        console.log('✅ AuthProvider initialized with injected session.');
        return;
    }

    console.log('🚀 AuthProvider useEffect starting');

    const setData = async () => {
      try {
        console.log('📡 Getting initial session...');
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          console.error("❌ Error getting session:", error);
          setSession(null);
          setProfile(null);
        } else {
          console.log('📝 Initial session:', session ? 'exists' : 'null');

          if (session?.user) {
            console.log('👤 User found, fetching profile...');
            const userProfile = await getProfileFromDb(session.user.id);

            // For local development, allow overriding the subscription status to 'premium'
            if (userProfile && import.meta.env.DEV && import.meta.env.VITE_DEV_PREMIUM_ACCESS === 'true') {
              console.log("🔧 Developer premium access override enabled.");
              userProfile.subscription_status = 'premium';
            }

            setProfile(userProfile);
            console.log('✅ Profile set:', userProfile);
          } else {
            console.log('❌ No user in session');
            setProfile(null);
          }

          setSession(session);
        }
      } catch (err) {
        console.error('💥 Exception in setData:', err);
        setSession(null);
        setProfile(null);
      } finally {
        console.log('✅ Initial auth setup complete, setting loading to false');
        setLoading(false);
      }
    };

    setData();

    console.log('🎧 Setting up auth state listener...');
    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, newSession: Session | null) => {
        console.log(`🔄 Auth state changed: ${event}`, newSession ? 'session exists' : 'no session');

        setSession(newSession);

        if (newSession?.user) {
          console.log('👤 New session has user, fetching profile...');
          setLoading(true);

          try {
            const userProfile = await getProfileFromDb(newSession.user.id);

            // For local development, allow overriding the subscription status to 'premium'
            if (userProfile && import.meta.env.DEV && import.meta.env.VITE_DEV_PREMIUM_ACCESS === 'true') {
              console.log("🔧 Developer premium access override enabled.");
              userProfile.subscription_status = 'premium';
            }

            setProfile(userProfile);
            console.log('✅ Profile updated:', userProfile);
          } catch (err) {
            console.error('💥 Exception updating profile:', err);
            setProfile(null);
          } finally {
            setLoading(false);
            console.log('✅ Auth state change handling complete');
          }
        } else {
          console.log('❌ No user in new session, clearing profile');
          setProfile(null);
          setLoading(false);
        }
      }
    );

    return () => {
      console.log('🧹 Cleaning up auth listener');
      listener?.subscription.unsubscribe();
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
