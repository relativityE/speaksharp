import { describe, it, expect } from 'vitest';
import { computeFinalizedFillerAnalysis, fillerDisclosure } from '../finalizedSessionAnalysis';
import { countFillerWords, FillerCounts } from '../fillerWordUtils';

const live = (m: Record<string, number>): FillerCounts => {
    const out: FillerCounts = {};
    let total = 0;
    for (const [k, v] of Object.entries(m)) { out[k] = { count: v, color: 'x' }; total += v; }
    out.total = { count: total, color: '' };
    return out;
};
const c = (f: FillerCounts, k: string) => f[k]?.count ?? 0;

describe('computeFinalizedFillerAnalysis — visible / speech-time-only / total split', () => {
    it('Native: um/uh detected live but omitted from the transcript → speech-time-only; totals reconcile', () => {
        // Web Speech strips um/uh from its written text; the live counter still caught them.
        const finalTranscript = 'hello there this is the opening and this is the ending';
        expect(c(countFillerWords(finalTranscript), 'um')).toBe(0); // sanity: no um/uh in the text
        const f = computeFinalizedFillerAnalysis(finalTranscript, live({ um: 2, uh: 2 }));

        expect(c(f.transcriptVisibleCounts, 'um')).toBe(0);
        expect(c(f.transcriptVisibleCounts, 'uh')).toBe(0);
        expect(c(f.speechTimeOnlyCounts, 'um')).toBe(2);
        expect(c(f.speechTimeOnlyCounts, 'uh')).toBe(2);
        expect(f.transcriptVisibleTotal).toBe(0);
        expect(f.speechTimeOnlyTotal).toBe(4);
        expect(f.finalTotal).toBe(4);
    });

    it('INVARIANT: transcriptVisibleCounts is reproducible from the final transcript (== countFillerWords)', () => {
        const finalTranscript = 'so I can see um and um so and so';
        const f = computeFinalizedFillerAnalysis(finalTranscript, live({ um: 3, so: 3 }));
        const recount = countFillerWords(finalTranscript);
        for (const key of Object.keys(f.transcriptVisibleCounts)) {
            if (key === 'total') continue;
            expect(c(f.transcriptVisibleCounts, key)).toBe(c(recount, key));
        }
    });

    it('INVARIANT: per category, visible + speechTimeOnly === finalTotal and finalTotal >= visible', () => {
        const finalTranscript = 'um so um actually so';
        const f = computeFinalizedFillerAnalysis(finalTranscript, live({ um: 3, so: 3, uh: 1, actually: 1 }));
        for (const key of Object.keys(f.finalTotalCounts)) {
            if (key === 'total') continue;
            expect(c(f.transcriptVisibleCounts, key) + c(f.speechTimeOnlyCounts, key)).toBe(c(f.finalTotalCounts, key));
            expect(c(f.finalTotalCounts, key)).toBeGreaterThanOrEqual(c(f.transcriptVisibleCounts, key));
        }
    });

    it('fillers present in the transcript with live == visible → no speech-only', () => {
        const finalTranscript = 'um this is a test um again';
        const visible = countFillerWords(finalTranscript);
        const f = computeFinalizedFillerAnalysis(finalTranscript, live({ um: c(visible, 'um') }));
        expect(c(f.transcriptVisibleCounts, 'um')).toBe(c(visible, 'um'));
        expect(c(f.transcriptVisibleCounts, 'um')).toBeGreaterThan(0);
        expect(f.speechTimeOnlyTotal).toBe(0);
        expect(f.transcriptVisibleTotal).toBe(f.finalTotal);
    });

    it('disclosure distinguishes visible vs speech-only when Native omits fillers, else a plain total', () => {
        // Native-like: um/uh live-detected, absent from text → secondary disclosure required.
        const native = computeFinalizedFillerAnalysis('the opening and the ending', live({ um: 2, uh: 2 }));
        const d1 = fillerDisclosure(native);
        expect(d1.primary).toMatch(/0 shown in transcript · 4 additional filler words detected while speaking/);
        expect(d1.secondary).toMatch(/Browser transcription may omit some filler words/);

        // Everything visible → no secondary.
        const t = 'um and um';
        const clean = computeFinalizedFillerAnalysis(t, live({ um: c(countFillerWords(t), 'um') }));
        const d2 = fillerDisclosure(clean);
        expect(d2.secondary).toBeUndefined();
        expect(d2.primary).toMatch(/filler words? in this session/);
    });

    it('handles null/empty live counts without throwing; visible drives the total', () => {
        const f = computeFinalizedFillerAnalysis('um and um', null);
        expect(f.speechTimeOnlyTotal).toBe(0);
        expect(f.finalTotal).toBe(f.transcriptVisibleTotal);
        expect(f.finalTotal).toBeGreaterThan(0);
    });
});
