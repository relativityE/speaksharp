/**
 * #1835 — completeSession sends transcript text only under the owner's recorded yes to saving. Without it the session
 * still completes metrics-only (progress is kept). If the server refuses the text (saving is off there), the same
 * session completes metrics-only once, and stays metrics-only on any replay.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { completeSession } from '../storage';
import { getSupabaseClient } from '../supabaseClient';
import logger from '../logger';
import { usePracticePrivacyStore } from '@/services/practicePrivacy';
import { grantPracticePrivacy, resetPracticePrivacyForTests, TEST_PRIVACY_OWNER } from '../../../tests/test-utils/practicePrivacy';

vi.mock('../supabaseClient');

const NEXT_ACTION = {
    reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate',
    value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1',
} as const;
const envelope = (over: Record<string, unknown> = {}) => ({
    success: true, session_saved: true, idempotent: false, final_status: 'completed', next_action_signal: NEXT_ACTION,
    transcript_state: 'available', transcript_outcome: 'retained', transcript_retained: true, retention: { status: 'converged' },
    ...over,
});
const metricsOnlyEnvelope = () => envelope({ transcript_state: 'not_captured', transcript_outcome: 'not_provided', transcript_retained: false });
const options = {
    status: 'completed' as const, duration: 42, nextActionSignal: NEXT_ACTION as never,
    metrics: { totalWords: 120, clarityScore: 88, wpm: 142, fillerCounts: { um: 4 }, pauseMetrics: { totalPauses: 1, averagePauseDuration: 0.5, longestPause: 0.5, pausesPerMinute: 1 } } as never,
    finalTranscript: 'my private words',
};
const supabase = { rpc: vi.fn(), from: vi.fn() };
const sentTranscripts = () => supabase.rpc.mock.calls.map((c) => (c[1] as Record<string, unknown>).p_final_transcript);
let seq = 0;
const sid = () => `1835-session-${++seq}`;

beforeEach(() => {
    vi.clearAllMocks();
    supabase.rpc.mockReset();
    vi.mocked(getSupabaseClient).mockReturnValue(supabase as unknown as SupabaseClient);
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); resetPracticePrivacyForTests(); });

describe('#1835 completeSession and the saving choice', () => {
    it.each([
        ['signed out', () => resetPracticePrivacyForTests()],
        ['loading', () => usePracticePrivacyStore.setState({ ownerId: TEST_PRIVACY_OWNER, status: 'loading' })],
        ['unknown', () => usePracticePrivacyStore.setState({ ownerId: TEST_PRIVACY_OWNER, status: 'unknown' })],
        ['unavailable', () => usePracticePrivacyStore.setState({ ownerId: TEST_PRIVACY_OWNER, status: 'unavailable' })],
        ['declined', () => grantPracticePrivacy({ transcriptSave: false, aiCoaching: false })],
    ])('%s → no transcript text is sent, and the session still completes with its metrics', async (_label, arrange) => {
        resetPracticePrivacyForTests();
        arrange();
        supabase.rpc.mockResolvedValue({ data: metricsOnlyEnvelope(), error: null });
        const result = await completeSession(sid(), options);
        expect(result.success).toBe(true);
        expect(supabase.rpc).toHaveBeenCalledTimes(1);
        const args = supabase.rpc.mock.calls[0][1] as Record<string, unknown>;
        expect(args).toMatchObject({ p_status: 'completed', p_total_words: 120, p_wpm: 142, p_final_transcript: null });
    });

    it('a recorded yes to saving → the transcript is sent (control)', async () => {
        grantPracticePrivacy({ transcriptSave: true, aiCoaching: false });
        supabase.rpc.mockResolvedValue({ data: envelope(), error: null });
        await completeSession(sid(), options);
        expect(sentTranscripts()).toEqual(['my private words']);
    });

    it('the server refuses the text (transcript_consent_required) → the same session completes metrics-only, once', async () => {
        grantPracticePrivacy();
        const id = sid();
        supabase.rpc
            .mockResolvedValueOnce({ data: null, error: { message: 'transcript_consent_required', code: '42501', details: 'my private words' } })
            .mockResolvedValueOnce({ data: metricsOnlyEnvelope(), error: null });
        const result = await completeSession(id, options);
        expect(result.success).toBe(true);
        expect(sentTranscripts()).toEqual(['my private words', null]);
        expect(supabase.rpc.mock.calls.every((c) => (c[1] as Record<string, unknown>).p_session_id === id)).toBe(true);
        // The refusal is logged without content.
        expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('my private words');
    });

    it('a replay of a session that completed metrics-only stays metrics-only, even after saving is turned on', async () => {
        resetPracticePrivacyForTests();
        usePracticePrivacyStore.setState({ ownerId: TEST_PRIVACY_OWNER, status: 'unknown' });
        const id = sid();
        supabase.rpc.mockResolvedValue({ data: metricsOnlyEnvelope(), error: null });
        await completeSession(id, options);
        grantPracticePrivacy();
        await completeSession(id, options);
        expect(sentTranscripts()).toEqual([null, null]);
    });

    it('any other RPC error is not treated as a consent refusal: no metrics-only second call', async () => {
        grantPracticePrivacy();
        supabase.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied', code: '42501' } });
        const result = await completeSession(sid(), options);
        expect(result.success).toBe(false);
        expect(supabase.rpc).toHaveBeenCalledTimes(1);
    });

    it('a still-refused metrics-only retry fails closed without a third call', async () => {
        grantPracticePrivacy();
        supabase.rpc.mockResolvedValue({ data: null, error: { message: 'transcript_consent_required' } });
        const result = await completeSession(sid(), options);
        expect(result.success).toBe(false);
        expect(sentTranscripts()).toEqual(['my private words', null]);
    });
});
