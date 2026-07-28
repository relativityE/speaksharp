import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeWasmThreadCount, MAX_WASM_THREADS } from '../../frontend/src/services/transcription/utils/wasmThreads';

// This repo is ESM (`type: module`), so the CommonJS `__dirname` global is not guaranteed to exist.
// Derive it from import.meta.url so module initialization can never throw ReferenceError.
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * #1043: the cross-origin-isolation headers (which unlock multi-threaded WASM for Private-v2) must be
 * scoped to PREVIEW deployments only. Production must keep sending NO COOP/COEP until that rollout is
 * separately approved. This locks the scoping so an accidental edit cannot switch production to isolated.
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

describe('#1043 cross-origin isolation is preview-scoped, never global production', () => {
    it('declares exactly one isolation header entry', () => {
        expect(isolationEntries).toHaveLength(1);
    });

    it('sets COOP=same-origin + COEP=credentialless (the proven-compatible mode)', () => {
        const kv = Object.fromEntries(isolationEntries[0].headers.map((h) => [h.key.toLowerCase(), h.value]));
        expect(kv['cross-origin-opener-policy']).toBe('same-origin');
        expect(kv['cross-origin-embedder-policy']).toBe('credentialless');
    });

    it('is GATED by a host condition — never unconditional', () => {
        const has = isolationEntries[0].has ?? [];
        expect(has.length).toBeGreaterThan(0);
        expect(has.some((c) => c.type === 'host')).toBe(true);
    });

    it('production hosts do NOT match; branch-preview hosts DO', () => {
        const hostRule = (isolationEntries[0].has ?? []).find((c) => c.type === 'host');
        const re = new RegExp(`^${hostRule!.value}$`);
        // Production must stay non-isolated until separately approved.
        expect(re.test('speaksharp-public.vercel.app')).toBe(false);
        expect(re.test('speaksharp.app')).toBe(false);
        expect(re.test('www.speaksharp.app')).toBe(false);
        // Branch previews receive the headers so the isolated proof can run production-equivalently.
        expect(re.test('speaksharp-public-git-perf-1043-team.vercel.app')).toBe(true);
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
