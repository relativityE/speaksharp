/**
 * #1259 F05 — the transcript, at every stage that can lose it.
 *
 * WHAT PRODUCTION ALREADY SHOWS: `session_saved` carried `word_count: 82` and `88`. What it cannot
 * show is that the panel was empty while it said so. A count and a rendered surface are two different
 * facts, and today only one of them is recorded — so "88 words" beside a blank transcript is
 * indistinguishable from "88 words" beside 88 visible words.
 *
 * This event pairs them at four stages, and the pairing is the whole point:
 *
 *   finalize        — the decode settled. What does the authority hold?
 *   save            — persistence returned. Does the saved text still match?
 *   teardown        — buffers were purged. Was anything still authoritative afterwards?
 *   review_rendered — the user is looking at it. Does the screen agree?
 *
 * `digests_match` is what makes the disagreement legible without sending a single word: both sides
 * are digested locally and only the comparison travels.
 *
 * NOTHING HERE CARRIES TEXT. Not the transcript, not an excerpt, not a first line. A digest, two
 * counts, and three booleans.
 */
import { analyticsBuffer } from '../AnalyticsBuffer';
import { contentDigest, countWords } from '@/lib/contentDigest';

export type TranscriptStage = 'finalize' | 'save' | 'teardown' | 'review_rendered';

export interface TranscriptAuthorityInput {
    stage: TranscriptStage;
    /** What the authority for this stage holds. Null when it holds nothing — a real answer. */
    authoritative: string | null;
    /** What the user can actually see. Null at stages with no rendered surface. */
    rendered?: string | null;
    persisted?: boolean | null;
    sessionIdPresent?: boolean | null;
    teardownState?: string | null;
}

/**
 * De-duplication. `review_rendered` is emitted from a component, and a component re-renders for
 * reasons that have nothing to do with the transcript changing. Emitting per render would produce
 * exactly the per-frame noise this contract forbids, so a stage only reports when what it would SAY
 * has changed.
 */
let lastSignature = '';

export function emitTranscriptAuthority(input: TranscriptAuthorityInput): void {
    const authoritative = input.authoritative ?? '';
    const rendered = input.rendered ?? null;

    const authoritativeWords = countWords(authoritative);
    const renderedWords = rendered === null ? null : countWords(rendered);
    const digest = contentDigest(authoritative.trim());

    const props = {
        stage: input.stage,
        transcript_digest: digest,
        authoritative_word_count: authoritativeWords,
        rendered_word_count: renderedWords,
        // The claim F05 exists to test. `true` requires visible words, not a mounted container: a
        // rendered empty panel is exactly the failure being measured.
        transcript_visibly_present: renderedWords === null ? false : renderedWords > 0,
        // Null when there is nothing to compare against, so "not rendered here" never reads as
        // "rendered something different".
        digests_match: rendered === null ? null : contentDigest(rendered.trim()) === digest,
        persisted: input.persisted ?? null,
        session_id_present: input.sessionIdPresent ?? null,
        teardown_state: input.teardownState ?? null,
    };

    const signature = JSON.stringify(props);
    if (signature === lastSignature) return;
    lastSignature = signature;

    analyticsBuffer.push('transcript_authority', props, 'HIGH');
}

/** Test seam, and the boundary between one session's stages and the next's. */
export function __resetTranscriptAuthorityForTests(): void { lastSignature = ''; }
