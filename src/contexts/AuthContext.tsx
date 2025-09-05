import React, { createContext, useContext, useState } from 'react';

type AuthContextType = {
  session: object | null;
  user: object | null;
  profile: object | null;
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
  // In E2E tests, a mock session can be injected into the window object.
  // This avoids a complex chain of mocks for Supabase's auth flow.
  const mockSession = (window as any).__E2E_MOCK_SESSION__;

  const [session, setSession] = useState(mockSession || null);
  const [profile, setProfile] = useState(mockSession?.user?.user_metadata || null);
  const [loading, setLoading] = useState(!mockSession); // No loading needed if session is mocked

  const signOut = async () => {
    // In a real app, you'd call supabase.auth.signOut()
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
