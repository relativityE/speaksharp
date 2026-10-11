// @vitest-environment node
/**
 * #1258 RWT run 38104864048 (F2): the Open Mic oracle counted the LITERAL word "um" in the saved transcript, while
 * the product saves `flattenToFillerCounts(countFillerWords(finalTranscript))`, whose "um" family is um|umm|ummm|uhm.
 * A transcript that wrote "Umm" could read as transcript 2 vs saved 5 — an oracle mismatch, not a saved-count defect. The oracle must recount the
 * saved transcript with the product's own definition, so "transcript vs saved" compares one definition with itself.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countFillerWords } from '../../frontend/src/utils/fillerWordUtils';
import { flattenToFillerCounts } from '../../frontend/src/utils/nextAction';
import { productFillerCount } from '../live/helpers/rwtFillerOracle';

describe('#1258 RWT filler oracle uses the product definition', () => {
    const transcript = 'Umm, so the plan, um, is simple. Uhm, you know, it works. Ummm.';

    it('counts every product variant of a key, not only the literal word', () => {
        expect(productFillerCount(transcript, 'um')).toBe(4);
        expect(productFillerCount(transcript, 'you_know')).toBe(1);
        expect(productFillerCount(transcript, 'uh')).toBe(0);
    });

    it('equals the count the product saves for the same transcript', () => {
        // The saved row: SpeechRuntimeController flattens `finalizedFillerData(finalTranscript)` into `filler_counts`.
        const saved = flattenToFillerCounts(countFillerWords(transcript)) as Record<string, number>;
        for (const key of ['um', 'uh', 'ah', 'you_know']) {
            expect(productFillerCount(transcript, key)).toBe(saved[key] ?? 0);
        }
    });

    it('the Open Mic spec recounts the saved transcript with the product definition, never a literal regex', () => {
        const spec = readFileSync(path.join(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        expect(spec).toContain('productFillerCount(transcript, key)');
        expect(spec).not.toMatch(/occurrences\(transcript/);
    });
});
