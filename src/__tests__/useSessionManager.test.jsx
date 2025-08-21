import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useSessionManager } from '../hooks/useSessionManager';
import { useAuth } from '../contexts/AuthContext';
import * as storage from '../lib/storage';

// Mock the context
jest.mock('../contexts/AuthContext');

// Mock the storage module
jest.mock('../lib/storage');

const mockUser = { id: 'user-123', email: 'test@example.com' };
const mockSessions = [
  { id: 'session-1', user_id: mockUser.id, duration: 120 },
  { id: 'session-2', user_id: mockUser.id, duration: 180 },
];

const mockProfile = { id: 'user-123', subscription_status: 'free' };

describe('useSessionManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.mockReturnValue({ user: mockUser, profile: mockProfile });
  });

  it('should be in a loading state initially', () => {
    storage.getSessionHistory.mockResolvedValue([]);
    const { result } = renderHook(() => useSessionManager());
    expect(result.current.loading).toBe(true);
  });

  it('should load sessions on mount and set loading to false', async () => {
    storage.getSessionHistory.mockResolvedValue(mockSessions);
    let result;
    await act(async () => {
      const { result: r } = renderHook(() => useSessionManager());
      result = r;
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.sessions).toEqual(mockSessions);
      expect(storage.getSessionHistory).toHaveBeenCalledWith(mockUser.id);
    });
  });

  it('should save a session and add it to the list', async () => {
    storage.getSessionHistory.mockResolvedValue(mockSessions);
    const newSessionData = { duration: 90, total_words: 150 };
    const savedSession = { id: 'session-3', ...newSessionData, user_id: mockUser.id };
    storage.saveSession.mockResolvedValue({ session: savedSession, usageExceeded: false });

    const { result } = renderHook(() => useSessionManager());

    // Wait for initial load
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.saveSession(newSessionData);
    });

    expect(storage.saveSession).toHaveBeenCalledWith(
      { ...newSessionData, user_id: mockUser.id },
      mockProfile
    );
    expect(result.current.sessions).toEqual([savedSession, ...mockSessions]);
  });

  it('should delete a session and remove it from the list', async () => {
    storage.getSessionHistory.mockResolvedValue(mockSessions);
    storage.deleteSession.mockResolvedValue(true);
    const sessionIdToDelete = 'session-1';

    const { result } = renderHook(() => useSessionManager());

    // Wait for initial load
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteSession(sessionIdToDelete);
    });

    expect(storage.deleteSession).toHaveBeenCalledWith(sessionIdToDelete);
    expect(result.current.sessions).toEqual(mockSessions.filter(s => s.id !== sessionIdToDelete));
  });

  it('should not fetch sessions if there is no user', async () => {
    useAuth.mockReturnValue({ user: null });
    let result;
    await act(async () => {
      const { result: r } = renderHook(() => useSessionManager());
      result = r;
    });

    await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.sessions).toEqual([]);
    });

    expect(storage.getSessionHistory).not.toHaveBeenCalled();
  });
});
