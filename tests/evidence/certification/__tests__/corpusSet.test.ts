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
import { describe, it, expect, afterAll } from 'vitest';
import realManifest from '../../../fixtures/corpus-manifest.json';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadFrozenCorpus, verifyFrozenAudio, frozenCorpusDigest, type ManifestShape } from '../corpusSet';

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

/**
 * THE OTHER HALF OF COMPLETENESS.
 *
 * A complete set of ids says nothing about whether the FILES on disk are the ones that were frozen. A
 * re-extraction, a substitution, or a partial overwrite leaves every id present while the audio is
 * different — 600 clips scored, none of them the corpus the result claims to describe.
 */
describe('each clip must be the FROZEN clip, not merely a clip with the right name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frozen-audio-'));
    const bytes = Buffer.from('the frozen audio for this utterance');
    const path = join(dir, 'clip.flac');
    writeFileSync(path, bytes);
    const frozen = {
        audioSha256: createHash('sha256').update(bytes).digest('hex'),
        audioBytes: bytes.length,
    };
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('the untouched file verifies', () => {
        expect(verifyFrozenAudio(path, frozen)).toEqual({ ok: true });
    });

    it('a SUBSTITUTED file of the same length is caught by the digest', () => {
        // The case a byte count cannot see — the same failure mode as the archive chain, one level down.
        const swapped = join(dir, 'swapped.flac');
        const other = Buffer.from('THE frozen audio for this utterance');
        expect(other.length).toBe(bytes.length);
        writeFileSync(swapped, other);
        const result = verifyFrozenAudio(swapped, frozen);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('audio_digest_mismatch');
    });

    it('a file of the wrong length fails on the byte count first', () => {
        const truncated = join(dir, 'short.flac');
        writeFileSync(truncated, bytes.subarray(0, 10));
        const result = verifyFrozenAudio(truncated, frozen);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('audio_bytes_mismatch');
    });

    it('a missing file is named, not thrown', () => {
        const result = verifyFrozenAudio(join(dir, 'nope.flac'), frozen);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('audio_missing');
    });

    it('the committed manifest carries a distinct digest for every clip', () => {
        // 600 identical digests would satisfy every per-clip check while meaning one clip was frozen
        // 600 times.
        const loaded = loadFrozenCorpus(manifest);
        if (!loaded.ok) throw new Error(loaded.reason);
        const digests = loaded.corpus.utterances.map((u) => u.audioSha256);
        expect(new Set(digests).size).toBe(600);
    });
});

/**
 * #1304 — THE COHERENT SHRINK. A version string is not identity.
 *
 * `loadFrozenCorpus` checks the manifest against itself, and it is thorough: subset lengths against
 * declared counts, declared counts against `subsetSize`, the total against sets × size, and duplicate
 * ids. But an edit that reduces BOTH subsets, BOTH declared counts and `subsetSize` together satisfies
 * every one of those checks. The version stays `librispeech_test_v1`, the arm is measured on 598
 * clips, and its provenance says it ran the frozen corpus.
 *
 * Only a digest of the actual selection refuses that.
 */
describe('a coherently shrunken manifest is a DIFFERENT corpus', () => {
    const shrinkBothSets = (by: number): ManifestShape => {
        const m = clone();
        for (const set of Object.keys(m.subsets)) {
            m.subsets[set] = m.subsets[set].slice(0, m.subsets[set].length - by);
            m.counts[set].selected -= by;
        }
        m.subsetSize -= by;
        return m;
    };

    it('the shrunken manifest passes every INTERNAL consistency check', () => {
        // The precondition. If it failed here, the digest would be untested.
        const loaded = loadFrozenCorpus(shrinkBothSets(1));
        expect(loaded.ok, 'internal checks were expected to pass on a coherent shrink').toBe(true);
    });

    it('...and keeps the same version string', () => {
        expect(shrinkBothSets(1).corpusVersion).toBe('librispeech_test_v1');
    });

    it('but its DIGEST differs from the real corpus', () => {
        const real = loadFrozenCorpus(manifest);
        const shrunk = loadFrozenCorpus(shrinkBothSets(1));
        if (!real.ok || !shrunk.ok) throw new Error('both were expected to load');
        expect(shrunk.corpus.digest).not.toBe(real.corpus.digest);
        expect(shrunk.corpus.utterances).toHaveLength(598);
    });

    it('the digest is stable across manifest ORDER — it identifies contents, not layout', () => {
        const reordered = clone();
        for (const set of Object.keys(reordered.subsets)) reordered.subsets[set].reverse();
        const a = loadFrozenCorpus(manifest);
        const b = loadFrozenCorpus(reordered);
        if (!a.ok || !b.ok) throw new Error('both were expected to load');
        expect(b.corpus.digest).toBe(a.corpus.digest);
    });

    it('a SUBSTITUTED clip moves the digest even with the id list untouched', () => {
        // Built from the audio digests, so swapping the bytes behind an id cannot hide.
        const swapped = clone();
        swapped.subsets['test-clean'][0].audio!.sha256 = 'f'.repeat(64);
        const real = loadFrozenCorpus(manifest);
        const other = loadFrozenCorpus(swapped);
        if (!real.ok || !other.ok) throw new Error('both were expected to load');
        expect(other.corpus.digest).not.toBe(real.corpus.digest);
    });

    it('the digest function alone agrees with what loadFrozenCorpus records', () => {
        // Binds the exported helper to the value that actually travels on a row, so a future caller
        // computing it directly cannot drift from the loader.
        const loaded = loadFrozenCorpus(manifest);
        if (!loaded.ok) throw new Error(loaded.reason);
        expect(frozenCorpusDigest(loaded.corpus.utterances)).toBe(loaded.corpus.digest);
    });

    it('the real corpus digest is stable run to run', () => {
        const a = loadFrozenCorpus(manifest);
        const b = loadFrozenCorpus(clone());
        if (!a.ok || !b.ok) throw new Error('both were expected to load');
        expect(b.corpus.digest).toBe(a.corpus.digest);
        expect(a.corpus.digest).toMatch(/^[0-9a-f]{64}$/);
    });
});
