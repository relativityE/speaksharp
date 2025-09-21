import { createContext } from 'react';
import { Session, User, AuthError } from '@supabase/supabase-js';
import { UserProfile } from '../types/user';

export interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  is_anonymous: boolean;
  signOut: () => Promise<{ error: AuthError | null }>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
