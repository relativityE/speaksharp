import type { TranscriptState } from '@/constants/transcriptState';

/**
 * #1416 F-05 / W-04 / W-05 — ONE AUTHORITY FOR THE TRANSCRIPT A USER READS AFTER A SESSION.
 *
 * THE DEFECT THIS EXISTS TO CLOSE. Two correct decisions combined into a wrong product:
 *
 *   1. #1306 purges the live transcript from working memory at finalization
 *      (`purgeTranscriptWorkingMemory`), so no spoken text survives in the tab. That is a privacy
 *      contract and it is not being weakened here.
 *   2. #1258/#1314 made the SERVER the authority: the transcript of the newest transcript-bearing
 *      saved sessions is retained, and `transcript_state` is the only source of truth for whether
 *      it still exists.
 *
 * Nobody reconnected the after-state to (2) after (1) emptied the store. `SessionOverhaulView`
 * still renders the review transcript from `store.transcript.transcript`, which finalization has
 * just cleared — so the user watches their words disappear at the exact moment they are told the
 * session was saved. The text is not lost; it is on the server and nothing asks for it.
 *
 * WHY THIS IS A SEPARATE MODULE RATHER THAN A PROP CHANGE. "Is there a transcript to show?" has
 * four distinct answers and the UI has been collapsing them into one empty string:
 *
 *   available    — retained and readable. Render it.
 *   expired      — retention aged it out. Say so; do NOT imply the user lost it.
 *   not_captured — the session genuinely produced none. A different sentence entirely.
 *   pending      — finalization has not settled. Not an absence, a wait.
 *
 * An empty string cannot distinguish those, and every one of them needs different words. That
 * collapse is also W-04's shape: a transcript that "shrank during finalization" is indistinguishable
 * from one that was purged on purpose, unless the state is carried explicitly.
 */

export type ReviewTranscriptOutcome =
    | { status: 'available'; text: string }
    | { status: 'expired' }
    | { status: 'not_captured' }
    | { status: 'pending' };

export interface ReviewTranscriptInputs {
    /** Server-owned. The ONLY authority for whether a retained transcript exists. */
    transcriptState: TranscriptState | null | undefined;
    /** The retained text as loaded from the saved session row. */
    retainedText: string | null | undefined;
    /** True until finalization is terminal — persistence, reconciliation and formatting all settled. */
    isFinalizing: boolean;
    /** Present once the row exists. Without it there is nothing to have retained anything. */
    savedSessionId: string | null | undefined;
}

/**
 * The single decision. Deliberately does NOT read live working memory: the whole defect is the UI
 * reading a buffer that finalization is contractually required to empty.
 */
export function resolveReviewTranscript(input: ReviewTranscriptInputs): ReviewTranscriptOutcome {
    if (input.isFinalizing) return { status: 'pending' };
    if (!input.savedSessionId) return { status: 'pending' };

    // NEVER infer expiry from emptiness. An empty string means the server said nothing about state;
    // `transcript_state` is what distinguishes "aged out" from "never captured" from "not loaded
    // yet", and guessing produces a confident sentence about the user's own session that may be
    // false.
    switch (input.transcriptState) {
        case 'expired':
            return { status: 'expired' };
        case 'not_captured':
            return { status: 'not_captured' };
        case 'available': {
            const text = (input.retainedText ?? '').trim();
            // Server says available but the text has not arrived: that is a load in flight, not an
            // absence. Reporting it as empty would tell the user their words are gone when the
            // server is holding them.
            return text.length > 0 ? { status: 'available', text } : { status: 'pending' };
        }
        default:
            return { status: 'pending' };
    }
}
