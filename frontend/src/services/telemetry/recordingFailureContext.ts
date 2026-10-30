import {
    currentAttemptId, currentAttemptSeq, currentBootId, currentJourneyId,
} from './journeyIdentity';

export type RecordingFailureContext = Readonly<Partial<Record<
    'boot_id' | 'journey_id' | 'attempt_id' | 'attempt_seq', string
>>>;

// Only the two formats minted by journeyIdentity, never account/session IDs or error text.
const CORRELATION_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|j-[a-z0-9]{1,16}-[a-z0-9]{1,10})$/i;

export function recordingFailureContext(input: {
    bootId?: unknown;
    journeyId?: unknown;
    attemptId?: unknown;
    attemptSeq?: unknown;
}): RecordingFailureContext {
    const tags: Partial<Record<keyof RecordingFailureContext, string>> = {};
    const id = (value: unknown) => typeof value === 'string' && CORRELATION_ID.test(value) ? value : null;
    const boot = id(input.bootId);
    const journey = id(input.journeyId);
    const attempt = id(input.attemptId);
    if (boot) tags.boot_id = boot;
    if (journey) tags.journey_id = journey;
    if (attempt && Number.isSafeInteger(input.attemptSeq) && Number(input.attemptSeq) > 0) {
        tags.attempt_id = attempt;
        tags.attempt_seq = String(input.attemptSeq);
    }
    return Object.freeze(tags);
}

/** Snapshot at the accepted intent, before asynchronous acquisition can change the ambient journey. */
export function captureRecordingFailureContext(): RecordingFailureContext {
    return recordingFailureContext({
        bootId: currentBootId(),
        journeyId: currentJourneyId(),
        attemptId: currentAttemptId(),
        attemptSeq: currentAttemptSeq(),
    });
}

export function applyRecordingFailureContext(
    scope: { setTag(key: string, value: string): unknown },
    context: RecordingFailureContext | null,
): void {
    if (!context) return;
    for (const [key, value] of Object.entries(context)) scope.setTag(key, value);
}
