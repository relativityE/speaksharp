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

/** Collapse the parts that vary per occurrence so the same failure yields the same fingerprint. */
export function normalizeErrorMessage(message: string): string {
    return message
        .toLowerCase()
        .replace(/[0-9a-f]{8,}/g, '#')   // uuids, hashes, tokens
        .replace(/\d+/g, '#')            // ids, counts, offsets, ports
        .replace(/\s+/g, ' ')
        .trim();
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

export function fingerprintError(reason: unknown, message: string): ErrorFingerprint {
    const name = reason instanceof Error && reason.name ? reason.name : null;
    return {
        reason_kind: reasonKind(reason),
        error_name: name,
        // The NAME is part of the fingerprint: two different error classes with the same generic text
        // ("failed to fetch") are different failures and must not be grouped together.
        error_fingerprint: digest(`${name ?? ''}|${normalizeErrorMessage(message)}`),
        message_length_band: messageLengthBand(message.length),
    };
}
