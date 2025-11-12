import { createContext } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { UserProfile } from '@/types/user';

export interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => void;
  setSession: (session: Session | null) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
