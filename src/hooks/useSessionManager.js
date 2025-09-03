import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import logger from '../lib/logger';
import { getSessionHistory, saveSession as saveSessionToDb, deleteSession as deleteSessionFromDb, exportData } from '../lib/storage';

export const useSessionManager = () => {
  const { user, profile } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [usageLimitExceeded, setUsageLimitExceeded] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Only fetch history for real, non-anonymous users
      if (user && !user.is_anonymous) {
        const savedSessions = await getSessionHistory(user.id);
        setSessions(savedSessions);
      } else {
        // For anonymous users or logged-out users, check session storage
        const anonymousSession = sessionStorage.getItem('anonymousSession');
        if (anonymousSession) {
          setSessions([JSON.parse(anonymousSession)]);
        } else {
          setSessions([]);
        }
      }
    } catch (err) {
      logger.error({ err }, "Error loading sessions:");
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const saveSession = async (sessionData) => {
    setError(null);
    try {
      // Handle anonymous users: save session to sessionStorage for temporary access during dev testing.
      if (user && user.is_anonymous) {
        const tempSession = { ...sessionData, id: `anon-${Date.now()}` }; // Create a temporary ID
        sessionStorage.setItem('anonymousSession', JSON.stringify(tempSession));
        setSessions([tempSession]);
        return tempSession.id;
      }

      // Handle real users
      if (!user || !profile) {
        throw new Error("Cannot save session: no user or profile available.");
      }

      const sessionWithUser = { ...sessionData, user_id: user.id };
      const { session: newSession, usageExceeded } = await saveSessionToDb(sessionWithUser, profile);

      if (usageExceeded) {
        setUsageLimitExceeded(true);
      }

      if (newSession) {
        setSessions(prevSessions => [newSession, ...prevSessions]);
        return newSession.id;
      }
      return null;
    } catch (err) {
      logger.error({ err }, "Error saving session:");
      setError(err);
      return null;
    }
  };

  const deleteSession = async (sessionId) => {
    setError(null);
    try {
      // Anonymous sessions are in sessionStorage and can't be deleted from the UI this way.
      if (user && user.is_anonymous) return;

      const success = await deleteSessionFromDb(sessionId);
      if (success) {
        setSessions(prevSessions => prevSessions.filter(s => s.id !== sessionId));
      }
    } catch (err) {
      logger.error({ err }, "Error deleting session:");
      setError(err);
    }
  };

  const exportSessions = async () => {
    setError(null);
    try {
      if (!user || user.is_anonymous) {
        throw new Error("Cannot export sessions: no real user logged in.");
      }
      const data = await exportData(user.id);
      const dataStr = JSON.stringify({
        exportDate: new Date().toISOString(),
        version: '2.0', // Updated version for Supabase export
        ...data
      }, null, 2);

      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `speaksharp-sessions-${new Date().toISOString().split('T')[0]}.json`;
      link.click();

      URL.revokeObjectURL(url);
    } catch (err) {
      logger.error({ err }, "Error exporting sessions:");
      setError(err);
    }
  };

  const clearError = () => setError(null);

  return {
    sessions,
    loading,
    error,
    saveSession,
    deleteSession,
    exportSessions,
    refreshSessions: loadSessions,
    usageLimitExceeded,
    setUsageLimitExceeded,
    clearError,
  };
};
