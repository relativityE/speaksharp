/**
 * #1259 F12 — a content-free fingerprint for error surfaces.
 *
 * `GLOBAL_UNHANDLED_REJECTION`'s governed schema was literally `{}`. Every unhandled rejection in
 * Production shipped with no properties at all, so the event could say that something failed and
 * nothing else — a counter, not a diagnostic. The producer still passed `reason` (the raw message) and
 * a stale comment claimed analytics kept it; T1's allowlist had been dropping it silently for weeks.
 *
 * Restoring the message is not the fix. Error text is the worst possible carrier: PostgREST and
 * Postgres echo request material back through `message`/`details`/`hint`, and `lib/storage.ts` already
 * refuses to log raw errors because a completion request carries the full transcript.
 *
 * So this derives what is diagnostic and discards what is content:
 *
 *   - the error's CLASS NAME, which is authored, bounded, and prose-free;
 *   - a DIGEST of the normalized message, which groups identical failures without carrying any of them;
 *   - the message's LENGTH BAND, which separates a terse `NetworkError` from a wall of echoed SQL.
 *
 * Normalization strips digits and hex runs BEFORE digesting. That is not cosmetic: without it, one
 * failure mode carrying a different id each time produces a new fingerprint every occurrence, and the
 * grouping this exists to provide never happens. It also removes the identifiers most likely to be
 * sensitive before anything is derived from them.
 */

import { contentDigest as digest } from './contentDigest';

/**
 * How much of an authored error skeleton is worth grouping on, counted in WORDS.
 *
 * A character bound was the first attempt and it was not enough: with a 120-character cap, a 66-character
 * authored opening still left ~54 characters of unquoted prose inside the digest, so two failures that
 * differed only in what the speaker said fingerprinted differently. A word bound matches the thing being
 * bounded — authored error text is a short phrase, echoed material is everything after it.
 *
 * Eight words is a heuristic, not a proof. It is deliberately tight: over-grouping two distinct failures
 * costs diagnostic precision, while under-grouping costs someone's words.
 */
const FINGERPRINT_PREFIX_WORDS = 8;

/**
 * Collapse the parts that vary per occurrence so the same failure yields the same fingerprint — and drop
 * the parts that can carry what a user said.
 *
 * Stripping digits and hex was never enough. PostgREST and Postgres echo request material back through
 * `message`/`details`/`hint`, and a completion request carries the full transcript, so a failing save can
 * put someone's speech into this string. Digesting that produces a 32-bit unsalted value derived from
 * their words — enumerable for a short utterance and identical across accounts, which is precisely the
 * property that made `transcript_digest` unacceptable.
 *
 * So quoted runs go first: quotes are how both engines delimit echoed values, and they are where prose
 * usually arrives. Then the message is bounded to its opening WORDS, because unquoted prose arrives at
 * the end — after an authored opening — and grouping needs the shape of the failure, not its tail.
 *
 * This REDUCES exposure; it does not prove prose can never appear. The fingerprint therefore stays a
 * grouping key and must never be treated as opaque or as an identifier.
 */
export function normalizeErrorMessage(message: string): string {
    return message
        .toLowerCase()
        // Quoted material is echoed input, not authored text. Both quote styles, non-greedy.
        .replace(/'[^']*'/g, "'#'")
        .replace(/"[^"]*"/g, '"#"')
        .replace(/[0-9a-f]{8,}/g, '#')   // uuids, hashes, tokens
        .replace(/\d+/g, '#')            // ids, counts, offsets, ports
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .slice(0, FINGERPRINT_PREFIX_WORDS)
        .join(' ');
}

export function messageLengthBand(length: number): string {
    if (length === 0) return '0';
    if (length <= 64) return '1-64';
    if (length <= 256) return '65-256';
    if (length <= 1024) return '257-1024';
    return '1024+';
}

export type ReasonKind = 'error' | 'string' | 'object' | 'nullish' | 'unknown';

export function reasonKind(reason: unknown): ReasonKind {
    if (reason === null || reason === undefined) return 'nullish';
    if (reason instanceof Error) return 'error';
    if (typeof reason === 'string') return 'string';
    if (typeof reason === 'object') return 'object';
    return 'unknown';
}

export interface ErrorFingerprint {
    reason_kind: ReasonKind;
    /** The class name only. A caller that assigns prose to `name` fails the slug rule and is dropped. */
    error_name: string | null;
    error_fingerprint: string;
    message_length_band: string;
}

/**
 * #1421 Codex P1 `3993611247` (PM RETURN `5641005311`) — NOTHING DERIVED FROM THE MESSAGE ENTERS THE FINGERPRINT.
 *
 * The digest used to cover `normalizeErrorMessage(message)`. Normalization reduced exposure but could not remove
 * it: an unhandled rejection that OPENS with unquoted user-authored text keeps its first eight words, and the
 * digest is an unsalted deterministic 32-bit FNV value over them — enumerable by dictionary for a short phrase,
 * and identical across accounts for identical content, which is exactly the property that made `transcript_digest`
 * unacceptable. A grouping key cannot be bought with someone's words.
 *
 * The fingerprint is therefore derived only from AUTHORED identity: the error's class name, the reason kind, and
 * the call site the caller names. All three are closed or authored values that no request or transcript can reach.
 * Grouping is coarser than before — two different failures from one call site with the same class now share a
 * fingerprint — and that is the intended trade: `logger` and Sentry keep the message for diagnosis.
 */
export function fingerprintError(reason: unknown, message: string, site: string): ErrorFingerprint {
    const name = reason instanceof Error && reason.name ? reason.name : null;
    const kind = reasonKind(reason);
    return {
        reason_kind: kind,
        error_name: name,
        // Authored terms only: class name, reason kind, and the authored call-site identity. The NAME matters
        // because two error classes with the same generic text are different failures; the SITE separates the
        // same class raised from different surfaces, which is what the message prefix used to do.
        error_fingerprint: digest(`${name ?? ''}|${kind}|${site}`),
        message_length_band: messageLengthBand(message.length),
    };
}
