import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient'; // Ensure you have this file
import { Session } from '@supabase/supabase-js';

type Profile = {
  id: string;
  subscription_status: 'free' | 'pro' | 'premium';
  // Add other profile properties as needed
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

// A helper function to get the profile from the database
const getProfile = async (user_id: string): Promise<Profile | null> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user_id)
    .single();

  if (error) {
    console.error('Error fetching profile:', error);
    return null;
  }
  return data as Profile;
};


export function AuthProvider({ children }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const setData = async () => {
      // Check for E2E mock session first
      if (window.__E2E_MOCK_SESSION__) {
        const mockSession = window.__E2E_MOCK_SESSION__;
        setSession(mockSession);
        // In E2E, the profile might be part of the user object directly
        // or we might need a mock profile table. For now, let's assume
        // the test provides the necessary profile info within the mock session.
        // The test provides `user.user_metadata.subscription_status`. Let's use that.
        const mockProfile: Profile = {
            id: mockSession.user.id,
            subscription_status: mockSession.user.user_metadata.subscription_status || 'free',
        };
        setProfile(mockProfile);
        setLoading(false);
        return;
      }

      // If no mock session, proceed with real Supabase auth
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Error getting session:", error);
        setLoading(false);
        return;
      }

      setSession(session);
      if (session?.user) {
        const userProfile = await getProfile(session.user.id);
        setProfile(userProfile);
      }
      setLoading(false);
    };

    // Only run `setData` if we are not in a test environment with a mock.
    // The E2E mock setup will be handled by the `addInitScript` in the test itself.
    if (!window.__E2E_MOCK_SESSION__) {
      setData();
    }


    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        // Ignore auth state change if we are in an E2E test with a mock session
        if (window.__E2E_MOCK_SESSION__) return;

        setSession(session);
        if (session?.user) {
          setLoading(true);
          const userProfile = await getProfile(session.user.id);
          setProfile(userProfile);
          setLoading(false);
        } else {
          // Handle user logout
          setProfile(null);
          setLoading(false);
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
