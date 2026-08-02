import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const viteConfig = readFileSync(resolve('frontend/vite.config.mjs'), 'utf8');

describe('Transformers.js v2 ORT build contract', () => {
    it('emits stable ORT 1.14 filenames for both the app and worker builds', () => {
        for (const filename of [
            'ort-wasm.wasm',
            'ort-wasm-threaded.wasm',
            'ort-wasm-simd.wasm',
            'ort-wasm-simd-threaded.wasm',
        ]) {
            expect(viteConfig).toContain(`'${filename}'`);
        }
        expect(viteConfig).toContain('return `assets/transformers-v2-ort/${sourceBaseName}`');

        const workerBlock = viteConfig.slice(
            viteConfig.indexOf('worker: {'),
            viteConfig.indexOf('server: {'),
        );
        expect(workerBlock).toContain('assetFileNames: assetFileName');
    });
});
