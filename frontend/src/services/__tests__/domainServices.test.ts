import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { createSupabaseMock, createSupabaseNotFoundMock, createSupabaseErrorMock } from '../../../tests/utils/supabase-mock';
import * as supabaseModule from '@/lib/supabaseClient';
import {
    sessionService,
    profileService,
    vocabularyService,
    goalsService
} from '../domainServices';

describe('domainServices', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // =========================================================================
    // Session Service
    // =========================================================================
    describe('sessionService', () => {
        describe('getHistory', () => {
            it('should return session history on success', async () => {
                const mockData = [{ id: '1', title: 'Session 1' }, { id: '2', title: 'Session 2' }];
                const mockClient = createSupabaseMock(mockData, null);
                (mockClient as unknown as { limit: Mock }).limit = vi.fn().mockResolvedValue({ data: mockData, error: null });
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await sessionService.getHistory('user-123');

                expect(mockClient.from).toHaveBeenCalledWith('sessions');
                expect(result).toEqual(mockData);
            });

            it('should throw on error', async () => {
                const mockClient = createSupabaseErrorMock('DB_ERROR', 'Database connection failed');
                (mockClient as unknown as { limit: Mock }).limit = vi.fn().mockResolvedValue({ data: null, error: { code: 'DB_ERROR', message: 'Database connection failed' } });
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                await expect(sessionService.getHistory('user-123')).rejects.toEqual({ code: 'DB_ERROR', message: 'Database connection failed' });
            });
        });

        describe('getById', () => {
            it('should return session on success', async () => {
                const mockData = { id: '123', title: 'Test Session' };
                const mockClient = createSupabaseMock(mockData, null);
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await sessionService.getById('123');
                expect(result).toEqual(mockData);
            });

            it('should return null when not found', async () => {
                const mockClient = createSupabaseNotFoundMock();
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await sessionService.getById('999');
                expect(result).toBeNull();
            });
        });

        describe('create', () => {
            it('should create session on success', async () => {
                const mockData = { id: 'new-123', title: 'New Session' };
                const mockClient = createSupabaseMock(mockData, null);
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await sessionService.create({ title: 'New Session' });
                expect(result).toEqual(mockData);
            });
        });

        describe('update', () => {
            it('should update session on success', async () => {
                const mockData = { id: '123', title: 'Updated Session' };
                const mockClient = createSupabaseMock(mockData, null);
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await sessionService.update('123', { title: 'Updated Session' });
                expect(result).toEqual(mockData);
            });
        });

        describe('delete', () => {
            it('should delete session on success', async () => {
                const mockClient = createSupabaseMock(null, null);
                (mockClient as unknown as { eq: Mock }).eq = vi.fn().mockResolvedValue({ error: null });
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                await expect(sessionService.delete('123')).resolves.toBeUndefined();
            });
        });
    });

    // =========================================================================
    // Profile Service
    // =========================================================================
    describe('profileService', () => {
        describe('getById', () => {
            it('should return profile on success', async () => {
                const mockData = { id: 'user-1', subscription_status: 'pro' };
                const mockClient = createSupabaseMock(mockData, null);
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await profileService.getById('user-1');
                expect(result).toEqual(mockData);
            });

            it('should return null when not found', async () => {
                const mockClient = createSupabaseNotFoundMock();
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await profileService.getById('nonexistent');
                expect(result).toBeNull();
            });

            it('should throw on other errors', async () => {
                const mockClient = createSupabaseErrorMock('OTHER', 'DB error');
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                await expect(profileService.getById('user-1')).rejects.toEqual({ code: 'OTHER', message: 'DB error' });
            });
        });

        describe('update', () => {
            it('should update profile on success', async () => {
                const mockData = { id: 'user-1', subscription_status: 'free' };
                const mockClient = createSupabaseMock(mockData, null);
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await profileService.update('user-1', { subscription_status: 'free' });
                expect(result).toEqual(mockData);
            });
        });
    });

    // =========================================================================
    // Vocabulary Service
    // =========================================================================
    describe('vocabularyService', () => {
        describe('getWords', () => {
            it('should return vocabulary list on success', async () => {
                const mockData = [{ id: '1', word: 'kubernetes' }, { id: '2', word: 'terraform' }];
                const mockClient = createSupabaseMock(mockData, null);
                (mockClient as unknown as { order: Mock }).order = vi.fn().mockResolvedValue({ data: mockData, error: null });
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await vocabularyService.getWords('user-1');
                expect(result).toEqual(mockData);
            });
        });

        describe('addWord', () => {
            it('should add word on success', async () => {
                const mockData = { id: 'new-1', word: 'docker', user_id: 'user-1' };
                const mockClient = createSupabaseMock(mockData, null);
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await vocabularyService.addWord('user-1', 'Docker');
                expect(result).toEqual(mockData);
            });
        });

        describe('removeWord', () => {
            it('should remove word on success', async () => {
                const mockClient = createSupabaseMock(null, null);
                (mockClient as unknown as { eq: Mock }).eq = vi.fn().mockResolvedValue({ error: null });
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                await expect(vocabularyService.removeWord('word-123')).resolves.toBeUndefined();
            });
        });
    });

    // =========================================================================
    // Goals Service
    // =========================================================================
    describe('goalsService', () => {
        describe('get', () => {
            it('should return goals on success', async () => {
                const mockData = { id: 'goal-1', user_id: 'user-1', weekly_goal: 5, clarity_goal: 90 };
                const mockClient = createSupabaseMock(mockData, null);
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await goalsService.get('user-1');
                expect(result).toEqual(mockData);
            });

            it('should return null when not found', async () => {
                const mockClient = createSupabaseNotFoundMock();
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await goalsService.get('user-1');
                expect(result).toBeNull();
            });
        });

        describe('upsert', () => {
            it('should upsert goals on success', async () => {
                const mockData = { id: 'goal-1', user_id: 'user-1', weekly_goal: 10, clarity_goal: 95 };
                const mockClient = createSupabaseMock(mockData, null);
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await goalsService.upsert('user-1', { weekly_goal: 10, clarity_goal: 95 });
                expect(result).toEqual(mockData);
            });
        });
    });
});
