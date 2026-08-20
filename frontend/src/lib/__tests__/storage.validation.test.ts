import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveSession, completeSession } from '../storage';
import { getSupabaseClient } from '../supabaseClient';
import type { PracticeSession } from '../../types/session';
import type { UserProfile } from '../../types/user';
import type { PersistedFillerCounts } from '../../contracts/fillerCounts';

const VALID_NEXT_ACTION = { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' } as const;

// Mock dependencies
vi.mock('../supabaseClient', () => ({
    getSupabaseClient: vi.fn(),
}));



describe('storage.ts validation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const mockUser = { id: 'user-123', email: 'test@example.com', subscription_status: 'free' };

    // Persistence boundary under the #1258/#1314 retention contract, which SUPERSEDED #1306's "no transcript
    // ever" P0: the newest two sessions retain their transcript for review and PDF, so `transcript` now passes
    // through. Every OTHER content-bearing field is still stripped before the RPC, so a prose
    // write is impossible even if a caller passes one — there is no length limit because content is never sent.
    it('passes the retained transcript through but still strips every non-retained content field', async () => {
        const mockRpc = vi.fn().mockResolvedValue({ data: { new_session: { id: 'session-1' }, usage_exceeded: false }, error: null });
        vi.mocked(getSupabaseClient).mockReturnValue({ rpc: mockRpc } as unknown as ReturnType<typeof getSupabaseClient>);

        const sessionData = {
            user_id: mockUser.id,
            transcript: 'a'.repeat(500001) + ' um so today I talked about my weekend',
            ai_suggestions: { version: 'gemini_coaching_v1', what_worked: 'x', what_to_try_next: 'y' },
            ground_truth: 'the exact reference text',
            accuracy: 0.9,
            custom_words: { foo: {} },
            duration: 60,
            total_words: 100,
        } as unknown as Partial<PracticeSession> & { user_id: string };

        const result = await saveSession(sessionData, mockUser as unknown as UserProfile);
        expect(result.session).toBeDefined();
        expect(mockRpc).toHaveBeenCalled();
        const payload = mockRpc.mock.calls[0][1] as { p_session_data: Record<string, unknown> };
        for (const banned of ['ai_suggestions', 'ground_truth', 'accuracy', 'custom_words', 'filler_words']) {
            expect(payload.p_session_data).not.toHaveProperty(banned);
        }
        // The transcript is RETAINED, not stripped — and is forwarded verbatim rather than truncated or
        // sanitized, since retention exists so the user can read back what they actually said.
        expect(payload.p_session_data.transcript).toBe(sessionData.transcript);
        // Metrics still pass through.
        expect(payload.p_session_data).toHaveProperty('duration', 60);
        expect(payload.p_session_data).toHaveProperty('total_words', 100);
    });

    // CLIENT persistence boundary: an unknown/prose filler key is rejected BEFORE the RPC — never sent,
    // never silently dropped, and the prose is NEVER echoed into an error, log, or payload.
    it('completeSession REJECTS an unknown prose filler key (no RPC call, no prose leak)', async () => {
        const PROSE = 'confidential project phrase';
        const mockRpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
        vi.mocked(getSupabaseClient).mockReturnValue({ rpc: mockRpc } as unknown as ReturnType<typeof getSupabaseClient>);
        const logger = (await import('../logger')).default;
        const errorSpy = vi.spyOn(logger, 'error');

        const res = await completeSession('sess-1', {
            status: 'completed',
            duration: 60,
            nextActionSignal: VALID_NEXT_ACTION,
            metrics: { fillerCounts: { [PROSE]: 1 } as unknown as PersistedFillerCounts },
        });

        expect(res.success).toBe(false);
        expect(mockRpc).not.toHaveBeenCalled(); // rejected before it could reach the DB (never in an RPC payload)
        // No-leak: the prose never appears in any logger call — only a sanitized code.
        const loggedBlob = JSON.stringify(errorSpy.mock.calls);
        expect(loggedBlob).not.toContain(PROSE);
        expect(loggedBlob).toContain('invalid_filler_counts_key');
        errorSpy.mockRestore();
    });

    it('completeSession ALLOWS an explicit {} filler map (a measured zero) through to the RPC', async () => {
        const mockRpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
        vi.mocked(getSupabaseClient).mockReturnValue({ rpc: mockRpc } as unknown as ReturnType<typeof getSupabaseClient>);

        const res = await completeSession('sess-2', {
            status: 'completed', duration: 60, nextActionSignal: VALID_NEXT_ACTION, metrics: { fillerCounts: {} },
        });

        expect(res.success).toBe(true);
        expect(mockRpc).toHaveBeenCalled();
        const arg = mockRpc.mock.calls[0][1] as { p_filler_counts: unknown };
        expect(arg.p_filler_counts).toEqual({}); // measured zero forwarded, not coerced away
    });
});
