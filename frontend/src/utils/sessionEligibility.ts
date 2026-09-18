/**
 * Session eligibility — whether a saved session may *influence* coaching or the next action.
 *
 * `product_release/PROGRESS_AND_NEXT_ACTION.md` §4 states two ordered, independent gates. **Metric
 * validity** decides whether a measurement exists. **Eligibility** decides whether a session may
 * influence Progress **or the next action**, and it holds only when ALL of these do:
 *
 *   | Status           | `completed`                                        |
 *   | Spoken duration  | ≥ 30 s (`MIN_COMPARABLE_SECONDS`)                  |
 *   | Word count       | ≥ 75                                               |
 *   | Transcript       | present                                            |
 *   | Attribution      | a server-owned `attrib_v1` authority record        |
 *
 * **Attribution comes from the AUTHORITY, never from `sessions.attribution_status`.** Migration
 * `20260803010000_session_attribution_authority.sql` makes that column advisory in as many words —
 * "Consumers gate on `authority_version`, NOT on the client-writable legacy sessions columns" — with no
 * legacy promotion or backfill, and it fails closed: "no attrib_v1 record => unverified". The column is
 * client-writable, so a legacy or client-declared row can read `verified` while no authority exists; gating
 * on it would let an unattributed session supply the user's lesson.
 *
 * That document is a Level-1 user-trust surface: a phrase shown to a user must be true of that user's own
 * recorded practice. A cached coaching sentence from a four-second accidental take is not — which is why
 * `MIN_SESSION_DURATION_SECONDS` (a persistence floor) and `MIN_RELIABLE_SCORING_WORDS` (3 words, whether a
 * metric is computable) are explicitly NOT eligibility. Conflating them is what would let that take move a
 * trend, or become the lesson Home quotes back to the user.
 *
 * Why this lives here rather than in the caller: `get-ai-suggestions` does not enforce these gates before
 * it caches a review on the row, so any reader that promotes that cached text has to apply them itself.
 */

import { MIN_COMPARABLE_SECONDS } from './aggregateProgress';

/**
 * The §4 word gate. Deliberately distinct from `MIN_RELIABLE_SCORING_WORDS` (3), which answers a different
 * question — whether a metric can be computed at all.
 */
export const MIN_ELIGIBLE_WORDS = 75;

/** The only attribution authority version that qualifies a session (migration `20260803010000`). */
export const ATTRIBUTION_AUTHORITY_VERSION = 'attrib_v1';

export interface SessionEligibilityInput {
    /** `sessions.status`. Legacy rows carry `null`, which is not `completed` and therefore not eligible. */
    status?: string | null;
    /** `sessions.duration`, in seconds. */
    durationSeconds?: number | null;
    /** `sessions.total_words`. */
    totalWords?: number | null;
    /** `sessions.transcript_state` — presence only; the text itself is never needed for this decision. */
    transcriptState?: string | null;
    /**
     * The owner-scoped verdict from `get_attribution_authority_v1` — `'attrib_v1'` when this session has a
     * server-written authority record, and `null` while pending or definitively unattributed. NOT
     * `sessions.attribution_status`, which the migration demotes to advisory.
     */
    authorityVersion?: string | null;
}

/** The deterministic reason a session was excluded, in the vocabulary §4 fixes. `null` when eligible. */
export type IneligibilityReason =
    | 'not_completed'
    | 'too_short'
    | 'too_few_words'
    | 'no_transcript'
    | 'unverified_attribution';

/**
 * Why this session may not influence coaching, or `null` when every gate holds.
 *
 * Fails closed: a missing or unparseable field is never read as a pass, because the gates exist to keep an
 * unproven session out.
 */
export function coachingIneligibilityReason(input: SessionEligibilityInput): IneligibilityReason | null {
    if (input.status !== 'completed') return 'not_completed';
    const duration = Number(input.durationSeconds);
    if (!Number.isFinite(duration) || duration < MIN_COMPARABLE_SECONDS) return 'too_short';
    const words = Number(input.totalWords);
    if (!Number.isFinite(words) || words < MIN_ELIGIBLE_WORDS) return 'too_few_words';
    // Presence is the gate. `expired` and `not_captured` are states in which there is no readable
    // transcript, so the coaching that was derived from one can no longer be shown beside it.
    if (input.transcriptState !== 'available') return 'no_transcript';
    // Fail closed exactly as the migration specifies: anything other than the attrib_v1 authority — a null
    // pending verdict, a terminal unattributed marker, or an unknown version — is unverified.
    if (input.authorityVersion !== ATTRIBUTION_AUTHORITY_VERSION) return 'unverified_attribution';
    return null;
}

/** Convenience predicate over `coachingIneligibilityReason`. */
export function isEligibleForCoaching(input: SessionEligibilityInput): boolean {
    return coachingIneligibilityReason(input) === null;
}
