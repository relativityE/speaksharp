import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSessionManager } from '../useSessionManager';

// Mock dependencies
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// Mock the actual exported functions from storage
vi.mock('../../lib/storage', () => ({
  getSessionHistory: vi.fn(),
  saveSession: vi.fn(),
  deleteSession: vi.fn(),
  exportData: vi.fn(),
}));

// Import mocked dependencies so we can control them in tests
import { useAuth } from '../../contexts/AuthContext';
import { getSessionHistory, saveSession, deleteSession } from '../../lib/storage';

const mockUser = { id: 'user-123' };
const mockProfile = { subscription_status: 'free' };
const mockSessions = [
  { id: 'session-1', transcript: 'Hello world' },
  { id: 'session-2', transcript: 'Another session' },
];

describe('useSessionManager', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Default mock implementation for a logged-in user
    useAuth.mockReturnValue({ user: mockUser, profile: mockProfile });
    getSessionHistory.mockResolvedValue(mockSessions);
  });

  it('should initialize with loading true and empty sessions', () => {
    const { result } = renderHook(() => useSessionManager());
    expect(result.current.loading).toBe(true);
    expect(result.current.sessions).toEqual([]);
  });

  it('should fetch and set sessions for a logged-in user on mount', async () => {
    const { result, waitForNextUpdate } = renderHook(() => useSessionManager());

    await act(async () => {
        // The hook fetches on mount, wait for state update
        await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(getSessionHistory).toHaveBeenCalledWith(mockUser.id);
    expect(result.current.loading).toBe(false);
    expect(result.current.sessions).toEqual(mockSessions);
  });

  it('should not fetch sessions if there is no user', async () => {
    useAuth.mockReturnValue({ user: null, profile: null });
    const { result } = renderHook(() => useSessionManager());

    await act(async () => {});

    expect(getSessionHistory).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.sessions).toEqual([]);
  });

  it('should save a new session and add it to the list', async () => {
    const { result } = renderHook(() => useSessionManager());
    // Wait for initial load
    await act(async () => {});

    const newSessionData = { transcript: 'A new recording' };
    const savedSession = { id: 'session-3', ...newSessionData, user_id: mockUser.id };

    saveSession.mockResolvedValue({ session: savedSession, usageExceeded: false });

    let newSessionId;
    await act(async () => {
      newSessionId = await result.current.saveSession(newSessionData);
    });

    expect(saveSession).toHaveBeenCalledWith({ ...newSessionData, user_id: mockUser.id }, mockProfile);
    expect(result.current.sessions).toEqual([savedSession, ...mockSessions]);
    expect(newSessionId).toBe(savedSession.id);
    expect(result.current.usageLimitExceeded).toBe(false);
  });

  it('should set usageLimitExceeded flag when saving fails due to usage', async () => {
    const { result } = renderHook(() => useSessionManager());
    const newSessionData = { transcript: 'This one will fail' };

    saveSession.mockResolvedValue({ session: null, usageExceeded: true });

    await act(async () => {
      await result.current.saveSession(newSessionData);
    });

    expect(result.current.usageLimitExceeded).toBe(true);
  });

  it('should delete a session and remove it from the list', async () => {
    const { result } = renderHook(() => useSessionManager());
    const sessionIdToDelete = 'session-1';

    // Wait for initial load
    await act(async () => {});

    deleteSession.mockResolvedValue(true);

    await act(async () => {
      await result.current.deleteSession(sessionIdToDelete);
    });

    expect(deleteSession).toHaveBeenCalledWith(sessionIdToDelete);
    expect(result.current.sessions.find(s => s.id === sessionIdToDelete)).toBeUndefined();
    expect(result.current.sessions.length).toBe(mockSessions.length - 1);
  });
});
