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
        vi.useFakeTimers();
        vi.clearAllMocks();
        vi.mocked(getSupabaseClient).mockReturnValue(mockSupabase as unknown as SupabaseClient);
        vi.spyOn(logger, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe('getSessionHistory', () => {
        it('should return empty array if userId is missing', async () => {
            const result = await getSessionHistory('');
            expect(result).toEqual([]);
            expect(logger.error).toHaveBeenCalledWith('Get Session History: User ID is required.');
        });

        it('should return session history on success', async () => {
            const mockData = [{ id: '1', user_id: 'user1' }];
            const mockRange = vi.fn().mockResolvedValue({ data: mockData, error: null });
            const mockOrder = vi.fn().mockReturnValue({ range: mockRange });
            const mockOr = vi.fn().mockReturnValue({ order: mockOrder });
            const mockEq = vi.fn().mockReturnValue({ or: mockOr });
            const mockSelect = vi.fn().mockReturnValue({
                eq: mockEq,
            });
            mockSupabase.from.mockReturnValue({ select: mockSelect } as unknown as ReturnType<SupabaseClient['from']>);

            const result = await getSessionHistory('user1');
            expect(result).toEqual(mockData);
            expect(mockSupabase.from).toHaveBeenCalledWith('sessions');
            // #1306 metrics-only: the select is CONTENT-FREE — metrics + the structured next action, never
            // transcript/ai_suggestions/ground_truth/accuracy/filler_words.
            expect(mockSelect).toHaveBeenCalledWith(expect.stringContaining('next_action_signal'));
            expect(mockSelect).toHaveBeenCalledWith(expect.stringContaining('filler_counts'));
            expect(mockSelect).toHaveBeenCalledWith(expect.stringContaining('pause_metrics'));
            expect(mockSelect).toHaveBeenCalledWith(expect.stringContaining('engine_version'));
            const selectArg = mockSelect.mock.calls[0][0] as string;
            for (const banned of ['transcript,', 'ai_suggestions', 'ground_truth', 'accuracy', 'filler_words']) {
                expect(selectArg).not.toContain(banned);
            }
            expect(mockOr).toHaveBeenCalledWith('status.is.null,status.eq.completed');
        });

        // #1047 PR-U1 pre-migration compatibility: the frontend can deploy before the transcript_state
        // migration is applied. History must still render via a legacy select, and unrelated errors must
        // still surface (the retry is narrowly scoped to the missing-column error).
        const buildHistoryChain = (rangeMock: ReturnType<typeof vi.fn>) => {
            const mockOrder = vi.fn().mockReturnValue({ range: rangeMock });
            const mockOr = vi.fn().mockReturnValue({ order: mockOrder });
            const mockEq = vi.fn().mockReturnValue({ or: mockOr });
            const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
            mockSupabase.from.mockReturnValue({ select: mockSelect } as unknown as ReturnType<SupabaseClient['from']>);
            return mockSelect;
        };

        it('retries the legacy select (no transcript_state) when the column is not yet applied', async () => {
            const legacyRows = [{ id: '1', user_id: 'user1' }];
            const mockRange = vi.fn()
                .mockResolvedValueOnce({ data: null, error: { code: '42703', message: 'column sessions.transcript_state does not exist' } })
                .mockResolvedValueOnce({ data: legacyRows, error: null });
            const mockSelect = buildHistoryChain(mockRange);

            const result = await getSessionHistory('user1');
            expect(result).toEqual(legacyRows);
            expect(mockSelect).toHaveBeenCalledTimes(2);
            expect(mockSelect.mock.calls[0][0]).toContain('transcript_state');   // first attempt: new select
            expect(mockSelect.mock.calls[1][0]).not.toContain('transcript_state'); // retry: legacy select
        });

        it('does NOT retry and surfaces an unrelated error (permission denied)', async () => {
            const mockRange = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for table sessions' } });
            const mockSelect = buildHistoryChain(mockRange);

            await expect(getSessionHistory('user1')).rejects.toThrow(/Unable to load your session history/i);
            expect(mockSelect).toHaveBeenCalledTimes(1); // no legacy retry on an unrelated error
        });

        it('should use default limit of 50 and offset 0', async () => {
            const mockRange = vi.fn().mockResolvedValue({ data: [], error: null });
            const mockOrder = vi.fn().mockReturnValue({ range: mockRange });
            const mockOr = vi.fn().mockReturnValue({ order: mockOrder });
            const mockSelect = vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                    or: mockOr,
                }),
            });
            mockSupabase.from.mockReturnValue({ select: mockSelect } as unknown as ReturnType<SupabaseClient['from']>);

            await getSessionHistory('user1');

            // offset=0, limit=50 => range(0, 49)
            expect(mockRange).toHaveBeenCalledWith(0, 49);
        });

        it('should throw sanitized error message on failure', async () => {
            const mockError = { message: 'DB Error' };
            const mockSelect = vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                    or: vi.fn().mockReturnValue({
                        order: vi.fn().mockReturnValue({
                            range: vi.fn().mockResolvedValue({ data: null, error: mockError }),
                        }),
                    }),
                }),
            });
            mockSupabase.from.mockReturnValue({ select: mockSelect } as unknown as ReturnType<SupabaseClient['from']>);

            await expect(getSessionHistory('user1')).rejects.toThrow('Unable to load your session history. Please refresh and try again.');
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

            expect(mockSupabase.rpc).toHaveBeenCalledWith('create_session_and_update_usage', expect.objectContaining({
                p_session_data: mockSessionData,
                p_engine_type: 'native'
            }));
            expect(result).toEqual({ session: mockNewSession, usageExceeded: false });
        });

        it('should pass correct engine_type to RPC', async () => {
            mockSupabase.rpc.mockResolvedValue({ data: { new_session: {}, usage_exceeded: false }, error: null });

            await saveSession(mockSessionData, mockProfile, 'cloud');

            expect(mockSupabase.rpc).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                p_engine_type: 'cloud'
            }));
        });

        // #1258/#1314 retention contract (SUPERSEDES #1306's "no transcript ever" P0): the two newest saved
        // sessions retain their transcript for review and PDF. These pin BOTH halves of that boundary — what the
        // save path must now carry, and what it must still refuse to carry — so neither can drift silently.
        it('PERSISTS the transcript — it is retained for the newest two sessions, not stripped', async () => {
            mockSupabase.rpc.mockResolvedValue({ data: { new_session: {}, usage_exceeded: false }, error: null });

            await saveSession({ ...mockSessionData, transcript: 'the retained transcript' }, mockProfile);

            const payload = mockSupabase.rpc.mock.calls[0][1] as { p_session_data: Record<string, unknown> };
            expect(payload.p_session_data.transcript).toBe('the retained transcript');
        });

        it('still strips every content field the retention contract does NOT retain', async () => {
            mockSupabase.rpc.mockResolvedValue({ data: { new_session: {}, usage_exceeded: false }, error: null });

            await saveSession({
                ...mockSessionData,
                transcript: 'retained',
                // Smuggled via an untyped object, exactly as a runtime caller could: none may reach the DB.
                ai_suggestions: { what_worked: 'prose' },
                ground_truth: 'reference text',
                accuracy: 0.93,
                custom_words: ['word'],
                filler_words: { um: 3 },
            } as unknown as Parameters<typeof saveSession>[0], mockProfile);

            const payload = mockSupabase.rpc.mock.calls[0][1] as { p_session_data: Record<string, unknown> };
            for (const stripped of ['ai_suggestions', 'ground_truth', 'accuracy', 'custom_words', 'filler_words']) {
                expect(payload.p_session_data, `${stripped} must never reach the DB`).not.toHaveProperty(stripped);
            }
            expect(payload.p_session_data.transcript).toBe('retained');
        });

        it('does not mutate the caller\'s object while stripping', async () => {
            mockSupabase.rpc.mockResolvedValue({ data: { new_session: {}, usage_exceeded: false }, error: null });
            const caller = { ...mockSessionData, transcript: 't', ground_truth: 'g' } as unknown as Parameters<typeof saveSession>[0];

            await saveSession(caller, mockProfile);

            expect(caller).toHaveProperty('ground_truth');   // stripped from the payload copy, not from the caller
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
                    or: vi.fn().mockReturnValue({
                        order: vi.fn().mockReturnValue({
                            range: vi.fn().mockResolvedValue({ data: mockData, error: null }),
                        }),
                    }),
                }),
            });
            mockSupabase.from.mockReturnValue({ select: mockSelect } as unknown as ReturnType<SupabaseClient['from']>);

            const result = await exportData('user1');
            expect(result).toEqual({ sessions: mockData });
        });
    });
});
