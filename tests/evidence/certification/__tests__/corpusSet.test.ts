/**
 * #1304 Task 3C — 599 of 600 must not look like 600 (blocker 1).
 *
 * THE BYPASS. The expected-id list and the scored list were built from the same loop over the
 * manifest's entries. A short subset made BOTH short — 599 expected, 599 scored — and the completeness
 * check reported a complete arm, because it was comparing a list against itself.
 *
 * The manifest states its own size in two independent places: `subsetSize`, and `counts[set].selected`
 * per set. Those are the authority, and they are checked BEFORE any id list is derived from entries.
 */
import { describe, it, expect } from 'vitest';
import realManifest from '../../../fixtures/corpus-manifest.json';
import { loadFrozenCorpus, type ManifestShape } from '../corpusSet';

const manifest = realManifest as unknown as ManifestShape;

/** A deep copy, so a mutation in one case cannot leak into another. */
const clone = (): ManifestShape => JSON.parse(JSON.stringify(manifest));

describe('the committed manifest loads as a complete frozen corpus', () => {
    it('yields exactly 600 utterances with 600 expected ids', () => {
        const loaded = loadFrozenCorpus(manifest);
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) return;
        expect(loaded.corpus.utterances).toHaveLength(600);
        expect(loaded.corpus.expectedIds).toHaveLength(600);
        expect(loaded.corpus.version).toBe('librispeech_test_v1');
    });

    it('every utterance carries the audio identity the manifest froze', () => {
        const loaded = loadFrozenCorpus(manifest);
        if (!loaded.ok) throw new Error(loaded.reason);
        for (const u of loaded.corpus.utterances) {
            expect(u.audioSha256).toMatch(/^[0-9a-f]{64}$/);
            expect(u.audioBytes).toBeGreaterThan(0);
            expect(u.audioPath).toContain('LibriSpeech/');
        }
    });
});

describe('a corpus that is one clip short is REFUSED, not measured', () => {
    it('599 entries against a declared 300+300 fails', () => {
        // The exact case: drop one utterance and leave the declared counts alone.
        const short = clone();
        short.subsets['test-clean'].pop();
        const loaded = loadFrozenCorpus(short);
        expect(loaded.ok).toBe(false);
        if (loaded.ok) return;
        expect(loaded.reason).toBe('subset_count_mismatch');
        expect(loaded.detail).toContain('299');
    });

    it('lowering the DECLARED count to match the short set still fails', () => {
        // Otherwise the fix for the previous case would be "edit the number", and 599 would once again
        // be a complete corpus — just a smaller one nobody agreed to.
        const short = clone();
        short.subsets['test-clean'].pop();
        short.counts['test-clean'].selected = 299;
        const loaded = loadFrozenCorpus(short);
        expect(loaded.ok).toBe(false);
        if (loaded.ok) return;
        expect(loaded.reason).toBe('subset_count_mismatch');
        // Because `subsetSize` — the size the freeze was performed at — still says 300.
        expect(loaded.detail).toContain('subsetSize');
    });

    it('shrinking subsetSize as well fails on the total', () => {
        const short = clone();
        short.subsets['test-clean'].pop();
        short.counts['test-clean'].selected = 299;
        short.subsetSize = 299;
        const loaded = loadFrozenCorpus(short);
        // test-other still holds 300 against a declared 299, so the manifest contradicts itself.
        expect(loaded.ok).toBe(false);
    });

    it('a duplicated id satisfies the COUNT and is still refused', () => {
        // 600 entries, 599 distinct clips: the count check alone would pass while one clip was scored
        // twice and another never at all.
        const duped = clone();
        duped.subsets['test-clean'][1] = { ...duped.subsets['test-clean'][0] };
        const loaded = loadFrozenCorpus(duped);
        expect(loaded.ok).toBe(false);
        if (loaded.ok) return;
        expect(loaded.reason).toBe('duplicate_utterance_id');
    });

    it('an entry with no audio binding is refused', () => {
        const unbound = clone();
        delete (unbound.subsets['test-other'][5] as { audio?: unknown }).audio;
        const loaded = loadFrozenCorpus(unbound);
        expect(loaded.ok).toBe(false);
        if (loaded.ok) return;
        expect(loaded.reason).toBe('missing_audio_binding');
    });

    it('an EMPTY subset is refused rather than treated as a zero-length set', () => {
        const empty = clone();
        empty.subsets['test-clean'] = [];
        expect(loadFrozenCorpus(empty).ok).toBe(false);
    });
});
