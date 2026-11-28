/**
 * The shipped meaning model is exactly the pinned bytes. Re-derived from disk: an added, removed or edited file
 * under frontend/public/models/nli-deberta-v3-xsmall fails here instead of silently changing what users download.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import pins from '../meaningAssetPins.json' with { type: 'json' };
import {
    MEANING_MODEL_APPROX_MB,
    MEANING_MODEL_FILES,
    MEANING_MODEL_PIN_DIGEST,
    MEANING_MODEL_TOTAL_BYTES,
    meaningModelResponsePins,
    meaningModelScope,
} from '../meaningAssetPins';

const ROOT = resolve(process.cwd(), pins.pinSource);
const isDocumentation = (path: string) => /^LICENSE[^/]*$/.test(path) || path === 'SOURCE.md';

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [relative(ROOT, full).split('\\').join('/')];
    });
}

const onDisk = walk(ROOT).filter((p) => !isDocumentation(p)).sort().map((path) => {
    const bytes = readFileSync(join(ROOT, path));
    return { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength };
});

describe('meaning model pins', () => {
    it('pins every shipped model file with its exact sha256 and byte length (nothing more, nothing less)', () => {
        expect(onDisk.length).toBeGreaterThan(0);
        expect([...MEANING_MODEL_FILES].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))).toEqual(onDisk);
    });

    it('ships the license texts and the provenance note next to the model', () => {
        const docs = walk(ROOT).filter(isDocumentation).sort();
        expect(docs).toEqual(['LICENSE-APACHE-2.0.txt', 'LICENSE-MIT-microsoft-deberta-v3-xsmall.txt', 'SOURCE.md']);
        const source = readFileSync(join(ROOT, 'SOURCE.md'), 'utf8');
        expect(source).toContain(pins.revision);
        for (const f of onDisk) {
            expect(source).toContain(f.sha256);
            expect(source).toContain(`| ${f.bytes} |`);
        }
        expect(readFileSync(join(ROOT, 'LICENSE-MIT-microsoft-deberta-v3-xsmall.txt'), 'utf8')).toContain('Copyright (c) Microsoft Corporation.');
        expect(readFileSync(join(ROOT, 'LICENSE-APACHE-2.0.txt'), 'utf8')).toContain('Version 2.0, January 2004');
    });

    it('the pin digest is recomputed from the file list', () => {
        const lines = onDisk.map((f) => `${f.path}:${f.sha256}\n`).join('');
        expect(createHash('sha256').update(lines).digest('hex')).toBe(MEANING_MODEL_PIN_DIGEST);
    });

    it('keeps the ONNX model under 100 MB and only ships the quantized export', () => {
        const onnx = onDisk.filter((f) => f.path.endsWith('.onnx'));
        expect(onnx.map((f) => f.path)).toEqual(['onnx/model_quantized.onnx']);
        expect(onnx[0].bytes).toBeLessThan(100_000_000);
    });

    it('derives the quoted size and the request URLs from the pins', () => {
        expect(MEANING_MODEL_TOTAL_BYTES).toBe(onDisk.reduce((s, f) => s + f.bytes, 0));
        expect(MEANING_MODEL_APPROX_MB).toBe(Math.round(MEANING_MODEL_TOTAL_BYTES / 1_000_000));
        const scope = meaningModelScope('https://example.test');
        expect(scope).toBe('https://example.test/models/nli-deberta-v3-xsmall/');
        const urls = meaningModelResponsePins('https://example.test');
        expect(urls).toHaveLength(onDisk.length);
        for (const pin of urls) expect(pin.url.startsWith(scope)).toBe(true);
        expect(urls.map((p) => p.url)).toContain('https://example.test/models/nli-deberta-v3-xsmall/onnx/model_quantized.onnx');
    });
});
