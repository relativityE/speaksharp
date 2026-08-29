import { describe, it, expect } from 'vitest';

/**
 * #1304 — aggregate timing must be recomputable from retained per-clip evidence.
 *
 * The frozen 600 serialized p50/p95/RTF but not the per-clip rows they came from, so a reviewer reading
 * `RTF p95 = 5.969` had no way to check it. This proves the retained shape supports re-derivation.
 */
export interface ClipTiming {
    utteranceId: string; audioSeconds: number; decodeMs: number;
    realTimeFactor: number | null; outcome: string;
}

/** Percentile by nearest-rank on the sorted sample — stated explicitly so a reviewer can reproduce it. */
export function percentile(values: number[], p: number): number | null {
    const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
    return sorted[rank - 1];
}

export function recompute(clips: ClipTiming[]) {
    const scored = clips.filter(c => c.outcome === 'scored');
    return {
        decodeMsP50: percentile(scored.map(c => c.decodeMs), 50),
        decodeMsP95: percentile(scored.map(c => c.decodeMs), 95),
        rtfP50: percentile(scored.map(c => c.realTimeFactor ?? NaN), 50),
        rtfP95: percentile(scored.map(c => c.realTimeFactor ?? NaN), 95),
    };
}

const clip = (id: string, sec: number, ms: number, outcome = 'scored'): ClipTiming => ({
    utteranceId: id, audioSeconds: sec, decodeMs: ms,
    realTimeFactor: sec > 0 ? ms / (sec * 1000) : null, outcome,
});

describe('#1304 aggregate timing is recomputable from retained per-clip rows', () => {
    const clips = Array.from({ length: 100 }, (_, i) => clip(`u${i}`, 2, (i + 1) * 10));

    it('recomputes p50 and p95 by an explicitly stated rule', () => {
        const agg = recompute(clips);
        expect(agg.decodeMsP50).toBe(500);
        expect(agg.decodeMsP95).toBe(950);
        expect(agg.rtfP50).toBeCloseTo(0.25, 6);
        expect(agg.rtfP95).toBeCloseTo(0.475, 6);
    });

    it('excludes non-scored clips, so a failed decode cannot flatter the percentile', () => {
        // A throw records decodeMs too; counting it would let fast failures improve the timing profile.
        const withFailures = [...clips, clip('bad1', 2, 1, 'threw'), clip('bad2', 2, 1, 'empty')];
        expect(recompute(withFailures)).toEqual(recompute(clips));
    });

    it('carries audioSeconds, without which RTF cannot be re-derived', () => {
        const c = clip('u', 2.5, 1250);
        expect(c.realTimeFactor).toBeCloseTo(0.5, 6);
        expect(c.audioSeconds).toBe(2.5);
    });

    it('returns null rather than a number when there is nothing to measure', () => {
        expect(percentile([], 95)).toBeNull();
        expect(recompute([]).rtfP95).toBeNull();
    });

    it('tolerates a non-finite RTF without corrupting the aggregate', () => {
        const withZeroDuration = [...clips, { ...clip('z', 0, 100), realTimeFactor: null }];
        expect(recompute(withZeroDuration).rtfP95).toBeCloseTo(recompute(clips).rtfP95!, 6);
    });
});
