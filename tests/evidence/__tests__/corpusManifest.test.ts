/**
 * #1304 Task 4 — the frozen subset must actually be frozen.
 *
 * An unfrozen random subset makes two runs incomparable: a model could "improve" purely by drawing
 * easier clips. These pin the properties the freeze depends on, so a change to the sampler is a test
 * failure rather than a silently different corpus.
 *
 * The PRNG is inline and dependency-free. `seedrandom` is in neither package.json, and adding a
 * package to pick 300 numbers is supply-chain surface for no benefit — but an inline PRNG is only
 * trustworthy if its determinism is asserted, which is what this file is for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seededSample } from '../../../scripts/corpus/make-corpus-manifest.mjs';
import { PINNED_SHA256, OFFICIAL_MD5, EXPECTED_BYTES } from '../../../scripts/corpus/verify-archive.mjs';

const SEED = 'speaksharp-1304-v1';
const POOL = Array.from({ length: 2620 }, (_, i) => `utt-${String(i).padStart(4, '0')}`);

describe('the seeded subset is deterministic and order-independent', () => {
    it('the same seed selects the same ids, every time', () => {
        expect(seededSample(POOL, 300, SEED)).toEqual(seededSample(POOL, 300, SEED));
    });

    it('INPUT ORDER cannot change the selection', () => {
        // Directory traversal order is filesystem-dependent. Sorting before sampling is what makes the
        // manifest reproducible on a different machine — without it, the "frozen" subset would drift.
        expect(seededSample([...POOL].reverse(), 300, SEED)).toEqual(seededSample(POOL, 300, SEED));
        expect(seededSample([...POOL].sort(() => 0.5 - Math.random()), 300, SEED))
            .toEqual(seededSample(POOL, 300, SEED));
    });

    it('a DIFFERENT seed selects a different subset — the seed is doing work', () => {
        // Positive control: without this, a broken sampler returning the first 300 would pass every
        // other assertion here.
        expect(seededSample(POOL, 300, 'some-other-seed')).not.toEqual(seededSample(POOL, 300, SEED));
    });

    it('selects exactly the requested count, and never duplicates', () => {
        const picked = seededSample(POOL, 300, SEED);
        expect(picked).toHaveLength(300);
        expect(new Set(picked).size).toBe(300);
    });

    it('is a genuine sample, not a prefix', () => {
        const picked = seededSample(POOL, 300, SEED);
        expect(picked).not.toEqual(POOL.slice(0, 300).sort());
        // It should reach across the whole pool rather than clustering at one end.
        const last = picked[picked.length - 1];
        expect(Number(last.slice(4))).toBeGreaterThan(2000);
    });

    it('a pool smaller than the subset size returns everything, not a crash', () => {
        const small = POOL.slice(0, 12);
        expect(seededSample(small, 300, SEED)).toEqual([...small].sort());
    });

    it('the output is sorted, so a manifest diff is readable', () => {
        const picked = seededSample(POOL, 300, SEED);
        expect(picked).toEqual([...picked].sort());
    });
});

/**
 * THE COMMITTED MANIFEST ITSELF.
 *
 * The freeze is only real if the file in the repo is the real thing. An earlier revision of this PR
 * shipped a manifest generator and no manifest — every sampler property below passed while the corpus
 * was not frozen at all, because there was nothing to freeze it against. These assertions are about
 * the artifact, so "the generator works" can no longer stand in for "the corpus is frozen".
 *
 * The audio is deliberately NOT in git (660 MB of archives, gitignored). Identity travels as the
 * archive digests recorded here, which is why they must agree with the verifier's pins.
 */
