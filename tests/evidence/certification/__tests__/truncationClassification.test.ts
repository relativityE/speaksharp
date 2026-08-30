import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TRUNCATION_MIN_AUDIO_SECONDS, classifyDurationSignals } from '../buildVerdict';

/**
 * #1304 — a high deletion ratio is a QUALITY signal, not evidence of truncation.
 *
 * `deletions/referenceWords >= 0.4` was labelled truncation and made eligibility-gating. On the targeted
 * 600 it disqualified `v4:base:q4-decoder:wasm` on clip `533-131556-0001`: a 3.5-SECOND utterance, 10
 * reference words, 4 deletions — exactly 0.400, on the inclusive boundary. The same clip scored 0.300 on
 * int8, 0.100 on v2 and 0.000 on Moonshine, and the earlier frozen run flagged the identical clip with
 * identical S/D/I. Reproducible, and ordinary misrecognition — not a transcript cut short.
 */
const ART = resolve(__dirname, '../../../../evidence-runs/1304-targeted-600/targeted-finalists.partial.json');
interface ArtifactRow { id: string; [k: string]: unknown }
const art = JSON.parse(readFileSync(ART, 'utf8')) as { rows: ArtifactRow[] };
const row = (id: string) => art.rows.find((r) => r.id === id)!;

/**
 * Drives the SHIPPED classifier over retained evidence. Deliberately not a reimplementation: the first
 * version of this file recomputed the rule inline and therefore SURVIVED reverting the fix — the mutant
 * changed `buildVerdict` and the test, testing itself, still passed.
 */
const classify = (id: string) => {
    const r = row(id);
    const timings = r.clipTimings as Array<{ utteranceId: string; audioSeconds: number }>;
    const utts = r.perUtterance as Array<{ id: string; referenceWords: number; deletions: number }>;
    const seconds = new Map<string, number>(timings.map((c) => [c.utteranceId, c.audioSeconds]));
    const rows = utts.map((u) => ({ id: u.id, referenceWords: u.referenceWords, deletions: u.deletions }));
    const out = classifyDurationSignals(rows, seconds);
    return { highDeletion: out.highDeletion, truncated: new Array(out.truncated).fill(0) };
};

describe('truncation requires the thing truncation means', () => {
    it('CASUALTY REPRODUCED: the q4 clip is high-deletion but is NOT truncation', () => {
        const { highDeletion, truncated } = classify('v4:base:q4-decoder:wasm');
        expect(highDeletion).toHaveLength(1);
        expect(highDeletion[0].id).toBe('533-131556-0001');
        expect(truncated).toHaveLength(0);

        const t = row('v4:base:q4-decoder:wasm').clipTimings as Array<{ utteranceId: string; audioSeconds: number }>;
        const seconds = new Map<string, number>(t.map((c) => [c.utteranceId, c.audioSeconds]));
        const audio = seconds.get('533-131556-0001')!;
        expect(audio).toBeLessThan(TRUNCATION_MIN_AUDIO_SECONDS);
        // Exactly on the inclusive boundary — which is why it fired at all.
        expect(highDeletion[0].deletions / highDeletion[0].referenceWords).toBeCloseTo(0.4, 10);
    });

    it('NOT a threshold tweak: a SHORT clip cannot be truncated at ANY deletion ratio', () => {
        const out = classifyDurationSignals(
            [{ id: 'short', referenceWords: 10, deletions: 10 }],   // 100% deleted
            new Map([['short', 3.5]]),
        );
        expect(out.highDeletion).toHaveLength(1);   // still surfaced as a quality signal
        expect(out.truncated).toBe(0);              // never as truncation
    });

    it('CASUALTY: a LONG-FORM clip that loses its reference IS still truncation', () => {
        const out = classifyDurationSignals(
            [{ id: 'long', referenceWords: 40, deletions: 20 }],
            new Map([['long', 31.65]]),
        );
        expect(out.truncated).toBe(1);
    });

    it('POSITIVE CONTROL: the other three arms have neither signal', () => {
        for (const id of ['v4:base:int8-decoder:cpu', 'v2:base.en', 'moonshine:streaming-medium']) {
            const { highDeletion, truncated } = classify(id);
            expect(highDeletion, `${id} highDeletion`).toHaveLength(0);
            expect(truncated, `${id} truncated`).toHaveLength(0);
        }
    });

    it('the diagnostic metric is REPORTED, not discarded', () => {
        const src = readFileSync(resolve(__dirname, '../buildVerdict.ts'), 'utf8');
        expect(src).toContain('highDeletionClips: highDeletion.length');
        expect(src).toContain('TRUNCATION_MIN_AUDIO_SECONDS');
    });

    it('truncation remains eligibility-gating; the diagnostic does not', () => {
        const cp = readFileSync(resolve(__dirname, '../checkpoint.ts'), 'utf8');
        const counters = cp.slice(cp.indexOf('RELIABILITY_COUNTERS = Object.freeze(['), cp.indexOf('] as const)'));
        expect(counters).toContain("'truncated'");
        expect(counters).not.toContain('highDeletion');
    });
});
