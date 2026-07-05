/**
 * ============================================================================
 * WEBGPU *ENGAGEMENT* PROOF (beyond capability detection)
 * ============================================================================
 *
 * `detectWebGPUSupport()` (webgpuSupport.ts) answers "is a GPU adapter present?".
 * That is necessary but NOT sufficient for the v4 re-platform: the transformers.js
 * pipeline can be constructed with `device: 'webgpu'` and still SILENTLY run
 * inference on the WASM execution provider (observed: a v4 "webgpu" run whose
 * effective EP was null/wasm, decode ≈ WASM speed). "WebGPU requested" ≠ "WebGPU
 * effective". Trusting the request alone would ship a "fast GPU path" that is
 * quietly the slow CPU path on some devices.
 *
 * This module proves ENGAGEMENT with two INDEPENDENT legs:
 *
 *   1. CAPABILITY proof — `probeWebGpuEngagement()` runs a trivial compute shader
 *      (writes a sentinel to a storage buffer, maps it back) on a real GPUDevice.
 *      A correct round-trip proves the adapter→device→compute path actually
 *      executes on this machine. Model-independent, ~milliseconds, and reusable
 *      as a RUNTIME GUARD: if this fails, the v4 path should choose WASM
 *      explicitly instead of silently mis-running a "GPU" pipeline on CPU.
 *
 *   2. MODEL-EFFECTIVE proof — `classifyModelExecution()` interprets the actual
 *      decode RTF. WASM base_q4 ≈ 0.21; WebGPU ≈ 0.05. An RTF below the WASM
 *      floor is physically impossible on WASM, so it is definitive proof the
 *      MODEL ran on the GPU. This is the per-model signal the device-matrix
 *      harness measures on real hardware.
 *
 * Dependency-free: structural interfaces only (mirrors webgpuSupport.ts), so no
 * @webgpu/types requirement. Nothing here changes engine selection — it is an
 * inert, independently-testable building block for the v4 promotion + the device
 * matrix. Never throws; all failure is reported as typed data.
 */

// ---- Structural WebGPU shapes (only what we touch) -------------------------

interface GpuAdapterInfoLike {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}
interface GpuDeviceLike {
  createShaderModule(desc: { code: string }): unknown;
  createBuffer(desc: { size: number; usage: number }): GpuBufferLike;
  createBindGroupLayout(desc: unknown): unknown;
  createPipelineLayout(desc: unknown): unknown;
  createComputePipeline(desc: unknown): { getBindGroupLayout(i: number): unknown };
  createBindGroup(desc: unknown): unknown;
  createCommandEncoder(): GpuCommandEncoderLike;
  queue: { submit(buffers: unknown[]): void };
  destroy?(): void;
}
interface GpuBufferLike {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy?(): void;
}
interface GpuComputePassLike {
  setPipeline(p: unknown): void;
  setBindGroup(i: number, g: unknown): void;
  dispatchWorkgroups(x: number): void;
  end(): void;
}
interface GpuCommandEncoderLike {
  beginComputePass(): GpuComputePassLike;
  copyBufferToBuffer(src: unknown, so: number, dst: unknown, dof: number, size: number): void;
  finish(): unknown;
}
interface GpuAdapterLike {
  info?: GpuAdapterInfoLike;
  features?: Iterable<string>;
  requestAdapterInfo?: () => Promise<GpuAdapterInfoLike>;
  requestDevice: () => Promise<GpuDeviceLike>;
}
interface GpuLike {
  requestAdapter: () => Promise<GpuAdapterLike | null>;
}

// WebGPU numeric constants (avoid depending on the GPU* globals existing at TS level).
const BUFFER_USAGE_STORAGE = 0x0080;
const BUFFER_USAGE_COPY_SRC = 0x0004;
const BUFFER_USAGE_COPY_DST = 0x0008;
const BUFFER_USAGE_MAP_READ = 0x0001;
const SHADER_STAGE_COMPUTE = 0x0004;
const MAP_MODE_READ = 0x0001;
const SENTINEL = 42; // value the compute shader writes; a correct read-back proves real GPU execution

// ---- Result types ----------------------------------------------------------

export type WebGpuEngagementStage =
  | 'no-api'          // navigator.gpu absent
  | 'no-adapter'      // requestAdapter() returned null
  | 'no-device'       // requestDevice() failed
  | 'compute-failed'  // device created but the compute round-trip threw / wrong value
  | 'engaged';        // sentinel round-tripped — GPU compute genuinely executed

export interface WebGpuEngagementProbe {
  /** True ONLY when a real compute shader round-tripped the sentinel on the GPU. */
  engaged: boolean;
  stage: WebGpuEngagementStage;
  adapterInfo: GpuAdapterInfoLike | null; // vendor/architecture/device/description when exposed
  features: string[];                     // adapter feature names (device-matrix data)
  probeMs: number | null;                 // wall-clock of the capability probe
  error?: string;
}

/** Advisory floor: any decode RTF at or below this is physically impossible on WASM → definitely GPU. */
export const WASM_RTF_FLOOR = 0.12;

export type ModelExecutionVerdict =
  | 'webgpu-effective'              // reported webgpu AND RTF proves GPU
  | 'wasm-effective'               // reported/ran wasm, RTF consistent
  | 'requested-webgpu-ran-wasm'    // reported webgpu but RTF is WASM-slow → SILENT FALLBACK (the trap)
  | 'unknown';                     // insufficient signal

