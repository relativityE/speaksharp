/**
 * #1304 — the TWO scoring tracks, kept apart by the type system.
 *
 * WHY TWO. They answer different questions and must not share a normalizer:
 *
 *   TRACK A — transcript accuracy. Uses the pinned OFFICIAL Whisper `EnglishTextNormalizer`, in which
 *   `hmm|mm|mhm|mmm|uh|um` ARE REMOVED (upstream `english.py:467`) and bracketed markers are stripped.
 *   Only normalized this way are the numbers comparable to published WER — which is the entire point of
 *   the comparison a down-select rests on.
 *
 *   TRACK B — disfluency accuracy. Fillers and markers are PRESERVED and scored explicitly, because a
 *   model that silently drops "um" must be penalised, not rewarded.
 *
 * THERE IS NO DEFAULT, deliberately. A default is how these merged in the first place: one
 * filler-preserving normalizer became the silent default for everything, so Track A would have charged
 * every model an error for each filler it CORRECTLY transcribed. The track is a required argument, and
 * the result is branded with it so handing Track-A data to a Track-B consumer is a COMPILE error rather
 * than a runtime check nobody runs.
 */
import { normalizeOfficialTrackA, normalizeOfficialTrackB } from './officialNormalizer';

export type Track = 'track_a' | 'track_b';

/**
 * Normalized tokens, BRANDED with the track that produced them.
 *
 * The brand is phantom — it exists only at compile time — but it makes the two incompatible, which is
 * what stops a Track-A corpus row being scored as disfluency evidence or vice versa.
 */
export interface NormalizedText<T extends Track> {
    readonly track: T;
    readonly tokens: readonly string[];
}

export function normalizeForTrack<T extends Track>(track: T, text: string): NormalizedText<T> {
    // BOTH tracks run the same official core. The ONLY difference is disfluency handling — otherwise a
    // Track A/Track B delta could not be attributed to fillers, which is the entire measurement.
    const tokens = track === 'track_a' ? normalizeOfficialTrackA(text) : normalizeOfficialTrackB(text);
    return { track, tokens };
}

/** Human-readable label for provenance rows. */
export const TRACK_LABEL: Record<Track, string> = {
    track_a: 'transcript accuracy (official Whisper normalization, fillers removed)',
    track_b: 'disfluency accuracy (fillers and markers preserved)',
};
