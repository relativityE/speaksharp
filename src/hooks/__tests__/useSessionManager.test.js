import { renderHook, act } from '@testing-library/react';
import { useSessionManager } from '../useSessionManager';
import * as storage from '../../lib/storage';
import { useAuth } from '../../contexts/AuthContext';
import { vi } from 'vitest';

// Mock dependencies
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn(),
    deleteSession: vi.fn(),
    exportData: vi.fn(),
}));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: vi.fn(),
}));

const mockUser = { id: 'test-user-123', is_anonymous: false };
const mockProfile = { id: 'test-user-123', subscription_status: 'free' };

describe('useSessionManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuth.mockReturnValue({ user: mockUser, profile: mockProfile });
    });

    describe('saveSession', () => {
        it('should call storage.saveSession for an authenticated user and return the session', async () => {
            const mockSessionData = { transcript: 'A new recording' };
            const expectedSession = { id: 'session-1', ...mockSessionData };
            storage.saveSession.mockResolvedValue({ session: expectedSession, error: null });

            const { result } = renderHook(() => useSessionManager());

            let returnedValue;
            await act(async () => {
                returnedValue = await result.current.saveSession(mockSessionData);
            });

            expect(storage.saveSession).toHaveBeenCalledWith(mockSessionData, mockProfile);
            expect(returnedValue).toEqual({ session: expectedSession, usageExceeded: false });
        });

        it('should NOT call storage.saveSession for a null (anonymous) user but return a temporary session', async () => {
            useAuth.mockReturnValue({ user: null, profile: null }); // Test the real anonymous case
            const mockSessionData = { transcript: 'An anonymous recording' };

            const { result } = renderHook(() => useSessionManager());

            let returnedValue;
            await act(async () => {
                returnedValue = await result.current.saveSession(mockSessionData);
            });

            expect(storage.saveSession).not.toHaveBeenCalled();
            expect(returnedValue).toBeDefined();
            expect(returnedValue.id.startsWith('anonymous-session')).toBe(true);
            expect(returnedValue.user_id.startsWith('anon-')).toBe(true);
            expect(returnedValue.transcript).toBe('An anonymous recording');
        });

        it('should return null if an authenticated user has no profile', async () => {
           useAuth.mockReturnValue({ user: mockUser, profile: null });
           const { result } = renderHook(() => useSessionManager());
           const mockSessionData = { transcript: 'A new recording' };

           let returnedValue;
           await act(async () => {
               returnedValue = await result.current.saveSession(mockSessionData);
           });

           expect(storage.saveSession).not.toHaveBeenCalled();
           expect(returnedValue.session).toBeNull();
        });
    });

    describe('deleteSession', () => {
        it('should call storage.deleteSession for a normal session ID', async () => {
            storage.deleteSession.mockResolvedValue(true);
            const { result } = renderHook(() => useSessionManager());

            await act(async () => {
                await result.current.deleteSession('session-123');
            });

            expect(storage.deleteSession).toHaveBeenCalledWith('session-123');
        });

        it('should NOT call storage.deleteSession for an anonymous session ID', async () => {
            const { result } = renderHook(() => useSessionManager());

            await act(async () => {
                await result.current.deleteSession('anonymous-session-abc');
            });

            expect(storage.deleteSession).not.toHaveBeenCalled();
        });
    });

    describe('exportSessions', () => {
        it('should call storage.exportData for an authenticated user', async () => {
            const mockData = [{ id: '1', transcript: 'test' }];
            storage.exportData.mockResolvedValue(mockData);

            const { result } = renderHook(() => useSessionManager());

            await act(async () => {
                await result.current.exportSessions();
            });

            expect(storage.exportData).toHaveBeenCalledWith(mockUser.id);
        });
    });
});
