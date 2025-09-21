import { createContext } from 'react';
import type { PracticeSession } from '@/types/session';

export interface SessionContextValue {
  sessionHistory: PracticeSession[];
  loading: boolean;
  error: Error | null;
  refreshHistory: () => Promise<void>;
  addSession: (newSession: PracticeSession) => void;
  clearAnonymousSession: () => void;
}

export const SessionContext = createContext<SessionContextValue | undefined>(undefined);
