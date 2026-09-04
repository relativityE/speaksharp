/**
 * #1259 — THE CORRELATION IDENTITY.
 *
 * WHY THIS EXISTS. Before it, not one telemetry event carried a correlation key. `ENVELOPE_KEYS` had
 * none, no event schema declared one, and `PRIVATE_TELEMETRY_ALLOWED_PROPS` had `session_id`
 * deliberately REMOVED as re-identifying — with nothing put in its place. The consequence is not that
 * journeys were hard to reconstruct: they were not reconstructible at all. Ordering across events was
 * inferable only from wall-clock, which cannot separate two recording attempts in one tab, and cannot
 * tell a save that belongs to this take from one that belongs to the previous one.
 *
 * WHAT THIS IS NOT. Not the database session UUID, and not derived from it, from the account, or from
 * anything the user typed. That UUID is the one identifier the database already holds against real
 * content, which is exactly why it was removed from the analytics payload; re-adding it under a new
 * name would undo that decision quietly. These are random values minted in the tab, meaningful only
 * for joining events to each other.
 *
 * TWO SCOPES, BECAUSE ONE IS NOT ENOUGH:
 *
 *   journey_id  — one pass through a product: entry -> setup -> record -> review. Answers "did these
 *                 events belong to the same visit?"
 *   attempt_id  — one recording attempt inside that journey. Answers "was this the first take or the
 *                 second?" F01 is precisely a question about attempt COUNT (one click, two clicks, two
 *                 starts), and a journey-scoped id alone cannot express it.
 *
 * The envelope attaches both at the single capture boundary, so a producer can neither forget them nor
 * forge them.
 */

import { resetInitSequence } from './reinitObservation';

/** Slug-safe, so the value satisfies the same shape rules every other bounded identifier does. */
function mintId(): string {
    try {
        const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
        if (typeof c?.randomUUID === 'function') return c.randomUUID();
    } catch {
        /* fall through to the arithmetic path */
    }
    // No crypto (older embedded webview, some test runners). Uniqueness within a tab is all this
    // needs to provide, and collision here costs a join, not correctness of any measurement.
    return `j-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

let journeyId: string | null = null;
let attemptId: string | null = null;
let attemptSeq = 0;

/**
 * The current journey, minted on first read.
 *
 * Lazy rather than module-load so that importing telemetry does not itself start a journey — a tab
 * that never enters a product should not report one.
 */
export function currentJourneyId(): string {
    if (!journeyId) journeyId = mintId();
    return journeyId;
}

/**
 * Start a NEW journey. Called when the user enters a product, not on every route change: navigating
 * from a session to Analytics and back is one journey, and splitting it would hide exactly the
 * post-session navigation F08 asks about.
 */
export function beginJourney(): string {
    journeyId = mintId();
    attemptId = null;
    attemptSeq = 0;
    // #1259 F15 — initialisation ordinals are per-journey. A tab-lifetime counter would report a
    // second visit's first load as the fifth, which is exactly the kind of number that looks like a
    // defect and is not.
    resetInitSequence();
    return journeyId;
}

/** The current recording attempt, or null when no attempt is open. Null is a real answer. */
export function currentAttemptId(): string | null {
    return attemptId;
}

/**
 * The 1-based ordinal of the current attempt within this journey.
 *
 * Carried alongside the id because the ordinal is what makes F01 answerable without joining: a
 * `recording_intent` with `attempt_seq: 2` says a second take happened, whether or not the first
 * attempt's events survived.
 */
export function currentAttemptSeq(): number {
    return attemptSeq;
}

export function beginRecordingAttempt(): string {
    currentJourneyId();          // an attempt always belongs to a journey
    attemptSeq += 1;
    attemptId = mintId();
    return attemptId;
}

/** Close the attempt. Later events in the journey correctly report no open attempt. */
export function endRecordingAttempt(): void {
    attemptId = null;
}

/** Test seam only. Production never resets identity except through beginJourney(). */
export function __resetJourneyIdentityForTests(): void {
    journeyId = null;
    attemptId = null;
    attemptSeq = 0;
}
