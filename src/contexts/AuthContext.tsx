import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Session } from '@supabase/supabase-js';

// Helper to get the mock session if it exists
const getMockSession = () => {
    if (typeof window !== 'undefined' && window.__E2E_MOCK_SESSION__) {
        return window.__E2E_MOCK_SESSION__;
    }
    return null;
};

const mockSession = getMockSession();

const getInitialProfile = () => {
    if (!mockSession) return null;
    return {
        id: mockSession.user.id,
        subscription_status: mockSession.user.user_metadata?.subscription_status || 'free',
    };
};

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
  loading: !mockSession, // If there's a mock, we are not loading.
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const getProfileFromDb = async (user_id: string): Promise<Profile | null> => {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user_id).single();
  if (error) {
    console.error('Error fetching profile:', error);
    return null;
  }
  return data;
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState<Session | null>(mockSession);
  const [profile, setProfile] = useState<Profile | null>(getInitialProfile());
  const [loading, setLoading] = useState<boolean>(!mockSession); // Not loading if mocked

  useEffect(() => {
    if (mockSession) {
      // Mark initialization as complete for E2E tests
      if (typeof window !== 'undefined') {
        window.__AUTH_INITIALIZED__ = true;
      }
      setLoading(false);
      return;
    }

    // ... rest of existing useEffect logic
    const setData = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Error getting session:", error);
      } else if (session?.user) {
        const userProfile = await getProfileFromDb(session.user.id);
        setProfile(userProfile);
      } else {
        // This handles the case where there is no session or user is null
        setProfile(null);
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
      {!loading && children}
    </AuthContext.Provider>
  );
}
