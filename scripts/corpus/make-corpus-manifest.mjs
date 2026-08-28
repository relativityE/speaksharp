#!/usr/bin/env node
/**
 * #1304 Task 4 — freeze a deterministic 300-utterance subset per LibriSpeech test set.
 *
 * WHY A FROZEN SUBSET. Scoring all 5,559 utterances is slow enough to discourage re-running, and an
 * unfrozen random subset makes two runs incomparable — a model could "improve" purely by drawing
 * easier clips. The seed and the resulting ids are committed, so any arm is scored on exactly the
 * same audio and a ranking cannot move by sampling.
 *
 * NO `seedrandom` DEPENDENCY. It is not in either package.json, and adding a package to pick 300
 * numbers is not worth the supply-chain surface. The PRNG below is inline, deterministic and
 * dependency-free, and its output is pinned by a test.
 *
 * Licence: CC BY 4.0. The attribution line is written INTO the manifest so it travels with the data
 * rather than living only in a script comment.
 *
 *   usage: node scripts/corpus/make-corpus-manifest.mjs [bench-corpus-dir]
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyArchive } from './verify-archive.mjs';

const SEED = 'speaksharp-1304-v1';
const SUBSET_SIZE = 300;
const SETS = ['test-clean', 'test-other'];

/**
 * xmur3 + sfc32 — a small, well-known, dependency-free deterministic PRNG.
 * Identical output on every platform and Node version, which is what "frozen" requires.
 */
function makeRng(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
        h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    const next = () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^= h >>> 16) >>> 0;
    };
    let a = next(), b = next(), c = next(), d = next();
    return () => {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0;
        t = (t + d) | 0;
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
    };
}

/** Fisher-Yates with the seeded PRNG. Sorting first makes the input order filesystem-independent. */
export function seededSample(ids, size, seed) {
    const pool = [...ids].sort();
    const rng = makeRng(seed);
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.min(size, pool.length)).sort();
}

/** Every utterance id and its reference transcript, from the set's own `.trans.txt` files. */
function readUtterances(setDir) {
    const out = new Map();
    const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
            const p = join(dir, entry);
            if (statSync(p).isDirectory()) { walk(p); continue; }
            if (!entry.endsWith('.trans.txt')) continue;
            for (const line of readFileSync(p, 'utf8').split('\n')) {
                const sp = line.indexOf(' ');
                if (sp <= 0) continue;
                out.set(line.slice(0, sp), line.slice(sp + 1).trim());
            }
        }
    };
    walk(setDir);
    return out;
}

/**
 * Where a LibriSpeech utterance's audio lives, derived from its id: `<speaker>-<chapter>-<index>` sits
 * under `<set>/<speaker>/<chapter>/`. Returned RELATIVE to the corpus root so the manifest records a
 * path that means the same thing on every machine.
 */
export function flacPathForId(set, id) {
    // All three components are NUMERIC in LibriSpeech. Accepting any three hyphen-separated tokens
    // would happily build `.../not/an/not-an-id.flac` — a path-shaped string for a file that cannot
    // exist, turning a malformed id into a confusing `audio_missing` instead of a clear rejection.
    const match = /^(\d+)-(\d+)-(\d+)$/.exec(id ?? '');
    if (match === null) return null;
    const [, speaker, chapter] = match;
    return `LibriSpeech/${set}/${speaker}/${chapter}/${id}.flac`;
}

/**
 * Bind each selected id to its ACTUAL AUDIO — path, byte count and SHA-256.
 *
 * THE DEFECT THIS CLOSES. `readUtterances` reads `.trans.txt` files and nothing else, so the manifest's
 * idea of "complete" was a count of TRANSCRIPT LINES. A directory whose audio was never extracted, or
 * was extracted and then deleted, produced a manifest that looked complete and named 600 utterances
 * that could not be decoded. Worse, the frozen identity would have been identical either way, so the
 * corruption was invisible to every check.
 *
 * Missing or unreadable audio now FAILS GENERATION. A manifest is a claim about bytes; it must not be
 * producible without them.
 */
