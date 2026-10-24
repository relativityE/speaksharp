/**
 * #1593 case 4 (CLI audit 1792782759, Sam selection 1792798707) — THE RETURN STATE IS SETTLED, NOT SAMPLED ONCE.
 *
 * After returning to Open Mic, the spec waited only for `mic-card` to be visible and then read `data-model-status` and the
 * primary control's state once. A healthy remount still resolving availability could be sampled mid-transition (loading,
 * or a disabled Start) and written as FAIL. The return state is now polled to a fixed deadline: PASS needs the control that
 * matches the published model status to be present, visible AND enabled on consecutive samples; anything else at the
 * deadline is FAIL with every observed state retained. A genuinely stuck or unknown state still fails. The spec keeps its
 * own Playwright reads; this module only decides when they have settled.
 *
 * Sam HOLD on 81a442b2 — THE DEADLINE IS ABSOLUTE. Each read is raced against the remaining budget and receives it, a
 * success counts only if its confirming read completed within the deadline, and a read that resolves (or rejects) after
 * the verdict is ignored: the returned evidence is a frozen copy and the late promise's outcome is always consumed.
 */

/** The primary control the mic card must offer for each published model status. */
export const RETURN_CONTROL_FOR_STATUS: Readonly<Record<string, string>> = Object.freeze({
    'download-required': 'mic-download',
    ready: 'mic-start',
    idle: 'mic-start',
    warming: 'mic-start',
    error: 'mic-retry',
    'init-failed': 'mic-retry',
});

export interface ReturnControlState {
    present: boolean;
    visible: boolean;
    enabled: boolean;
    ariaLabel: string | null;
}

export interface ReturnControlSample {
    modelStatus: string | null;
    expectedControl: string | null;
    shellState: string | null;
    start: ReturnControlState;
    download: ReturnControlState;
    retry: ReturnControlState;
    /** The expected control exists, is visible and is enabled in this one sample. */
    actionable: boolean;
}

/** Build one sample from the spec's reads; the decision fields are derived here, never supplied by the caller. */
export function returnControlSample(
    modelStatus: string | null,
    shellState: string | null,
    controls: { start: ReturnControlState; download: ReturnControlState; retry: ReturnControlState },
): ReturnControlSample {
    const expectedControl = modelStatus ? RETURN_CONTROL_FOR_STATUS[modelStatus] ?? null : null;
    const byId: Record<string, ReturnControlState> = {
        'mic-start': controls.start, 'mic-download': controls.download, 'mic-retry': controls.retry,
    };
    const expected = expectedControl ? byId[expectedControl] : undefined;
    return {
        modelStatus, expectedControl, shellState, ...controls,
        actionable: Boolean(expected?.present && expected.visible && expected.enabled),
    };
}

export interface SettleReturnControlOptions {
    /** Absolute deadline measured from the start of the first read. */
    deadlineMs: number;
    /** Pause between reads; also the minimum spacing of the consecutive settled samples. */
    intervalMs: number;
    /** Consecutive actionable samples, with the same expected control, that count as settled. */
    stableSamples: number;
}

export interface SettledReturnControl {
    settled: boolean;
    last: ReturnControlSample | null;
    /** Every sample that completed within the deadline, in order (closed status strings, closed copy and booleans). */
    samples: ReturnControlSample[];
    elapsedMs: number;
    /** A read that rejected within the budget: its own outcome, never coerced into "not enabled". */
    readErrors: number;
    /** A read still pending when the budget ran out. */
    readTimeouts: number;
}

export const RETURN_SETTLE_DEFAULTS: Readonly<SettleReturnControlOptions> = Object.freeze({
    deadlineMs: 30_000,
    intervalMs: 250,
    stableSamples: 2,
});

type Bounded<T> = { kind: 'value'; value: T } | { kind: 'error' } | { kind: 'timeout' };

/** Race `work` against `ms`. The work's rejection is always consumed, so a late failure is never unhandled. */
function withinBudget<T>(work: Promise<T>, ms: number): Promise<Bounded<T>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<Bounded<T>>((resolve) => { timer = setTimeout(() => resolve({ kind: 'timeout' }), ms); });
    const settled = work.then((value): Bounded<T> => ({ kind: 'value', value }), (): Bounded<T> => ({ kind: 'error' }));
    return Promise.race([settled, budget]).finally(() => clearTimeout(timer));
}

/**
 * Poll `read(remainingMs)` until the expected control is actionable on `stableSamples` consecutive reads for the same
 * expected control, all completed within the absolute deadline; otherwise FAIL once the deadline is reached. A flicker
 * or a change of expected control restarts the count; a rejected or timed-out read counts as not actionable.
 */
export async function settleReturnControlState(
    read: (remainingMs: number) => Promise<ReturnControlSample>,
    options: SettleReturnControlOptions = RETURN_SETTLE_DEFAULTS,
): Promise<SettledReturnControl> {
    const started = Date.now();
    const deadline = started + options.deadlineMs;
    const samples: ReturnControlSample[] = [];
    let readErrors = 0;
    let readTimeouts = 0;
    let run = 0;
    let runControl: string | null = null;
    const verdict = (settled: boolean, last: ReturnControlSample | null): SettledReturnControl => ({
        settled, last, samples: samples.slice(), elapsedMs: Date.now() - started, readErrors, readTimeouts,
    });
    for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return verdict(false, samples[samples.length - 1] ?? null);
        let work: Promise<ReturnControlSample>;
        try {
            work = read(remaining);
        } catch (error) {
            work = Promise.reject(error);
        }
        const outcome = await withinBudget(work, remaining);
        if (outcome.kind === 'timeout' || Date.now() > deadline) {
            if (outcome.kind === 'timeout') readTimeouts += 1;
            return verdict(false, samples[samples.length - 1] ?? null);
        }
        const sample = outcome.kind === 'value' ? outcome.value : null;
        if (!sample) readErrors += 1;
        if (sample?.actionable && sample.expectedControl === runControl) {
            run += 1;
        } else if (sample?.actionable) {
            run = 1;
            runControl = sample.expectedControl;
        } else {
            run = 0;
            runControl = null;
        }
        if (sample) samples.push(sample);
        if (run >= options.stableSamples) return verdict(true, sample);
        const pause = Math.min(options.intervalMs, deadline - Date.now());
        if (pause <= 0) return verdict(false, samples[samples.length - 1] ?? null);
        await new Promise<void>((resolve) => setTimeout(resolve, pause));
    }
}
