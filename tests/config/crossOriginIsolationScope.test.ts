import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeWasmThreadCount, MAX_WASM_THREADS } from '../../frontend/src/services/transcription/utils/wasmThreads';

// This repo is ESM (`type: module`), so the CommonJS `__dirname` global is not guaranteed to exist.
// Derive it from import.meta.url so module initialization can never throw ReferenceError.
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * #1043: the cross-origin-isolation headers unlock multi-threaded WASM for Private-v2. They now apply to
 * ALL hosts, including production — this PR IS the production activation, so merging it makes testers
 * faster rather than landing an inactive preview-only configuration.
 *
 * Compatibility was proven on the PRODUCTION origin while genuinely isolated (CDP control run
 * 30412189758): crossOriginIsolated=true, SharedArrayBuffer available, authenticated check-usage-limit
 * HTTP 200 with full CORS headers, and ZERO COEP/CORP/CORS blocks — under both credentialless and
 * require-corp. credentialless is the shipped mode (the narrower of the two).
 *
 * These tests lock the exact header contract so an accidental edit cannot silently change the isolation
 * mode or drop the headers (which would silently revert every user to single-threaded decode).
 */
const vercelConfig = JSON.parse(
    fs.readFileSync(path.resolve(HERE, '../../vercel.json'), 'utf8'),
) as {
    headers: Array<{
        source: string;
        has?: Array<{ type: string; value: string }>;
        headers: Array<{ key: string; value: string }>;
    }>;
};

const isolationEntries = vercelConfig.headers.filter((entry) =>
    entry.headers.some((h) => h.key.toLowerCase() === 'cross-origin-embedder-policy'),
);

describe('#1043 cross-origin isolation ships to production (this PR is the activation)', () => {
    it('declares exactly one isolation header entry', () => {
        expect(isolationEntries).toHaveLength(1);
    });

    it('sets COOP=same-origin + COEP=credentialless (the proven-compatible mode)', () => {
        const kv = Object.fromEntries(isolationEntries[0].headers.map((h) => [h.key.toLowerCase(), h.value]));
        expect(kv['cross-origin-opener-policy']).toBe('same-origin');
        expect(kv['cross-origin-embedder-policy']).toBe('credentialless');
    });

    it('applies to EVERY host — production included, so merging actually activates it', () => {
        // A host condition here would mean production silently stays single-threaded: the exact
        // preview-only outcome this PR must not ship.
        expect(isolationEntries[0].has).toBeUndefined();
        expect(isolationEntries[0].source).toBe('/(.*)');
    });

    it('ships credentialless, not require-corp (both proven; credentialless is the narrower choice)', () => {
        const kv = Object.fromEntries(isolationEntries[0].headers.map((h) => [h.key.toLowerCase(), h.value]));
        expect(kv['cross-origin-embedder-policy']).not.toBe('require-corp');
    });
});

describe('#1043 single-thread WASM remains the automatic compatibility floor', () => {
    it('returns 1 thread whenever the context is NOT cross-origin isolated', () => {
        expect(computeWasmThreadCount(false, 8)).toBe(1);
        expect(computeWasmThreadCount(false, 16)).toBe(1);
        expect(computeWasmThreadCount(false, undefined)).toBe(1);
    });

    it('returns 2-4 threads only when isolated (observed: 4 on an 8-core isolated browser)', () => {
        expect(computeWasmThreadCount(true, 8)).toBe(4);
        expect(computeWasmThreadCount(true, 2)).toBe(2);
        expect(computeWasmThreadCount(true, 8)).toBeLessThanOrEqual(MAX_WASM_THREADS);
    });
});
