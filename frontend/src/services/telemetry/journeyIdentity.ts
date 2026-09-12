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

/**
 * #1421 P1 — THE BOOT AUTHORITY. ONE PAGE/APP BOOTSTRAP, ONE OPAQUE ID.
 *
 * A JOURNEY BOUNDARY IS NOT A BOOT BOUNDARY, and the readback qualification was built as if it were.
 * `ensureJourneyBoundary()` begins a new journey on every non-product -> product transition, so one
 * browser boot legitimately contains SEVERAL journeys — while `telemetry_positive_control` is emitted
 * once per boot and `account_identified` only when identity settles. Inferring the boot from journey
 * ORDERING was wrong in both directions and could not be made right by tuning the window: it either
 * let another boot's receipts qualify the selected journey, or rejected the boot's own receipts
 * because an earlier journey of the SAME boot became the lower bound.
 *
 * The information simply was not in the data, so it is put there. Minted lazily on first read like
 * `journey_id`, and — unlike the journey — NEVER re-minted: a value that changed mid-boot would be
 * indistinguishable from a second boot and would reintroduce the same ambiguity one layer down.
 * `beginJourney()` therefore does not touch it, which is the whole point.
 *
 * It is a random tab-local value, meaningful only for joining events to each other, and carries no
 * account, session or user-authored data — the same constraint every other correlation id here obeys.
 */
let bootId: string | null = null;
let journeyId: string | null = null;
let attemptId: string | null = null;
let attemptSeq = 0;

/** The boot this tab is running. Stable for the lifetime of the page; never re-minted. */
export function currentBootId(): string {
    if (!bootId) bootId = mintId();
    return bootId;
}

/**
 * Test seam only. Production has no way to end a boot except by loading the page again — which is
 * exactly what a boot IS, and why no production caller may reset this.
 */
export function __resetBootIdentityForTests(): void {
    bootId = null;
}

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

/**
 * Open an attempt only if none is open.
 *
 * The attempt used to open at `RECORDING` and close only at `TERMINATED`/`IDLE`. A normal Stop returns
 * the controller to `READY` WITHOUT closing it, so the next accepted Start was attributed to the
 * previous take — and on the very first Start the accepted intent carried `attempt_id: null` because
 * the attempt did not exist yet. Neither could be joined to the recording it initiated.
 *
 * Ownership therefore moves to the accepted intent, which is the user action that becomes a take, and
 * the controller now only ENSURES one rather than minting a second. A start that hangs does consume an
 * ordinal, which is correct: the user did attempt a take, and a hang is exactly what F01 must show.
 * Refused starts never reach `accepted`, so they still consume nothing.
 */
export function ensureRecordingAttempt(): string {
    return attemptId ?? beginRecordingAttempt();
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
