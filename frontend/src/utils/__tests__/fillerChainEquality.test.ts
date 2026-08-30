import { describe, expect, it } from 'vitest';
import {
    calculateCoreSessionMetrics, selectReviewFillerSnapshot, normalizeFillerCounts,
} from '../sessionAnalysis';
import { countFillerWords, type FillerCounts } from '../fillerWordUtils';
import { readPersistedFillerCounts } from '@/contracts/fillerCounts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

    it('a VALID ZERO stays zero — a genuine no-filler session is not overwritten by a recount', () => {
        // The inverse error, and the more damaging one: a user who genuinely said nothing must not have a
        // recount of the transcript invent fillers for them.
        const zero = normalizeFillerCounts({ um: { count: 0 } } as unknown as FillerCounts);
        const metrics = calculateCoreSessionMetrics({
            transcript: 'um uh um uh um', durationSeconds: 60, fillerData: zero, userWords: [],
        });
        expect(metrics.fillerCount).toBe(0);
    });

    it('the headline total and the chips derive from ONE map — they cannot disagree', () => {
        // The C3 contract. Internal consistency: necessary, and NOT sufficient for accuracy.
        const rendered = selectReviewFillerSnapshot({
            inAfter: true, finalizedFillerData: stopSnapshot(), liveFillerData: null,
        });
        const chipSum = Object.entries(rendered.counts ?? {})
            .filter(([k]) => k !== 'total')
            .reduce((a, [, v]) => a + ((v as { count?: number })?.count ?? 0), 0);
        expect(chipSum).toBe(rendered.total);
    });

    it('mutating the store AFTER the stop snapshot cannot move the reported number', () => {
        // The defensive deep copy in stopRecording. Without it, a later in-place store mutation would
        // retroactively rewrite what the session reported.
        const snapshot = stopSnapshot();
        const metrics = calculateCoreSessionMetrics({
            transcript: '', durationSeconds: 60, fillerData: snapshot, userWords: [],
        });
        const before = metrics.fillerCount;
        (snapshot as unknown as Record<string, { count: number }>).um.count = 999;
        expect(metrics.fillerCount).toBe(before);
    });

    it('DEFAULT: persisted 3 = rendered 3 — discourse markers excluded from BOTH', () => {
        const transcript = 'um so uh I think um we should review it';
        const metrics = calculateCoreSessionMetrics({
            transcript, durationSeconds: 60, fillerData: null, userWords: [],
        });
        const rendered = selectReviewFillerSnapshot({
            inAfter: true, finalizedFillerData: metrics.fillerData, liveFillerData: null,
        });
        expect(metrics.fillerCount).toBe(3);
        expect(metrics.fillerData.total.count).toBe(3);   // canonical persisted total
        expect(rendered.total).toBe(3);                   // what the user sees
        // The per-key map stays COMPREHENSIVE so history can be re-tiered and an opted-in user's chips
        // have something to draw from. Only the scalar is the coachable tier.
        expect(metrics.fillerData.so.count).toBe(1);
    });

    it('OPT-IN: persisted 4 = rendered 4 — the flag moves BOTH together', () => {
        const transcript = 'um so uh I think um we should review it';
        const metrics = calculateCoreSessionMetrics({
            transcript, durationSeconds: 60, fillerData: null, userWords: [], includeDiscourseMarkers: true,
        });
        const rendered = selectReviewFillerSnapshot({
            inAfter: true, finalizedFillerData: metrics.fillerData, liveFillerData: null,
            includeDiscourseMarkers: true,
        });
        expect(metrics.fillerData.total.count).toBe(4);
        expect(rendered.total).toBe(4);
        expect(metrics.fillerData.total.count).toBe(rendered.total);
    });

    it('a CUSTOM word that overlaps a discourse marker still counts, opted in or not', () => {
        // A user who declares `so` as a word they are working on must be coached on it even under the
        // default tier, where `so` is otherwise excluded. The user's own declaration outranks the default.
        const transcript = 'um so uh I think um we should review it';
        const withCustom = calculateCoreSessionMetrics({
            transcript, durationSeconds: 60, fillerData: null, userWords: ['so'],
        });
        const withoutCustom = calculateCoreSessionMetrics({
            transcript, durationSeconds: 60, fillerData: null, userWords: [],
        });
        expect(withCustom.fillerCount).toBeGreaterThan(withoutCustom.fillerCount);
        const rendered = selectReviewFillerSnapshot({
            inAfter: true, finalizedFillerData: withCustom.fillerData, liveFillerData: null,
            userWords: ['so'],
        });
        expect(rendered.total).toBe(withCustom.fillerData.total.count);
    });

    it('the persisted map and the rendered view agree KEY BY KEY, not just on the scalar', () => {
        // Scalar equality alone could hide a per-key disagreement.
        const metrics = calculateCoreSessionMetrics({
            transcript: 'um so uh I think um we should review it',
            durationSeconds: 60, fillerData: null, userWords: [],
        });
        const rendered = selectReviewFillerSnapshot({
            inAfter: true, finalizedFillerData: metrics.fillerData, liveFillerData: null,
        });
        for (const key of ['um', 'uh', 'ah'] as const) {
            expect(rendered.counts?.[key]?.count ?? 0).toBe(metrics.fillerData[key]?.count ?? 0);
        }
        const chipSum = Object.entries(rendered.counts ?? {})
            .filter(([k]) => k !== 'total')
            .reduce((a, [, v]) => a + ((v as { count?: number })?.count ?? 0), 0);
        expect(chipSum).toBe(metrics.fillerData.total.count);
    });

    it('SURVIVES THE PERSISTENCE ROUND TRIP: rendered == readback == canonical', () => {
        // The map is written as the strict flat `filler_counts` contract and read back through it. If the
        // round trip changed the number, persisted-equals-rendered would hold only in memory.
        const metrics = calculateCoreSessionMetrics({
            transcript: 'um so uh I think um we should review it',
            durationSeconds: 60, fillerData: null, userWords: [],
        });
        const flat: Record<string, number> = {};
        for (const [k, v] of Object.entries(metrics.fillerData)) {
            if (k === 'total') continue;
            const c = (v as { count?: number })?.count ?? 0;
            if (c > 0) flat[k] = c;
        }
        const readback = readPersistedFillerCounts(flat);
        expect(readback).not.toBeNull();

        const rehydrated = calculateCoreSessionMetrics({
            transcript: '', durationSeconds: 60,
            fillerData: normalizeFillerCounts(readback as unknown as FillerCounts), userWords: [],
        });
        const rendered = selectReviewFillerSnapshot({
            inAfter: true, finalizedFillerData: rehydrated.fillerData, liveFillerData: null,
        });
        expect(rehydrated.fillerData.total.count).toBe(metrics.fillerData.total.count);
        expect(rendered.total).toBe(metrics.fillerData.total.count);
    });

    it('no consumer reads the comprehensive breakdown total where the headline is meant', () => {
        // Guards the fix at its source: `fillerWords.total.count` was the exact read that reported a
        // number the user never saw.
        const src = readFileSync(
            resolve(__dirname, '../../services/SpeechRuntimeController.ts'), 'utf8',
        );
        const code = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
        expect(code).not.toContain('fillerWords.total.count');
        expect(code).toContain('const headlineFillerCount = sessionMetrics.fillerCount;');
    });

});
