/**
 * #1415 — the user's intent to record, retained across preparation.
 *
 * THE FAILURE THIS FIXES. On a cold first visit the click never becomes a recording:
 *
 *   1. `startRecording()` builds the service and calls `startTranscription()`.
 *   2. The engine reports no cached model, so the service FSM moves to DOWNLOAD_REQUIRED.
 *   3. `executeStrategy` refuses to start from any state but READY and THROWS
 *      `TRANSCRIPTION_START_BLOCKED_STATE:DOWNLOAD_REQUIRED`.
 *   4. The controller treats that as a start failure and lands in FAILED_VISIBLE.
 *   5. Nothing remembers that the user asked to record.
 *
 * Preparation being required is not a failure — it is the expected first-visit path — and the user
 * already said what they wanted. #1259 measured the consequence: 113 and 126 seconds between the
 * runtime becoming ready and a recording starting, because a human had to notice and click again.
 *
 * WHY A CLAIM, NOT A FLAG. Readiness can be signalled more than once — a duplicate transition, a
 * late callback from a superseded attempt, a retry that re-reaches READY. A boolean "should
 * auto-start" would fire on each one and produce two recordings from one click, which is a worse bug
 * than the one being fixed. `claim()` REMOVES the intent and returns it, so the second signal finds
 * nothing. Exactly-once is a property of the data structure, not of the caller's care.
 *
 * Every intent carries a token. A holder that acts on a token which is no longer current is acting on
 * a stale intent and is refused — which is what makes navigation, teardown and supersession safe.
 */
import type { TranscriptionPolicy } from './transcription/TranscriptionPolicy';

export type IntentRetireReason =
    | 'started'
    | 'cancelled'
    | 'permission_denied'
    | 'acquisition_failed'
    | 'navigated'
    | 'teardown'
    | 'replaced'
    | 'superseded';

export interface RecordingIntent {
    /** Identifies THIS intent. A stale token can never claim a newer intent. */
    readonly token: string;
    readonly recordingId: string;
    readonly policy: TranscriptionPolicy | null;
    readonly userWords: readonly string[];
    readonly mintedAt: number;
    /**
     * True when this intent was created by resuming after preparation rather than by a fresh click.
     *
     * It BOUNDS the resumption. Without it, a start that reaches READY, resumes, and is refused for
     * preparation AGAIN would re-arm preparation and try forever — a spinner the user can never
     * escape, which is a worse outcome than the original silent idle. One resume per click; a second
     * refusal is a real failure and is shown as one.
     */
    readonly resumed: boolean;
}

export interface RetiredIntent {
    readonly token: string;
    readonly reason: IntentRetireReason;
}

let pending: RecordingIntent | null = null;
let lastRetired: RetiredIntent | null = null;

function mintToken(): string {
    try {
        const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
        if (typeof c?.randomUUID === 'function') return `ri-${c.randomUUID()}`;
    } catch { /* fall through */ }
    return `ri-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Record that the user asked to record.
 *
 * A second click while one intent is already pending REPLACES it rather than queueing: the user
 * expressed the same wish twice, and starting twice is the duplicate this exists to prevent.
 */
export function mintRecordingIntent(input: {
    recordingId: string;
    policy: TranscriptionPolicy | null;
    userWords: readonly string[];
    resumed?: boolean;
}): RecordingIntent {
    if (pending) lastRetired = { token: pending.token, reason: 'replaced' };
    pending = {
        token: mintToken(),
        recordingId: input.recordingId,
        policy: input.policy,
        userWords: [...input.userWords],
        mintedAt: Date.now(),
        resumed: input.resumed ?? false,
    };
    return pending;
}

/** Look without taking. Callers that intend to ACT must use `claimRecordingIntent`. */
export function pendingRecordingIntent(): RecordingIntent | null {
    return pending;
}

/**
 * Take the pending intent, if any, and leave nothing behind.
 *
 * This is the exactly-once seam: a duplicate readiness signal arriving a millisecond later finds no
 * intent and starts nothing. Pass `token` to claim only a SPECIFIC intent — a late holder whose
 * intent has since been replaced gets null rather than starting the newer one on its behalf.
 */
export function claimRecordingIntent(token?: string): RecordingIntent | null {
    if (!pending) return null;
    if (token !== undefined && token !== pending.token) return null;
    const claimed = pending;
    pending = null;
    lastRetired = { token: claimed.token, reason: 'started' };
    return claimed;
}

/** Discard the intent with a stated reason. Idempotent: retiring nothing is not an error. */
export function retireRecordingIntent(reason: IntentRetireReason): RetiredIntent | null {
    if (!pending) return null;
    lastRetired = { token: pending.token, reason };
    pending = null;
    return lastRetired;
}

/** Why the last intent went away. Read by the UI to explain a refusal, and by tests. */
export function lastRetiredIntent(): RetiredIntent | null {
    return lastRetired;
}

/** Is this token the one currently pending? A stale holder must never act. */
export function isCurrentIntent(token: string): boolean {
    return pending !== null && pending.token === token;
}

export function __resetRecordingIntentForTests(): void {
    pending = null;
    lastRetired = null;
}