describe('the committed manifest is a real frozen corpus', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(
        readFileSync(resolve(here, '..', '..', 'fixtures', 'corpus-manifest.json'), 'utf8'),
    );

    it('both LibriSpeech test sets are present with the full published utterance counts', () => {
        // 2620 and 2939 are LibriSpeech's own totals for test-clean and test-other. A short count
        // means a partial extraction was sampled — the subset would be frozen but unrepresentative.
        expect(manifest.counts['test-clean'].available).toBe(2620);
        expect(manifest.counts['test-other'].available).toBe(2939);
    });

    it('carries 300 real utterances per set — ids AND references, none blank', () => {
        for (const set of ['test-clean', 'test-other']) {
            const utterances = manifest.subsets[set];
            expect(utterances, `${set} subset`).toHaveLength(300);
            expect(new Set(utterances.map((u: { id: string }) => u.id)).size, `${set} duplicates`).toBe(300);
            for (const u of utterances) {
                expect(u.id, `${set} id shape`).toMatch(/^\d+-\d+-\d+$/);
                // A blank reference scores as a zero-word utterance and silently deflates any WER
                // computed over the set.
                expect(u.reference.trim().length, `${set}/${u.id} reference`).toBeGreaterThan(0);
            }
        }
    });

    it('is sorted, so a re-freeze shows up as a readable diff', () => {
        for (const set of ['test-clean', 'test-other']) {
            const ids = manifest.subsets[set].map((u: { id: string }) => u.id);
            expect(ids).toEqual([...ids].sort());
        }
    });

    it('the two subsets are disjoint sets of audio, not the same clips twice', () => {
        const clean = new Set(manifest.subsets['test-clean'].map((u: { id: string }) => u.id));
        const other = manifest.subsets['test-other'].map((u: { id: string }) => u.id);
        expect(other.filter((id: string) => clean.has(id))).toEqual([]);
    });

    it('the archive identity in the manifest AGREES with the verifier pins', () => {
        // Two records of the same fact must not be allowed to drift. If a pin is rotated without
        // re-freezing, the manifest is describing a corpus that no longer exists and this fails.
        for (const name of ['test-clean.tar.gz', 'test-other.tar.gz']) {
            expect(manifest.archives[name].sha256, `${name} sha256`).toBe(PINNED_SHA256[name]);
            expect(manifest.archives[name].officialMd5, `${name} md5`).toBe(OFFICIAL_MD5[name]);
            expect(manifest.archives[name].bytes, `${name} bytes`).toBe(EXPECTED_BYTES[name]);
        }
    });

    it('the seed and subset size that produced it are recorded', () => {
        expect(manifest.seed).toBe(SEED);
        expect(manifest.subsetSize).toBe(300);
        expect(manifest.corpusVersion).toBe('librispeech_test_v1');
    });

    it('the CC BY 4.0 attribution travels WITH the data', () => {
        // The licence requires attribution wherever the corpus goes. In a comment in a script it does
        // not travel; in the manifest it does.
        expect(manifest.licence).toBe('CC BY 4.0');
        expect(manifest.attribution).toMatch(/Panayotov/);
        expect(manifest.attribution).toMatch(/openslr\.org/);
    });
});

/**
 * The >30s fixture. Ordinary LibriSpeech utterances are seconds long and all take the zero-stride
 * branch, so without this the long-form half of the shipping decode path is unmeasured while looking
 * covered.
 */
describe('the long-form fixture is committed and long-form', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const dir = resolve(here, '..', '..', 'fixtures', 'corpus-longform');
    const provenance = readFileSync(resolve(dir, 'PROVENANCE'), 'utf8');

    it('crosses the 30s Whisper window it exists to exercise', () => {
        const seconds = Number(/duration seconds: ([\d.]+)/.exec(provenance)?.[1]);
        expect(seconds).toBeGreaterThan(30);
    });

    it('records which utterances it was cut from, in order', () => {
        expect(provenance).toMatch(/utterances \(in order\): (\d+-\d+-\d+ ){5}\d+-\d+-\d+/);
    });

    it('states that its source archive passed PINNED verification before the cut', () => {
        // A fixture built from an unverified extraction would carry its own clean-looking checksum
        // and nothing would ever contradict it.
        expect(provenance).toMatch(/archive verified: test-clean\.tar\.gz passed pinned verification/);
    });

    it('freezes audio and reference TOGETHER — a reference that drifts from its audio is unusable', () => {
        const checksums = readFileSync(resolve(dir, 'CHECKSUMS'), 'utf8');
        expect(checksums).toMatch(/^[0-9a-f]{64}\s+long-01\.wav$/m);
        expect(checksums).toMatch(/^[0-9a-f]{64}\s+long-01\.reference\.txt$/m);
    });

    it('the reference has one line per source utterance', () => {
        const lines = readFileSync(resolve(dir, 'long-01.reference.txt'), 'utf8')
            .split('\n').filter((l) => l.trim().length > 0);
        expect(lines).toHaveLength(6);
    });

    it('carries the CC BY 4.0 attribution too', () => {
        expect(provenance).toMatch(/CC BY 4\.0/);
    });
});
