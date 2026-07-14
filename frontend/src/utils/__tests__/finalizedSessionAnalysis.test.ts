import { describe, it, expect } from 'vitest';
import {
    reconcileFinalizedFillers,
    reconciliationStatusCopy,
    selectFinalizedHighlightTokens,
} from '../finalizedSessionAnalysis';
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
const fillerTokens = (tokens: { type: string; transcript: string }[], word: string) =>
    tokens.filter((t) => t.type === 'filler' && t.transcript.toLowerCase().trim() === word).length;

describe('reconcileFinalizedFillers — observation vs explicit source selection', () => {
    // ---- POLICY: canonical (#944 live) wins; a transcript recount is never promoted ----

    it('semantic "so" in the transcript does NOT increase the persisted total above canonical', () => {
        const transcript = 'so I went to the store so that I could buy milk and so on';
        const candSo = c(countFillerWords(transcript), 'so');
        expect(candSo).toBeGreaterThan(0); // regex over-counts semantic "so"

        const r = reconcileFinalizedFillers(transcript, canonical({ so: 0, um: 2 }));
        expect(r.selection['so'].reason).toBe('candidate-exceeds-canonical');
        expect(c(r.transcriptCandidateCounts, 'so')).toBe(candSo); // observed, reported
        expect(c(r.transcriptExcessCounts, 'so')).toBe(candSo);    // flagged as excess...
        expect(c(r.persistedCounts, 'so')).toBe(0);                // ...but NOT promoted
        expect(r.persistedTotal).toBe(2);                          // only the canonical um:2 counts
    });

    it('semantic "like" in the transcript does NOT increase the persisted total above canonical', () => {
        const transcript = 'things like apples and oranges taste like fruit like that';
        const candLike = c(countFillerWords(transcript), 'like');
        expect(candLike).toBeGreaterThan(0);

        const r = reconcileFinalizedFillers(transcript, canonical({ like: 1 }));
        expect(c(r.transcriptExcessCounts, 'like')).toBe(candLike - 1);
        expect(c(r.persistedCounts, 'like')).toBe(1); // canonical, not the inflated candidate count
        expect(r.persistedTotal).toBe(1);
    });

    it('a candidate recount LARGER than live never auto-wins (no per-category max)', () => {
        const transcript = 'so so so um';
        const r = reconcileFinalizedFillers(transcript, canonical({ so: 1, um: 1 }));
        expect(c(r.transcriptCandidateCounts, 'so')).toBe(3);
        expect(c(r.persistedCounts, 'so')).toBe(1);
        expect(r.persistedTotal).toBe(r.retainedCanonicalTotal);
        expect(r.persistedTotal).toBe(2);
    });

    it('a live count LARGER than candidate is an INFERRED gap, NOT proven missing-token identity', () => {
        const transcript = 'the opening and the ending';
        const r = reconcileFinalizedFillers(transcript, canonical({ um: 2, uh: 2 }));
        expect(c(r.transcriptCandidateCounts, 'um')).toBe(0);
        expect(c(r.notVisibleCountGap, 'um')).toBe(2); // inferred count difference
        expect(r.selection['um'].reason).toBe('canonical-exceeds-candidate');
        expect(c(r.persistedCounts, 'um')).toBe(2);
        // The module claims no per-occurrence evidence: no "exact speech-only" field exists.
        expect(r).not.toHaveProperty('speechTimeOnlyCounts');
        expect(r.notVisibleGapTotal).toBe(4);
    });

    it('per category, persisted === canonical and the selection reason is explicit', () => {
        const transcript = 'um so um';
        const r = reconcileFinalizedFillers(transcript, canonical({ um: 3, so: 0, uh: 1 }));
        for (const key of Object.keys(r.selection)) {
            expect(r.selection[key].persisted).toBe(r.selection[key].canonical);
            expect(c(r.persistedCounts, key)).toBe(c(r.retainedCanonicalCounts, key));
            expect(['canonical-only', 'canonical-exceeds-candidate', 'candidate-exceeds-canonical'])
                .toContain(r.selection[key].reason);
        }
    });

    // ---- Safety: zero, malformed input, custom words ----

    it('valid zero stays zero and yields the no-discrepancy status', () => {
        const r = reconcileFinalizedFillers('a clean sentence with no fillers', canonical({}));
        expect(r.persistedTotal).toBe(0);
        expect(r.notVisibleGapTotal).toBe(0);
        expect(reconciliationStatusCopy(r)).toBe('Session saved · Your final feedback is ready.');
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
        // userWords ADD a custom filler to detection ("gonna", not a static key): transcript has 3, live 2.
        const transcript = 'gonna gonna gonna and a sonorous tone';
        const r = reconcileFinalizedFillers(transcript, canonical({ gonna: 2 }), ['gonna']);
        expect(c(r.transcriptCandidateCounts, 'gonna')).toBe(3);
        expect(c(r.persistedCounts, 'gonna')).toBe(2);        // canonical wins — not 3, not 5 (no merge/add)
        expect(c(r.transcriptExcessCounts, 'gonna')).toBe(1); // excess reported, not counted
        expect(c(r.transcriptCandidateCounts, 'so')).toBe(0); // "sonorous" must not leak into "so"
        const sources = new Set([
            ...Object.keys(r.retainedCanonicalCounts),
            ...Object.keys(r.transcriptCandidateCounts),
        ]);
        for (const key of Object.keys(r.persistedCounts)) expect(sources.has(key)).toBe(true);
    });

    // ---- SYNTHETIC selector regression (does NOT reproduce the real dogfood session) ----

    it('SYNTHETIC SELECTOR REGRESSION: 8 canonical fillers do not become 10 via transcript semantic "so"', () => {
        // Synthetic shape only. The real Private dogfood session (persisted 10 vs expected 8) is NOT
        // reproduced here — telemetry retains no per-category/transcript data to reconstruct it. This
        // proves ONLY that the SELECTOR does not add transcript candidates on top of canonical.
        const canonicalLive = canonical({ um: 3, uh: 2, like: 2, actually: 1 }); // 8 canonical fillers
        const transcript =
            'um so I think uh the plan is like this and um so we can like proceed uh and actually um finish';
        const r = reconcileFinalizedFillers(transcript, canonicalLive);

        expect(c(r.transcriptCandidateCounts, 'so')).toBeGreaterThanOrEqual(2); // transcript DID add "so"
        expect(c(r.persistedCounts, 'so')).toBe(0);                             // ...never promoted
        expect(r.persistedTotal).toBe(8);                                       // reconciled total stays 8
        expect(r.transcriptExcessTotal).toBeGreaterThanOrEqual(2);             // excess reported, not counted
    });
});

