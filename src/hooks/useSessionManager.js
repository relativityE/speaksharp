import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getSessionHistory, saveSession as saveSessionToDb, deleteSession as deleteSessionFromDb, exportData } from '../lib/storage';

export const useSessionManager = () => {
  const { user } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    if (!user) {
      setSessions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const savedSessions = await getSessionHistory(user.id);
    setSessions(savedSessions);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const saveSession = async (sessionData) => {
    if (!user) {
      console.error("Cannot save session: no user logged in.");
      return null;
    }
    const sessionWithUser = { ...sessionData, user_id: user.id };
    const newSession = await saveSessionToDb(sessionWithUser);
    if (newSession) {
      setSessions(prevSessions => [newSession, ...prevSessions]);
      return newSession.id;
    }
    return null;
  };

  const deleteSession = async (sessionId) => {
    const success = await deleteSessionFromDb(sessionId);
    if (success) {
      setSessions(prevSessions => prevSessions.filter(s => s.id !== sessionId));
    }
  };

  const exportSessions = async () => {
    if (!user) {
      console.error("Cannot export sessions: no user logged in.");
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
    refreshSessions: loadSessions
  };
};
