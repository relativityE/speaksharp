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
 * NOTE ON WHICH LANE OWNS THIS CONSTANT. It reads `newest-two` because that is what the DEPLOYED
 * database does today. It previously read `newest-one`, anticipating #1436 — which is wrong, and
 * operationally wrong in a way the design would have masked as a finding: #1421 deploys before #1436,
 * so every receipt in the gap would have carried a false belief beside an observation showing two
 * retained. The mismatch detector would then be stuck on for the whole down-select window, and a
 * permanently-firing detector is one nobody reads.
 *
 * A constant describing deployed reality belongs to the commit that CHANGES deployed reality. The flip
 * to `newest-one` therefore moves with #1436's activation, not with this instrumentation. The observed
 * COUNT beside it is what proves the deployed database actually agrees — the constant is a claim, the
 * count is the evidence.
 *
 * Counts and states only — never a transcript, never a session id.
 */
import { safeEmit } from './safeEmit';

/**
 * What the DEPLOYED database policy is believed to be. A constant, because the client cannot read the
 * migration — which is why it is published beside the observed count rather than instead of it.
 */
export const RETENTION_POLICY_VERSION = 'newest-two';

/**
 * What the user-facing copy currently claims. Separate on purpose; a mismatch is the finding.
 *
 * THESE TWO DISAGREE RIGHT NOW, AND THAT IS THE TRUTH THEY EXIST TO REPORT.
 *
 * The copy says newest-ONE; the deployed database does newest-TWO until #1436 activates. That gap is
 * exactly the defect the PO reported — "text promising one transcript beside a list holding two" — so a
 * receipt carrying both values disagreeing is reporting a real product state, not an instrumentation
 * artifact.
 *
 * An earlier revision of this file warned that leaving either constant at `newest-two` "would let a
 * release qualify against a policy string the migration retires." That reasoning was inverted:
 * #1421 deploys BEFORE #1436, so pinning `policy_version` to `newest-one` describes a policy the
 * database is not running. Every receipt in the gap would then have carried a FALSE belief beside an
 * observation showing two retained, the mismatch detector would have fired continuously on that
 * falsehood for the whole down-select window, and a permanently-firing detector is one nobody reads.
 * The failure mode these constants guard against is a receipt agreeing with ITSELF while disagreeing
 * with deployed behaviour — and that is precisely what pinning both to `newest-one` would have
 * produced.
 *
 * BOTH values flip to `newest-one` with #1436's activation, because a constant describing deployed
 * reality belongs to the commit that changes deployed reality. The observed COUNT beside them is the
 * evidence; the constants are claims.
 */
export const RETENTION_COPY_VERSION = 'newest-one';

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