describe('selectFinalizedHighlightTokens — bounded highlight budget (never the raw candidates)', () => {
    it('canonical 0 + semantic "so" candidates → ZERO finalized "so" highlights', () => {
        const raw = parseTranscriptForHighlighting('so so so and um');
        expect(fillerTokens(raw, 'so')).toBeGreaterThan(0); // raw highlighter marks every "so"
        const bounded = selectFinalizedHighlightTokens(raw, canonical({ um: 1 })); // no canonical "so"
        expect(fillerTokens(bounded, 'so')).toBe(0);        // ...all demoted to text
        expect(fillerTokens(bounded, 'um')).toBe(1);
    });

    it('candidates > canonical → finalized highlights never exceed the canonical count per category', () => {
        const raw = parseTranscriptForHighlighting('um um um um');
        expect(fillerTokens(raw, 'um')).toBe(4);
        const bounded = selectFinalizedHighlightTokens(raw, canonical({ um: 1 }));
        expect(fillerTokens(bounded, 'um')).toBe(1); // capped at canonical
    });

    it('highlighted count may be LOWER than the card when Native omitted tokens; status bar acknowledges', () => {
        // Native: um live-detected but stripped from the transcript text.
        const transcript = 'the opening and the ending';
        const raw = parseTranscriptForHighlighting(transcript);
        const r = reconcileFinalizedFillers(transcript, canonical({ um: 2 }));
        const bounded = selectFinalizedHighlightTokens(raw, r.persistedCounts);
        expect(fillerTokens(bounded, 'um')).toBe(0);   // nothing to highlight (omitted from text)
        expect(r.finalizedHighlightTotal).toBe(0);
        expect(r.persistedTotal).toBe(2);              // card still shows the canonical 2
        expect(reconciliationStatusCopy(r, { mode: 'native' })).toMatch(/Browser may omit some/);
    });

    it('the raw regex-candidate object is NOT the highlight source — finalized budget is bounded/separate', () => {
        const transcript = 'so so um';
        const r = reconcileFinalizedFillers(transcript, canonical({ so: 0, um: 1 }));
        // Candidate total (raw regex) exceeds the finalized highlight budget — they are distinct objects.
        expect(r.transcriptCandidateTotal).toBeGreaterThan(r.finalizedHighlightTotal);
        expect(r.finalizedHighlightTotal).toBeLessThanOrEqual(r.persistedTotal);
        expect(c(r.finalizedHighlightCounts, 'so')).toBe(0); // canonical 0 → 0 budget
    });
});

describe('reconciliationStatusCopy — status-bar-only, mode-aware, three approved variants', () => {
    it('NATIVE omission → Browser-omission copy with the persisted count', () => {
        const r = reconcileFinalizedFillers('the opening and the ending', canonical({ um: 2, uh: 2 }));
        expect(reconciliationStatusCopy(r, { mode: 'native' })).toBe(
            'Session saved · 4 filler words detected. Browser may omit some from the transcript.',
        );
    });

    it('PRIVATE never receives Browser-specific copy, even with an omission gap', () => {
        const r = reconcileFinalizedFillers('the opening and the ending', canonical({ um: 2, uh: 2 }));
        expect(r.notVisibleGapTotal).toBeGreaterThan(0);
        const copy = reconciliationStatusCopy(r, { mode: 'private' });
        expect(copy).not.toMatch(/Browser/);
        expect(copy).toBe('Session saved · Your final feedback is ready.');
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
            'Session saved · Your final feedback is ready.',
        );
    });

    it('is concise (single line) and exports no card disclosure contract', async () => {
        const mod = await import('../finalizedSessionAnalysis');
        expect(mod).not.toHaveProperty('fillerDisclosure');
        const r = reconcileFinalizedFillers('the opening and the ending', canonical({ um: 2 }));
        expect(reconciliationStatusCopy(r, { mode: 'native' })).not.toMatch(/\n/);
    });
});
