import { renderHook } from '@testing-library/react';
import { useSessionManager } from '../useSessionManager';
import { useAuthProvider } from '../../contexts/AuthProvider';
import { useUserProfile } from '../useUserProfile';
import { saveSession, deleteSession, updateSession } from '../../lib/storage';
import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// Mock dependencies
vi.mock('../../contexts/AuthProvider', () => ({
  useAuthProvider: vi.fn(),
}));

vi.mock('../useUserProfile', () => ({
  useUserProfile: vi.fn(),
}));

vi.mock('../../lib/storage', () => ({
  saveSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  exportData: vi.fn(),
}));



describe('useSessionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('should save to sessionStorage for anonymous user', async () => {
    (useAuthProvider as unknown as Mock).mockReturnValue({ user: { is_anonymous: true } });
    (useUserProfile as unknown as Mock).mockReturnValue({ data: null });

    const { result } = renderHook(() => useSessionManager(), { wrapper: createWrapper() });

    const sessionData = { duration: 60 };
    const { session, usageExceeded } = await result.current.saveSession(sessionData, 'native');

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

    (useAuthProvider as unknown as Mock).mockReturnValue({ user: mockUser });
    (useUserProfile as unknown as Mock).mockReturnValue({ data: mockProfile });
    (saveSession as unknown as Mock).mockResolvedValue({ session: mockSession, usageExceeded: false });

    const { result } = renderHook(() => useSessionManager(), { wrapper: createWrapper() });

    const { session } = await result.current.saveSession({}, 'native');

    expect(session).toEqual(mockSession);
    expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'test-user' }), mockProfile, 'native');
  });

  it('invalidates BOTH session-history and single-session detail caches on authenticated save', async () => {
    const mockUser = { id: 'test-user', is_anonymous: false };
    const mockProfile = { id: 'test-user' };
    const mockSession = { id: 'session-1', user_id: 'test-user' };

    (useAuthProvider as unknown as Mock).mockReturnValue({ user: mockUser });
    (useUserProfile as unknown as Mock).mockReturnValue({ data: mockProfile });
    (saveSession as unknown as Mock).mockResolvedValue({ session: mockSession, usageExceeded: false });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useSessionManager(), { wrapper });
    await result.current.saveSession({}, 'native');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sessionHistory'] });
    // Regression (P0 #29): the analytics detail view reads useSession(['session', id]),
    // which has a 5-min staleTime. Without invalidating it the detail kept serving the
    // record-start placeholder transcript (' '), so the detail transcript rendered empty
    // even though the row was saved. Mode-agnostic (Native + Private).
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['session'] });
  });

  it('invalidates the single-session detail cache when updating an existing session', async () => {
    const mockUser = { id: 'test-user', is_anonymous: false };
    const mockProfile = { id: 'test-user' };

    (useAuthProvider as unknown as Mock).mockReturnValue({ user: mockUser });
    (useUserProfile as unknown as Mock).mockReturnValue({ data: mockProfile });
    (updateSession as unknown as Mock).mockResolvedValue({ success: true });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useSessionManager(), { wrapper });
    await result.current.saveSession({ id: 'session-1', duration: 42 }, 'native');

    expect(updateSession).toHaveBeenCalledWith('session-1', expect.objectContaining({ user_id: 'test-user' }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['session'] });
  });

  it('should handle delete session', async () => {
    (deleteSession as unknown as Mock).mockResolvedValue(true);

    const { result } = renderHook(() => useSessionManager(), { wrapper: createWrapper() });

    const success = await result.current.deleteSession('session-1');

    expect(success).toBe(true);
    expect(deleteSession).toHaveBeenCalledWith('session-1');
  });

  it('should handle anonymous session delete (client-side only)', async () => {
    const { result } = renderHook(() => useSessionManager(), { wrapper: createWrapper() });

    const success = await result.current.deleteSession('anonymous-session-123');

    expect(success).toBe(true);
    expect(deleteSession).not.toHaveBeenCalled();
  });
});
