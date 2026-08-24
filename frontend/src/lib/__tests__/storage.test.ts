import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { getSessionHistory, getSessionById, saveSession, deleteSession, exportData, completeSession, TRANSCRIPT_OUTCOMES, resolveTranscriptView } from '../storage';
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

    // -----------------------------------------------------------------------------------------
    // #1306 Step 3 — the STORAGE-LEVEL completion contract.
    //
    // Controller tests cover this path as integration, but the storage boundary must be protected
    // independently: it is what actually decides the RPC name, the argument set, and whether a
    // response counts as a save. A clean `tsc` proves none of that — the widened return type compiles
    // perfectly while a caller reads only `.success`.
    // -----------------------------------------------------------------------------------------
    describe('completeSession — direct v2 cutover contract', () => {
        /** A well-formed v2 envelope. Individual tests corrupt exactly one field. */
        const validEnvelope = (over: Record<string, unknown> = {}) => ({
            success: true,
            session_saved: true,
            idempotent: false,
            final_status: 'completed',
            next_action_signal: { kind: 'practice_again' },
            transcript_state: 'available',
            transcript_outcome: 'retained',
            transcript_retained: true,
            retention: { status: 'converged' },
            ...over,
        });

        const completedOptions = {
            status: 'completed' as const,
            duration: 42,
            nextActionSignal: { kind: 'practice_again' } as never,
            metrics: { totalWords: 10, clarityScore: 0.9, wpm: 100, fillerCounts: {}, pauseMetrics: {} } as never,
            finalTranscript: 'the exact finalized transcript',
        };

        it('calls complete_session_v2 — never a v1 overload', () => {
            mockSupabase.rpc.mockResolvedValue({ data: validEnvelope(), error: null });
            return completeSession('s1', completedOptions).then(() => {
                expect(mockSupabase.rpc).toHaveBeenCalledTimes(1);
                expect(mockSupabase.rpc.mock.calls[0][0]).toBe('complete_session_v2');
            });
        });

        it('sends EXACTLY the eleven named arguments — nulls included, no extras', async () => {
            // Multiple overloads coexist server-side. An omitted argument lets PostgREST resolve a
            // DIFFERENT function than the one reviewed and postflight-verified; an extra fails to resolve.
            mockSupabase.rpc.mockResolvedValue({ data: validEnvelope(), error: null });
            await completeSession('s1', { status: 'completed', finalTranscript: 't' } as never);
            const args = mockSupabase.rpc.mock.calls[0][1] as Record<string, unknown>;
            expect(Object.keys(args).sort()).toEqual([
                'p_clarity_score', 'p_filler_counts', 'p_final_duration', 'p_final_transcript',
                'p_next_action', 'p_pause_metrics', 'p_reason', 'p_session_id', 'p_status',
                'p_total_words', 'p_wpm',
            ]);
            // Absent optional values must be explicit nulls, not `undefined` (which PostgREST drops).
            for (const k of ['p_final_duration', 'p_reason', 'p_next_action', 'p_total_words',
                             'p_clarity_score', 'p_wpm', 'p_filler_counts', 'p_pause_metrics']) {
                expect(args[k], `${k} must be an explicit null`).toBeNull();
            }
        });

        it('sends the exact finalized transcript for a completed session', async () => {
            mockSupabase.rpc.mockResolvedValue({ data: validEnvelope(), error: null });
            await completeSession('s1', completedOptions);
            expect((mockSupabase.rpc.mock.calls[0][1] as Record<string, unknown>).p_final_transcript)
                .toBe('the exact finalized transcript');
        });

        it('NEVER sends transcript text for a failed session, even if a caller passes one', async () => {
            mockSupabase.rpc.mockResolvedValue({ data: validEnvelope({ transcript_outcome: 'not_provided', transcript_retained: false, transcript_state: 'not_captured', final_status: 'failed' }), error: null });
            mockSupabase.from.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) } as never);
            await completeSession('s1', { status: 'failed', finalTranscript: 'LEAKED' } as never);
            expect((mockSupabase.rpc.mock.calls[0][1] as Record<string, unknown>).p_final_transcript).toBeNull();
        });

        it('does NOT fall back to v1 after an RPC error', async () => {
            mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
            const res = await completeSession('s1', completedOptions);
            expect(res.success).toBe(false);
            // Exactly one call, and it was v2. A fallback would split the completion authority.
            expect(mockSupabase.rpc).toHaveBeenCalledTimes(1);
            expect(mockSupabase.rpc.mock.calls[0][0]).toBe('complete_session_v2');
        });

        it('returns the server-stated outcome, never one inferred client-side', async () => {
            mockSupabase.rpc.mockResolvedValue({ data: validEnvelope({ transcript_outcome: 'expired', transcript_retained: false, transcript_state: 'expired' }), error: null });
            const res = await completeSession('s1', completedOptions);
            expect(res).toMatchObject({ success: true, transcriptOutcome: 'expired', transcriptRetained: false });
        });

        // Each outcome now requires its compatible state; an envelope pairing e.g. `expired` with
        // `available` is a corrupt contract, not an accepted save.
        const STATE_FOR = {
            retained: 'available', expired: 'expired',
            not_provided: 'not_captured', not_captured: 'not_captured', retention_failed: 'available',
        } as const;
        it.each(TRANSCRIPT_OUTCOMES)('accepts the documented outcome %s with its compatible state', async (outcome) => {
            mockSupabase.rpc.mockResolvedValue({
                data: validEnvelope({
                    transcript_outcome: outcome,
                    transcript_state: STATE_FOR[outcome],
                    transcript_retained: outcome === 'retained',
                }),
                error: null,
            });
            const res = await completeSession('s1', completedOptions);
            expect(res.success).toBe(true);
            expect(res.transcriptOutcome).toBe(outcome);
        });

        // ---- item 1: ONE atomic completion authority. No sessions.update after an accepted v2 call. ----
        it.each([
            ['completed', 'completed'],
            ['failed', 'failed'],
        ])('issues NO sessions.update after a successful %s completion', async (_l, status) => {
            // Even 'failed' — the v2 transaction already wrote p_status, and final_status is validated
            // to equal exactly what we asked for. A second write re-creates a divergent authority.
            mockSupabase.rpc.mockResolvedValue({
                data: validEnvelope({
                    final_status: status,
                    transcript_outcome: status === 'completed' ? 'retained' : 'not_provided',
                    transcript_state: status === 'completed' ? 'available' : 'not_captured',
                    transcript_retained: status === 'completed',
                }),
                error: null,
            });
            const res = await completeSession('s1', { ...completedOptions, status: status as 'completed' | 'failed' });
            expect(res.success).toBe(true);
            expect(mockSupabase.from).not.toHaveBeenCalled();
        });

        // ---- item 2: state, final_status, and state/outcome agreement, each isolated ----
        it.each([
            ['transcript_state omitted', { transcript_state: undefined }],
            ['transcript_state unknown', { transcript_state: 'something_new' }],
            ['transcript_state null', { transcript_state: null }],
        ])('FAILS CLOSED on %s', async (_l, over) => {
            // Isolated: outcome/retained/final_status all remain valid and mutually agreeing, so ONLY the
            // closed-state check can reject this. A test that also perturbed the outcome would pass via
            // the agreement guard and prove nothing about state validation.
            mockSupabase.rpc.mockResolvedValue({ data: validEnvelope(over), error: null });
            expect((await completeSession('s1', completedOptions)).success).toBe(false);
        });

        it.each([
            ['final_status omitted', { final_status: undefined }],
            ['final_status not a string', { final_status: 1 }],
            ['final_status disagreeing with the requested status', { final_status: 'failed' }],
        ])('FAILS CLOSED on %s', async (_l, over) => {
            // A server that completed a DIFFERENT status than requested has not done what we asked,
            // however successful it reports itself.
            mockSupabase.rpc.mockResolvedValue({ data: validEnvelope(over), error: null });
            expect((await completeSession('s1', completedOptions)).success).toBe(false);
        });

        it.each([
            ['retained with a non-available state', { transcript_outcome: 'retained', transcript_retained: true, transcript_state: 'expired' }],
            ['expired with an available state', { transcript_outcome: 'expired', transcript_retained: false, transcript_state: 'available' }],
            ['not_provided with an available state', { transcript_outcome: 'not_provided', transcript_retained: false, transcript_state: 'available' }],
            ['not_captured with an expired state', { transcript_outcome: 'not_captured', transcript_retained: false, transcript_state: 'expired' }],
        ])('FAILS CLOSED on incompatible state/outcome: %s', async (_l, over) => {
            mockSupabase.rpc.mockResolvedValue({ data: validEnvelope(over), error: null });
            expect((await completeSession('s1', completedOptions)).success).toBe(false);
        });

        it('retention_failed may keep whatever valid state the row held, but still obeys the other guards', async () => {
            mockSupabase.rpc.mockResolvedValue({
                data: validEnvelope({ transcript_outcome: 'retention_failed', transcript_retained: false, transcript_state: 'expired' }),
                error: null,
            });
            expect((await completeSession('s1', completedOptions)).success).toBe(true);
            // ...but an unknown state is still rejected even under retention_failed.
            mockSupabase.rpc.mockResolvedValue({
                data: validEnvelope({ transcript_outcome: 'retention_failed', transcript_retained: false, transcript_state: 'bogus' }),
                error: null,
            });
            expect((await completeSession('s1', completedOptions)).success).toBe(false);
        });

        // ---- item 6: an RPC failure must never echo request material ----
        it('an RPC error never leaks transcript content into logs or the result', async () => {
            const SENTINEL = 'RPC-ERROR-TRANSCRIPT-CANARY-9d21f4';
            mockSupabase.rpc.mockResolvedValue({
                data: null,
                // Postgres/PostgREST quote the failing statement back — which, for a completion, contains
                // the transcript. This is the realistic shape of that leak.
                error: {
                    code: '22001',
                    message: `value too long for type character varying: "${SENTINEL}"`,
                    details: `Failing row contains (${SENTINEL})`,
                    hint: `shorten ${SENTINEL}`,
                },
            });
            const res = await completeSession('s1', { ...completedOptions, finalTranscript: SENTINEL });
            expect(res.success).toBe(false);
            // Positive control: the error path DID log, so an empty capture cannot pass as clean.
            expect(vi.mocked(logger.error)).toHaveBeenCalled();
            const logged = JSON.stringify(vi.mocked(logger.error).mock.calls);
            expect(logged).not.toContain(SENTINEL);
            // The safe code is still recorded, so the failure stays diagnosable.
            expect(logged).toContain('22001');
            // Nothing content-bearing comes back to the caller either.
            expect(JSON.stringify(res)).not.toContain(SENTINEL);
        });

        it.each([
            ['null response', null],
            ['an array', []],
            ['a bare string', 'ok'],
            ['success omitted', { session_saved: true, transcript_outcome: 'retained', transcript_retained: true }],
            ['success truthy but not true', { success: 1, session_saved: true, transcript_outcome: 'retained', transcript_retained: true }],
            ['session_saved omitted', { success: true, transcript_outcome: 'retained', transcript_retained: true }],
            ['transcript_outcome omitted', { success: true, session_saved: true, transcript_retained: true }],
            ['an unknown transcript_outcome', { success: true, session_saved: true, transcript_outcome: 'probably_fine', transcript_retained: true }],
            // ISOLATES the outcome allowlist. The case above pairs an unknown outcome with
            // retained:true, so the agreement check catches it and the allowlist is never exercised —
            // the test passed for the wrong reason. Here retained:false AGREES with a non-'retained'
            // outcome, so only the allowlist can reject it.
            ['an unknown outcome whose retained flag agrees', { success: true, session_saved: true, transcript_outcome: 'probably_fine', transcript_retained: false }],
            ['an empty-string outcome', { success: true, session_saved: true, transcript_outcome: '', transcript_retained: false }],
            ['transcript_retained missing', { success: true, session_saved: true, transcript_outcome: 'retained' }],
            ['retained CONTRADICTING the outcome', { success: true, session_saved: true, transcript_outcome: 'expired', transcript_retained: true }],
            ['not-retained contradicting a retained outcome', { success: true, session_saved: true, transcript_outcome: 'retained', transcript_retained: false }],
        ])('FAILS CLOSED on %s', async (_label, data) => {
            mockSupabase.rpc.mockResolvedValue({ data, error: null });
            const res = await completeSession('s1', completedOptions);
            expect(res.success).toBe(false);
            expect(res.transcriptOutcome).toBeUndefined();
        });

        it('never echoes the response envelope when rejecting it', async () => {
            // The envelope carries next_action_signal; a rejection log must record shape only.
            mockSupabase.rpc.mockResolvedValue({ data: { success: true, secret: 'SHOULD_NOT_APPEAR' }, error: null });
            await completeSession('s1', completedOptions);
            const logged = JSON.stringify(vi.mocked(logger.error).mock.calls);
            expect(logged).not.toContain('SHOULD_NOT_APPEAR');
        });
    });

    // -----------------------------------------------------------------------------------------
    // #1306 Step 3 subtask C — the SELECT fields themselves, not the rendered output. Rendering can
    // look correct while the query has already pulled every retained transcript over the wire.
    // -----------------------------------------------------------------------------------------
    describe('list vs detail select fields', () => {
        const captureSelect = (result: unknown) => {
            const select = vi.fn();
            const range = vi.fn().mockResolvedValue(result);
            const single = vi.fn().mockResolvedValue(result);
            select.mockReturnValue({
                eq: vi.fn().mockReturnValue({
                    or: vi.fn().mockReturnValue({ order: vi.fn().mockReturnValue({ range }) }),
                    single,
                }),
            });
            mockSupabase.from.mockReturnValue({ select } as never);
            return select;
        };

        it('history LIST never requests transcript text', async () => {
            const select = captureSelect({ data: [], error: null });
            await getSessionHistory('user1');
            const fields = String(select.mock.calls[0][0]).split(',').map(f => f.trim());
            expect(fields).not.toContain('transcript');
            // ...while still carrying the state, so the list can label expired rows honestly.
            expect(fields).toContain('transcript_state');
            expect(fields).toContain('filler_counts');
        });

        it('single-session DETAIL requests transcript AND its state together', async () => {
            const select = captureSelect({ data: { id: 's1' }, error: null });
            await getSessionById('s1');
            const fields = String(select.mock.calls[0][0]).split(',').map(f => f.trim());
            // The text and the state must arrive together: rendering is gated on the server's state,
            // never on whether the text happens to be non-empty.
            expect(fields).toContain('transcript');
            expect(fields).toContain('transcript_state');
        });

        it('the detail select is a strict superset of the list select', async () => {
            const listSelect = captureSelect({ data: [], error: null });
            await getSessionHistory('user1');
            const listFields = String(listSelect.mock.calls[0][0]).split(',').map(f => f.trim());
            const detailSelect = captureSelect({ data: { id: 's1' }, error: null });
            await getSessionById('s1');
            const detailFields = String(detailSelect.mock.calls[0][0]).split(',').map(f => f.trim());
            for (const f of listFields) expect(detailFields).toContain(f);
            expect(detailFields.filter(f => !listFields.includes(f))).toEqual(['transcript']);
        });
    });

    // -----------------------------------------------------------------------------------------
    // Closes the INJECTED-STATE blind spot in the parser tests above.
    //
    // Those tests hand-build response envelopes, so they prove the parser handles that shape — they
    // cannot notice if the SERVER produces a different one. The migration SQL is the source of truth
    // for what `complete_session_v2` actually returns, so the client's expectations are checked
    // against it directly rather than against a fixture someone wrote from memory.
    // -----------------------------------------------------------------------------------------
    describe('envelope shape agrees with the migration source of truth', () => {
        const MIGRATION = 'backend/supabase/migrations/20260819120000_complete_session_v2_atomic_retention_1314.sql';
        const readMigration = async () => {
            const { readFileSync } = await import('node:fs');
            const { resolve } = await import('node:path');
            return readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');
        };

        it('every field the client reads is actually returned by the RPC', async () => {
            const sql = await readMigration();
            // Positive control: we found the real RETURN block, not an empty string.
            expect(sql).toContain('RETURN jsonb_build_object(');
            const block = sql.slice(sql.indexOf('RETURN jsonb_build_object('));
            for (const key of ['success', 'session_saved', 'transcript_outcome', 'transcript_retained',
                               'transcript_state', 'idempotent', 'final_status']) {
                expect(block, `client reads ${key}, but the RPC does not return it`).toContain(`'${key}'`);
            }
        });

        it('every outcome the SQL can emit is accepted by the client allowlist', async () => {
            const sql = await readMigration();
            const caseBlock = sql.slice(sql.indexOf('v_outcome := CASE'), sql.indexOf('END;', sql.indexOf('v_outcome := CASE')));
            // Extract the quoted literals the CASE can assign.
            const emitted = [...caseBlock.matchAll(/THEN\s+'([a-z_]+)'|ELSE\s+'([a-z_]+)'/g)]
                .map(m => m[1] ?? m[2]).filter(Boolean);
            expect(emitted.length, 'no outcomes parsed from the SQL — the scan proves nothing').toBeGreaterThan(3);
            for (const o of emitted) {
                expect(TRANSCRIPT_OUTCOMES as readonly string[], `SQL can emit '${o}' but the client rejects it`).toContain(o);
            }
        });
    });

    // -----------------------------------------------------------------------------------------
    // #1306 Step 3 subtask C — the ONE decision both the review surface and the PDF consume.
    // Rendering must follow the server's transcript_state, never the presence of text.
    // -----------------------------------------------------------------------------------------
    describe('resolveTranscriptView', () => {
        it('available WITH usable text renders that text', () => {
            expect(resolveTranscriptView({ transcript_state: 'available', transcript: '  hello world  ' }))
                .toEqual({ kind: 'available', text: 'hello world' });
        });

        it.each([
            ['empty string', ''],
            ['whitespace only', '   \n\t '],
            ['null', null],
            ['absent', undefined],
        ])('available WITHOUT usable text (%s) is an honest gap, never a blank transcript', (_l, text) => {
            // A blank panel labelled "transcript" is a lie; "could not be loaded" is the truth.
            expect(resolveTranscriptView({ transcript_state: 'available', transcript: text as string | null }))
                .toEqual({ kind: 'unavailable' });
        });

        it.each([
            ['expired', 'expired'],
            ['not_captured', 'not_captured'],
        ])('%s SUPPRESSES text even when the response still carries it', (_l, state) => {
            // A malformed row claiming expiry while shipping the text must not leak it past retention.
            const view = resolveTranscriptView({ transcript_state: state, transcript: 'STALE TEXT THAT MUST NOT RENDER' });
            expect(view).toEqual({ kind: state as 'expired' | 'not_captured' });
            expect(JSON.stringify(view)).not.toContain('STALE TEXT');
        });

        it.each([
            ['unknown state', 'something_new'],
            ['null state', null],
            ['absent state', undefined],
        ])('%s suppresses text AND reports it honestly as unavailable', (_l, state) => {
            // Fails closed on DISPLAY without lying about MEANING. "No transcript was captured" is a
            // factual claim about the recording; when the state is unknown we simply do not know, so only
            // the explicit server state `not_captured` may produce that sentence.
            expect(resolveTranscriptView({ transcript_state: state as string | null, transcript: 'TEXT PRESENT' }))
                .toEqual({ kind: 'unavailable' });
        });

        it('only the EXPLICIT server state not_captured yields the not-captured claim', () => {
            expect(resolveTranscriptView({ transcript_state: 'not_captured', transcript: null }))
                .toEqual({ kind: 'not_captured' });
            expect(resolveTranscriptView({ transcript_state: 'garbled', transcript: null }).kind)
                .not.toBe('not_captured');
        });

        it('a null session is unavailable, not a false not-captured claim', () => {
            expect(resolveTranscriptView(null)).toEqual({ kind: 'unavailable' });
        });

        it('NEVER infers availability from text presence alone', () => {
            // The decisive property: identical text, different server state → different decision.
            const withState = resolveTranscriptView({ transcript_state: 'available', transcript: 'same text' });
            const withoutState = resolveTranscriptView({ transcript: 'same text' });
            expect(withState.kind).toBe('available');
            expect(withoutState.kind).toBe('unavailable');
        });
    });
});