export function collectSelection(root, set, ids, references) {
    const utterances = [];
    for (const id of ids) {
        const relative = flacPathForId(set, id);
        if (relative === null) {
            return { ok: false, reason: 'malformed_utterance_id', detail: `${set}/${id}` };
        }
        const absolute = join(root, relative);
        let bytes;
        try {
            const info = statSync(absolute);
            if (!info.isFile()) return { ok: false, reason: 'audio_not_a_file', detail: relative };
            bytes = info.size;
        } catch {
            return { ok: false, reason: 'audio_missing', detail: relative };
        }
        // A zero-byte FLAC is present-but-unusable: it would decode to nothing and score as a total
        // miss, quietly making an arm look worse for a filesystem reason.
        if (bytes === 0) return { ok: false, reason: 'audio_empty', detail: relative };

        let sha256;
        try {
            sha256 = createHash('sha256').update(readFileSync(absolute)).digest('hex');
        } catch {
            return { ok: false, reason: 'audio_unreadable', detail: relative };
        }

        const reference = references.get(id);
        if (typeof reference !== 'string' || reference.trim().length === 0) {
            return { ok: false, reason: 'missing_reference', detail: `${set}/${id}` };
        }
        utterances.push({ id, reference, audio: { path: relative, bytes, sha256 } });
    }

    // Two ids resolving to the same file, or to identical bytes, means the same audio would be scored
    // twice under different names — the arm's totals would be weighted by a duplicate rather than by
    // the corpus. Both are duplicate INPUT IDENTITY, so both are rejected.
    const paths = new Set(), digests = new Set();
    for (const u of utterances) {
        if (paths.has(u.audio.path)) return { ok: false, reason: 'duplicate_audio_path', detail: u.audio.path };
        if (digests.has(u.audio.sha256)) return { ok: false, reason: 'duplicate_audio_bytes', detail: u.id };
        paths.add(u.audio.path);
        digests.add(u.audio.sha256);
    }

    return { ok: true, utterances };
}

/**
 * Build the manifest object. `archives` must come from REAL pinned verification — `main` obtains it by
 * running the verifier and cannot obtain it any other way.
 */
export function buildManifest({ root, archives, sets = SETS, subsetSize = SUBSET_SIZE, seed = SEED }) {
    const subsets = {};
    const counts = {};
    for (const set of sets) {
        const dir = join(root, 'LibriSpeech', set);
        if (!existsSync(dir)) return { ok: false, reason: 'set_missing', detail: dir };
        const references = readUtterances(dir);
        const ids = seededSample([...references.keys()], subsetSize, seed);
        const selection = collectSelection(root, set, ids, references);
        if (!selection.ok) return selection;
        counts[set] = { available: references.size, selected: ids.length };
        subsets[set] = selection.utterances;
    }

    return {
        ok: true,
        manifest: {
            corpusVersion: 'librispeech_test_v1',
            source: 'https://www.openslr.org/12/ (OpenSLR SLR12)',
            licence: 'CC BY 4.0',
            attribution:
                'LibriSpeech ASR corpus, Panayotov et al., ICASSP 2015. https://www.openslr.org/12/ — CC BY 4.0.',
            seed,
            subsetSize,
            // The corpus's real identity, recorded from the verification this run actually performed —
            // not restated from a table, and not read back from a file we wrote ourselves.
            archives,
            counts,
            generatorSha256: createHash('sha256')
                .update(readFileSync(new URL(import.meta.url), 'utf8')).digest('hex'),
            subsets,
        },
    };
}

async function main() {
    const root = resolve(process.cwd(), process.argv[2] ?? 'bench-corpus');

    // THE MANIFEST RE-VERIFIES THE ARCHIVES ITSELF, in pinned mode, before describing anything.
    //
    // An earlier version read a `CHECKSUMS` file that the fetch script had written from its own
    // `sha256sum` of whatever downloaded — so the manifest's claim to identity was a hash of the file
    // it was already describing. That is circular: it would have happily identified a corrupted corpus.
    // Running the real verifier here means the manifest cannot be produced from archives that do not
    // match the publisher's MD5 and our committed pin.
    const archives = {};
    for (const set of SETS) {
        const name = `${set}.tar.gz`;
        const result = await verifyArchive({ path: join(root, name), name, mode: 'pinned' });
        if (!result.ok) {
            console.error(`FATAL: ${name} failed pinned verification (${result.reason}: ${result.detail}).`);
            console.error('       A manifest cannot describe a corpus whose archives are unverified.');
            process.exit(1);
        }
        archives[name] = { bytes: result.bytes, officialMd5: result.md5, sha256: result.sha256 };
    }

    const built = buildManifest({ root, archives });
    if (!built.ok) {
        console.error(`FATAL: ${built.reason} (${built.detail})`);
        console.error('       Refusing to write a manifest that cannot account for its own audio.');
        process.exit(1);
    }

    const out = resolve(process.cwd(), 'tests/fixtures/corpus-manifest.json');
    writeFileSync(out, `${JSON.stringify(built.manifest, null, 2)}\n`, 'utf8');
    console.log(`wrote ${out}`);
    for (const set of SETS) {
        const c = built.manifest.counts[set];
        console.log(`  ${set}: ${c.selected} of ${c.available} (audio bound: path + bytes + sha256)`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
