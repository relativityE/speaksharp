import { describe, it, expect } from 'vitest';
import {
    reconcileFinalizedFillers,
    reconciliationStatusCopy,
} from '../finalizedSessionAnalysis';
import * as finalizedModule from '../finalizedSessionAnalysis';
import { countFillerWords, FillerCounts } from '../fillerWordUtils';
import { parseTranscriptForHighlighting } from '../highlightUtils';

// Build a canonical (live) FillerCounts map from a plain {key: count} object.
const canonical = (m: Record<string, number>): FillerCounts => {
    const out: FillerCounts = {};
    let total = 0;
    for (const [k, v] of Object.entries(m)) { out[k] = { count: v, color: 'x' }; total += v; }
    out.total = { count: total, color: '' };
    return out;
};
const c = (f: FillerCounts, k: string) => f[k]?.count ?? 0;

describe('reconcileFinalizedFillers — observation vs explicit source selection (no occurrence selection)', () => {
    // ---- POLICY: canonical (#944 live) wins; a transcript recount is never promoted ----

    it('semantic "so" in the transcript does NOT increase the persisted total above canonical', () => {
        const transcript = 'so I went to the store so that I could buy milk and so on';
        const candSo = c(countFillerWords(transcript), 'so');
        expect(candSo).toBeGreaterThan(0);
        const r = reconcileFinalizedFillers(transcript, canonical({ so: 0, um: 2 }));
        expect(r.selection['so'].reason).toBe('candidate-exceeds-canonical');
        expect(c(r.transcriptExcessCounts, 'so')).toBe(candSo);
        expect(c(r.persistedCounts, 'so')).toBe(0);
        expect(r.persistedTotal).toBe(2);
    });

    it('a candidate recount LARGER than live never auto-wins (no per-category max)', () => {
        const transcript = 'so so so um';
        const r = reconcileFinalizedFillers(transcript, canonical({ so: 1, um: 1 }));
        expect(c(r.transcriptCandidateCounts, 'so')).toBe(3);
        expect(c(r.persistedCounts, 'so')).toBe(1);
        expect(r.persistedTotal).toBe(2);
    });

    it('a live count LARGER than candidate is an INFERRED gap, NOT proven missing-token identity', () => {
        const transcript = 'the opening and the ending';
        const r = reconcileFinalizedFillers(transcript, canonical({ um: 2, uh: 2 }));
        expect(c(r.transcriptCandidateCounts, 'um')).toBe(0);
        expect(c(r.notVisibleCountGap, 'um')).toBe(2);
        expect(r.selection['um'].reason).toBe('canonical-exceeds-candidate');
        expect(c(r.persistedCounts, 'um')).toBe(2);
        expect(r).not.toHaveProperty('speechTimeOnlyCounts');
        expect(r.notVisibleGapTotal).toBe(4);
    });

    it('per category, persisted === canonical and the selection reason is explicit', () => {
        const transcript = 'um so um';
        const r = reconcileFinalizedFillers(transcript, canonical({ um: 3, so: 0, uh: 1 }));
        for (const key of Object.keys(r.selection)) {
            expect(r.selection[key].persisted).toBe(r.selection[key].canonical);
            expect(['canonical-only', 'canonical-exceeds-candidate', 'candidate-exceeds-canonical'])
                .toContain(r.selection[key].reason);
        }
    });

    // ---- LIMITATION PROOFS: aggregate counts cannot select truthful occurrences ----

    it('LIMITATION: an early semantic "so" + a later genuine filler "so" cannot be truthfully selected', () => {
        // Two "so" tokens in the transcript: the first is a conjunction, the second a filler. The live
        // canonical count says there is 1 filler "so" — but aggregate counts give NO way to know WHICH
        // of the two transcript occurrences it is. The module must not pretend to know.
        const transcript = 'so the plan changed and then so I paused for a while';
        expect(c(countFillerWords(transcript), 'so')).toBe(2); // two candidate occurrences
        const r = reconcileFinalizedFillers(transcript, canonical({ so: 1 }));
        expect(c(r.transcriptCandidateCounts, 'so')).toBe(2);
        expect(c(r.persistedCounts, 'so')).toBe(1);            // count only — canonical
        expect(c(r.transcriptExcessCounts, 'so')).toBe(1);
        // The module exposes NO occurrence/position selection: no highlight budget, no chosen indices.
        expect(finalizedModule).not.toHaveProperty('selectFinalizedHighlightTokens');
        expect(r).not.toHaveProperty('finalizedHighlightCounts');
        expect(r).not.toHaveProperty('finalizedHighlightTotal');
        expect(r.selection['so']).not.toHaveProperty('highlight');
    });

    it('LIMITATION: highlight selection is not exported — highlights and the card total may differ', () => {
        // The module deliberately provides no way to force transcript highlights to equal the card total.
        expect(finalizedModule).not.toHaveProperty('selectFinalizedHighlightTokens');
        // Candidate highlights (what the existing highlighter renders) can exceed the canonical card total,
        // and the module does nothing to reconcile them — by design.
        const transcript = 'so so um';                          // 2 semantic "so" + 1 "um"
        const raw = parseTranscriptForHighlighting(transcript);
        const rendered = raw.filter((t) => t.type === 'filler').length;
        const r = reconcileFinalizedFillers(transcript, canonical({ so: 0, um: 1 }));
        expect(rendered).toBeGreaterThan(r.persistedTotal);     // highlights > card total, left as-is
    });

    // ---- Counter/highlighter coverage limitations for common filler VARIANTS ----

    it('LIMITATION: counter/highlighter variant behavior diverges, and smart apostrophes are missed by both', () => {
        // Documents ACTUAL behavior (not a guess). The COUNTER lists variants explicitly, so it CATCHES
        // umm / uhh / ya know / kinda / sorta:
        expect(c(countFillerWords('umm'), 'um')).toBeGreaterThan(0);
        expect(c(countFillerWords('uhh'), 'uh')).toBeGreaterThan(0);
        expect(c(countFillerWords('ya know'), 'You Know')).toBeGreaterThan(0);
        // #1324 finding 3 CURRENTIZED: these asserted `.total`, but `kind of`/`sort of` are DISCOURSE
        // MARKERS and no longer reach the coachable headline. The claim here is about VARIANT MATCHING
        // — that the counter catches "kinda"/"sorta" at all — which is a PER-KEY fact, so assert it
        // per key. Using `.total` as a proxy conflated coverage with the headline tier.
        expect(c(countFillerWords('kinda'), 'Kind Of')).toBeGreaterThan(0);
        expect(c(countFillerWords('sorta'), 'Sort Of')).toBeGreaterThan(0);
        // ...but the HIGHLIGHTER keys only on the canonical strings, so it MISSES the same variants —
        // a real counter-vs-highlighter divergence the finalized analysis does not resolve.
        expect(parseTranscriptForHighlighting('umm').filter((t) => t.type === 'filler').length).toBe(0);
        // Smart / curly-apostrophe "y’know" is a blind spot for BOTH (only the straight apostrophe is listed):
        expect(c(countFillerWords("y'know"), 'You Know')).toBeGreaterThan(0); // straight '
        expect(c(countFillerWords('y’know'), 'You Know')).toBe(0);       // curly ’ — not matched
        // Reconciliation inherits the counter's coverage and its blind spots; it adds neither.
        const r = reconcileFinalizedFillers('y’know y’know', canonical({}));
        expect(r.transcriptCandidateTotal).toBe(0);
        expect(r.persistedTotal).toBe(0);
    });

    // ---- Safety ----

    it('valid zero stays zero and yields the no-discrepancy status', () => {
        const r = reconcileFinalizedFillers('a clean sentence with no fillers', canonical({}));
        expect(r.persistedTotal).toBe(0);
        expect(r.notVisibleGapTotal).toBe(0);
        expect(reconciliationStatusCopy(r)).toBe('Session saved · Your transcript is ready.');
    });

    it('malformed / null input fails safe (no throw, sane zeros)', () => {
        // @ts-expect-error deliberately malformed transcript
        const r1 = reconcileFinalizedFillers(null, null);
        expect(r1.persistedTotal).toBe(0);
        expect(r1.transcriptCandidateTotal).toBe(0);
        // @ts-expect-error deliberately malformed canonical shape
        const r2 = reconcileFinalizedFillers('um and um', { um: { count: 'NaN', color: 1 }, total: null });
        expect(Number.isFinite(r2.persistedTotal)).toBe(true);
        expect(r2.persistedTotal).toBeGreaterThanOrEqual(0);
    });

    it('custom-tracked words obey canonical-wins and never double-count or leak via source merging', () => {
        const transcript = 'gonna gonna gonna and a sonorous tone';
        const r = reconcileFinalizedFillers(transcript, canonical({ gonna: 2 }), ['gonna']);
        expect(c(r.transcriptCandidateCounts, 'gonna')).toBe(3);
        expect(c(r.persistedCounts, 'gonna')).toBe(2);
        expect(c(r.transcriptExcessCounts, 'gonna')).toBe(1);
        expect(c(r.transcriptCandidateCounts, 'so')).toBe(0); // "sonorous" must not leak into "so"
    });

    it('SYNTHETIC SELECTOR REGRESSION: 8 canonical fillers do not become 10 via transcript semantic "so"', () => {
        // Synthetic shape only — does NOT reproduce the real Private dogfood session (no per-category
        // telemetry exists). Proves ONLY that the selector never adds transcript candidates on top.
        const canonicalLive = canonical({ um: 3, uh: 2, like: 2, actually: 1 }); // 8 canonical fillers
        const transcript =
            'um so I think uh the plan is like this and um so we can like proceed uh and actually um finish';
        const r = reconcileFinalizedFillers(transcript, canonicalLive);
        expect(c(r.transcriptCandidateCounts, 'so')).toBeGreaterThanOrEqual(2);
        expect(c(r.persistedCounts, 'so')).toBe(0);
        expect(r.persistedTotal).toBe(8);
        expect(r.transcriptExcessTotal).toBeGreaterThanOrEqual(2);
    });
});

