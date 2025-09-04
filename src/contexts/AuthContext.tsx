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
  const [session] = useState({ user: { id: 'test-user' } });
  const [profile] = useState({ subscription_status: 'free' });
  const [loading] = useState(false);

  const signOut = async () => {};

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
