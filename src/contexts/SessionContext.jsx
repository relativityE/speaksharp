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

  const fetchSessionHistory = useCallback(async () => {
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
    setSessionHistory(prevHistory => [newSession, ...prevHistory]);
  };

  const value = {
    sessionHistory,
    loading,
    error,
    refreshHistory: fetchSessionHistory,
    addSession,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
};