describe('reconciliationStatusCopy — status-bar-only, mode-aware, three approved variants', () => {
    it('NATIVE omission → Browser-omission copy with the persisted count', () => {
        const r = reconcileFinalizedFillers('the opening and the ending', canonical({ um: 4, uh: 4 }));
        expect(reconciliationStatusCopy(r, { mode: 'native' })).toBe(
            'Session saved · 8 filler words detected. The written transcript may omit some.',
        );
    });

    it('PRIVATE never receives Browser-specific copy, even with an omission gap', () => {
        const r = reconcileFinalizedFillers('the opening and the ending', canonical({ um: 2, uh: 2 }));
        expect(r.notVisibleGapTotal).toBeGreaterThan(0);
        const copy = reconciliationStatusCopy(r, { mode: 'private' });
        expect(copy).not.toMatch(/Browser/);
        expect(copy).toBe('Session saved · Your transcript is ready.');
    });

    it('mode omitted → conservative (no Browser copy)', () => {
        const r = reconcileFinalizedFillers('the opening and the ending', canonical({ um: 2 }));
        expect(reconciliationStatusCopy(r)).not.toMatch(/Browser/);
    });

    it('count changed without omission → "updated to" copy', () => {
        const r = reconcileFinalizedFillers('um and um', canonical({ um: 2 }));
        expect(r.notVisibleGapTotal).toBe(0);
        expect(reconciliationStatusCopy(r, { mode: 'native', priorDisplayedTotal: 3 })).toBe(
            'Session saved · Filler words updated to 2.',
        );
    });

    it('no discrepancy → plain ready copy', () => {
        const r = reconcileFinalizedFillers('um and um', canonical({ um: 2 }));
        expect(reconciliationStatusCopy(r, { mode: 'native', priorDisplayedTotal: 2 })).toBe(
            'Session saved · Your transcript is ready.',
        );
    });

    it('is concise (single line) and exports no card disclosure / highlight-selection contract', () => {
        expect(finalizedModule).not.toHaveProperty('fillerDisclosure');
        expect(finalizedModule).not.toHaveProperty('selectFinalizedHighlightTokens');
        const r = reconcileFinalizedFillers('the opening and the ending', canonical({ um: 2 }));
        expect(reconciliationStatusCopy(r, { mode: 'native' })).not.toMatch(/\n/);
    });

    // ---- SCOPE HONESTY: no page-integration / one-status-bar completion claim in this PR ----
    it('SCOPE: this module has no SessionPage integration and asserts no single-status-bar completion', () => {
        // The module exports only pure helpers; wiring the card/highlights/status bar into SessionPage
        // (and removing the separate post-save-review-actions surface) is deferred and NOT claimed here.
        expect(typeof finalizedModule.reconcileFinalizedFillers).toBe('function');
        expect(typeof finalizedModule.reconciliationStatusCopy).toBe('function');
        expect(Object.keys(finalizedModule).sort()).toEqual(
            ['reconcileFinalizedFillers', 'reconciliationStatusCopy'],
        );
    });
});
