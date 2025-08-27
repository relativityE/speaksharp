import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getSessionHistory, saveSession as saveSessionToDb, deleteSession as deleteSessionFromDb, exportData } from '../lib/storage';

export const useSessionManager = () => {
  const { user, profile } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usageLimitExceeded, setUsageLimitExceeded] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
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
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const saveSession = async (sessionData) => {
    // Handle anonymous users: save session to sessionStorage for temporary access during dev testing.
    if (user && user.is_anonymous) {
      const tempSession = { ...sessionData, id: `anon-${Date.now()}` }; // Create a temporary ID
      sessionStorage.setItem('anonymousSession', JSON.stringify(tempSession));
      setSessions([tempSession]);
      return tempSession.id;
    }

    // Handle real users
    if (!user || !profile) {
      console.error("Cannot save session: no user or profile available.");
      return null;
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
  };

  const deleteSession = async (sessionId) => {
    // Anonymous sessions are in sessionStorage and can't be deleted from the UI this way.
    if (user && user.is_anonymous) return;

    const success = await deleteSessionFromDb(sessionId);
    if (success) {
      setSessions(prevSessions => prevSessions.filter(s => s.id !== sessionId));
    }
  };

  const exportSessions = async () => {
    if (!user || user.is_anonymous) {
      console.error("Cannot export sessions: no real user logged in.");
      return;
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
  };

  return {
    sessions,
    loading,
    saveSession,
    deleteSession,
    exportSessions,
    refreshSessions: loadSessions,
    usageLimitExceeded,
    setUsageLimitExceeded
  };
};
