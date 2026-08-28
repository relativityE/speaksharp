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
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    seededSample,
    buildManifest,
    collectSelection,
    flacPathForId,
} from '../../../scripts/corpus/make-corpus-manifest.mjs';
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

    it('RECOMPUTES both committed files and matches the frozen checksums exactly', () => {
        // REPLACED A REGEX. The previous assertion only checked that CHECKSUMS contained two
        // hash-SHAPED lines — it would have passed with both hashes wrong, or with the audio replaced
        // wholesale. A freeze that is never recomputed is a freeze nobody is holding.
        const checksums = readFileSync(resolve(dir, 'CHECKSUMS'), 'utf8');
        const frozen = new Map(
            checksums.trim().split('\n').map((line) => {
                const [digest, name] = line.trim().split(/\s+/);
                return [name, digest] as const;
            }),
        );
        expect([...frozen.keys()].sort()).toEqual(['long-01.reference.txt', 'long-01.wav']);
        for (const [name, digest] of frozen) {
            const actual = createHash('sha256').update(readFileSync(resolve(dir, name))).digest('hex');
            expect(actual, `${name} does not match its frozen checksum`).toBe(digest);
        }
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

/**
 * IDENTITY BINDING — the three places the freeze still trusted a declaration.
 *
 * Every value below was RECORDED in the manifest and then never checked against the thing it claimed
 * to describe. A recorded hash nobody recomputes is documentation, and documentation drifts silently:
 * the whole point of a freeze is that drift is loud.
 */
describe('the manifest is BOUND to the artifacts it names', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, '..', '..', '..');
    const manifest = JSON.parse(
        readFileSync(resolve(repoRoot, 'tests', 'fixtures', 'corpus-manifest.json'), 'utf8'),
    );

    it('the recorded generator hash is the hash of the CURRENT generator', () => {
        // Binds `generatorSha256` to reality. Edit the generator without re-freezing and this fails —
        // which is the only thing that makes the field worth recording. A sampler change that silently
        // altered the selection is exactly the case it exists to catch.
        const source = readFileSync(
            resolve(repoRoot, 'scripts', 'corpus', 'make-corpus-manifest.mjs'), 'utf8',
        );
        expect(createHash('sha256').update(source).digest('hex')).toBe(manifest.generatorSha256);
    });

    it('every selected utterance records the path, byte count and SHA-256 of its audio', () => {
        // Without this, "complete" meant "600 transcript lines were read". A corpus whose audio was
        // never extracted produced an identical, entirely convincing manifest.
        for (const set of ['test-clean', 'test-other']) {
            for (const u of manifest.subsets[set]) {
                expect(u.audio, `${set}/${u.id} has no audio binding`).toBeTruthy();
                expect(u.audio.path).toBe(flacPathForId(set, u.id));
                expect(u.audio.bytes, `${set}/${u.id} byte count`).toBeGreaterThan(0);
                expect(u.audio.sha256, `${set}/${u.id} digest`).toMatch(/^[0-9a-f]{64}$/);
            }
        }
    });

    it('no two selections point at the same file OR the same bytes', () => {
        // Either would score one clip twice under different names, weighting the pooled totals by a
        // duplicate rather than by the corpus.
        const all = ['test-clean', 'test-other'].flatMap((set) => manifest.subsets[set]);
        expect(all).toHaveLength(600);
        expect(new Set(all.map((u: { audio: { path: string } }) => u.audio.path)).size).toBe(600);
        expect(new Set(all.map((u: { audio: { sha256: string } }) => u.audio.sha256)).size).toBe(600);
    });

    it('audio paths resolve under the set they were selected from', () => {
        for (const set of ['test-clean', 'test-other']) {
            for (const u of manifest.subsets[set]) {
                expect(u.audio.path.startsWith(`LibriSpeech/${set}/`), `${u.audio.path}`).toBe(true);
            }
        }
    });
});

/**
 * BEHAVIOURAL MINI-CORPUS. The real generator, run against a tiny synthetic tree.
 *
 * Structural assertions on the committed manifest cannot show what happens when audio is MISSING or
 * CHANGED — the committed manifest is, by construction, the case where everything is fine. These
 * drive the actual code down the failure paths.
 */
