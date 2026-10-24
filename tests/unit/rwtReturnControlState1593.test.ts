/**
 * #1593 case 4 (Sam selection 1792798707; HOLD on 81a442b2) — the return to Open Mic is judged on a SETTLED state within
 * an ABSOLUTE deadline, not on one sample taken the moment the mic card appears. Scripted reads under fake timers drive the
 * same helper the spec calls; the old single-read rule is the causal control.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    RETURN_SETTLE_DEFAULTS, returnControlSample, settleReturnControlState,
    type ReturnControlSample, type ReturnControlState, type SettleReturnControlOptions,
} from '../live/helpers/rwtReturnControlState';

const absent: ReturnControlState = { present: false, visible: false, enabled: false, ariaLabel: null };
const shown = (enabled: boolean, ariaLabel = 'Start recording'): ReturnControlState => ({ present: true, visible: true, enabled, ariaLabel });

const loadingDisabled = returnControlSample('loading', 'idle', { start: shown(false, 'Starting…'), download: absent, retry: absent });
const readyDisabled = returnControlSample('ready', 'idle', { start: shown(false), download: absent, retry: absent });
const readyEnabled = returnControlSample('ready', 'idle', { start: shown(true), download: absent, retry: absent });
const downloadEnabled = returnControlSample('download-required', 'idle', { start: absent, download: shown(true, 'Download model'), retry: absent });

const { deadlineMs } = RETURN_SETTLE_DEFAULTS;

type Step = ReturnControlSample | 'throw' | 'hang' | { sample: ReturnControlSample; delayMs: number };

/** Replays `script` (then repeats its last step), recording the budget each read was given. */
function scripted(script: readonly Step[]) {
    const budgets: number[] = [];
    let i = 0;
    const read = (remainingMs: number): Promise<ReturnControlSample> => {
        budgets.push(remainingMs);
        const step = script[Math.min(i, script.length - 1)];
        i += 1;
        if (step === 'throw') return Promise.reject(new Error('read failed'));
        if (step === 'hang') return new Promise<ReturnControlSample>(() => undefined);
        if ('delayMs' in step) return new Promise((resolve) => setTimeout(() => resolve(step.sample), step.delayMs));
        return Promise.resolve(step);
    };
    return { read, budgets };
}

async function settle(script: readonly Step[], options: Partial<SettleReturnControlOptions> = {}) {
    const { read, budgets } = scripted(script);
    const pending = settleReturnControlState(read, { ...RETURN_SETTLE_DEFAULTS, ...options });
    await vi.runAllTimersAsync();
    return { result: await pending, budgets };
}

/** The pre-fix spec rule: one read taken when the mic card appears, PASS only if that sample is actionable. */
const oldSingleRead = async (script: readonly Step[]) => (await scripted(script).read(deadlineMs)).actionable;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('returnControlSample — the expected control follows the published model status', () => {
    it('maps each status to its control and is actionable only when that control is present, visible and enabled', () => {
        expect(readyEnabled).toMatchObject({ expectedControl: 'mic-start', actionable: true });
        expect(readyDisabled.actionable).toBe(false);
        expect(downloadEnabled).toMatchObject({ expectedControl: 'mic-download', actionable: true });
        expect(returnControlSample('init-failed', null, { start: absent, download: absent, retry: shown(true, 'Retry') }))
            .toMatchObject({ expectedControl: 'mic-retry', actionable: true });
        expect(returnControlSample('ready', null, { start: { ...shown(true), visible: false }, download: absent, retry: absent }).actionable)
            .toBe(false);
        // An enabled control that does not match the status is not the truthful action.
        expect(returnControlSample('download-required', null, { start: shown(true), download: absent, retry: absent }).actionable)
            .toBe(false);
        expect(loadingDisabled).toMatchObject({ expectedControl: null, actionable: false });
        expect(returnControlSample(null, null, { start: shown(true), download: absent, retry: absent }).actionable).toBe(false);
    });
});

