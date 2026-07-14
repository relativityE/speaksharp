import { describe, it, expect } from 'vitest';
import {
    reconcileFinalizedFillers,
    reconciliationStatusCopy,
} from '../finalizedSessionAnalysis';
import { countFillerWords, FillerCounts } from '../fillerWordUtils';

// Build a canonical (live) FillerCounts map from a plain {key: count} object.
const canonical = (m: Record<string, number>): FillerCounts => {
    const out: FillerCounts = {};
    let total = 0;
    for (const [k, v] of Object.entries(m)) { out[k] = { count: v, color: 'x' }; total += v; }
    out.total = { count: total, color: '' };
    return out;
};
const c = (f: FillerCounts, k: string) => f[k]?.count ?? 0;

describe('reconcileFinalizedFillers — observation vs explicit source selection', () => {
    // ---- POLICY: canonical (#944 live) wins; a transcript recount is never promoted ----

    it('semantic "so" in the transcript does NOT increase the persisted total above canonical', () => {
        // Speaker used no filler "so"; the transcript contains conjunction "so" the regex still matches.
        const transcript = 'so I went to the store so that I could buy milk and so on';
        const visibleSo = c(countFillerWords(transcript), 'so');
        expect(visibleSo).toBeGreaterThan(0); // regex over-counts semantic "so"

        const r = reconcileFinalizedFillers(transcript, canonical({ so: 0, um: 2 }));
        expect(r.selection['so'].reason).toBe('visible-exceeds-canonical');
        expect(c(r.transcriptVisibleCounts, 'so')).toBe(visibleSo); // observed, reported
        expect(c(r.transcriptExcessCounts, 'so')).toBe(visibleSo);  // flagged as excess...
        expect(c(r.persistedCounts, 'so')).toBe(0);                 // ...but NOT promoted
        expect(r.persistedTotal).toBe(2);                           // only the canonical um:2 counts
    });

    it('semantic "like" in the transcript does NOT increase the persisted total above canonical', () => {
        const transcript = 'things like apples and oranges taste like fruit like that';
        const visibleLike = c(countFillerWords(transcript), 'like');
        expect(visibleLike).toBeGreaterThan(0);

        const r = reconcileFinalizedFillers(transcript, canonical({ like: 1 }));
        expect(c(r.transcriptExcessCounts, 'like')).toBe(visibleLike - 1);
        expect(c(r.persistedCounts, 'like')).toBe(1); // canonical, not the inflated visible count
        expect(r.persistedTotal).toBe(1);
    });

    it('a visible recount LARGER than live never auto-wins (no per-category max)', () => {
        const transcript = 'so so so um';
        const r = reconcileFinalizedFillers(transcript, canonical({ so: 1, um: 1 }));
        // visible so = 3 > canonical 1, but persisted stays canonical.
        expect(c(r.transcriptVisibleCounts, 'so')).toBe(3);
        expect(c(r.persistedCounts, 'so')).toBe(1);
        expect(r.persistedTotal).toBe(r.retainedCanonicalTotal);
        expect(r.persistedTotal).toBe(2);
    });

    it('a live count LARGER than visible is reported as an INFERRED gap, NOT proven missing-token identity', () => {
        // Native: um/uh live-detected but stripped from Web Speech text.
        const transcript = 'the opening and the ending';
        const r = reconcileFinalizedFillers(transcript, canonical({ um: 2, uh: 2 }));
        expect(c(r.transcriptVisibleCounts, 'um')).toBe(0);
        expect(c(r.notVisibleCountGap, 'um')).toBe(2); // inferred count difference
        expect(r.selection['um'].reason).toBe('canonical-exceeds-visible');
        // The gap is a count, exposed for disclosure — the module claims no per-occurrence evidence:
        // persisted is canonical, and there is no "exact speech-time-only occurrences" field.
        expect(c(r.persistedCounts, 'um')).toBe(2);
        expect(r).not.toHaveProperty('speechTimeOnlyCounts');
        expect(r.notVisibleGapTotal).toBe(4);
    });

    it('per category, persisted === canonical and the selection reason is explicit', () => {
        const transcript = 'um so um';
        const r = reconcileFinalizedFillers(transcript, canonical({ um: 3, so: 0, uh: 1 }));
        for (const key of Object.keys(r.selection)) {
            expect(r.selection[key].persisted).toBe(r.selection[key].canonical);
            expect(c(r.persistedCounts, key)).toBe(c(r.retainedCanonicalCounts, key));
            expect(['canonical-only', 'canonical-exceeds-visible', 'visible-exceeds-canonical'])
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
        expect(r1.transcriptVisibleTotal).toBe(0);
        // @ts-expect-error deliberately malformed canonical shape
        const r2 = reconcileFinalizedFillers('um and um', { um: { count: 'NaN', color: 1 }, total: null });
        expect(Number.isFinite(r2.persistedTotal)).toBe(true);
        expect(r2.persistedTotal).toBeGreaterThanOrEqual(0);
    });

    it('custom-tracked words obey canonical-wins and never double-count or leak via source merging', () => {
        // A user-tracked custom filler ("gonna", not a static key): transcript has 3, live canonical 2.
        const transcript = 'gonna gonna gonna and a sonorous tone';
        const r = reconcileFinalizedFillers(transcript, canonical({ gonna: 2 }), ['gonna']);
        expect(c(r.transcriptVisibleCounts, 'gonna')).toBe(3);
        expect(c(r.persistedCounts, 'gonna')).toBe(2);        // canonical wins — not 3, not 5 (no merge/add)
        expect(c(r.transcriptExcessCounts, 'gonna')).toBe(1); // excess reported, not counted
        // "sonorous" must not leak into the "so" filler via substring matching.
        expect(c(r.transcriptVisibleCounts, 'so')).toBe(0);
        // Reconciliation must not invent a category absent from BOTH sources.
        const sources = new Set([
            ...Object.keys(r.retainedCanonicalCounts),
            ...Object.keys(r.transcriptVisibleCounts),
        ]);
        for (const key of Object.keys(r.persistedCounts)) expect(sources.has(key)).toBe(true);
    });

    // ---- Dogfood regression: the finalized selector must NOT turn 8 into 10 ----

    it('DOGFOOD REGRESSION: 8 spoken fillers do not become 10 via transcript recount of semantic "so"', () => {
        // Synthetic reconstruction of the Private dogfood shape (session c9149661, persisted 10 vs expected 8).
        // Canonical live counted the 8 genuinely-spoken fillers; the transcript ALSO contains 2 semantic
        // "so" the regex matches. A max()/promotion policy would surface 10; canonical-wins keeps 8.
        const canonicalLive = canonical({ um: 3, uh: 2, like: 2, actually: 1 }); // 8 real spoken fillers
        const transcript =
            'um so I think uh the plan is like this and um so we can like proceed uh and actually um finish';
        const r = reconcileFinalizedFillers(transcript, canonicalLive);

        const visibleSo = c(r.transcriptVisibleCounts, 'so');
        expect(visibleSo).toBeGreaterThanOrEqual(2);        // the transcript DID add semantic "so"
        expect(c(r.persistedCounts, 'so')).toBe(0);         // ...never promoted (canonical so = 0)
        expect(r.persistedTotal).toBe(8);                   // the reconciled total stays 8, not 10
        expect(r.transcriptExcessTotal).toBeGreaterThanOrEqual(2); // excess is reported, not counted
        // NOTE: if the LIVE counter itself over-counts semantic "so" (the actual dogfood cause), the
        // canonical total is already inflated upstream — that is a DETECTION fix, out of scope here.
        // This test proves only that the SELECTOR does not add transcript recounts on top.
    });
});

describe('reconciliationStatusCopy — status-bar-only, three approved variants', () => {
    it('Native omission → discrepancy copy with the persisted count', () => {
        const r = reconcileFinalizedFillers('the opening and the ending', canonical({ um: 2, uh: 2 }));
        expect(reconciliationStatusCopy(r)).toBe(
            'Session saved · 4 filler words detected. Browser may omit some from the transcript.',
        );
    });

    it('count changed without omission → "updated to" copy', () => {
        const r = reconcileFinalizedFillers('um and um', canonical({ um: 2 }));
        expect(r.notVisibleGapTotal).toBe(0);
        expect(reconciliationStatusCopy(r, { priorDisplayedTotal: 3 })).toBe(
            'Session saved · Filler words updated to 2.',
        );
    });

    it('no discrepancy → plain ready copy', () => {
        const r = reconcileFinalizedFillers('um and um', canonical({ um: 2 }));
        expect(reconciliationStatusCopy(r, { priorDisplayedTotal: 2 })).toBe(
            'Session saved · Your final feedback is ready.',
        );
        expect(reconciliationStatusCopy(r)).toBe('Session saved · Your final feedback is ready.');
    });

    it('is concise (single line, no card primary/secondary contract exported)', async () => {
        const mod = await import('../finalizedSessionAnalysis');
        expect(mod).not.toHaveProperty('fillerDisclosure');
        const r = reconcileFinalizedFillers('the opening and the ending', canonical({ um: 2 }));
        expect(reconciliationStatusCopy(r)).not.toMatch(/\n/);
    });
});
