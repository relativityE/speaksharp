/**
 * #1593 case 4 (CLI audit 1792782759, Sam selection 1792798707) — THE RETURN STATE IS SETTLED, NOT SAMPLED ONCE.
 *
 * After returning to Open Mic, the spec waited only for `mic-card` to be visible and then read `data-model-status` and the
 * primary control's state once. A healthy remount still resolving availability could be sampled mid-transition (loading,
 * or a disabled Start) and written as FAIL. The return state is now polled to a fixed deadline: PASS needs the control that
 * matches the published model status to be present, visible AND enabled on consecutive samples; anything else at the
 * deadline is FAIL with every observed state retained. A genuinely stuck or unknown state still fails. The spec keeps its
 * own Playwright reads; this module only decides when they have settled.
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
    /** Fixed deadline measured from the first read. */
    deadlineMs: number;
    /** Pause between reads; also the minimum spacing of the consecutive settled samples. */
    intervalMs: number;
    /** Consecutive actionable samples, with the same expected control, that count as settled. */
    stableSamples: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

export interface SettledReturnControl {
    settled: boolean;
    last: ReturnControlSample | null;
    /** Every sample read, in order (closed status strings, closed product copy and booleans only). */
    samples: ReturnControlSample[];
    elapsedMs: number;
    /** A read that threw is its own outcome, never coerced into "not enabled". */
    readErrors: number;
}

export const RETURN_SETTLE_DEFAULTS: Readonly<SettleReturnControlOptions> = Object.freeze({
    deadlineMs: 30_000,
    intervalMs: 250,
    stableSamples: 2,
});

/**
 * Poll `read` until the expected control is actionable on `stableSamples` consecutive reads for the same expected
 * control, or the deadline passes. A flicker (actionable, then not) or a change of expected control restarts the count;
 * a read error counts as not actionable and is reported separately.
 */
export async function settleReturnControlState(
    read: () => Promise<ReturnControlSample>,
    options: SettleReturnControlOptions = RETURN_SETTLE_DEFAULTS,
): Promise<SettledReturnControl> {
    const now = options.now ?? (() => Date.now());
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const started = now();
    const samples: ReturnControlSample[] = [];
    let readErrors = 0;
    let run = 0;
    let runControl: string | null = null;
    for (;;) {
        let sample: ReturnControlSample | null = null;
        try {
            sample = await read();
        } catch {
            readErrors += 1;
        }
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
        const elapsedMs = now() - started;
        if (run >= options.stableSamples) return { settled: true, last: sample, samples, elapsedMs, readErrors };
        if (elapsedMs >= options.deadlineMs) {
            return { settled: false, last: samples[samples.length - 1] ?? null, samples, elapsedMs, readErrors };
        }
        await sleep(options.intervalMs);
    }
}
