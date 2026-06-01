import { describe, it, expect, afterEach, vi } from 'vitest';

vi.unmock('../webgpuSupport');

import { detectWebGPUSupport, hasWebGPUApi, isWebGPUSupported } from '../webgpuSupport';

type GpuStub = { requestAdapter: () => Promise<unknown> } | undefined;

function setGpu(gpu: GpuStub): void {
  Object.defineProperty(globalThis.navigator, 'gpu', {
    value: gpu,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  // Remove the stubbed property so tests stay isolated.
  setGpu(undefined);
  vi.restoreAllMocks();
});

describe('webgpuSupport', () => {
  it('reports no-gpu-api when navigator.gpu is absent', async () => {
    setGpu(undefined);
    expect(hasWebGPUApi()).toBe(false);
    expect(await detectWebGPUSupport()).toEqual({ supported: false, reason: 'no-gpu-api' });
    expect(await isWebGPUSupported()).toBe(false);
  });

  it('reports supported when an adapter is returned', async () => {
    setGpu({ requestAdapter: vi.fn().mockResolvedValue({ name: 'mock-adapter' }) });
    expect(hasWebGPUApi()).toBe(true);
    expect(await detectWebGPUSupport()).toEqual({ supported: true });
    expect(await isWebGPUSupported()).toBe(true);
  });

  it('reports no-adapter when the API exists but returns null (headless/blocklisted GPU)', async () => {
    setGpu({ requestAdapter: vi.fn().mockResolvedValue(null) });
    expect(hasWebGPUApi()).toBe(true);
    expect(await detectWebGPUSupport()).toEqual({ supported: false, reason: 'no-adapter' });
  });

  it('never throws when requestAdapter rejects; reports error reason', async () => {
    setGpu({ requestAdapter: vi.fn().mockRejectedValue(new Error('driver crash')) });
    expect(await detectWebGPUSupport()).toEqual({ supported: false, reason: 'error' });
    expect(await isWebGPUSupported()).toBe(false);
  });

  it('treats a malformed gpu object (no requestAdapter) as no API', async () => {
    setGpu({} as GpuStub);
    expect(hasWebGPUApi()).toBe(false);
    expect(await detectWebGPUSupport()).toEqual({ supported: false, reason: 'no-gpu-api' });
  });
});
