import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // onAuthStateChange fires on initial load and whenever the auth state changes.
    // This is the single source of truth for the user's session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      const currentUser = session?.user;
      setUser(currentUser ?? null);

      // Don't try to fetch a profile for anonymous or logged-out users.
      if (currentUser && !currentUser.is_anonymous) {
        const { data: profileData } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', currentUser.id)
          .single();
        setProfile(profileData ?? null);
      } else {
        setProfile(null);
      }

      // Once the session and profile (or lack thereof) are sorted, we are done loading.
      setLoading(false);
    });

    // Cleanup the subscription when the component unmounts.
    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  const value = {
    session,
    user,
    profile,
    signOut: () => supabase.auth.signOut(),
  };

  // Do not render the rest of the app until the initial auth state has been determined.
  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
