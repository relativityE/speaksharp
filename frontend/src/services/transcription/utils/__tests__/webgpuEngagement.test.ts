import { describe, it, expect, afterEach } from 'vitest';
import {
  classifyModelExecution,
  probeWebGpuEngagement,
  WASM_RTF_FLOOR,
} from '../webgpuEngagement';

// ---------------------------------------------------------------------------
// Leg 2 — classifyModelExecution (pure): the silent-WASM-fallback detector.
// ---------------------------------------------------------------------------
describe('classifyModelExecution — catches "webgpu requested but ran wasm"', () => {
  it('webgpu reported + RTF below the WASM floor → webgpu-effective (real GPU)', () => {
    expect(classifyModelExecution({ workerReportedDevice: 'webgpu', decodeRtf: 0.048 }))
      .toBe('webgpu-effective');
  });

  it('webgpu reported + WASM-slow RTF → requested-webgpu-ran-wasm (the trap)', () => {
    expect(classifyModelExecution({ workerReportedDevice: 'webgpu', decodeRtf: 0.21 }))
      .toBe('requested-webgpu-ran-wasm');
  });

  it('webgpu reported but NO timing → unknown (cannot confirm effective from the label alone)', () => {
    expect(classifyModelExecution({ workerReportedDevice: 'webgpu', decodeRtf: null }))
      .toBe('unknown');
    expect(classifyModelExecution({ workerReportedDevice: 'webgpu', decodeRtf: undefined }))
      .toBe('unknown');
  });

  it('wasm-fallback / wasm-default → wasm-effective regardless of RTF', () => {
    expect(classifyModelExecution({ workerReportedDevice: 'wasm-fallback', decodeRtf: 0.01 }))
      .toBe('wasm-effective');
    expect(classifyModelExecution({ workerReportedDevice: 'wasm-default', decodeRtf: 0.3 }))
      .toBe('wasm-effective');
  });

  it('unknown device label falls back to timing alone', () => {
    expect(classifyModelExecution({ workerReportedDevice: null, decodeRtf: 0.05 })).toBe('webgpu-effective');
    expect(classifyModelExecution({ workerReportedDevice: null, decodeRtf: 0.4 })).toBe('wasm-effective');
    expect(classifyModelExecution({ workerReportedDevice: undefined, decodeRtf: null })).toBe('unknown');
  });

  it('honors a custom wasmRtfFloor (weak-GPU tuning)', () => {
    // With a stricter floor, a mid RTF that would pass the default now reads as the trap.
    expect(classifyModelExecution({ workerReportedDevice: 'webgpu', decodeRtf: 0.1, wasmRtfFloor: 0.08 }))
      .toBe('requested-webgpu-ran-wasm');
    expect(WASM_RTF_FLOOR).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Leg 1 — probeWebGpuEngagement: capability proof via a fake WebGPU stack.
// ---------------------------------------------------------------------------
type FakeOpts = {
  adapter?: 'null' | 'present';
  deviceThrows?: boolean;
  sentinelValue?: number;
  info?: Record<string, string>;
  features?: string[];
};

function installFakeGpu(opts: FakeOpts): void {
  const makeDevice = () => {
    const mapped = new ArrayBuffer(4);
    new Uint32Array(mapped)[0] = opts.sentinelValue ?? 42;
    const buffer = {
      mapAsync: async () => {},
      getMappedRange: () => mapped,
      unmap: () => {},
      destroy: () => {},
    };
    const pass = { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} };
    const encoder = {
      beginComputePass: () => pass,
      copyBufferToBuffer() {},
      finish: () => ({}),
    };
    return {
      createShaderModule: () => ({}),
      createBuffer: () => buffer,
      createBindGroupLayout: () => ({}),
      createPipelineLayout: () => ({}),
      createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
      createBindGroup: () => ({}),
      createCommandEncoder: () => encoder,
      queue: { submit() {} },
      destroy: () => {},
    };
  };
  const adapter = opts.adapter === 'null' ? null : {
    info: opts.info,
    features: opts.features,
    requestDevice: async () => {
      if (opts.deviceThrows) throw new Error('device lost');
      return makeDevice();
    },
  };
  (navigator as unknown as { gpu?: unknown }).gpu = {
    requestAdapter: async () => adapter,
  };
}

describe('probeWebGpuEngagement — real compute round-trip proof', () => {
  afterEach(() => {
    delete (navigator as unknown as { gpu?: unknown }).gpu;
  });

  it('no navigator.gpu (jsdom default) → not engaged, stage no-api, never throws', async () => {
    const r = await probeWebGpuEngagement();
    expect(r.engaged).toBe(false);
    expect(r.stage).toBe('no-api');
  });

  it('sentinel round-trips → engaged, with adapter info + features surfaced', async () => {
    installFakeGpu({ adapter: 'present', sentinelValue: 42, info: { vendor: 'apple', architecture: 'metal-3' }, features: ['f16', 'timestamp-query'] });
    const r = await probeWebGpuEngagement();
    expect(r.engaged).toBe(true);
    expect(r.stage).toBe('engaged');
    expect(r.adapterInfo).toEqual({ vendor: 'apple', architecture: 'metal-3' });
    expect(r.features).toEqual(['f16', 'timestamp-query']);
  });

  it('requestAdapter() returns null → stage no-adapter', async () => {
    installFakeGpu({ adapter: 'null' });
    const r = await probeWebGpuEngagement();
    expect(r.engaged).toBe(false);
    expect(r.stage).toBe('no-adapter');
  });

  it('requestDevice() throws → stage no-device (adapter info still captured)', async () => {
    installFakeGpu({ adapter: 'present', deviceThrows: true, info: { vendor: 'intel' } });
    const r = await probeWebGpuEngagement();
    expect(r.engaged).toBe(false);
    expect(r.stage).toBe('no-device');
    expect(r.adapterInfo).toEqual({ vendor: 'intel' });
  });

  it('compute returns the wrong value → stage compute-failed (device present but GPU compute broken)', async () => {
    installFakeGpu({ adapter: 'present', sentinelValue: 7 });
    const r = await probeWebGpuEngagement();
    expect(r.engaged).toBe(false);
    expect(r.stage).toBe('compute-failed');
  });
});
