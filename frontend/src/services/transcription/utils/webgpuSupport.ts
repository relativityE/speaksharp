/**
 * ============================================================================
 * WEBGPU CAPABILITY DETECTION
 * ============================================================================
 *
 * Foundation for Private STT performance work (Path A / WebGPU promotion).
 *
 * WebGPU is the only route to fast Private STT in production for the GPU-capable
 * majority, because:
 *   - Cloud fallback is permanently prohibited by the privacy promise.
 *   - Multi-threaded WASM (the CPU speedup) requires cross-origin isolation,
 *     which is currently disabled (see product_release/BACKLOG.md).
 *
 * IMPORTANT: This module only *detects* capability. It deliberately does NOT
 * change engine selection. Promoting `whisper-turbo` to the default requires:
 *   1. this detector,
 *   2. a guaranteed CPU (`transformers-js`) fallback when WebGPU is absent
 *      or the GPU engine fails to initialize,
 *   3. download-consent coordination (whisper-turbo is a separate ~75MB model
 *      in a different cache than the ~40MB transformers-js model), and
 *   4. validation on real GPU hardware.
 * Until those land, this is an inert, independently-testable building block.
 *
 * `navigator.gpu` existing is necessary but NOT sufficient: a browser can expose
 * the API yet fail to return an adapter (no compatible GPU, blocklisted driver,
 * headless/CI). `detectWebGPUSupport()` performs the real adapter request.
 */

export type WebGPUSupport =
  | { supported: true }
  | { supported: false; reason: 'no-navigator' | 'no-gpu-api' | 'no-adapter' | 'error' };

interface GPULike {
  requestAdapter: () => Promise<unknown>;
}

function getGpu(): GPULike | null {
  if (typeof navigator === 'undefined') return null;
  const gpu = (navigator as unknown as { gpu?: GPULike }).gpu;
  return gpu && typeof gpu.requestAdapter === 'function' ? gpu : null;
}

/**
 * Synchronous, cheap pre-check: is the WebGPU API surface even present?
 * Use this to short-circuit before paying for an async adapter request.
 * A `true` result does NOT guarantee a usable adapter — call
 * {@link detectWebGPUSupport} for an authoritative answer.
 */
export function hasWebGPUApi(): boolean {
  return getGpu() !== null;
}

/**
 * Authoritative WebGPU capability probe. Requests a real GPU adapter, which is
 * the only reliable signal that hardware-accelerated inference can actually run.
 * Never throws — failures are reported as a typed `reason`.
 */
export async function detectWebGPUSupport(): Promise<WebGPUSupport> {
  if (typeof navigator === 'undefined') {
    return { supported: false, reason: 'no-navigator' };
  }

  const gpu = getGpu();
  if (!gpu) {
    return { supported: false, reason: 'no-gpu-api' };
  }

  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, reason: 'no-adapter' };
    }
    return { supported: true };
  } catch {
    return { supported: false, reason: 'error' };
  }
}

/**
 * Convenience boolean wrapper around {@link detectWebGPUSupport}.
 */
export async function isWebGPUSupported(): Promise<boolean> {
  return (await detectWebGPUSupport()).supported;
}