// ---- Capability proof (leg 1) ----------------------------------------------

function getGpu(): GpuLike | null {
  if (typeof navigator === 'undefined') return null;
  const gpu = (navigator as unknown as { gpu?: GpuLike }).gpu;
  return gpu && typeof gpu.requestAdapter === 'function' ? gpu : null;
}

async function readAdapterInfo(adapter: GpuAdapterLike): Promise<GpuAdapterInfoLike | null> {
  try {
    if (adapter.info) return adapter.info;                                  // modern GPUAdapter.info
    if (adapter.requestAdapterInfo) return await adapter.requestAdapterInfo(); // deprecated fallback
  } catch { /* info is best-effort */ }
  return null;
}

/**
 * Prove real WebGPU compute engagement on THIS device by executing a trivial
 * compute shader and verifying the read-back. Never throws. Returns typed data
 * describing exactly how far the pipeline got and the adapter's identity/features.
 */
export async function probeWebGpuEngagement(): Promise<WebGpuEngagementProbe> {
  const started = safeNow();
  const gpu = getGpu();
  if (!gpu) return probeResult(false, 'no-api', null, [], elapsed(started));

  let adapterInfo: GpuAdapterInfoLike | null = null;
  let features: string[] = [];
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return probeResult(false, 'no-adapter', null, [], elapsed(started));
    adapterInfo = await readAdapterInfo(adapter);
    features = adapter.features ? Array.from(adapter.features) : [];

    let device: GpuDeviceLike;
    try {
      device = await adapter.requestDevice();
    } catch (e) {
      return probeResult(false, 'no-device', adapterInfo, features, elapsed(started), errStr(e));
    }

    try {
      const value = await runSentinelCompute(device);
      device.destroy?.();
      if (value === SENTINEL) return probeResult(true, 'engaged', adapterInfo, features, elapsed(started));
      return probeResult(false, 'compute-failed', adapterInfo, features, elapsed(started), `sentinel mismatch: ${value}`);
    } catch (e) {
      device.destroy?.();
      return probeResult(false, 'compute-failed', adapterInfo, features, elapsed(started), errStr(e));
    }
  } catch (e) {
    return probeResult(false, 'no-adapter', adapterInfo, features, elapsed(started), errStr(e));
  }
}

/** The minimal compute: write SENTINEL to out[0], copy to a mappable buffer, read it back. */
async function runSentinelCompute(device: GpuDeviceLike): Promise<number> {
  const module = device.createShaderModule({
    code: `@group(0) @binding(0) var<storage, read_write> out: array<u32>;
@compute @workgroup_size(1) fn main() { out[0] = ${SENTINEL}u; }`,
  });
  const storage = device.createBuffer({ size: 4, usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_SRC });
  const readback = device.createBuffer({ size: 4, usage: BUFFER_USAGE_COPY_DST | BUFFER_USAGE_MAP_READ });
  const layout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: SHADER_STAGE_COMPUTE, buffer: { type: 'storage' } }],
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'main' },
  });
  const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: storage } }] });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(1);
  pass.end();
  encoder.copyBufferToBuffer(storage, 0, readback, 0, 4);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(MAP_MODE_READ);
  const value = new Uint32Array(readback.getMappedRange().slice(0))[0];
  readback.unmap();
  storage.destroy?.();
  readback.destroy?.();
  return value;
}

// ---- Model-effective proof (leg 2) — pure, unit-testable -------------------

/**
 * Interpret a real decode RTF against the reported device to catch SILENT WASM
 * fallback. Pure. `workerReportedDevice` is the v4 worker's `loaded.device`
 * ('webgpu' | 'wasm-default' | 'wasm-fallback' | undefined).
 */
export function classifyModelExecution(input: {
  workerReportedDevice: string | null | undefined;
  decodeRtf: number | null | undefined;
  wasmRtfFloor?: number;
}): ModelExecutionVerdict {
  const floor = input.wasmRtfFloor ?? WASM_RTF_FLOOR;
  const dev = input.workerReportedDevice ?? '';
  const rtf = input.decodeRtf;

  if (dev === 'wasm-fallback' || dev === 'wasm-default') return 'wasm-effective';

  if (dev === 'webgpu') {
    if (rtf == null || !Number.isFinite(rtf)) return 'unknown';        // no timing → can't confirm effective
    if (rtf <= floor) return 'webgpu-effective';                        // faster than WASM can be → real GPU
    return 'requested-webgpu-ran-wasm';                                 // GPU requested but ran WASM-slow → the trap
  }

  // Unknown device label: fall back to timing alone if present.
  if (rtf != null && Number.isFinite(rtf)) return rtf <= floor ? 'webgpu-effective' : 'wasm-effective';
  return 'unknown';
}

// ---- helpers ---------------------------------------------------------------

function safeNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}
function elapsed(from: number): number {
  return Math.round(safeNow() - from);
}
function errStr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function probeResult(
  engaged: boolean, stage: WebGpuEngagementStage, adapterInfo: GpuAdapterInfoLike | null,
  features: string[], probeMs: number | null, error?: string,
): WebGpuEngagementProbe {
  return { engaged, stage, adapterInfo, features, probeMs, ...(error ? { error } : {}) };
}
