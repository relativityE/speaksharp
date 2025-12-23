/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { renderHook, act } from '@testing-library/react';
import { useSessionManager } from '../useSessionManager';
import { useAuthProvider } from '../../contexts/AuthProvider';
import { useUserProfile } from '../useUserProfile';
import { saveSession, deleteSession, exportData } from '../../lib/storage';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../contexts/AuthProvider', () => ({
  useAuthProvider: vi.fn(),
}));

vi.mock('../useUserProfile', () => ({
  useUserProfile: vi.fn(),
}));

vi.mock('../../lib/storage', () => ({
  saveSession: vi.fn(),
  deleteSession: vi.fn(),
  exportData: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useSessionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('should save to sessionStorage for anonymous user', async () => {
    (useAuthProvider as any).mockReturnValue({ user: { is_anonymous: true } });
    (useUserProfile as any).mockReturnValue({ data: null });

    const { result } = renderHook(() => useSessionManager());

    const sessionData = { duration: 60 };
    const { session, usageExceeded } = await result.current.saveSession(sessionData);

    expect(session).not.toBeNull();
    expect(session?.id).toContain('anonymous-session');
    expect(sessionStorage.getItem('anonymous-session')).toBeTruthy();
    expect(saveSession).not.toHaveBeenCalled();
    expect(usageExceeded).toBe(false);
  });

  it('should save to DB for authenticated user', async () => {
    const mockUser = { id: 'test-user', is_anonymous: false };
    const mockProfile = { id: 'test-user' };
    const mockSession = { id: 'session-1', user_id: 'test-user' };

    (useAuthProvider as any).mockReturnValue({ user: mockUser });
    (useUserProfile as any).mockReturnValue({ data: mockProfile });
    (saveSession as any).mockResolvedValue({ session: mockSession, usageExceeded: false });

    const { result } = renderHook(() => useSessionManager());

    const { session } = await result.current.saveSession({});

    expect(session).toEqual(mockSession);
    expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'test-user' }), mockProfile);
  });

  it('should handle delete session', async () => {
    (deleteSession as any).mockResolvedValue(true);

    const { result } = renderHook(() => useSessionManager());

    const success = await result.current.deleteSession('session-1');

    expect(success).toBe(true);
    expect(deleteSession).toHaveBeenCalledWith('session-1');
  });

  it('should handle anonymous session delete (client-side only)', async () => {
    const { result } = renderHook(() => useSessionManager());

    const success = await result.current.deleteSession('anonymous-session-123');

    expect(success).toBe(true);
    expect(deleteSession).not.toHaveBeenCalled();
  });
});
