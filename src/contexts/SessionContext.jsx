import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { getSessionHistory } from '@/lib/storage';
import { useAuth } from './AuthContext';
import logger from '@/lib/logger';

const SessionContext = createContext();

export const useSession = () => useContext(SessionContext);

export const SessionProvider = ({ children }) => {
  const { user } = useAuth();
  const [sessionHistory, setSessionHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [usageLimitExceeded, setUsageLimitExceeded] = useState(false);

  const fetchSessionHistory = useCallback(async () => {
    // Only fetch history for authenticated, non-anonymous users
    if (!user || user.is_anonymous) {
      setSessionHistory([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await getSessionHistory(user.id);
      setSessionHistory(data || []);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch session history');
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchSessionHistory();
  }, [fetchSessionHistory]);

  const addSession = (newSession) => {
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

  const value = {
    sessionHistory,
    loading,
    error,
    usageLimitExceeded,
    setUsageLimitExceeded,
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
