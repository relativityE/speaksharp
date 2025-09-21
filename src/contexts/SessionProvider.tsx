import React, { useState, useEffect, useCallback, ReactNode } from 'react';
import { getSessionHistory } from '@/lib/storage';
import { useAuth } from './useAuth';
import logger from '@/lib/logger';
import type { PracticeSession } from '@/types/session';
import { SessionContext, SessionContextValue } from './SessionContext';

interface SessionProviderProps {
  children: ReactNode;
}

export const SessionProvider = ({ children }: SessionProviderProps) => {
  const { user } = useAuth();
  const [sessionHistory, setSessionHistory] = useState<PracticeSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSessionHistory = useCallback(async () => {
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
    } catch (err: unknown) {
      logger.error({ err }, 'Failed to fetch session history');
      if (err instanceof Error) {
        setError(err);
      } else {
        setError(new Error(String(err)));
      }
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
