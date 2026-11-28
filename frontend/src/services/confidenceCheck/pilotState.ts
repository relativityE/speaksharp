/**
 * Practice confidence check pilot — SESSION-ONLY state (spec Revision 1).
 *
 * Held in this module's memory only: no server write, no browser storage, no telemetry. A reload, a sign-out or a
 * different signed-in owner starts empty. Answers are never sent anywhere; they exist only to show the user's own
 * "You said" line beside the review, separately from anything measured.
 *
 * One loop at a time:
 *   - `pre` is asked only after the user EXPLICITLY starts a loop ("Start a practice loop" — a separate choice from the
 *     rating, which is then optional). A loop that begins later through "Practice again" gets no invented baseline.
 *   - a repeat take (in-session Practice again / Retry this set, or a linked repeat started from a saved review) arms
 *     `repeatPending`; its after screen asks `post` and the target chip BEFORE the review is shown, with an immediate
 *     way to skip straight to the review. Leaving that screen first (Progress, History, anywhere) counts as a skip.
 */
export type ReadinessRating = 1 | 2 | 3 | 4 | 5;
export type TargetFeel = 'easier' | 'same' | 'harder' | 'not_sure';
export type Answer<T> = T | 'skipped' | null;

export interface ConfidencePilotState {
    ownerId: string;
    /** The user chose "Start a practice loop" on the before screen (an explicit loop, not a rating). */
    loopStarted: boolean;
    /** Answered on the before-take card of an explicitly started loop; null when no loop was explicitly started. */
    pre: Answer<ReadinessRating>;
    /** A take of this loop has reached its after screen, so a later plain Start from the before screen is a new take,
     *  not this loop's first (a Start that fails before any audio, e.g. a mic permission retry, keeps the answer). */
    tookTake: boolean;
    /** A repeat take was started and its post questions have not been answered or skipped yet. */
    repeatPending: boolean;
    /** The pending repeat has actually recorded (reached `during`), so an after screen now belongs to it. */
    repeatRecorded: boolean;
    /** The pending repeat's own after screen is showing: ask before revealing its review. */
    askPost: boolean;
    post: Answer<ReadinessRating>;
    feel: Answer<TargetFeel>;
}

export const READINESS_LABELS: Record<ReadinessRating, string> = {
    1: 'Not ready', 2: 'A little', 3: 'Somewhat', 4: 'Mostly', 5: 'Fully ready',
};
export const TARGET_FEEL_LABELS: Record<TargetFeel, string> = {
    easier: 'Easier', same: 'About the same', harder: 'Harder', not_sure: 'Not sure',
};

let state: ConfidencePilotState | null = null;
const listeners = new Set<() => void>();
const publish = (next: ConfidencePilotState | null) => { state = next; listeners.forEach((listener) => listener()); };

export const subscribeConfidencePilot = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
export const confidencePilotSnapshot = (): ConfidencePilotState | null => state;

/** This owner's state, or null (another owner's answers are never shown). */
export const pilotFor = (snapshot: ConfidencePilotState | null, ownerId: string | null): ConfidencePilotState | null =>
    snapshot && ownerId && snapshot.ownerId === ownerId ? snapshot : null;

const blank = (ownerId: string): ConfidencePilotState => ({ ownerId, loopStarted: false, pre: null, tookTake: false, repeatPending: false, repeatRecorded: false, askPost: false, post: null, feel: null });

/** Before-take card: the user explicitly starts a practice loop. Rating is a separate, optional step after this. */
export function startLoop(ownerId: string): void {
    publish({ ...blank(ownerId), loopStarted: true });
}

/** Readiness before the first take of an explicitly started loop. Ignored unless the loop was started. */
export function answerPre(ownerId: string, answer: ReadinessRating | 'skipped'): void {
    const current = pilotFor(state, ownerId);
    if (current?.loopStarted && !current.tookTake) publish({ ...current, pre: answer });
}

/**
 * A take is starting.
 *   - `repeat`: an in-session Practice again / Retry this set — the SAME loop, so its baseline is kept.
 *   - `linked`: a linked repeat accepted from a saved review — its OWN loop, never an earlier loop's baseline.
 *   - `first`: the first take from the before screen: keeps a `pre` answered on that screen, drops anything older.
 */
export function noteTakeStart(ownerId: string, kind: 'first' | 'repeat' | 'linked'): void {
    const current = pilotFor(state, ownerId);
    if (kind === 'linked') {
        publish({ ...blank(ownerId), repeatPending: true });
        return;
    }
    if (kind === 'repeat') {
        publish({ ...(current ?? blank(ownerId)), repeatPending: true, repeatRecorded: false, askPost: false, post: null, feel: null });
        return;
    }
    if (current && current.loopStarted && !current.tookTake) return;
    if (state !== null) publish(null);
}

/**
 * The page's state changed. Recording (`during`) marks a pending repeat as recorded; the next `after` is then the
 * repeat's own after screen (the previous take's after screen, still showing while the repeat starts, never asks).
 */
export function noteSessionPhase(ownerId: string, phase: 'before' | 'during' | 'after'): void {
    const current = pilotFor(state, ownerId);
    if (!current) return;
    if (phase === 'during' && current.repeatPending && !current.repeatRecorded) publish({ ...current, repeatRecorded: true });
    else if (phase === 'after') {
        const next = { ...current, tookTake: true, askPost: current.askPost || (current.repeatPending && current.repeatRecorded) };
        if (next.tookTake !== current.tookTake || next.askPost !== current.askPost) publish(next);
    }
}

export function answerPost(ownerId: string, answer: ReadinessRating | 'skipped'): void {
    const current = pilotFor(state, ownerId);
    if (current?.askPost) publish({ ...current, post: answer });
}

export function answerFeel(ownerId: string, answer: TargetFeel): void {
    const current = pilotFor(state, ownerId);
    if (current?.askPost) publish({ ...current, feel: answer });
}

/**
 * Show the review: anything unanswered becomes skipped (never a low score), and the questions are not asked again.
 * Also used when the user leaves the repeat's review screen before answering (opening Progress or History = skip).
 */
export function revealReview(ownerId: string): void {
    const current = pilotFor(state, ownerId);
    if (!current?.askPost) return;
    publish({ ...current, repeatPending: false, repeatRecorded: false, askPost: false, post: current.post ?? 'skipped', feel: current.feel ?? 'skipped' });
}

export function clearConfidencePilot(): void {
    publish(null);
}
