/**
 * #1259 F10 — what retention actually did, per save.
 *
 * The PO found two transcripts still readable in Analytics under copy that claimed otherwise. Whether
 * that is a policy not applied, a policy applied and the copy stale, or a policy that ran and kept two
 * on purpose is unanswerable from anything we currently record: `session_saved` says a session saved
 * and nothing about what happened to the ones before it.
 *
 * The counts are OBSERVED at the client's own history view, not asserted from the policy we believe is
 * deployed. That distinction is the point — if the deployed policy and the shipped copy disagree, an
 * event that reports the intended policy would agree with the copy and hide the defect. What is
 * recorded is what the client can actually see afterwards.
 *
 * `policy_version` and `copy_version` are recorded SEPARATELY and deliberately. A mismatch between the
 * two is exactly the failure the PO hit: text promising one transcript beside a list holding two.
 *
 * Counts and states only — never a transcript, never a session id.
 */
import { safeEmit } from './safeEmit';

/**
 * What the DEPLOYED database policy is believed to be. A constant, because the client cannot read the
 * migration — which is why it is published beside the observed count rather than instead of it.
 */
export const RETENTION_POLICY_VERSION = 'newest-two';

/** What the user-facing copy currently claims. Separate on purpose; a mismatch is the finding. */
export const RETENTION_COPY_VERSION = 'newest-two';

export interface RetentionObservationInput {
    /** Sessions holding readable transcript text BEFORE this save, as the client could see them. */
    transcriptBearingBefore: number | null;
    /** The same count AFTER. */
    transcriptBearingAfter: number | null;
    /** Sessions whose measurements survive regardless of transcript state. */
    contentFreeHistoryCount: number | null;
    /** The state the just-saved session reports for itself. */
    savedTranscriptState: string | null;
}

export function emitRetentionObservation(input: RetentionObservationInput): void {
    const before = input.transcriptBearingBefore;
    const after = input.transcriptBearingAfter;
    safeEmit('retention_observation', {
        policy_version: RETENTION_POLICY_VERSION,
        copy_version: RETENTION_COPY_VERSION,
        transcript_bearing_before: before,
        transcript_bearing_after: after,
        // Null rather than 0 when either side is unknown: "we did not observe" must never read as
        // "nothing expired", which is the more flattering of the two and the one that hides a defect.
        expired_count: before !== null && after !== null ? Math.max(0, before - after + 1) : null,
        content_free_history_count: input.contentFreeHistoryCount,
        saved_transcript_state: input.savedTranscriptState,
    }, 'HIGH');
}
