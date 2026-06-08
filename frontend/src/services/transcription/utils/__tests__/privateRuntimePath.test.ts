import { describe, it, expect, afterEach, vi } from 'vitest';

vi.unmock('../privateRuntimePath');
vi.unmock('../webgpuSupport');
vi.unmock('../wasmThreads');

import {
  resolvePrivateRuntimePath,
  describePrivateRuntimePath,
  type PrivateRuntimeDecision,
} from '../privateRuntimePath';
import { computeWasmThreadCount, MAX_WASM_THREADS } from '../wasmThreads';

function setGpu(gpu: { requestAdapter: () => Promise<unknown> } | undefined): void {
  Object.defineProperty(globalThis.navigator, 'gpu', { value: gpu, configurable: true, writable: true });
}

function setIsolated(value: boolean): void {
  Object.defineProperty(globalThis, 'crossOriginIsolated', { value, configurable: true, writable: true });
}

const workingAdapter = () => ({ requestAdapter: vi.fn().mockResolvedValue({ name: 'adapter' }) });

afterEach(() => {
  setGpu(undefined);
  setIsolated(false);
  vi.restoreAllMocks();
});

describe('computeWasmThreadCount', () => {
  it('returns 1 when not cross-origin isolated, regardless of hardware', () => {
    expect(computeWasmThreadCount(false, 16)).toBe(1);
  });
  it('returns capped hardware count when isolated', () => {
    expect(computeWasmThreadCount(true, 16)).toBe(MAX_WASM_THREADS);
    expect(computeWasmThreadCount(true, 2)).toBe(2);
    expect(computeWasmThreadCount(true, undefined)).toBe(MAX_WASM_THREADS);
  });
  it('never returns less than 1', () => {
    expect(computeWasmThreadCount(true, 0)).toBe(1);
  });
});

describe('resolvePrivateRuntimePath — policy order (CPU is the floor)', () => {
  it('WebGPU available + turbo cached → webgpu, gpu, fallbackAvailable', async () => {
    setGpu(workingAdapter());
    const d = await resolvePrivateRuntimePath({ webgpuPromotionAllowed: true, turboModelCached: true });
    expect(d.runtime).toBe('webgpu');
    expect(d.provider).toBe('transformers-js-v4');
    expect(d.acceleration).toBe('gpu');
    expect(d.reason).toBe('webgpu_available_and_model_cached');
    expect(d.webgpuAvailable).toBe(true);
    expect(d.turboCached).toBe(true);
    expect(d.fallbackAvailable).toBe(true);
    expect(d.cloudFallbackAttempted).toBe(false);
  });

  it('WebGPU available but turbo NOT cached → CPU (no surprise download)', async () => {
    setGpu(workingAdapter());
    setIsolated(false);
    const d = await resolvePrivateRuntimePath({ webgpuPromotionAllowed: true, turboModelCached: false });
    expect(d.provider).toBe('transformers-js');
    expect(d.acceleration).toBe('cpu');
    expect(d.webgpuAvailable).toBe(true);
    expect(d.turboCached).toBe(false);
  });

  it('WebGPU missing + cross-origin isolated → CPU multi-thread metadata', async () => {
    setGpu(undefined);
    setIsolated(true);
    const d = await resolvePrivateRuntimePath({ webgpuPromotionAllowed: true, turboModelCached: false });
    expect(d.runtime).toBe('wasm-multithread');
    expect(d.acceleration).toBe('cpu');
    expect(d.reason).toBe('no_webgpu_cross_origin_isolated');
    expect(d.crossOriginIsolated).toBe(true);
    expect(d.wasmThreadCount).toBeGreaterThan(1);
  });

  it('WebGPU missing + NOT isolated → CPU single-thread floor', async () => {
    setGpu(undefined);
    setIsolated(false);
    const d = await resolvePrivateRuntimePath({ webgpuPromotionAllowed: true, turboModelCached: false });
    expect(d.runtime).toBe('wasm-singlethread');
    expect(d.reason).toBe('no_webgpu_or_isolation');
    expect(d.wasmThreadCount).toBe(1);
    expect(d.fallbackAvailable).toBe(false);
  });

  it('promotion not allowed → never probes WebGPU, single-thread floor', async () => {
    setGpu(workingAdapter());
    setIsolated(false);
    const d = await resolvePrivateRuntimePath({ webgpuPromotionAllowed: false, turboModelCached: true });
    expect(d.runtime).toBe('wasm-singlethread');
    expect(d.webgpuAvailable).toBe(false); // not probed
    expect(d.provider).toBe('transformers-js');
  });

  it('degrades to CPU floor when WebGPU detection throws', async () => {
    setGpu({ requestAdapter: vi.fn().mockRejectedValue(new Error('boom')) });
    setIsolated(false);
    const d = await resolvePrivateRuntimePath({ webgpuPromotionAllowed: true, turboModelCached: true });
    expect(d.acceleration).toBe('cpu');
    expect(d.runtime).toBe('wasm-singlethread');
  });

  it('cloudFallbackAttempted is always false (privacy invariant)', async () => {
    setGpu(undefined);
    const d1 = await resolvePrivateRuntimePath({ webgpuPromotionAllowed: true, turboModelCached: true });
    const d2 = await resolvePrivateRuntimePath({ webgpuPromotionAllowed: false, turboModelCached: false });
    expect(d1.cloudFallbackAttempted).toBe(false);
    expect(d2.cloudFallbackAttempted).toBe(false);
  });

  it('decision object is always fully populated (observable)', async () => {
    setGpu(undefined);
    setIsolated(true);
    const d = await resolvePrivateRuntimePath({ webgpuPromotionAllowed: true, turboModelCached: false });
    for (const key of ['runtime', 'provider', 'acceleration', 'reason', 'webgpuAvailable', 'turboCached', 'crossOriginIsolated', 'wasmThreadCount', 'fallbackAvailable', 'cloudFallbackAttempted'] as const) {
      expect(d[key]).toBeDefined();
    }
  });
});

describe('describePrivateRuntimePath — honest UX copy', () => {
  const cases: Array<[PrivateRuntimeDecision['runtime'], RegExp]> = [
    ['webgpu', /GPU acceleration/i],
    ['wasm-multithread', /locally on your CPU/i],
    ['wasm-singlethread', /take a little longer/i],
  ];
  it.each(cases)('describes %s', (runtime, matcher) => {
    const decision = { runtime } as PrivateRuntimeDecision;
    expect(describePrivateRuntimePath(decision)).toMatch(matcher);
  });
});
