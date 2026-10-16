/**
 * #1258 C10 (PM 6207105255 item 1) — ONE identity per accepted Start press, and the fact of its settlement.
 *
 * The page's "Getting your mic ready…" wait is PRESENTATION: the controller can clear it (TERMINATED) while the hook's
 * original start call is still in flight. So `Try again` must not read "the wait ended" as "the old start finished".
 * Each press registers an attempt here; its `settled` promise resolves only when THAT hook invocation has actually
 * returned. A newer press replaces `current`, so anything holding an older id can tell it has been superseded.
 */
export interface StartAttempt {
    readonly id: string;
    readonly settled: Promise<void>;
    readonly isSettled: () => boolean;
}

let sequence = 0;
let current: StartAttempt | null = null;

/** Register a new accepted Start. Call `settle()` exactly when this invocation returns (its `finally`). */
export function beginStartAttempt(): { attempt: StartAttempt; settle: () => void } {
    let resolve: () => void = () => undefined;
    let done = false;
    const settled = new Promise<void>((r) => { resolve = r; });
    sequence += 1;
    const attempt: StartAttempt = { id: `start-attempt-${sequence}`, settled, isSettled: () => done };
    current = attempt;
    return { attempt, settle: () => { done = true; resolve(); } };
}

/** The most recent accepted Start, settled or not. */
export function currentStartAttempt(): StartAttempt | null {
    return current;
}

export function __resetStartAttemptsForTests(): void {
    current = null;
    sequence = 0;
}
