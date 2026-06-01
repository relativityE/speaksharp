/**
 * ============================================================================
 * PRIVATE STT RUNTIME PATH RESOLVER
 * ============================================================================
 *
 * Single deterministic resolver for the official Private STT provider policy.
 * CPU is the product FLOOR, not a fallback edge case — WebGPU only accelerates.
 *
 *   1. WebGPU            when a real adapter is available AND turbo is cached.
 *   2. CPU multi-thread  when no WebGPU but the context is cross-origin isolated.
 *   3. CPU single-thread otherwise — the GUARANTEED local floor.
 *   4. Cloud             NEVER automatic. `cloudFallbackAttempted` is always false.
 *
 * The resolver returns a flat, fully-populated decision object so selection, UX
 * copy, diagnostics/telemetry, and tests all derive from one source of truth.
 * It does not instantiate engines or download anything — it only describes the
 * chosen path and the signals behind it. Never throws: on any detection error it
 * degrades toward the CPU floor (the always-available local path).
 */

import { detectWebGPUSupport } from './webgpuSupport';
import {
  computeWasmThreadCount,
  getHardwareThreads,
  isCrossOriginIsolated,
} from './wasmThreads';

export type PrivateRuntimeKind = 'webgpu' | 'wasm-multithread' | 'wasm-singlethread';

export type PrivateRuntimeReason =
  | 'webgpu_available_and_model_cached'
  | 'no_webgpu_cross_origin_isolated'
  | 'no_webgpu_or_isolation';

/**
 * Fully-observable runtime decision. Every field is always present so it can be
 * logged/surfaced verbatim for diagnostics and release proof.
 */
export interface PrivateRuntimeDecision {
  /** Coarse runtime kind driving UX copy + telemetry. */
  runtime: PrivateRuntimeKind;
  /** Concrete engine the facade will initialize. */
  provider: 'whisper-turbo' | 'transformers-js';
  /** Acceleration class. */
  acceleration: 'gpu' | 'cpu';
  reason: PrivateRuntimeReason;
  /** Whether a usable WebGPU adapter was detected (probed only when promotion is allowed). */
  webgpuAvailable: boolean;
  /** Whether the WebGPU (turbo) model is already cached — gates promotion to avoid surprise downloads. */
  turboCached: boolean;
  /** Whether the context is cross-origin isolated (required for multi-threaded WASM). */
  crossOriginIsolated: boolean;
  /** Actual WASM thread count the CPU engine will use (0 when runtime is webgpu). */
  wasmThreadCount: number;
  /** True only when a faster path was chosen that can safely fall back to CPU (i.e. webgpu). */
  fallbackAvailable: boolean;
  /** Privacy invariant: cloud is never an automatic fallback. Always false. */
  cloudFallbackAttempted: false;
}

export interface ResolvePrivateRuntimePathOptions {
  /**
   * Whether WebGPU promotion is permitted to be *considered* at all. The caller
   * gates this on: not in CI/forced-CPU, and the configured engine is the CPU
   * default. When false the resolver never probes/returns WebGPU and only chooses
   * between the two CPU tiers.
   */
  webgpuPromotionAllowed: boolean;
  /**
   * Whether the WebGPU (whisper-turbo) model is already cached. Promotion to GPU
   * requires this so we never trigger a surprise ~75MB download. Reported back in
   * the decision regardless of the outcome.
   */
  turboModelCached: boolean;
}

function cpuDecision(crossOriginIsolated: boolean, webgpuAvailable: boolean, turboCached: boolean): PrivateRuntimeDecision {
  const threads = computeWasmThreadCount(crossOriginIsolated, getHardwareThreads());
  const multithread = crossOriginIsolated && threads > 1;
  return {
    runtime: multithread ? 'wasm-multithread' : 'wasm-singlethread',
    provider: 'transformers-js',
    acceleration: 'cpu',
    reason: multithread ? 'no_webgpu_cross_origin_isolated' : 'no_webgpu_or_isolation',
    webgpuAvailable,
    turboCached,
    crossOriginIsolated,
    wasmThreadCount: multithread ? threads : 1,
    fallbackAvailable: false, // CPU is the floor — nothing safer to fall back to.
    cloudFallbackAttempted: false,
  };
}

/**
 * Resolve the Private runtime decision per the policy above.
 */
export async function resolvePrivateRuntimePath(
  options: ResolvePrivateRuntimePathOptions,
): Promise<PrivateRuntimeDecision> {
  const isolated = isCrossOriginIsolated();

  // Tier 1: WebGPU acceleration — only considered when explicitly allowed.
  if (options.webgpuPromotionAllowed) {
    let webgpuAvailable = false;
    try {
      webgpuAvailable = (await detectWebGPUSupport()).supported;
    } catch {
      webgpuAvailable = false;
    }

    if (webgpuAvailable && options.turboModelCached) {
      return {
        runtime: 'webgpu',
        provider: 'whisper-turbo',
        acceleration: 'gpu',
        reason: 'webgpu_available_and_model_cached',
        webgpuAvailable: true,
        turboCached: true,
        crossOriginIsolated: isolated,
        wasmThreadCount: 0, // N/A on the GPU path.
        fallbackAvailable: true, // GPU can safely fall back to the CPU floor.
        cloudFallbackAttempted: false,
      };
    }

    // WebGPU considered but not chosen (no adapter, or model not cached):
    // fall through to the CPU floor, reporting the probed signals.
    return cpuDecision(isolated, webgpuAvailable, options.turboModelCached);
  }

  // Tiers 2 & 3: CPU floor (promotion not allowed; do not probe WebGPU).
  return cpuDecision(isolated, false, options.turboModelCached);
}

/**
 * User-facing status copy for each runtime path. Honest about the trade-off:
 * single-thread CPU warns that finalization may take longer, so post-Stop
 * latency reads as intentional rather than broken.
 */
export function describePrivateRuntimePath(decision: PrivateRuntimeDecision): string {
  switch (decision.runtime) {
    case 'webgpu':
      return 'Private mode is running locally with GPU acceleration.';
    case 'wasm-multithread':
      return 'Private mode is running locally on your CPU.';
    case 'wasm-singlethread':
    default:
      return 'Private mode is running locally on this device. Transcription may take a little longer after you stop.';
  }
}
