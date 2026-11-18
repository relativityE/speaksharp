/**
 * #1835 — the client's view of the owner's practice privacy choices. Fail closed: only THIS owner's own valid row turns
 * anything on; an owner change, a stale read, a malformed row and a write failure all leave it off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/lib/supabaseClient';
import {
    loadPracticePrivacy, savePracticePrivacy, transcriptSaveAllowed, coachingAllowed, captureCoachingConsent,
    coachingConsentStillHolds, resetPracticePrivacyForTests, usePracticePrivacyStore,
} from '../practicePrivacy';

vi.mock('@/lib/supabaseClient');

const OWNER_A = '00000000-0000-4000-8000-00000000000a';
const OWNER_B = '00000000-0000-4000-8000-00000000000b';
const row = (over: Record<string, unknown> = {}) =>
    ({ transcript_save: true, ai_coaching: true, consent_version: 1, choice_revision: 1, ...over });

const client = { from: vi.fn(), rpc: vi.fn() };
/** Each read answers with the next queued result, in order; a deferred result can be settled later. */
let reads: Array<Promise<{ data: unknown; error: unknown }>> = [];
const eqSpy = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    reads = [];
    resetPracticePrivacyForTests();
    client.rpc.mockReset();
    client.from.mockImplementation(() => ({
        select: () => ({
            eq: (column: string, value: string) => {
                eqSpy(column, value);
                return { maybeSingle: () => reads.shift() ?? Promise.resolve({ data: null, error: null }) };
            },
        }),
    }));
    vi.mocked(getSupabaseClient).mockReturnValue(client as unknown as SupabaseClient);
});

function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

describe('loadPracticePrivacy', () => {
    it('starts signed out and off', () => {
        expect(usePracticePrivacyStore.getState()).toMatchObject({ ownerId: null, status: 'signed_out', transcriptSave: false, aiCoaching: false });
        expect([transcriptSaveAllowed(), coachingAllowed(), captureCoachingConsent()]).toEqual([false, false, null]);
    });

    it('reads only this owner\'s row; no row → unknown (off)', async () => {
        reads.push(Promise.resolve({ data: null, error: null }));
        await loadPracticePrivacy(OWNER_A);
        expect(client.from).toHaveBeenCalledWith('practice_privacy_choices');
        expect(eqSpy).toHaveBeenCalledWith('user_id', OWNER_A);
        expect(usePracticePrivacyStore.getState()).toMatchObject({ ownerId: OWNER_A, status: 'unknown', transcriptSave: false, aiCoaching: false, revision: null });
        expect([transcriptSaveAllowed(), coachingAllowed()]).toEqual([false, false]);
    });

    it.each([
        ['save + AI', row(), true, true],
        ['save only', row({ ai_coaching: false }), true, false],
        ['neither', row({ transcript_save: false, ai_coaching: false }), false, false],
    ])('a valid row (%s) → chosen, and the gates follow it', async (_label, data, save, ai) => {
        reads.push(Promise.resolve({ data, error: null }));
        await loadPracticePrivacy(OWNER_A);
        expect(usePracticePrivacyStore.getState().status).toBe('chosen');
        expect([transcriptSaveAllowed(), coachingAllowed()]).toEqual([save, ai]);
    });

    it.each([
        ['AI without save', row({ transcript_save: false, ai_coaching: true })],
        ['unknown consent version', row({ consent_version: 2 })],
        ['non-boolean save', row({ transcript_save: 'true' })],
        ['missing revision', row({ choice_revision: null })],
        ['zero revision', row({ choice_revision: 0 })],
        ['fractional revision', row({ choice_revision: 1.5 })],
    ])('a row this client does not understand (%s) → unavailable (off)', async (_label, data) => {
        reads.push(Promise.resolve({ data, error: null }));
        await loadPracticePrivacy(OWNER_A);
        expect(usePracticePrivacyStore.getState()).toMatchObject({ status: 'unavailable', transcriptSave: false, aiCoaching: false });
        expect([transcriptSaveAllowed(), coachingAllowed()]).toEqual([false, false]);
    });

    it('a read error → unavailable (off), never consent', async () => {
        reads.push(Promise.resolve({ data: row(), error: { message: 'boom' } }));
        await loadPracticePrivacy(OWNER_A);
        expect(usePracticePrivacyStore.getState()).toMatchObject({ status: 'unavailable', transcriptSave: false, aiCoaching: false });
    });

    it('an owner change drops the previous owner\'s choice synchronously, before the new read answers', async () => {
        reads.push(Promise.resolve({ data: row(), error: null }));
        await loadPracticePrivacy(OWNER_A);
        expect(coachingAllowed()).toBe(true);
        const pending = deferred<{ data: unknown; error: unknown }>();
        reads.push(pending.promise);
        const loading = loadPracticePrivacy(OWNER_B);
        expect(usePracticePrivacyStore.getState()).toMatchObject({ ownerId: OWNER_B, status: 'loading', transcriptSave: false, aiCoaching: false });
        expect([transcriptSaveAllowed(), coachingAllowed()]).toEqual([false, false]);
        pending.resolve({ data: null, error: null });
        await loading;
        expect(usePracticePrivacyStore.getState()).toMatchObject({ ownerId: OWNER_B, status: 'unknown' });
    });

    it('a read for the previous owner that answers after the switch is dropped', async () => {
        const slowA = deferred<{ data: unknown; error: unknown }>();
        reads.push(slowA.promise);
        const loadingA = loadPracticePrivacy(OWNER_A);
        reads.push(Promise.resolve({ data: null, error: null }));
        await loadPracticePrivacy(OWNER_B);
        slowA.resolve({ data: row(), error: null });
        await loadingA;
        expect(usePracticePrivacyStore.getState()).toMatchObject({ ownerId: OWNER_B, status: 'unknown', aiCoaching: false });
    });

    it('a re-read for the SAME owner keeps the settled choice while it runs (no flicker to off)', async () => {
        reads.push(Promise.resolve({ data: row(), error: null }));
        await loadPracticePrivacy(OWNER_A);
        const pending = deferred<{ data: unknown; error: unknown }>();
        reads.push(pending.promise);
        const again = loadPracticePrivacy(OWNER_A);
        expect(usePracticePrivacyStore.getState().status).toBe('chosen');
        pending.resolve({ data: row({ choice_revision: 2 }), error: null });
        await again;
        expect(usePracticePrivacyStore.getState().revision).toBe(2);
    });

    it('signing out → signed_out and off', async () => {
        reads.push(Promise.resolve({ data: row(), error: null }));
        await loadPracticePrivacy(OWNER_A);
        await loadPracticePrivacy(null);
        expect(usePracticePrivacyStore.getState()).toMatchObject({ ownerId: null, status: 'signed_out', transcriptSave: false, aiCoaching: false });
    });
});