describe('generation fails, or changes identity, when the audio does', () => {
    const SET = 'mini';
    const IDS = ['700-100-0000', '700-100-0001', '700-100-0002'];
    const ARCHIVES = { 'mini.tar.gz': { bytes: 1, officialMd5: 'x', sha256: 'y' } };

    /** A synthetic LibriSpeech-shaped tree. `audio` maps id -> file contents (or null to omit). */
    const makeCorpus = (audio: Record<string, string | null>) => {
        const root = mkdtempSync(join(tmpdir(), 'mini-corpus-'));
        const chapter = join(root, 'LibriSpeech', SET, '700', '100');
        mkdirSync(chapter, { recursive: true });
        writeFileSync(
            join(chapter, '700-100.trans.txt'),
            IDS.map((id, i) => `${id} REFERENCE WORDS NUMBER ${i}`).join('\n'),
        );
        for (const [id, contents] of Object.entries(audio)) {
            if (contents === null) continue;
            writeFileSync(join(chapter, `${id}.flac`), contents);
        }
        return root;
    };
    const complete = () => Object.fromEntries(IDS.map((id, i) => [id, `audio bytes for ${i}`]));
    const build = (root: string) =>
        buildManifest({ root, archives: ARCHIVES, sets: [SET], subsetSize: 3, seed: 'mini' });

    /**
     * Narrow to the branch the test is about, and FAIL LOUDLY on the other one. Without this a
     * `result.ok === false` case that unexpectedly succeeded would read as `undefined !== undefined`
     * somewhere downstream instead of naming what went wrong.
     */
    type Failure = { ok: false; reason: string; detail: string };
    const failure = <T extends { ok: boolean }>(result: T | Failure): Failure => {
        if (result.ok) throw new Error('expected a failure, but generation succeeded');
        return result as Failure;
    };
    const succeeded = (result: ReturnType<typeof build>) => {
        expect(result.ok, 'expected a manifest').toBe(true);
        if (!result.ok) throw new Error(result.reason);
        return result.manifest;
    };

    const roots: string[] = [];
    const corpus = (audio: Record<string, string | null>) => {
        const root = makeCorpus(audio);
        roots.push(root);
        return root;
    };
    afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

    it('a complete mini-corpus builds, and binds each id to its real bytes', () => {
        // The positive control. Without it, every failure case below could be passing for the wrong
        // reason — a generator that refuses everything would look flawless.
        const utterances = succeeded(build(corpus(complete()))).subsets[SET];
        expect(utterances.map((u: { id: string }) => u.id)).toEqual(IDS);
        for (const u of utterances) {
            expect(u.audio.sha256).toBe(
                createHash('sha256').update(`audio bytes for ${IDS.indexOf(u.id)}`).digest('hex'),
            );
        }
    });

    it('MISSING audio prevents generation — a transcript index is not a corpus', () => {
        const result = failure(build(corpus({ ...complete(), [IDS[1]]: null })));
        expect(result.reason).toBe('audio_missing');
        expect(result.detail).toContain(IDS[1]);
    });

    it('a present-but-EMPTY file prevents generation', () => {
        // It would decode to nothing and score as a total miss, making an arm look worse for a
        // filesystem reason.
        expect(failure(build(corpus({ ...complete(), [IDS[2]]: '' }))).reason).toBe('audio_empty');
    });

    it('CHANGED audio changes the frozen identity — and nothing else', () => {
        const before = succeeded(build(corpus(complete())));
        const after = succeeded(build(corpus({ ...complete(), [IDS[0]]: 'DIFFERENT audio bytes' })));

        const digest = (m: typeof before) =>
            Object.fromEntries(m.subsets[SET].map((u) => [u.id, u.audio.sha256]));
        const [b, a] = [digest(before), digest(after)];

        expect(a[IDS[0]], 'the changed clip must change identity').not.toBe(b[IDS[0]]);
        // The other two must be untouched: an identity that moves for unrelated clips would make every
        // re-freeze unreadable and hide which file actually changed.
        expect(a[IDS[1]]).toBe(b[IDS[1]]);
        expect(a[IDS[2]]).toBe(b[IDS[2]]);
        // References are unaffected by an audio change, so a diff points at the audio alone.
        expect(after.subsets[SET].map((u) => u.reference))
            .toEqual(before.subsets[SET].map((u) => u.reference));
    });

    it('two ids holding IDENTICAL bytes is rejected as duplicate input identity', () => {
        const same = complete();
        same[IDS[1]] = same[IDS[0]];
        expect(failure(build(corpus(same))).reason).toBe('duplicate_audio_bytes');
    });

    it('a malformed id has no derivable audio path and is refused', () => {
        // LibriSpeech ids are three NUMERIC components. Anything else is rejected outright rather than
        // turned into a path-shaped string for a file that cannot exist — which would surface later as
        // a confusing `audio_missing` instead of naming the real problem.
        for (const bad of ['nope', 'not-an-id', '700-100', '700-100-0000-extra', '', 'a-1-2']) {
            expect(flacPathForId(SET, bad), `${bad} must have no derivable path`).toBeNull();
        }
        expect(flacPathForId(SET, '700-100-0000')).toBe('LibriSpeech/mini/700/100/700-100-0000.flac');

        expect(failure(collectSelection('/nonexistent', SET, ['nope'], new Map([['nope', 'WORDS']]))).reason)
            .toBe('malformed_utterance_id');
    });

    it('an id with audio but NO reference is refused rather than scored against nothing', () => {
        const root = corpus(complete());
        expect(failure(collectSelection(root, SET, [IDS[0]], new Map([[IDS[0], '   ']]))).reason)
            .toBe('missing_reference');
    });

    it('a missing set directory is named, not crashed on', () => {
        expect(failure(build(mkdtempSync(join(tmpdir(), 'empty-corpus-')))).reason).toBe('set_missing');
    });
});

/**
 * The CLI still cannot be talked out of verifying the archives. `buildManifest` takes `archives` as an
 * argument so the mini-corpus tests above can exist at all — this proves that seam is not reachable
 * from the command anyone actually runs.
 */
describe('the generator CLI refuses an unverified corpus', () => {
    it('exits non-zero and writes no manifest when the archive fails pinned verification', () => {
        const root = mkdtempSync(join(tmpdir(), 'unverified-corpus-'));
        // Correct NAME, wrong bytes — the archive is in the pinned tables, so this reaches the byte
        // check rather than being dismissed as unknown.
        writeFileSync(join(root, 'test-clean.tar.gz'), 'not the real archive');
        const here = dirname(fileURLToPath(import.meta.url));
        const generator = resolve(here, '..', '..', '..', 'scripts', 'corpus', 'make-corpus-manifest.mjs');

        let failed = false;
        let output = '';
        try {
            execFileSync(process.execPath, [generator, root], { encoding: 'utf8', stdio: 'pipe' });
        } catch (e) {
            failed = true;
            output = String((e as { stderr?: string }).stderr ?? '');
        }
        rmSync(root, { recursive: true, force: true });

        expect(failed, 'the CLI accepted an unverified corpus').toBe(true);
        expect(output).toMatch(/failed pinned verification/);
        expect(output).toMatch(/byte_count_mismatch/);
    });
});
