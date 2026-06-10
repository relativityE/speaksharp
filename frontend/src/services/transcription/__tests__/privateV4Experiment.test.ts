// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getV4ExperimentOverrides } from '../privateV4Experiment';

// Injectable window (matches the codebase pattern, e.g. collectSttIdentityFromWindow) so
// the reader is testable without happy-dom history/location plumbing.
function mockWin(search: string, storage: Record<string, string> = {}): Window {
    return {
        location: { search } as Location,
        localStorage: { getItem: (k: string) => storage[k] ?? null } as unknown as Storage,
    } as unknown as Window;
}

describe('getV4ExperimentOverrides — dev/test-gated v4 decode A/B knobs', () => {
    // gate = import.meta.env.DEV || ENV.isTest; __TEST__ keeps the gate open in unit tests.
    beforeEach(() => { (globalThis as { __TEST__?: boolean }).__TEST__ = true; });
    afterEach(() => { (globalThis as { __TEST__?: boolean }).__TEST__ = true; });

    it('defaults to no overrides', () => {
        expect(getV4ExperimentOverrides(mockWin(''))).toEqual({ noWorker: false });
    });

    it('reads device + decoderDtype + noWorker from query params', () => {
        expect(getV4ExperimentOverrides(mockWin('?v4Device=wasm&v4DecoderDtype=fp32&v4NoWorker=1')))
            .toEqual({ device: 'wasm', decoderDtype: 'fp32', noWorker: true });
    });

    it('falls back to localStorage when no query param', () => {
        expect(getV4ExperimentOverrides(mockWin('', { 'speaksharp.v4.device': 'webgpu', 'speaksharp.v4.decoderDtype': 'int8' })))
            .toEqual({ device: 'webgpu', decoderDtype: 'int8', noWorker: false });
    });

    it('rejects invalid device/dtype values', () => {
        expect(getV4ExperimentOverrides(mockWin('?v4Device=banana&v4DecoderDtype=fp64'))).toEqual({ noWorker: false });
    });

    it('undefined window -> no overrides', () => {
        expect(getV4ExperimentOverrides(undefined)).toEqual({ noWorker: false });
    });
});
