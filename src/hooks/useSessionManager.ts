import { useAuth } from '../contexts/AuthContext';
import logger from '../lib/logger';
import { saveSession as saveSessionToDb, deleteSession as deleteSessionFromDb, exportData } from '../lib/storage';
import type { PracticeSession } from '../types/session';

interface UseSessionManager {
  saveSession: (sessionData: Partial<PracticeSession>) => Promise<{ session: PracticeSession | null; usageExceeded: boolean }>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  exportSessions: () => Promise<void>;
}

// This hook is now "headless" and only contains the logic for actions.
// The state itself is managed in SessionContext.
export const useSessionManager = (): UseSessionManager => {
  const { user, profile } = useAuth();

  const saveSession = async (sessionData: Partial<PracticeSession>): Promise<{ session: PracticeSession | null; usageExceeded: boolean }> => {
    try {
      // Handle anonymous users: save to sessionStorage instead of DB.
      if (!user || user.is_anonymous) {
        logger.info('Saving session for anonymous user to sessionStorage.');
        const tempSession: PracticeSession = {
          ...sessionData,
          id: `anonymous-session-${Date.now()}`,
          created_at: new Date().toISOString(),
          duration: sessionData.duration || 0,
          user_id: `anon-${crypto.randomUUID()}`,
        };
        // Use sessionStorage to persist across a single session.
        sessionStorage.setItem('anonymous-session', JSON.stringify(tempSession));
        return { session: tempSession, usageExceeded: false };
      }

      // Handle real users
      if (!profile) {
        throw new Error("Cannot save session: user profile not available.");
      }

      const { session: newSession, usageExceeded } = await saveSessionToDb({ ...sessionData, user_id: user.id }, profile);

      if (newSession) {
        return { session: newSession, usageExceeded: usageExceeded || false };
      }
      return { session: null, usageExceeded: usageExceeded || false };
    } catch (err: any) {
      logger.error({ err }, "Error in useSessionManager -> saveSession:");
      return { session: null, usageExceeded: false };
    }
  };

  const deleteSession = async (sessionId: string): Promise<boolean> => {
    if (sessionId.startsWith('anonymous-session')) {
        // This is a client-side only session, nothing to delete on the server.
        // The context will handle removing it from its state.
        return true;
    }
    try {
      return await deleteSessionFromDb(sessionId);
    } catch (err: any) {
      logger.error({ err }, "Error in useSessionManager -> deleteSession:");
      return false;
    }
  };

  const exportSessions = async (): Promise<void> => {
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
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(url);
    } catch (err: any) {
      logger.error({ err }, "Error exporting sessions:");
    }
  };

  return {
    saveSession,
    deleteSession,
    exportSessions,
  };
};
