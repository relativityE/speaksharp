import { describe, expect, it } from 'vitest';
import {
    calculateCoreSessionMetrics, selectReviewFillerSnapshot, normalizeFillerCounts,
} from '../sessionAnalysis';
import { countFillerWords, type FillerCounts } from '../fillerWordUtils';

/**
 * #1324 evidence item 3 — STOP-SNAPSHOT → FINALIZED → PERSISTED → RENDERED equality.
 *
 * #1324 requires three SEPARATE proofs, and says plainly that passing one does not substitute for the
 * others: (1) final-transcript WER, (2) interim-derived filler precision/recall, (3) this chain.
 *
 * (1) and (2) need consented real-human audio with at least 30 annotated true fillers. That does not
 * exist yet and cannot be invented here — a fabricated fixture would produce a number that looks like
 * evidence and is not. (3) needs NO audio: it asks whether a count, once measured, survives the
 * handoffs to the screen unchanged. Nothing asserted that chain before this file.
 *
 * SCOPE, STATED SO IT CANNOT BE MISREAD: this proves TRANSPORT, not ACCURACY. A wrong count that is
 * faithfully carried to the screen passes every test here. That is exactly the distinction #1324 draws
 * when it says the C3 fix made the total and chips internally consistent without proving the underlying
 * count correct.
 */

/** A live stop-time snapshot, as `cloneFillerCounts(store.fillerData)` would produce it. */
const stopSnapshot = (): FillerCounts => normalizeFillerCounts({
    um: { count: 3 }, uh: { count: 2 }, ah: { count: 1 },
} as unknown as FillerCounts);

