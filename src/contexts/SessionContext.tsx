import React, { createContext, useState, useContext, useEffect, useCallback, ReactNode } from 'react';
import { getSessionHistory } from '@/lib/storage';
import { useAuth } from './AuthContext';
import logger from '@/lib/logger';
import type { PracticeSession } from '@/types/session';

export interface SessionContextValue {
  sessionHistory: PracticeSession[];
  loading: boolean;
  error: Error | null;
  refreshHistory: () => Promise<void>;
  addSession: (newSession: PracticeSession) => void;
  clearAnonymousSession: () => void;
}

// The '!' is a non-null assertion, telling TypeScript that we expect
// this context to be provided, and it won't be null.
export const SessionContext = createContext<SessionContextValue | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useSession = () => {
    const context = useContext(SessionContext);
    if (context === undefined) {
        throw new Error('useSession must be used within a SessionProvider');
    }
    return context;
};

interface SessionProviderProps {
  children: ReactNode;
}

export const SessionProvider = ({ children }: SessionProviderProps) => {
  const { user } = useAuth();
  const [sessionHistory, setSessionHistory] = useState<PracticeSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSessionHistory = useCallback(async () => {
    // Handle anonymous user session from sessionStorage
    if (user && user.is_anonymous) {
      const savedSession = sessionStorage.getItem('anonymous-session');
      if (savedSession) {
        try {
          const parsedSession = JSON.parse(savedSession) as PracticeSession;
          setSessionHistory([parsedSession]);
        } catch (e) {
          logger.error(e, 'Failed to parse anonymous session from sessionStorage');
          setSessionHistory([]);
        }
      } else {
        setSessionHistory([]);
      }
      setLoading(false);
      return;
    }

    // Only fetch history for authenticated, non-anonymous users
    if (!user) {
      setSessionHistory([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await getSessionHistory(user.id);
      setSessionHistory(data || []);
    } catch (err: any) {
      logger.error({ err }, 'Failed to fetch session history');
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchSessionHistory();
  }, [fetchSessionHistory]);

  const addSession = (newSession: PracticeSession) => {
    if (!newSession || typeof newSession !== 'object') {
      logger.error({ newSession }, "addSession received invalid data type.");
      return;
    }
    setSessionHistory(prevHistory => [newSession, ...prevHistory]);
  };

  const clearAnonymousSession = () => {
      // This is used when an anonymous user has completed their one session
      // and is being prompted to sign up.
      setSessionHistory([]);
  }

  const value: SessionContextValue = {
    sessionHistory,
    loading,
    error,
    refreshHistory: fetchSessionHistory,
    addSession,
    clearAnonymousSession,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
};
