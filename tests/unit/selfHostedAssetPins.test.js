/**
 * #1259 — THE SHIPPED ASSET LIST IS DERIVED FROM THE SHIPPED BYTES.
 *
 * `selfHostedAssetPins.json` is what the cache probe and the network observation are measured against.
 * A hand-maintained list would drift from the directory the moment a file was added, removed or
 * rebuilt, and the telemetry would then measure a model the product does not serve — quietly, because
 * a stale list still produces confident-looking numbers.
 *
 * So the list is re-derived here from `frontend/public/models/whisper-base.en` and checked against the
 * registry's own digest. An edit to either side fails.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import pins from '../../frontend/src/services/transcription/selfHostedAssetPins.json';
import { CANDIDATES } from '../../frontend/src/services/transcription/candidateRegistry';

const ROOT = resolve(process.cwd(), 'frontend/public/models/whisper-base.en');

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
    });
}

const onDisk = walk(ROOT)
    .map((full) => ({
        path: relative(ROOT, full).split(/[\\/]/).join('/'),
        sha256: createHash('sha256').update(readFileSync(full)).digest('hex'),
        bytes: statSync(full).size,
    }))
    // Code-point order, not locale order: the digest is a byte construction and a locale-aware
    // comparator would reorder `onnx/...` against the top-level files and change the hash.
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

describe('#1259 the self-hosted pin list matches what we ship', () => {
    it('CASUALTY: every file, hash and size is re-derived from the served directory', () => {
        expect(pins.files).toEqual(onDisk);
    });

    it('CASUALTY: its digest is the one the registry identifies the model by', () => {
        const digest = createHash('sha256')
            .update(onDisk.map((f) => `${f.path}:${f.sha256}\n`).join(''))
            .digest('hex');
        expect(digest).toBe(CANDIDATES['v2:base.en'].assets.pinDigest);
    });

    it('the component count and total bytes agree with the registry', () => {
        const v2 = CANDIDATES['v2:base.en'].assets;
        expect(pins.files).toHaveLength(v2.componentCount);
        expect(pins.files.reduce((n, f) => n + f.bytes, 0)).toBe(v2.totalBytes);
    });

    it('the served path is an absolute origin path, because that is how the cache keys it', () => {
        expect(pins.servedFrom).toMatch(/^\//);
    });
});
