import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { createClient } from '@supabase/supabase-js';
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
        vi.useFakeTimers();
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
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
                (mockClient as unknown as { rpc: Mock }).rpc = vi.fn();
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await sessionService.getHistory('user-123');

                expect(mockClient.from).toHaveBeenCalledWith('sessions');
                expect(result).toEqual(mockData);
            });

            it('should throw on error', async () => {
                const mockClient = createSupabaseErrorMock('DB_ERROR', 'Database connection failed');
                (mockClient as unknown as { limit: Mock }).limit = vi.fn().mockResolvedValue({ data: null, error: { code: 'DB_ERROR', message: 'Database connection failed' } });
                (mockClient as unknown as { rpc: Mock }).rpc = vi.fn();
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                await expect(sessionService.getHistory('user-123')).rejects.toEqual({ code: 'DB_ERROR', message: 'Database connection failed' });
            });
        });

        describe('getById', () => {
            it('should return session on success', async () => {
                const mockData = { id: '123', title: 'Test Session' };
                const mockClient = createSupabaseMock(mockData, null);
                (mockClient as unknown as { rpc: Mock }).rpc = vi.fn();
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await sessionService.getById('123');
                expect(result).toEqual(mockData);
                expect(result).toEqual(mockData);
            });

            it('should return null when not found', async () => {
                const mockClient = createSupabaseNotFoundMock();
                (mockClient as unknown as { rpc: Mock }).rpc = vi.fn();
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await sessionService.getById('999');
                expect(result).toBeNull();
            });
        });

        describe('create', () => {
            it('should create session on success', async () => {
                const mockData = { id: 'new-123', title: 'New Session' };
                const mockClient = createSupabaseMock(mockData, null);
                (mockClient as unknown as { rpc: Mock }).rpc = vi.fn().mockResolvedValue({ 
                    data: { new_session: mockData, usage_exceeded: false }, 
                    error: null 
                });
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await sessionService.create({ title: 'New Session', user_id: 'user-123' });
                expect(result).toEqual(mockData);
                expect(mockClient.rpc).toHaveBeenCalledWith('create_session_and_update_usage', expect.anything());
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
                (mockClient as unknown as { rpc: Mock }).rpc = vi.fn();
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
            it('should return domain goals on success', async () => {
                const mockDbData = { id: 'goal-1', user_id: 'user-1', weekly_goal: 5, clarity_goal: 90 };
                const mockClient = createSupabaseMock(mockDbData, null);
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await goalsService.get('user-1');
                expect(result).toEqual({
                    weeklyGoal: 5,
                    clarityGoal: 90
                });
            });

            it('should return null when not found', async () => {
                const mockClient = createSupabaseNotFoundMock();
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await goalsService.get('user-1');
                expect(result).toBeNull();
            });
        });

        describe('upsert', () => {
            it('should map and upsert goals successfully', async () => {
                const mockDbData = { id: 'goal-1', user_id: 'user-1', weekly_goal: 10, clarity_goal: 95 };
                const mockClient = createSupabaseMock(mockDbData, null);
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);

                const result = await goalsService.upsert('user-1', { weeklyGoal: 10, clarityGoal: 95 });
                expect(result).toEqual({
                    weeklyGoal: 10,
                    clarityGoal: 95
                });
            });

            it('edits the existing owner row through the actual SDK without a second insert', async () => {
                vi.useRealTimers();
                const rows = new Map<string, Record<string, unknown>>();
                const requests: URL[] = [];
                const client = createClient('https://goals.unit.invalid', 'synthetic-public-key', {
                    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
                    global: { fetch: async (input, init) => {
                        const url = new URL(input instanceof Request ? input.url : String(input));
                        expect(url.pathname).toBe('/rest/v1/user_goals');
                        requests.push(url);
                        const body = JSON.parse(String(init?.body));
                        const existing = rows.get(body.user_id);
                        if (existing && url.searchParams.get('on_conflict') !== 'user_id') {
                            return Response.json({ code: '23505', message: 'unique owner constraint' }, { status: 409 });
                        }
                        const row = { id: existing?.id ?? 'synthetic-row', ...existing, ...body };
                        rows.set(body.user_id, row);
                        return Response.json(row);
                    } }
                });
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(client as ReturnType<typeof supabaseModule.getSupabaseClient>);

                await goalsService.upsert('owner-a', { weeklyGoal: 5, clarityGoal: 90 });
                const firstId = rows.get('owner-a')?.id;
                await expect(goalsService.upsert('owner-a', { weeklyGoal: 8, clarityGoal: 95 }))
                    .resolves.toEqual({ weeklyGoal: 8, clarityGoal: 95 });
                expect(rows.size).toBe(1);
                expect(rows.get('owner-a')).toEqual({ id: firstId, user_id: 'owner-a', weekly_goal: 8, clarity_goal: 95 });
                expect(requests).toHaveLength(2);
            });

            it('does not forward a foreign owner, row identity or database fields from a goals DTO', async () => {
                const mockClient = createSupabaseMock({ weekly_goal: 8, clarity_goal: 95 }, null);
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(mockClient);
                const untrustedGoals = { weeklyGoal: 8, clarityGoal: 95, user_id: 'owner-b', id: 'foreign-row', weekly_goal: 20 };
                await goalsService.upsert('owner-a', untrustedGoals);
                expect((mockClient as unknown as { upsert: Mock }).upsert).toHaveBeenCalledWith(
                    { user_id: 'owner-a', weekly_goal: 8, clarity_goal: 95 },
                    { onConflict: 'user_id' }
                );
            });

            it('preserves permission failures instead of reporting a saved goal or absent row', async () => {
                vi.useRealTimers();
                const client = createClient('https://goals.unit.invalid', 'synthetic-public-key', {
                    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
                    global: { fetch: async () => Response.json({ code: '42501', message: 'permission denied' }, { status: 403 }) }
                });
                vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(client as ReturnType<typeof supabaseModule.getSupabaseClient>);
                await expect(goalsService.get('owner-a')).rejects.toMatchObject({ code: '42501' });
                await expect(goalsService.upsert('owner-a', { weeklyGoal: 8 })).rejects.toMatchObject({ code: '42501' });
            });
        });
    });
});