describe('savePracticePrivacy', () => {
    async function chosen(data = row()) {
        reads.push(Promise.resolve({ data, error: null }));
        await loadPracticePrivacy(OWNER_A);
    }

    it('records both answers through the one RPC and adopts the server\'s row', async () => {
        reads.push(Promise.resolve({ data: null, error: null }));
        await loadPracticePrivacy(OWNER_A);
        client.rpc.mockResolvedValue({ data: [row({ choice_revision: 1 })], error: null });
        await expect(savePracticePrivacy(true, true)).resolves.toEqual({ ok: true });
        expect(client.rpc).toHaveBeenCalledWith('set_practice_privacy_choices_v1',
            { p_transcript_save: true, p_ai_coaching: true, p_expected_revision: null });
        expect(usePracticePrivacyStore.getState()).toMatchObject({ status: 'chosen', transcriptSave: true, aiCoaching: true, revision: 1 });
    });

    it('a turn-on takes effect only once the server confirms it', async () => {
        reads.push(Promise.resolve({ data: null, error: null }));
        await loadPracticePrivacy(OWNER_A);
        const pending = deferred<{ data: unknown; error: unknown }>();
        client.rpc.mockReturnValue(pending.promise);
        const saving = savePracticePrivacy(true, true);
        expect([transcriptSaveAllowed(), coachingAllowed()]).toEqual([false, false]);
        pending.resolve({ data: [row()], error: null });
        await saving;
        expect([transcriptSaveAllowed(), coachingAllowed()]).toEqual([true, true]);
    });

    it('a turn-off takes effect at once, before the server answers, and invalidates outstanding coaching tokens', async () => {
        await chosen();
        const token = captureCoachingConsent();
        expect(coachingConsentStillHolds(token)).toBe(true);
        client.rpc.mockReturnValue(new Promise(() => { /* in flight */ }));
        void savePracticePrivacy(true, false);
        expect(usePracticePrivacyStore.getState()).toMatchObject({ transcriptSave: true, aiCoaching: false, revision: null });
        expect([transcriptSaveAllowed(), coachingAllowed(), coachingConsentStillHolds(token)]).toEqual([true, false, false]);
        await expect(savePracticePrivacy(false, false)).resolves.toEqual({ ok: false, reason: 'changed' });
        expect(client.rpc).toHaveBeenCalledTimes(1);
    });

    it('a re-recorded choice (new revision) invalidates a token taken under the old one', async () => {
        await chosen(row({ choice_revision: 5 }));
        const token = captureCoachingConsent();
        client.rpc.mockResolvedValueOnce({ data: [row({ ai_coaching: false, choice_revision: 6 })], error: null })
            .mockResolvedValueOnce({ data: [row({ choice_revision: 7 })], error: null });
        await savePracticePrivacy(true, false);
        await savePracticePrivacy(true, true);
        expect(coachingConsentStillHolds(token)).toBe(false);
        expect(coachingConsentStillHolds(captureCoachingConsent())).toBe(true);
    });

    it('refuses AI coaching without saving, without calling the server', async () => {
        await chosen();
        await expect(savePracticePrivacy(false, true)).resolves.toEqual({ ok: false, reason: 'invalid_choice' });
        expect(client.rpc).not.toHaveBeenCalled();
        expect(coachingAllowed()).toBe(true);
    });

    it('refuses when signed out', async () => {
        await expect(savePracticePrivacy(true, true)).resolves.toEqual({ ok: false, reason: 'not_signed_in' });
        expect(client.rpc).not.toHaveBeenCalled();
    });

    it.each([
        ['an RPC error', { data: null, error: { message: 'consent_unavailable' } }],
        ['a row that says something else', { data: [row({ ai_coaching: false })], error: null }],
        ['a malformed row', { data: [row({ consent_version: 9 })], error: null }],
        ['a stale result revision', { data: [row({ choice_revision: 2 })], error: null }],
        ['multiple claim rows', { data: [row(), row()], error: null }],
    ])('%s → failed; the server\'s state is re-read, and a refused turn-on never applied', async (_label, answer) => {
        reads.push(Promise.resolve({ data: null, error: null }));
        await loadPracticePrivacy(OWNER_A);
        client.rpc.mockResolvedValue(answer);
        reads.push(Promise.resolve({ data: null, error: null }));
        await expect(savePracticePrivacy(true, true)).resolves.toEqual({ ok: false, reason: 'failed' });
        await vi.waitFor(() => expect(client.from).toHaveBeenCalledTimes(2));
        expect(usePracticePrivacyStore.getState()).toMatchObject({ status: 'unknown', transcriptSave: false, aiCoaching: false });
    });

    it('rejects a revocation conflict, drops stale permission, re-reads and does not replay the write', async () => {
        await chosen();
        const current = deferred<{ data: unknown; error: unknown }>();
        reads.push(current.promise);
        client.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'privacy_choices_changed' } });
        await expect(savePracticePrivacy(true, false)).resolves.toEqual({ ok: false, reason: 'changed' });
        expect(client.rpc).toHaveBeenCalledWith('set_practice_privacy_choices_v1',
            { p_transcript_save: true, p_ai_coaching: false, p_expected_revision: 1 });
        expect([transcriptSaveAllowed(), coachingAllowed()]).toEqual([false, false]);
        current.resolve({ data: row({ transcript_save: false, ai_coaching: false, choice_revision: 2 }), error: null });
        await vi.waitFor(() => expect(usePracticePrivacyStore.getState().revision).toBe(2));
        expect(client.rpc).toHaveBeenCalledTimes(1);
        expect([transcriptSaveAllowed(), coachingAllowed()]).toEqual([false, false]);
    });

    it('a conflict cannot restore the rejected revision from a stale read', async () => {
        await chosen();
        reads.push(Promise.resolve({ data: row(), error: null }));
        client.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'privacy_choices_changed' } });
        await savePracticePrivacy(true, false);
        await vi.waitFor(() => expect(usePracticePrivacyStore.getState().status).toBe('unavailable'));
        expect([transcriptSaveAllowed(), coachingAllowed()]).toEqual([false, false]);
    });

    it('a control rendered before a refresh cannot use the refreshed revision to restore saving', async () => {
        await chosen();
        const staleBasis = usePracticePrivacyStore.getState();
        await chosen(row({ transcript_save: false, ai_coaching: false, choice_revision: 2 }));
        await expect(savePracticePrivacy(true, false, staleBasis)).resolves.toEqual({ ok: false, reason: 'changed' });
        expect(client.rpc).not.toHaveBeenCalled();
    });

    it('a failed turn-off stays off in this client until the re-read shows the server\'s state', async () => {
        await chosen();
        client.rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
        const reread = deferred<{ data: unknown; error: unknown }>();
        reads.push(reread.promise);
        await savePracticePrivacy(true, false);
        expect(coachingAllowed()).toBe(false);
        reread.resolve({ data: row(), error: null });
        await vi.waitFor(() => expect(usePracticePrivacyStore.getState().revision).toBe(1));
        // The server never recorded the turn-off, so its state (still on) is what is shown.
        expect(coachingAllowed()).toBe(true);
    });

    it('a write that answers after an owner change does not land on the new owner', async () => {
        await chosen();
        const pending = deferred<{ data: unknown; error: unknown }>();
        client.rpc.mockReturnValue(pending.promise);
        const saving = savePracticePrivacy(true, true);
        reads.push(Promise.resolve({ data: null, error: null }));
        await loadPracticePrivacy(OWNER_B);
        pending.resolve({ data: [row({ choice_revision: 9 })], error: null });
        await saving;
        expect(usePracticePrivacyStore.getState()).toMatchObject({ ownerId: OWNER_B, status: 'unknown', aiCoaching: false });
    });
});
