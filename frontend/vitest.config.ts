/// <reference types="vitest" />
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        fileParallelism: false, // Prevent worker thread conflicts (Critical for CI hang fix)
        isolate: true,
        testTimeout: 10000,
        hookTimeout: 10000,
        setupFiles: ['./src/tests/setup.ts'],
        include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    },
});
