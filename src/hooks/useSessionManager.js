import { useAuth } from '../contexts/AuthContext';
import logger from '../lib/logger';
import { getSessionHistory, saveSession as saveSessionToDb, deleteSession as deleteSessionFromDb, exportData } from '../lib/storage';
import { useCallback } from 'react';

// This hook is now "headless" and only contains the logic for actions.
// The state itself is managed in SessionContext.
export const useSessionManager = () => {
  const { user, profile } = useAuth();

  const saveSession = async (sessionData) => {
    try {
      // Handle anonymous users: save to sessionStorage instead of DB.
      if (!user || user.is_anonymous) {
        logger.info('Saving session for anonymous user to sessionStorage.');
        const tempSession = {
          ...sessionData,
          id: `anonymous-session-${Date.now()}`,
          user_id: user.id,
        };
        // Use sessionStorage to persist across a single session.
        sessionStorage.setItem('anonymous-session', JSON.stringify(tempSession));
        return tempSession;
      }

      // Handle real users
      if (!profile) {
        throw new Error("Cannot save session: user profile not available.");
      }

      const { session: newSession, usageExceeded } = await saveSessionToDb(sessionData, profile);

      if (newSession) {
        return { session: newSession, usageExceeded: usageExceeded || false };
      }
      return { session: null, usageExceeded: false };
    } catch (err) {
      logger.error({ err }, "Error in useSessionManager -> saveSession:");
      return { session: null, usageExceeded: false };
    }
  };

  const deleteSession = async (sessionId) => {
    if (sessionId.startsWith('anonymous-session')) {
        return false;
    }
    try {
      // Anonymous sessions are in-memory and don't need to be deleted from DB.
      if (sessionId.startsWith('anon-')) {
        return true;
      }
      return await deleteSessionFromDb(sessionId);
    } catch (err) {
      logger.error({ err }, "Error in useSessionManager -> deleteSession:");
      return false;
    }
  };

  const exportSessions = async () => {
    try {
      if (!user || user.is_anonymous) {
        throw new Error("Cannot export sessions: no real user logged in.");
      }
      const data = await exportData(user.id);
      const dataStr = JSON.stringify({
        exportDate: new Date().toISOString(),
        version: '2.0',
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
    }
  };

  return {
    saveSession,
    deleteSession,
    exportSessions,
  };
};
