import { describe, expect, it, vi } from 'vitest';
import { FINALIZE_CLEANUP_MS, FinalizationSteps, OwnedCleanup, finalizeOwnedCleanup } from '../live/helpers/rwtWatchdog';

function witness() {
    const rows: { step: string; verdict: string }[] = [];
    const receipt = { rows, row: (step: string, verdict: string) => rows.push({ step, verdict }) };
    return { rows, receipt: receipt as unknown as Parameters<typeof finalizeOwnedCleanup>[1] };
}

describe('Retry Save cleanup finalization', () => {
    it('does not report an unverified deletion as successful cleanup', async () => {
        vi.useFakeTimers();
        try {
            const { receipt, rows } = witness();
            const steps = new FinalizationSteps();
            const cleanup = new OwnedCleanup(() => new Promise<string>(() => {}));
            const done = finalizeOwnedCleanup(steps, receipt, cleanup);
            await vi.advanceTimersByTimeAsync(FINALIZE_CLEANUP_MS);
            expect(await done).toBe('pending');
            expect(rows[0]?.verdict).toBe('FAIL');
        } finally {
            vi.useRealTimers();
        }
    });

    it('makes failed residue readback a failed journey finalization', async () => {
        const { receipt, rows } = witness();
        const steps = new FinalizationSteps();
        const cleanup = new OwnedCleanup(async () => { throw new Error('residue readback unavailable'); });
        expect(await finalizeOwnedCleanup(steps, receipt, cleanup)).toBe('failed');
        steps.report(receipt);
        expect(rows.at(-1)?.verdict).toBe('FAIL');
    });

    it('reports PASS when the owned deletion settles', async () => {
        const { receipt, rows } = witness();
        const steps = new FinalizationSteps();
        expect(await finalizeOwnedCleanup(steps, receipt, new OwnedCleanup(async () => 'run-owner'))).toBe('deleted');
        steps.report(receipt);
        expect(rows).toEqual([{ step: 'run-owned cleanup', verdict: 'PASS' }]);
    });
});
