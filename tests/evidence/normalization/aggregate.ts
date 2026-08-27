/**
 * #1304 — runtime guard against mixed-track aggregation.
 *
 * The compile-time brand on `WerResult<T>` disappears the moment rows are serialized. Corpus results
 * are written to JSON, imported and aggregated, and at that point nothing in the type system prevents
 * Track A transcript-accuracy numbers being averaged with Track B disfluency numbers into a single
 * figure that means nothing. This is the check that does.
 */
import type { WerResult } from '../werMetric';
import type { Track } from './tracks';

export function assertSingleTrack(rows: readonly WerResult[]): Track {
    const tracks = new Set<string>();
    for (const row of rows) {
        if (row?.track !== 'track_a' && row?.track !== 'track_b') {
            throw new Error('missing track: a scored row must record the track that produced it');
        }
        tracks.add(row.track);
    }
    if (tracks.size === 0) throw new Error('missing track: no rows to aggregate');
    if (tracks.size > 1) {
        throw new Error(`mixed track aggregation refused: ${[...tracks].sort().join(' + ')} are not comparable`);
    }
    return [...tracks][0] as Track;
}
