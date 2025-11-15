import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSessionManager } from '../useSessionManager';
import * as AuthProvider from '../../contexts/AuthProvider';
import * as storage from '../../lib/storage';
import logger from '../../lib/logger';
import type { User, Session } from '@supabase/supabase-js';
import type { PracticeSession } from '../../types/session';
import { AuthContextType } from '../../contexts/AuthProvider';
import { useUserProfile } from '../useUserProfile';
import { createQueryWrapper } from '../../../tests/test-utils/queryWrapper';
import { makeQuerySuccess } from '../../../tests/test-utils/queryMocks';

// Mock dependencies
vi.mock('../../contexts/AuthProvider');
vi.mock('../../lib/storage');
vi.mock('../../lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));
vi.mock('../useUserProfile');

const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);
const mockStorage = vi.mocked(storage);
const mockLogger = vi.mocked(logger);
const mockUseUserProfile = vi.mocked(useUserProfile);


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

const mockAuthContextValue: AuthContextType = {
    user: mockUser,
    session: {} as Session,
    profile: { id: mockUser.id, subscription_status: 'free' },
    loading: false,
    signOut: vi.fn(() => Promise.resolve()),
    setSession: vi.fn()
};

describe('useSessionManager', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    mockUseAuthProvider.mockReturnValue(mockAuthContextValue);
    mockUseUserProfile.mockReturnValue(makeQuerySuccess({ id: mockUser.id, subscription_status: 'free' }));
  });

  describe('saveSession', () => {
    it('should call saveSessionToDb for authenticated users', async () => {
      const newDbSession: PracticeSession = { id: 'new-session-1', user_id: mockUser.id, duration: 120, created_at: new Date().toISOString() };
      mockStorage.saveSession.mockResolvedValue({ session: newDbSession, usageExceeded: false });
      const { result } = renderHook(() => useSessionManager(), { wrapper: createQueryWrapper() });
      const sessionData = { duration: 120 };

      await act(async () => {
        const savedSession = await result.current.saveSession(sessionData);
        expect(savedSession).not.toBeNull();
        if (savedSession) {
          expect(savedSession.session).toEqual(newDbSession);
          expect(savedSession.usageExceeded).toBe(false);
        }
      });

      expect(mockStorage.saveSession).toHaveBeenCalledWith(
        { ...sessionData, user_id: mockUser.id },
        expect.anything() // profile is now fetched via useUserProfile, so we just check that it's there
      );
    });

    it('should return usageExceeded from saveSessionToDb', async () => {
        mockStorage.saveSession.mockResolvedValue({ session: null, usageExceeded: true });
        const { result } = renderHook(() => useSessionManager(), { wrapper: createQueryWrapper() });

        await act(async () => {
            const savedSession = await result.current.saveSession({ duration: 100 });
            expect(savedSession).not.toBeNull();
            if (savedSession) {
                expect(savedSession.session).toBeNull();
                expect(savedSession.usageExceeded).toBe(true);
            }
        });
    });
  });

  describe('deleteSession', () => {
    it('should call deleteSessionFromDb for authenticated users', async () => {
      mockStorage.deleteSession.mockResolvedValue(true);
      const { result } = renderHook(() => useSessionManager(), { wrapper: createQueryWrapper() });
      let success;
      await act(async () => {
        success = await result.current.deleteSession('db-session-123');
      });

      expect(mockStorage.deleteSession).toHaveBeenCalledExactlyOnceWith('db-session-123');
      expect(success).toBe(true);
    });

    it('should handle errors during deletion', async () => {
        mockStorage.deleteSession.mockRejectedValue(new Error('DB Error'));
        const { result } = renderHook(() => useSessionManager(), { wrapper: createQueryWrapper() });
        let success;
        await act(async () => {
          success = await result.current.deleteSession('db-session-123');
        });

        expect(mockLogger.error).toHaveBeenCalled();
        expect(success).toBe(false);
      });

    it('should do nothing for anonymous sessions but return true', async () => {
        mockUseAuthProvider.mockReturnValue({ ...mockAuthContextValue, user: { ...mockUser, is_anonymous: true } });
        const { result } = renderHook(() => useSessionManager(), { wrapper: createQueryWrapper() });
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
        mockUseAuthProvider.mockReturnValue({ ...mockAuthContextValue, user: { ...mockUser, is_anonymous: true } });
    });

    it('saveSession should save to sessionStorage for anonymous users', async () => {
        const { result } = renderHook(() => useSessionManager(), { wrapper: createQueryWrapper() });
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
    const { result } = renderHook(() => useSessionManager(), { wrapper: createQueryWrapper() });

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
    const { result } = renderHook(() => useSessionManager(), { wrapper: createQueryWrapper() });

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
