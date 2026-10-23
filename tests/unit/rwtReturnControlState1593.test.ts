/**
 * #1593 case 4 (Sam selection 1792798707) — the return to Open Mic is judged on a SETTLED state within a fixed deadline,
 * not on one sample taken the moment the mic card appears. Scripted reads and a fake clock drive the same helper the spec
 * calls, including the old single-read rule as a causal control.
 */
import { describe, expect, it } from 'vitest';
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

/** Replays `script`, then repeats its last entry; `'throw'` makes that read fail. */
function scripted(script: ReadonlyArray<ReturnControlSample | 'throw'>) {
    let i = 0;
    return async (): Promise<ReturnControlSample> => {
        const next = script[Math.min(i, script.length - 1)];
        i += 1;
        if (next === 'throw') throw new Error('read failed');
        return next;
    };
}

function fakeClock(): Pick<SettleReturnControlOptions, 'now' | 'sleep'> {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

const settle = (script: ReadonlyArray<ReturnControlSample | 'throw'>, options: Partial<SettleReturnControlOptions> = {}) =>
    settleReturnControlState(scripted(script), { ...RETURN_SETTLE_DEFAULTS, ...fakeClock(), ...options });

/** The pre-fix spec rule: one read taken when the mic card appears. */
const singleRead = (script: ReadonlyArray<ReturnControlSample | 'throw'>) =>
    settle(script, { deadlineMs: 0, stableSamples: 1 });

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

describe('settleReturnControlState — bounded settle within a fixed deadline', () => {
    it('CAUSAL: a healthy remount still resolving availability FAILS the old single read and PASSES the settled read', async () => {
        const healthy = [loadingDisabled, loadingDisabled, readyDisabled, readyEnabled];
        expect((await singleRead(healthy)).settled, 'the old rule wrote the transient as FAIL').toBe(false);
        const settled = await settle(healthy);
        expect(settled.settled).toBe(true);
        expect(settled.last).toBe(readyEnabled);
        expect(settled.samples.map((s) => s.actionable)).toEqual([false, false, false, true, true]);
        expect(settled.elapsedMs).toBeLessThan(RETURN_SETTLE_DEFAULTS.deadlineMs);
    });

    it('a genuinely stuck disabled Start still FAILS, at the deadline, with every sample retained', async () => {
        const stuck = await settle([readyDisabled]);
        expect(stuck.settled).toBe(false);
        expect(stuck.elapsedMs).toBeGreaterThanOrEqual(RETURN_SETTLE_DEFAULTS.deadlineMs);
        expect(stuck.last).toBe(readyDisabled);
        expect(stuck.samples.length).toBe(RETURN_SETTLE_DEFAULTS.deadlineMs / RETURN_SETTLE_DEFAULTS.intervalMs + 1);
    });

    it('a status that never maps to an action (loading forever) FAILS at the deadline', async () => {
        const unknown = await settle([loadingDisabled]);
        expect(unknown.settled).toBe(false);
        expect(unknown.last?.expectedControl).toBeNull();
    });

    it('a flicker is not settled: actionable samples must be consecutive', async () => {
        const flicker = await settle(Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? readyEnabled : readyDisabled)));
        expect(flicker.settled).toBe(false);
    });

    it('a change of expected control restarts the count', async () => {
        const changed = await settle([readyEnabled, downloadEnabled, readyEnabled, readyEnabled]);
        expect(changed.settled).toBe(true);
        expect(changed.samples.map((s) => s.expectedControl)).toEqual(['mic-start', 'mic-download', 'mic-start', 'mic-start']);
    });

    it('a read error is reported, never coerced into a pass; persistent errors FAIL', async () => {
        const recovered = await settle(['throw', readyEnabled, readyEnabled]);
        expect(recovered).toMatchObject({ settled: true, readErrors: 1 });
        const broken = await settle(['throw']);
        expect(broken.settled).toBe(false);
        expect(broken.readErrors).toBeGreaterThan(1);
        expect(broken.last).toBeNull();
    });
});
