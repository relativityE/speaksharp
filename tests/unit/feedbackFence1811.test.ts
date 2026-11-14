import { describe, expect, it, vi } from 'vitest';
import { cleanAndVerifyFeedbackFence, cleanFeedbackFence, closeFeedbackFence, fenceCleanupVerdict, fenceRunKey, openFeedbackFence,
    verifyFeedbackFence, type FenceRpcClient } from '../live/helpers/feedbackFence';
import type { RunBinding } from '../live/helpers/runBinding';

const BINDING: RunBinding = { repository: 'relativityE/speaksharp', workflow: 'relativityE/speaksharp/.github/workflows/rc-gates.yml@refs/heads/main',
    runId: '43583228045', runAttempt: '1', role: 'rwt-journey' };
const OWNER = '11111111-1111-4111-8111-111111111111';
const client = (reply: { data: unknown; error: { code?: string } | null }) => {
    const rpc = vi.fn(async () => reply);
    return { admin: { rpc } as unknown as FenceRpcClient, rpc };
};
/** Per-function replies; a function may answer once with a thrown transport failure. */
const routed = (replies: Record<string, { data: unknown; error: { code?: string } | null } | 'throw'>) => {
    const rpc = vi.fn(async (fn: string) => {
        const reply = replies[fn];
        if (reply === 'throw') throw new Error('socket hang up');
        return reply ?? { data: null, error: { code: 'unexpected' } };
    });
    return { admin: { rpc } as unknown as FenceRpcClient, rpc };
};
const openReadback = { exists: true, state: 'open', owner: OWNER, case: 'AHT-02', recorded: 0, keys: 0, remaining: 0, foreign: 0 };

