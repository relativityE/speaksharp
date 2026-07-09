/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { mockAuth, mockProfile, mockIsFetching } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockProfile: vi.fn(),
  mockIsFetching: vi.fn(),
}));
vi.mock('../../contexts/AuthProvider', () => ({ useAuthProvider: mockAuth }));
vi.mock('../useUserProfile', () => ({ useUserProfile: mockProfile }));
vi.mock('@tanstack/react-query', () => ({ useIsFetching: mockIsFetching }));

import { useCriticalQueries } from '../useCriticalQueries';

describe('useCriticalQueries — readiness resolution', () => {
  beforeEach(() => {
    mockAuth.mockReset(); mockProfile.mockReset(); mockIsFetching.mockReset();
    document.documentElement.removeAttribute('data-services-ready');
  });
  afterEach(() => { document.documentElement.removeAttribute('data-services-ready'); });

  it('resolves (and signals data-services-ready) when there is no session and nothing is fetching', () => {
    mockAuth.mockReturnValue({ session: null, loading: false });
    mockProfile.mockReturnValue({ isLoading: false, data: null });
    mockIsFetching.mockReturnValue(0);
    const { result } = renderHook(() => useCriticalQueries());
    expect(result.current.isResolved).toBe(true);
    expect(result.current.hasSession).toBe(false);
    expect(document.documentElement.getAttribute('data-services-ready')).toBe('true');
  });

  it('is NOT resolved while auth is still loading', () => {
    mockAuth.mockReturnValue({ session: null, loading: true });
    mockProfile.mockReturnValue({ isLoading: false, data: null });
    mockIsFetching.mockReturnValue(0);
    const { result } = renderHook(() => useCriticalQueries());
    expect(result.current.isResolved).toBe(false);
    expect(result.current.authLoading).toBe(true);
  });

  it('resolves when a session exists AND its profile has loaded', () => {
    mockAuth.mockReturnValue({ session: { user: { id: 'u' } }, loading: false });
    mockProfile.mockReturnValue({ isLoading: false, data: { id: 'p' } });
    mockIsFetching.mockReturnValue(0);
    const { result } = renderHook(() => useCriticalQueries());
    expect(result.current.isResolved).toBe(true);
    expect(result.current.hasSession).toBe(true);
    expect(result.current.hasProfile).toBe(true);
  });

  it('is NOT resolved when a session exists but its profile is still loading', () => {
    mockAuth.mockReturnValue({ session: { user: { id: 'u' } }, loading: false });
    mockProfile.mockReturnValue({ isLoading: true, data: undefined });
    mockIsFetching.mockReturnValue(0);
    const { result } = renderHook(() => useCriticalQueries());
    expect(result.current.isResolved).toBeFalsy(); // undefined via `profile && !profileLoading` short-circuit
  });

  it('is NOT resolved while a background query is still fetching', () => {
    mockAuth.mockReturnValue({ session: null, loading: false });
    mockProfile.mockReturnValue({ isLoading: false, data: null });
    mockIsFetching.mockReturnValue(1);
    const { result } = renderHook(() => useCriticalQueries());
    expect(result.current.isResolved).toBe(false);
    expect(result.current.isFetching).toBe(1);
  });
});
