/**
 * J1 option B (Sam, 21 Nov): a take that is meant to SAVE must record past the product's minimum before its Stop. The product
 * discards an explicit Stop under MIN_SESSION_DURATION_SECONDS (5 s, useSessionLifecycle.ts); live run 44955832135 stopped J1's
 * takes 3 and 4 at ~2 s and both were discarded.
 *
 * The hold is measured from the moment recording was proven, plus a small buffer, and counts only while the SAME recorder stays
 * live. The recorder bar present at the start is pinned inside the page; every poll checks that the bar the page renders is still
 * that element and that its own Stop control is enabled. The loop always takes a final poll AT OR AFTER the deadline (Sam on
 * b3455e86), and the deliberate Stop is clicked in the same page task as that last check, on the pinned bar's own Stop
 * (`guardedStopClick`'s pattern, #1897): a recorder replaced in the last interval can neither pass the hold nor receive the Stop.
 */
import type { Page } from '@playwright/test';

export const SAVE_MINIMUM_MS = 5_000;
export const SAVE_HOLD_BUFFER_MS = 1_500;
export const RECORDER_BAR_SELECTOR = '[data-testid="recorder-bar"]';
export const RECORDER_STOP_SELECTOR = '[data-testid="recorder-stop"]';
const PIN = '__SS_SAVE_HOLD_BAR__';

export type SaveHold = { ok: boolean; heldMs: number; reason: string | null };
/** One observation: is the rendered bar still the pinned one, and is its own Stop enabled; `t` is when it was taken. */
export type SaveHoldPoll = { t: number; same: boolean | null; stopEnabled: boolean | null };
export type StopClick = 'clicked' | 'replaced' | 'not-stoppable' | 'unreadable';

/**
 * The hold's verdict. `heldMs` is the time from the proven recording start to the LAST validated observation, so a hold that
 * slept past the deadline without observing the recorder there never counts.
 */
export function saveHoldVerdict(recordingAt: number, polls: readonly SaveHoldPoll[]): SaveHold {
    const last = polls.length > 0 ? polls[polls.length - 1] : undefined;
    const heldMs = last ? last.t - recordingAt : 0;
    if (!last) return { ok: false, heldMs, reason: 'the recording was never observed during the hold' };
    if (polls.some((p) => p.same !== true)) return { ok: false, heldMs, reason: 'the recording was dropped or replaced during the hold' };
    if (polls.some((p) => p.stopEnabled !== true)) return { ok: false, heldMs, reason: 'the recording stopped being stoppable during the hold' };
    if (!(heldMs >= SAVE_MINIMUM_MS + SAVE_HOLD_BUFFER_MS)) return { ok: false, heldMs, reason: 'the take was not held past the 5 s save minimum' };
    return { ok: true, heldMs, reason: null };
}

/** The deliberate Stop's outcome folded into the hold: only a click on the pinned bar's own Stop completes it. */
export function stopClickVerdict(hold: SaveHold, click: StopClick | null): SaveHold {
    if (!hold.ok) return hold;
    if (click === 'clicked') return hold;
    return { ok: false, heldMs: hold.heldMs, reason: click === 'replaced' ? 'the recording was replaced just before Stop'
        : click === 'not-stoppable' ? 'the recording was not stoppable at Stop' : 'the recorder could not be read at Stop' };
}

export interface SaveHoldDeps {
    pin: () => Promise<boolean | null>;
    read: () => Promise<{ same: boolean | null; stopEnabled: boolean | null }>;
    clickPinnedStop: () => Promise<StopClick>;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
}

/** The hold and its Stop, over injectable seams (tested with a fake clock). Clicks Stop only after a full, validated hold. */
export async function holdThenStopWith(deps: SaveHoldDeps, recordingAt: number, pollMs = 250): Promise<{ hold: SaveHold; clicked: boolean }> {
    const polls: SaveHoldPoll[] = [];
    if ((await deps.pin().catch(() => null)) !== true) {
        return { hold: { ok: false, heldMs: 0, reason: 'the recording was never observed during the hold' }, clicked: false };
    }
    const target = recordingAt + SAVE_MINIMUM_MS + SAVE_HOLD_BUFFER_MS;
    for (;;) {
        const seen = await deps.read().catch(() => ({ same: null, stopEnabled: null }));
        polls.push({ t: deps.now(), ...seen });
        if (seen.same !== true || seen.stopEnabled !== true) break;
        const left = target - deps.now();
        if (left <= 0) break; // this poll was taken at or after the deadline
        await deps.sleep(Math.min(pollMs, left));
    }
    const hold = saveHoldVerdict(recordingAt, polls);
    if (!hold.ok) return { hold, clicked: false };
    const click = await deps.clickPinnedStop().catch(() => 'unreadable' as const);
    return { hold: stopClickVerdict(hold, click), clicked: click === 'clicked' };
}

/** The page seams: pin the rendered recorder bar, re-check it is still the rendered one, and click its own Stop atomically. */
export function pageSaveHoldDeps(page: Page): SaveHoldDeps {
    return {
        pin: () => page.evaluate(([bar, pin]) => {
            const el = document.querySelector(bar);
            (window as unknown as Record<string, unknown>)[pin] = el;
            return el !== null;
        }, [RECORDER_BAR_SELECTOR, PIN] as const),
        read: () => page.evaluate(([bar, stop, pin]) => {
            const pinned = (window as unknown as Record<string, Element | null>)[pin] ?? null;
            const same = pinned !== null && pinned.isConnected && document.querySelector(bar) === pinned;
            const control = same ? pinned!.querySelector(stop) as HTMLButtonElement | null : null;
            return { same, stopEnabled: control !== null && !control.disabled };
        }, [RECORDER_BAR_SELECTOR, RECORDER_STOP_SELECTOR, PIN] as const),
        clickPinnedStop: () => page.evaluate(([bar, stop, pin]) => {
            const w = window as unknown as Record<string, Element | null>;
            const pinned = w[pin] ?? null;
            w[pin] = null;
            if (pinned === null || !pinned.isConnected || document.querySelector(bar) !== pinned) return 'replaced' as const;
            const control = pinned.querySelector(stop) as HTMLButtonElement | null;
            if (control === null || control.disabled) return 'not-stoppable' as const;
            control.click();
            return 'clicked' as const;
        }, [RECORDER_BAR_SELECTOR, RECORDER_STOP_SELECTOR, PIN] as const),
        now: () => Date.now(),
        sleep: (ms) => page.waitForTimeout(ms),
    };
}

/** Holds the live take past the save minimum and, only then, clicks the pinned recorder's own Stop. */
export function holdThenStop(page: Page, recordingAt: number): Promise<{ hold: SaveHold; clicked: boolean }> {
    return holdThenStopWith(pageSaveHoldDeps(page), recordingAt);
}