describe('#1811 feedback fence helper', () => {
    it('derives the run key exactly as the database does, and refuses malformed parts', () => {
        expect(fenceRunKey(BINDING, 'AHT-08')).toBe('43583228045-1-AHT-08');
        expect(fenceRunKey(BINDING, 'AHT-07+AHT-08')).toBe('43583228045-1-AHT-07+AHT-08');
        expect(() => fenceRunKey({ ...BINDING, runId: '0' }, 'AHT-02')).toThrow(/invalid run key/);
        expect(() => fenceRunKey(BINDING, 'AHT-03' as never)).toThrow(/invalid run key/);
    });

    it('opens with the exact binding, case and cap, and is CONFIRMED by a read-only readback before any write', async () => {
        const ok = routed({ open_rwt_feedback_fence_v1: { data: '43583228045-1-AHT-02', error: null },
            verify_rwt_feedback_fence_v1: { data: openReadback, error: null } });
        await expect(openFeedbackFence(ok.admin, OWNER, BINDING, 'AHT-02', 1)).resolves.toBe('43583228045-1-AHT-02');
        expect(ok.rpc.mock.calls).toEqual([
            ['open_rwt_feedback_fence_v1', { p_owner: OWNER, p_binding: BINDING, p_case: 'AHT-02', p_key_cap: 1 }],
            ['verify_rwt_feedback_fence_v1', { p_run_key: '43583228045-1-AHT-02' }],
        ]);
        await expect(openFeedbackFence(ok.admin, OWNER, BINDING, 'AHT-02', 0)).rejects.toThrow(/key cap/);
        await expect(openFeedbackFence(ok.admin, OWNER, BINDING, 'AHT-02', 9)).rejects.toThrow(/key cap/);
    });

    it('an UNCERTAIN open (error, lost response, odd payload) is recovered by its key — never by reopening', async () => {
        for (const openReply of [{ data: null, error: { code: '57014' } }, 'throw' as const, { data: 'garbage', error: null }]) {
            // The open actually happened: the readback shows this owner's open fence, so it is accepted without a second open.
            const landed = routed({ open_rwt_feedback_fence_v1: openReply, verify_rwt_feedback_fence_v1: { data: openReadback, error: null } });
            await expect(openFeedbackFence(landed.admin, OWNER, BINDING, 'AHT-02', 1)).resolves.toBe('43583228045-1-AHT-02');
            expect(landed.rpc.mock.calls.filter(([fn]) => fn === 'open_rwt_feedback_fence_v1')).toHaveLength(1);
            // The open did not happen (or is someone else's / not open): HOLD, never a second open.
            for (const readback of [{ exists: false }, { ...openReadback, owner: '22222222-2222-4222-8222-222222222222' },
                { ...openReadback, state: 'closed' }, { ...openReadback, case: 'AHT-07' }]) {
                const absent = routed({ open_rwt_feedback_fence_v1: openReply, verify_rwt_feedback_fence_v1: { data: readback, error: null } });
                await expect(openFeedbackFence(absent.admin, OWNER, BINDING, 'AHT-02', 1)).rejects.toThrow(/fail closed/);
                expect(absent.rpc.mock.calls.filter(([fn]) => fn === 'open_rwt_feedback_fence_v1')).toHaveLength(1);
            }
        }
        // A readback that itself fails is fail-closed too.
        const blind = routed({ open_rwt_feedback_fence_v1: 'throw', verify_rwt_feedback_fence_v1: 'throw' });
        await expect(openFeedbackFence(blind.admin, OWNER, BINDING, 'AHT-02', 1)).rejects.toThrow();
    });

    it('verify is read-only in shape: refuses malformed readbacks', async () => {
        await expect(verifyFeedbackFence(client({ data: { exists: false }, error: null }).admin, 'k')).resolves.toEqual({ exists: false });
        await expect(verifyFeedbackFence(client({ data: { exists: true, state: 'open' }, error: null }).admin, 'k')).rejects.toThrow(/shape/);
        await expect(verifyFeedbackFence(client({ data: null, error: { code: '42501' } }).admin, 'k')).rejects.toThrow(/verify failed/);
    });

    it('close and clean return only counts and states, and fail closed on errors or unexpected shapes', async () => {
        await expect(closeFeedbackFence(client({ data: { state: 'closed', reports: 2, keys: 1 }, error: null }).admin, 'k'))
            .resolves.toEqual({ state: 'closed', reports: 2, keys: 1 });
        await expect(closeFeedbackFence(client({ data: { state: 'open', reports: 0, keys: 0 }, error: null }).admin, 'k')).rejects.toThrow(/shape/);
        await expect(closeFeedbackFence(client({ data: null, error: { code: 'P0002' } }).admin, 'k')).rejects.toThrow(/close failed.*P0002/);
        await expect(cleanFeedbackFence(client({ data: { deleted: 1, residue: 0, foreign: 0, state: 'cleaned' }, error: null }).admin, 'k'))
            .resolves.toEqual({ deleted: 1, residue: 0, foreign: 0, state: 'cleaned' });
        await expect(cleanFeedbackFence(client({ data: { deleted: '1', residue: 0, foreign: 0, state: 'cleaned' }, error: null }).admin, 'k')).rejects.toThrow(/shape/);
        await expect(cleanFeedbackFence(client({ data: null, error: { code: '55000' } }).admin, 'k')).rejects.toThrow(/clean failed.*55000/);
    });

    it('PASSes cleanup only on a zero readback with nothing foreign and no over-deletion', async () => {
        const closed = { state: 'closed' as const, reports: 2, keys: 1 };
        const zero = { exists: true, state: 'cleaned' as const, owner: OWNER, case: 'AHT-02', recorded: 2, keys: 1, remaining: 0, foreign: 0 };
        expect(fenceCleanupVerdict(closed, { deleted: 2, residue: 0, foreign: 0, state: 'cleaned' }, zero).verdict).toBe('PASS');
        // The INDEPENDENT readback is required: clean's own zero alone never PASSes.
        expect(fenceCleanupVerdict(closed, { deleted: 2, residue: 0, foreign: 0, state: 'cleaned' }).verdict).toBe('FAIL');
        expect(fenceCleanupVerdict(closed, { deleted: 2, residue: 0, foreign: 0, state: 'cleaned' }, { ...zero, remaining: 1 }).verdict).toBe('FAIL');
        const both = routed({ clean_rwt_feedback_fence_v1: { data: { deleted: 2, residue: 0, foreign: 0, state: 'cleaned' }, error: null },
            verify_rwt_feedback_fence_v1: { data: zero, error: null } });
        const result = await cleanAndVerifyFeedbackFence(both.admin, 'k');
        expect(fenceCleanupVerdict(closed, result.cleaned, result.readback).verdict).toBe('PASS');
        expect(fenceCleanupVerdict(null, { deleted: 0, residue: 0, foreign: 0, state: 'cleaned' }).verdict).toBe('FAIL');
        expect(fenceCleanupVerdict(closed, null).verdict).toBe('FAIL');
        expect(fenceCleanupVerdict(closed, { deleted: 1, residue: 1, foreign: 0, state: 'closed' }).verdict).toBe('FAIL');
        expect(fenceCleanupVerdict(closed, { deleted: 1, residue: 0, foreign: 1, state: 'closed' }).verdict).toBe('FAIL');
        expect(fenceCleanupVerdict(closed, { deleted: 3, residue: 0, foreign: 0, state: 'cleaned' }).verdict).toBe('FAIL');
    });
});
