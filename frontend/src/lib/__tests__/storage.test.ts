import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { getSessionHistory, saveSession, deleteSession, exportData } from '../storage';
import { getSupabaseClient } from '../supabaseClient';
import logger from '../logger';
import { UserProfile } from '@/types/user';

// Mock dependencies
vi.mock('../supabaseClient');

describe('storage.ts', () => {
    const mockSupabase = {
        from: vi.fn(),
        rpc: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getSupabaseClient).mockReturnValue(mockSupabase as unknown as SupabaseClient);
        vi.spyOn(logger, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('getSessionHistory', () => {
        it('should return empty array if userId is missing', async () => {
            const result = await getSessionHistory('');
            expect(result).toEqual([]);
            expect(logger.error).toHaveBeenCalledWith('Get Session History: User ID is required.');
        });

        it('should return session history on success', async () => {
            const mockData = [{ id: '1', user_id: 'user1' }];
            const mockSelect = vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                        range: vi.fn().mockResolvedValue({ data: mockData, error: null }),
                    }),
                }),
            });
            mockSupabase.from.mockReturnValue({ select: mockSelect } as unknown as ReturnType<SupabaseClient['from']>);

            const result = await getSessionHistory('user1');
            expect(result).toEqual(mockData);
            expect(mockSupabase.from).toHaveBeenCalledWith('sessions');
        });

        it('should use default limit of 50 and offset 0', async () => {
            const mockSelect = vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                        range: vi.fn().mockResolvedValue({ data: [], error: null }),
                    }),
                }),
            });
            mockSupabase.from.mockReturnValue({ select: mockSelect } as unknown as ReturnType<SupabaseClient['from']>);

            await getSessionHistory('user1');

            // offset=0, limit=50 => range(0, 49)
            // We need to drill down to the mock call
            expect(mockSelect().eq().order().range).toHaveBeenCalledWith(0, 49);
        });

        it('should throw error with descriptive message on failure', async () => {
            const mockError = { message: 'DB Error' };
            const mockSelect = vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                        range: vi.fn().mockResolvedValue({ data: null, error: mockError }),
                    }),
                }),
            });
            mockSupabase.from.mockReturnValue({ select: mockSelect } as unknown as ReturnType<SupabaseClient['from']>);

            await expect(getSessionHistory('user1')).rejects.toThrow(/Failed to fetch sessions from/);
        });
    });

    describe('saveSession', () => {
        const mockProfile = { subscription_status: 'free' } as UserProfile;
        const mockSessionData = { user_id: 'user1', duration: 60 };

        it('should return null session if sessionData or userId is missing', async () => {
            const result = await saveSession({} as unknown as Parameters<typeof saveSession>[0], mockProfile);
            expect(result).toEqual({ session: null, usageExceeded: false });
            expect(logger.error).toHaveBeenCalledWith('Save Session: Session data and user ID are required.');
        });

        it('should call rpc and return session on success', async () => {
            const mockNewSession = { id: 'new-session', ...mockSessionData };
            mockSupabase.rpc.mockResolvedValue({
                data: { new_session: mockNewSession, usage_exceeded: false },
                error: null,
            });

            const result = await saveSession(mockSessionData, mockProfile);

            expect(mockSupabase.rpc).toHaveBeenCalledWith('create_session_and_update_usage', {
                p_session_data: mockSessionData,
                p_is_free_user: true,
            });
            expect(result).toEqual({ session: mockNewSession, usageExceeded: false });
        });

        it('should handle rpc error', async () => {
            const mockError = { message: 'RPC Error' };
            mockSupabase.rpc.mockResolvedValue({ data: null, error: mockError });

            const result = await saveSession(mockSessionData, mockProfile);

            expect(result).toEqual({ session: null, usageExceeded: false });
            expect(logger.error).toHaveBeenCalledWith({ error: mockError }, 'Error during atomic session save and usage update:');
        });
    });

    describe('deleteSession', () => {
        it('should return false if sessionId is missing', async () => {
            const result = await deleteSession('');
            expect(result).toBe(false);
            expect(logger.error).toHaveBeenCalledWith('Delete Session: Session ID is required.');
        });

        it('should return true on success', async () => {
            const mockDelete = vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
            });
            mockSupabase.from.mockReturnValue({ delete: mockDelete } as unknown as ReturnType<SupabaseClient['from']>);

            const result = await deleteSession('session1');
            expect(result).toBe(true);
            expect(mockSupabase.from).toHaveBeenCalledWith('sessions');
        });

        it('should return false and log error on failure', async () => {
            const mockError = { message: 'Delete Error' };
            const mockDelete = vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: mockError }),
            });
            mockSupabase.from.mockReturnValue({ delete: mockDelete } as unknown as ReturnType<SupabaseClient['from']>);

            const result = await deleteSession('session1');
            expect(result).toBe(false);
            expect(logger.error).toHaveBeenCalledWith({ error: mockError }, 'Error deleting session:');
        });
    });

    describe('exportData', () => {
        it('should return object with sessions', async () => {
            const mockData = [{ id: '1', user_id: 'user1' }];
            // Mock getSessionHistory behavior by mocking supabase calls
            const mockSelect = vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                        range: vi.fn().mockResolvedValue({ data: mockData, error: null }),
                    }),
                }),
            });
            mockSupabase.from.mockReturnValue({ select: mockSelect } as unknown as ReturnType<SupabaseClient['from']>);

            const result = await exportData('user1');
            expect(result).toEqual({ sessions: mockData });
        });
    });
});
