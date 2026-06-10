import { describe, it, expect } from 'vitest';
import {
    PRIVATE_V4_UX_COPY,
    privateV4DownloadMB,
    privateV4DownloadConsentMessage,
} from '../privateV4Ux';

describe('privateV4DownloadMB — variant-aware size', () => {
    it('returns the real download size per variant (default = base-q4 floor)', () => {
        expect(privateV4DownloadMB('base_q4')).toBe(142);
        expect(privateV4DownloadMB('distil_q4')).toBe(251);
        expect(privateV4DownloadMB()).toBe(142); // default
    });
});

describe('privateV4DownloadConsentMessage — honest size, customer-safe', () => {
    it('shows the resolved variant size + the privacy promise', () => {
        const base = privateV4DownloadConsentMessage('base_q4');
        expect(base).toContain('142 MB');
        expect(base).toContain('never uploaded');

        const distil = privateV4DownloadConsentMessage('distil_q4');
        expect(distil).toContain('251 MB');
    });
});

describe('v4 UX copy — never exposes engine internals', () => {
    const forbidden = ['webgpu', 'wasm', 'onnx', 'dtype', 'quantized', 'q4', 'fp32', 'tensor'];
    const allCopy = [
        ...Object.values(PRIVATE_V4_UX_COPY),
        privateV4DownloadConsentMessage('base_q4'),
        privateV4DownloadConsentMessage('distil_q4'),
    ];
    it('contains no internal terms', () => {
        for (const copy of allCopy) {
            const lower = copy.toLowerCase();
            for (const term of forbidden) {
                expect(lower, `"${copy}" must not contain "${term}"`).not.toContain(term);
            }
        }
    });
    it('fallback copy reads as safe, not broken', () => {
        expect(PRIVATE_V4_UX_COPY.fallbackToStandard.toLowerCase()).not.toContain('error');
        expect(PRIVATE_V4_UX_COPY.fallbackToStandard.toLowerCase()).not.toContain('failed');
        expect(PRIVATE_V4_UX_COPY.fallbackToStandard).toContain('stays on your device');
    });
});
