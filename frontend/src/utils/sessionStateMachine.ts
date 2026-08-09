import type { SessionState } from '@/components/session/SessionShell';

/**
 * #1222 — resolves the one-page-three-states value from lifecycle facts (spec §4).
 *
 * The rule that matters: **the transition to `during` triggers on the FIRST AUDIO FRAME, not on the
 * click.** A click that fails mic permission must NOT change the layout — it stays in `before` with the
 * error shown in the mic card. Only after a real audio frame arrives does the page collapse to the
 * recording layout. Once the recording has been stopped, the page resolves to `after`.
 */
export interface SessionLifecycleFacts {
    /** A real audio frame has been received from the mic (NOT merely "start clicked"). */
    firstAudioFrameReceived: boolean;
    /** The recording has been stopped (finalised). */
    stopped: boolean;
    /** A mic-permission / device error occurred before any audio arrived. */
    permissionError?: boolean;
}

export function resolveSessionState({ firstAudioFrameReceived, stopped, permissionError }: SessionLifecycleFacts): SessionState {
    // A failed start (permission denied) never leaves `before`, so long as no audio ever arrived.
    if (permissionError && !firstAudioFrameReceived) return 'before';
    // A finished recording resolves to review.
    if (stopped) return 'after';
    // Live only once real audio is flowing.
    if (firstAudioFrameReceived) return 'during';
    return 'before';
}