describe('#1324(3) a measured count survives every handoff to the screen', () => {
    it('POSITIVE CONTROL: the chain preserves the stop snapshot exactly', () => {
        const snapshot = stopSnapshot();

        // stop → persisted: a VALID snapshot supplies the saved metrics rather than a recount.
        const metrics = calculateCoreSessionMetrics({
            transcript: 'text that would recount DIFFERENTLY if the snapshot were ignored',
            durationSeconds: 60, fillerData: snapshot, userWords: [],
        });

        // persisted → rendered: the after-state review reads the finalized map.
        const rendered = selectReviewFillerSnapshot({
            inAfter: true, finalizedFillerData: metrics.fillerData, liveFillerData: null,
        });

        for (const key of ['um', 'uh', 'ah'] as const) {
            expect(rendered.counts?.[key]?.count, `${key} changed in transit`)
                .toBe(snapshot[key]?.count);
        }
        expect(rendered.total).toBe(6);
    });

    it('the stop snapshot BEATS a recount of the final transcript — the whole reason it is taken', () => {
        // Whisper's cleaned final transcript has no fillers at all. If the chain silently recounted, the
        // user would be shown 0 for a session in which the live counter measured 6.
        const cleanedFinal = 'So I think the number is wrong and we should review it.';
        expect(countFillerWords(cleanedFinal, []).total.count).toBe(0);

        const metrics = calculateCoreSessionMetrics({
            transcript: cleanedFinal, durationSeconds: 60, fillerData: stopSnapshot(), userWords: [],
        });
        expect(metrics.fillerData.total.count).toBe(6);
    });

    it('an ABSENT snapshot falls back to a recount — the fallback actually engages', () => {
        // The documented fallback. It must engage, not silently yield zero. Compared PER TRUE-FILLER KEY
        // rather than on `total`, because the two totals genuinely differ — see the divergence test below.
        const transcript = 'um so uh I think um we should review it';
        const direct = countFillerWords(transcript, []);
        const metrics = calculateCoreSessionMetrics({
            transcript, durationSeconds: 60, fillerData: null, userWords: [],
        });
        for (const key of ['um', 'uh', 'ah'] as const) {
            expect(metrics.fillerData[key]?.count).toBe(direct[key]?.count);
        }
        expect(metrics.fillerData.um.count).toBeGreaterThan(0);
    });

    it('an EMPTY snapshot is treated as absent, not as a measured zero', () => {
        // `{}` means "nothing was captured", which must not be reported as "the user said none".
        const transcript = 'um so uh I think we should review it';
        const direct = countFillerWords(transcript, []);
        const metrics = calculateCoreSessionMetrics({
            transcript, durationSeconds: 60, fillerData: {} as FillerCounts, userWords: [],
        });
        expect(metrics.fillerData.um.count).toBe(direct.um.count);
        expect(metrics.fillerData.um.count).toBeGreaterThan(0);
    });

    it('FINDING: the PERSISTED total and the RENDERED total disagree on discourse markers', () => {
        // Found by this chain test, which is why it exists.
        //
        //   countFillerWords(t).total          = 3   true-filler tier (um 2, uh 1) — excludes `so`
        //   calculateCoreSessionMetrics(...)   = 4   normalizeFillerCounts sums EVERY key, `so` included
        //   selectReviewFillerSnapshot(...)    = 3   C3 excludes discourse markers from chips AND total
        //
        // So the number written for a session is not the number the user was shown for that session.
        // The C3 ruling was applied to the review selector but not to the normalizer that produces the
        // persisted scalar.
        //
        // NOT SILENTLY "FIXED" HERE. Changing what `normalizeFillerCounts` writes into `total` changes a
        // PERSISTED metric's meaning and reaches analytics history and the RPC contract; that is a product
        // decision, not a test-time correction. Pinned so the divergence is deliberate and visible, and so
        // that closing it is a conscious change rather than an accident.
        const transcript = 'um so uh I think um we should review it';
        const metrics = calculateCoreSessionMetrics({
            transcript, durationSeconds: 60, fillerData: null, userWords: [],
        });
        const rendered = selectReviewFillerSnapshot({
            inAfter: true, finalizedFillerData: metrics.fillerData, liveFillerData: null,
        });

        expect(metrics.fillerData.so.count).toBe(1);
        expect(metrics.fillerData.total.count).toBe(4);   // persisted: discourse marker included
        expect(rendered.total).toBe(3);                   // rendered: excluded
        expect(rendered.total).not.toBe(metrics.fillerData.total.count);

        // The true-filler keys themselves agree — the divergence is confined to the scalar total.
        // (`??  0`: the review selector omits zero-count keys rather than rendering an empty chip.)
        for (const key of ['um', 'uh', 'ah'] as const) {
            expect(rendered.counts?.[key]?.count ?? 0).toBe(metrics.fillerData[key]?.count ?? 0);
        }
    });

    it('a VALID ZERO stays zero — a genuine no-filler session is not overwritten by a recount', () => {
        // The inverse error. `filler-source-comparison-gate`: valid zero stays zero.
        const zero = normalizeFillerCounts({ um: { count: 0 } } as unknown as FillerCounts);
        const metrics = calculateCoreSessionMetrics({
            transcript: 'um uh um uh um', durationSeconds: 60, fillerData: zero, userWords: [],
        });
        expect(metrics.fillerData.total.count).toBe(0);
    });

    it('the headline total and the chips derive from ONE map — they cannot disagree', () => {
        // The C3 contract. Internal consistency, which is necessary and NOT sufficient for accuracy.
        const rendered = selectReviewFillerSnapshot({
            inAfter: true, finalizedFillerData: stopSnapshot(), liveFillerData: null,
        });
        const chipSum = Object.entries(rendered.counts ?? {})
            .filter(([k]) => k !== 'total')
            .reduce((a, [, v]) => a + ((v as { count?: number })?.count ?? 0), 0);
        expect(chipSum).toBe(rendered.total);
    });

    it('mutating the store AFTER the stop snapshot cannot move the persisted number', () => {
        // The defensive deep copy in stopRecording. Without it a later in-place store mutation would
        // retroactively rewrite what the session reported.
        const snapshot = stopSnapshot();
        const metrics = calculateCoreSessionMetrics({
            transcript: '', durationSeconds: 60, fillerData: snapshot, userWords: [],
        });
        const before = metrics.fillerData.total.count;
        (snapshot as unknown as Record<string, { count: number }>).um.count = 999;
        expect(metrics.fillerData.total.count).toBe(before);
    });
});
