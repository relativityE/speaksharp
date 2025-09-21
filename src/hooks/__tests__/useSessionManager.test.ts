import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSessionManager } from '../useSessionManager';
import * as AuthContext from '../../contexts/AuthContext';
import * as storage from '../../lib/storage';
import logger from '../../lib/logger';
import type { User, Session, AuthError } from '@supabase/supabase-js';
import type { UserProfile } from '../../types/user';
import type { PracticeSession } from '../../types/session';

// Mock dependencies
vi.mock('../../contexts/AuthContext');
vi.mock('../../lib/storage');
vi.mock('../../lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

const mockUseAuth = vi.mocked(AuthContext.useAuth);
const mockStorage = vi.mocked(storage);
const mockLogger = vi.mocked(logger);

// Mock browser APIs
const mockSessionStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
vi.stubGlobal('sessionStorage', mockSessionStorage);
vi.stubGlobal('crypto', { randomUUID: () => 'mock-uuid' });

// More realistic mock objects
const mockUser: User = {
  id: 'user-123',
  is_anonymous: false,
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: new Date().toISOString(),
};

const mockAnonymousUser: User = {
    id: 'anon-456',
    is_anonymous: true,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
};

const mockProfile: UserProfile = {
    id: 'profile-123',
    subscription_status: 'free',
};

const mockAuthContextValue: AuthContext.AuthContextType = {
    user: mockUser,
    profile: mockProfile,
    session: {} as Session,
    loading: false,
    is_anonymous: false,
    signOut: vi.fn(() => Promise.resolve({ error: null }))
};

type SavedSessionReturn = { session: PracticeSession | null; usageExceeded: boolean };

describe('useSessionManager', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(mockAuthContextValue);
  });

  describe('saveSession', () => {
    it('should save session to sessionStorage for anonymous users', async () => {
      mockUseAuth.mockReturnValue({ ...mockAuthContextValue, user: mockAnonymousUser, profile: null, is_anonymous: true });
      const { result } = renderHook(() => useSessionManager());
      const sessionData = { duration: 60 };

      let savedSession: SavedSessionReturn | null = null;
      await act(async () => {
        savedSession = await result.current.saveSession(sessionData);
      });

      expect(mockStorage.saveSession).not.toHaveBeenCalled();
      expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
        'anonymous-session',
        expect.stringContaining('"duration":60')
      );

      expect(savedSession).not.toBeNull();
      if (savedSession) {
        expect(savedSession.session?.id).toContain('anonymous-session');
        expect(savedSession.usageExceeded).toBe(false);
      }
    });

    it('should call saveSessionToDb for authenticated users', async () => {
      const newDbSession: PracticeSession = { id: 'new-session-1', user_id: mockUser.id, duration: 120, created_at: new Date().toISOString() };
      mockStorage.saveSession.mockResolvedValue({ session: newDbSession, usageExceeded: false });
      const { result } = renderHook(() => useSessionManager());
      const sessionData = { duration: 120 };

      let savedSession: SavedSessionReturn | null = null;
      await act(async () => {
        savedSession = await result.current.saveSession(sessionData);
      });

      expect(mockStorage.saveSession).toHaveBeenCalledWith(
        { ...sessionData, user_id: mockUser.id },
        mockProfile
      );
      expect(savedSession).not.toBeNull();
      if (savedSession) {
        expect(savedSession.session).toEqual(newDbSession);
        expect(savedSession.usageExceeded).toBe(false);
      }
    });

    it('should return usageExceeded from saveSessionToDb', async () => {
        mockStorage.saveSession.mockResolvedValue({ session: null, usageExceeded: true });
        const { result } = renderHook(() => useSessionManager());

        let savedSession: SavedSessionReturn | null = null;
        await act(async () => {
            savedSession = await result.current.saveSession({ duration: 100 });
        });

        expect(savedSession).not.toBeNull();
        if (savedSession) {
            expect(savedSession.session).toBeNull();
            expect(savedSession.usageExceeded).toBe(true);
        }
    });

    it('should log an error if user is authenticated but profile is missing', async () => {
      mockUseAuth.mockReturnValue({ ...mockAuthContextValue, profile: null });
      const { result } = renderHook(() => useSessionManager());

      let savedSession: SavedSessionReturn | null = null;
       await act(async () => {
        savedSession = await result.current.saveSession({ duration: 100 });
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: new Error("Cannot save session: user profile not available.") }),
        "Error in useSessionManager -> saveSession:"
      );
      expect(savedSession).not.toBeNull();
      if (savedSession) {
        expect(savedSession.session).toBeNull();
      }
    });
  });

  describe('deleteSession', () => {
    it('should not call DB for anonymous sessions', async () => {
      const { result } = renderHook(() => useSessionManager());
      let success;
      await act(async () => {
        success = await result.current.deleteSession('anonymous-session-123');
      });
      expect(mockStorage.deleteSession).not.toHaveBeenCalled();
      expect(success).toBe(true);
    });

    it('should call deleteSessionFromDb for authenticated users', async () => {
      mockStorage.deleteSession.mockResolvedValue(true);
      const { result } = renderHook(() => useSessionManager());
      let success;
      await act(async () => {
        success = await result.current.deleteSession('db-session-123');
      });

      expect(mockStorage.deleteSession).toHaveBeenCalledWith('db-session-123');
      expect(success).toBe(true);
    });

    it('should handle errors during deletion', async () => {
        mockStorage.deleteSession.mockRejectedValue(new Error('DB Error'));
        const { result } = renderHook(() => useSessionManager());
        let success;
        await act(async () => {
          success = await result.current.deleteSession('db-session-123');
        });

        expect(mockLogger.error).toHaveBeenCalled();
        expect(success).toBe(false);
      });
  });

  // TODO: The exportSessions tests are disabled because they cause a conflict
  // with the happy-dom test environment, leading to a "Target container is not a DOM element"
  // error. This requires further investigation into how global DOM objects are mocked.
  describe.skip('exportSessions', () => {
    it('should log an error for anonymous users', async () => {
        mockUseAuth.mockReturnValue({ ...mockAuthContextValue, user: mockAnonymousUser, profile: null, is_anonymous: true });
        const { result } = renderHook(() => useSessionManager());

        await act(async () => {
            await result.current.exportSessions();
        });

        expect(mockLogger.error).toHaveBeenCalledWith(
            expect.objectContaining({ err: new Error("Cannot export sessions: no real user logged in.") }),
            "Error exporting sessions:"
        );
    });

    it('should call exportData and trigger download for authenticated users', async () => {
        // Mock the DOM methods only for this specific test
        const link = { click: vi.fn(), download: '', href: '' };
        const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:url');
        const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(link as any);
        const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => node);
        const removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node: Node) => node);

        const exportData = { sessions: [{ id: 's1', user_id: 'user-123', created_at: 'now', duration: 60 }], transcripts: [] };
        mockStorage.exportData.mockResolvedValue(exportData);
        const { result } = renderHook(() => useSessionManager());

        await act(async () => {
            await result.current.exportSessions();
        });

        expect(mockStorage.exportData).toHaveBeenCalledWith(mockUser.id);
        expect(createObjectURLSpy).toHaveBeenCalled();
        expect(link.download).toContain('speaksharp-sessions');
        expect(link.href).toBe('blob:url');
        expect(appendChildSpy).toHaveBeenCalledWith(link);
        expect(link.click).toHaveBeenCalled();
        expect(removeChildSpy).toHaveBeenCalledWith(link);
        expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:url');

        // Restore mocks
        vi.restoreAllMocks();
    });
  });
});