describe('settleReturnControlState — bounded settle within an absolute deadline', () => {
    it('CAUSAL: a healthy remount still resolving availability FAILS the old single read and PASSES the settled read', async () => {
        const healthy = [loadingDisabled, loadingDisabled, readyDisabled, readyEnabled];
        expect(await oldSingleRead(healthy), 'the old rule wrote the transient as FAIL').toBe(false);
        const { result } = await settle(healthy);
        expect(result.settled).toBe(true);
        expect(result.last).toBe(readyEnabled);
        expect(result.samples.map((s) => s.actionable)).toEqual([false, false, false, true, true]);
        expect(result.elapsedMs).toBeLessThan(deadlineMs);
    });

    it('a genuinely stuck disabled Start still FAILS, at the deadline, with every sample retained', async () => {
        const { result } = await settle([readyDisabled]);
        expect(result.settled).toBe(false);
        expect(result.elapsedMs).toBe(deadlineMs);
        expect(result.last).toBe(readyDisabled);
        // Reads start at t = 0, 250, …, 29,750; none starts at or after the absolute deadline.
        expect(result.samples.length).toBe(deadlineMs / RETURN_SETTLE_DEFAULTS.intervalMs);
    });

    it('a status that never maps to an action (loading forever) FAILS at the deadline', async () => {
        const { result } = await settle([loadingDisabled]);
        expect(result.settled).toBe(false);
        expect(result.last?.expectedControl).toBeNull();
    });

    it('a flicker is not settled: actionable samples must be consecutive', async () => {
        const { result } = await settle(Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? readyEnabled : readyDisabled)));
        expect(result.settled).toBe(false);
    });

    it('a change of expected control restarts the count', async () => {
        const { result } = await settle([readyEnabled, downloadEnabled, readyEnabled, readyEnabled]);
        expect(result.settled).toBe(true);
        expect(result.samples.map((s) => s.expectedControl)).toEqual(['mic-start', 'mic-download', 'mic-start', 'mic-start']);
    });

    it('a read error is reported, never coerced into a pass; persistent errors FAIL', async () => {
        const recovered = await settle(['throw', readyEnabled, readyEnabled]);
        expect(recovered.result).toMatchObject({ settled: true, readErrors: 1 });
        const broken = await settle(['throw']);
        expect(broken.result.settled).toBe(false);
        expect(broken.result.readErrors).toBeGreaterThan(1);
        expect(broken.result.last).toBeNull();
    });
});

describe('the deadline is absolute (Sam HOLD on 81a442b2)', () => {
    it('CAUSAL: a confirming actionable read that would complete after the bound FAILS at the bound', async () => {
        // Read 1 is actionable at t=0; read 2 starts at t=250 and would only complete at t=30,250.
        const { result } = await settle([readyEnabled, { sample: readyEnabled, delayMs: deadlineMs }]);
        expect(result.settled).toBe(false);
        expect(result.readTimeouts).toBe(1);
        expect(result.elapsedMs).toBe(deadlineMs);
        expect(result.samples).toEqual([readyEnabled]);
    });

    it('CAUSAL: a read that never resolves FAILS at the deadline instead of hanging', async () => {
        const { result } = await settle(['hang']);
        expect(result).toMatchObject({ settled: false, readTimeouts: 1, last: null, samples: [] });
        expect(result.elapsedMs).toBe(deadlineMs);
    });

    it('a near-deadline success whose confirming read completes in budget still PASSES', async () => {
        const { result } = await settle([
            { sample: readyDisabled, delayMs: 29_000 }, readyEnabled, { sample: readyEnabled, delayMs: 400 },
        ]);
        expect(result.settled).toBe(true);
        expect(result.elapsedMs).toBe(29_900);
        expect(result.elapsedMs).toBeLessThanOrEqual(deadlineMs);
    });

    it('each read receives the remaining budget, which only shrinks', async () => {
        const { budgets } = await settle([loadingDisabled, loadingDisabled, readyEnabled, readyEnabled]);
        expect(budgets[0]).toBe(deadlineMs);
        expect(budgets.every((b, i) => b > 0 && b <= deadlineMs && (i === 0 || b < budgets[i - 1]))).toBe(true);
    });

    it('a late result cannot change the returned evidence, and a late rejection is not unhandled', async () => {
        let rejectLate: (error: Error) => void = () => undefined;
        const read = vi.fn((): Promise<ReturnControlSample> => new Promise((_, reject) => { rejectLate = reject; }));
        const pending = settleReturnControlState(read, RETURN_SETTLE_DEFAULTS);
        await vi.runAllTimersAsync();
        const result = await pending;
        const frozen = JSON.stringify(result);
        rejectLate(new Error('late failure'));
        await vi.runAllTimersAsync();
        expect(JSON.stringify(result)).toBe(frozen);
        expect(result).toMatchObject({ settled: false, readTimeouts: 1 });
        expect(read).toHaveBeenCalledTimes(1);
    });
});
