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

function main() {
    const root = resolve(process.cwd(), process.argv[2] ?? 'bench-corpus');
    const checksumsPath = join(root, 'CHECKSUMS');
    if (!existsSync(checksumsPath)) {
        console.error(`FATAL: ${checksumsPath} missing. Run scripts/corpus/fetch-librispeech.sh first —`);
        console.error('       a manifest without the archive checksums cannot identify what it describes.');
        process.exit(1);
    }

    const subsets = {};
    const counts = {};
    for (const set of SETS) {
        const dir = join(root, 'LibriSpeech', set);
        if (!existsSync(dir)) { console.error(`FATAL: ${dir} missing — extract the archives first.`); process.exit(1); }
        const utterances = readUtterances(dir);
        counts[set] = { available: utterances.size };
        const ids = seededSample([...utterances.keys()], SUBSET_SIZE, SEED);
        subsets[set] = ids.map((id) => ({ id, reference: utterances.get(id) }));
        counts[set].selected = ids.length;
    }

    const manifest = {
        corpusVersion: 'librispeech_test_v1',
        source: 'https://www.openslr.org/12/ (OpenSLR SLR12)',
        licence: 'CC BY 4.0',
        attribution:
            'LibriSpeech ASR corpus, Panayotov et al., ICASSP 2015. https://www.openslr.org/12/ — CC BY 4.0.',
        seed: SEED,
        subsetSize: SUBSET_SIZE,
        // The archives' SHA-256s: the corpus's real identity. A size can coincide; a digest cannot.
        archiveChecksums: readFileSync(checksumsPath, 'utf8').trim().split('\n').map((l) => l.trim()),
        archiveBytes: { 'test-clean.tar.gz': 346663984, 'test-other.tar.gz': 328757843 },
        counts,
        generatorSha256: createHash('sha256')
            .update(readFileSync(new URL(import.meta.url), 'utf8')).digest('hex'),
        subsets,
    };

    const out = resolve(process.cwd(), 'tests/fixtures/corpus-manifest.json');
    writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`wrote ${out}`);
    for (const set of SETS) console.log(`  ${set}: ${counts[set].selected} of ${counts[set].available}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
