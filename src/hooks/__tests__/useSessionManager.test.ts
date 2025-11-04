import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSessionManager } from '../useSessionManager';
import * as useAuth from '../../contexts/useAuth';
import * as storage from '../../lib/storage';
import logger from '../../lib/logger';
import type { User, Session } from '@supabase/supabase-js';
import type { UserProfile } from '../../types/user';
import type { PracticeSession } from '../../types/session';
import { AuthContextType } from '../../contexts/AuthContext';

// Mock dependencies
vi.mock('../../contexts/useAuth');
vi.mock('../../lib/storage');
vi.mock('../../lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

const mockUseAuth = vi.mocked(useAuth.useAuth);
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
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: new Date().toISOString(),
};

const mockProfile: UserProfile = {
    id: 'profile-123',
    email: 'test@example.com',
    subscription_status: 'free',
};

const mockAuthContextValue: AuthContextType = {
    user: mockUser,
    profile: mockProfile,
    session: {} as Session,
    loading: false,
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    setSession: vi.fn()
};

describe('useSessionManager', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(mockAuthContextValue);
  });

  describe('saveSession', () => {
    it('should call saveSessionToDb for authenticated users', async () => {
      const newDbSession: PracticeSession = { id: 'new-session-1', user_id: mockUser.id, duration: 120, created_at: new Date().toISOString() };
      mockStorage.saveSession.mockResolvedValue({ session: newDbSession, usageExceeded: false });
      const { result } = renderHook(() => useSessionManager());
      const sessionData = { duration: 120 };

      await act(async () => {
        const savedSession = await result.current.saveSession(sessionData);
        expect(savedSession).not.toBeNull();
        if (savedSession) {
          expect(savedSession.session).toEqual(newDbSession);
          expect(savedSession.usageExceeded).toBe(false);
        }
      });

      expect(mockStorage.saveSession).toHaveBeenCalledExactlyOnceWith(
        { ...sessionData, user_id: mockUser.id },
        mockProfile
      );
    });

    it('should return usageExceeded from saveSessionToDb', async () => {
        mockStorage.saveSession.mockResolvedValue({ session: null, usageExceeded: true });
        const { result } = renderHook(() => useSessionManager());

        await act(async () => {
            const savedSession = await result.current.saveSession({ duration: 100 });
            expect(savedSession).not.toBeNull();
            if (savedSession) {
                expect(savedSession.session).toBeNull();
                expect(savedSession.usageExceeded).toBe(true);
            }
        });
    });

    it('should log an error if user is authenticated but profile is missing', async () => {
      mockUseAuth.mockReturnValue({ ...mockAuthContextValue, profile: null });
      const { result } = renderHook(() => useSessionManager());

      await act(async () => {
        const savedSession = await result.current.saveSession({ duration: 100 });
        expect(savedSession).not.toBeNull();
        if (savedSession) {
          expect(savedSession.session).toBeNull();
        }
      });

      expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ err: new Error("Cannot save session: user profile not available.") }),
        "Error in useSessionManager -> saveSession:"
      );
    });
  });

  describe('deleteSession', () => {
    it('should call deleteSessionFromDb for authenticated users', async () => {
      mockStorage.deleteSession.mockResolvedValue(true);
      const { result } = renderHook(() => useSessionManager());
      let success;
      await act(async () => {
        success = await result.current.deleteSession('db-session-123');
      });

      expect(mockStorage.deleteSession).toHaveBeenCalledExactlyOnceWith('db-session-123');
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

    it('should do nothing for anonymous sessions but return true', async () => {
        mockUseAuth.mockReturnValue({ ...mockAuthContextValue, user: { ...mockUser, is_anonymous: true } });
        const { result } = renderHook(() => useSessionManager());
        let success;
        await act(async () => {
            success = await result.current.deleteSession('anonymous-session-123');
        });
        expect(mockStorage.deleteSession).not.toHaveBeenCalled();
        expect(success).toBe(true);
    });
  });

  describe('Anonymous User Flow', () => {
    beforeEach(() => {
        mockUseAuth.mockReturnValue({ ...mockAuthContextValue, user: { ...mockUser, is_anonymous: true } });
    });

    it('saveSession should save to sessionStorage for anonymous users', async () => {
        const { result } = renderHook(() => useSessionManager());
        const sessionData = { duration: 60 };

        await act(async () => {
            await result.current.saveSession(sessionData);
        });

        expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
            'anonymous-session',
            expect.any(String)
        );
        expect(mockStorage.saveSession).not.toHaveBeenCalled();
    });
  });

  describe('exportSessions', () => {
  // Set up proper DOM mocks before each test
  beforeEach(() => {
    // Mock URL object methods
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();

    // Mock document.createElement to return a proper mock element, avoiding recursion
    const originalCreateElement = document.createElement;
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'a') {
        return {
          click: vi.fn(),
          download: '',
          href: '',
          style: {},
        } as unknown as HTMLAnchorElement;
      }
      return originalCreateElement.call(document, tagName);
    });

    // Mock document.body methods
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => node);
    vi.spyOn(document.body, 'removeChild').mockImplementation((node: Node) => node);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call exportData and trigger download for authenticated users', async () => {
    const exportData = {
      sessions: [{
        id: 's1',
        user_id: 'user-123',
        created_at: 'now',
        duration: 60
      }],
      transcripts: []
    };

    mockStorage.exportData.mockResolvedValue(exportData);
    const { result } = renderHook(() => useSessionManager());

    await act(async () => {
      await result.current.exportSessions();
    });

    // Verify the export flow
    expect(mockStorage.exportData).toHaveBeenCalledExactlyOnceWith(mockUser.id);
    expect(global.URL.createObjectURL).toHaveBeenCalled();

    expect(document.createElement).toHaveBeenCalledWith('a');
    expect(document.body.appendChild).toHaveBeenCalled();
    expect(document.body.removeChild).toHaveBeenCalled();
    expect(global.URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:mock-url');
  });

  it('should handle export errors gracefully', async () => {
    mockStorage.exportData.mockRejectedValue(new Error('Export failed'));
    const { result } = renderHook(() => useSessionManager());

    await act(async () => {
      await result.current.exportSessions();
    });

    expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        err: expect.any(Error)
      }),
      "Error exporting sessions:"
    );
  });
});
});