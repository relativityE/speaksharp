import { describe, expect, it, vi } from 'vitest';
import { cleanFeedbackFence, closeFeedbackFence, fenceCleanupVerdict, fenceRunKey, openFeedbackFence, type FenceRpcClient }
    from '../live/helpers/feedbackFence';
import type { RunBinding } from '../live/helpers/runBinding';

const BINDING: RunBinding = { repository: 'relativityE/speaksharp', workflow: 'relativityE/speaksharp/.github/workflows/rc-gates.yml@refs/heads/main',
    runId: '43583228045', runAttempt: '1', role: 'rwt-journey' };
const OWNER = '11111111-1111-4111-8111-111111111111';
const client = (reply: { data: unknown; error: { code?: string } | null }) => {
    const rpc = vi.fn(async () => reply);
    return { admin: { rpc } as unknown as FenceRpcClient, rpc };
};

describe('#1811 feedback fence helper', () => {
    it('derives the run key exactly as the database does, and refuses malformed parts', () => {
        expect(fenceRunKey(BINDING, 'AHT-08')).toBe('43583228045-1-AHT-08');
        expect(fenceRunKey(BINDING, 'AHT-07+AHT-08')).toBe('43583228045-1-AHT-07+AHT-08');
        expect(() => fenceRunKey({ ...BINDING, runId: '0' }, 'AHT-02')).toThrow(/invalid run key/);
        expect(() => fenceRunKey(BINDING, 'AHT-03' as never)).toThrow(/invalid run key/);
    });

    it('opens with the exact binding, case and cap, and accepts only the expected run key', async () => {
        const ok = client({ data: '43583228045-1-AHT-02', error: null });
        await expect(openFeedbackFence(ok.admin, OWNER, BINDING, 'AHT-02', 1)).resolves.toBe('43583228045-1-AHT-02');
        expect(ok.rpc).toHaveBeenCalledWith('open_rwt_feedback_fence_v1', { p_owner: OWNER, p_binding: BINDING, p_case: 'AHT-02', p_key_cap: 1 });
        await expect(openFeedbackFence(client({ data: '1-1-AHT-02', error: null }).admin, OWNER, BINDING, 'AHT-02', 1))
            .rejects.toThrow(/unexpected run key/);
        await expect(openFeedbackFence(client({ data: null, error: { code: '42501' } }).admin, OWNER, BINDING, 'AHT-02', 1))
            .rejects.toThrow(/open failed \(fail closed\): 42501/);
        await expect(openFeedbackFence(ok.admin, OWNER, BINDING, 'AHT-02', 0)).rejects.toThrow(/key cap/);
        await expect(openFeedbackFence(ok.admin, OWNER, BINDING, 'AHT-02', 9)).rejects.toThrow(/key cap/);
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

    it('PASSes cleanup only on a zero readback with nothing foreign and no over-deletion', () => {
        const closed = { state: 'closed' as const, reports: 2, keys: 1 };
        expect(fenceCleanupVerdict(closed, { deleted: 2, residue: 0, foreign: 0, state: 'cleaned' }).verdict).toBe('PASS');
        expect(fenceCleanupVerdict(null, { deleted: 0, residue: 0, foreign: 0, state: 'cleaned' }).verdict).toBe('FAIL');
        expect(fenceCleanupVerdict(closed, null).verdict).toBe('FAIL');
        expect(fenceCleanupVerdict(closed, { deleted: 1, residue: 1, foreign: 0, state: 'closed' }).verdict).toBe('FAIL');
        expect(fenceCleanupVerdict(closed, { deleted: 1, residue: 0, foreign: 1, state: 'closed' }).verdict).toBe('FAIL');
        expect(fenceCleanupVerdict(closed, { deleted: 3, residue: 0, foreign: 0, state: 'cleaned' }).verdict).toBe('FAIL');
    });
});
