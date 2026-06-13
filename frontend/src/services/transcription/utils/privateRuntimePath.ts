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
 * v4 (post-paid-soft-launch, flag-gated) layers ON TOP via the optional `v4`
 * input. When `v4` is omitted or disabled the resolver behaves byte-identically
 * to the v2-base default — v4 is NEVER selected. When enabled, v4 is selected
 * ONLY on confirmed WebGPU (conservative first rollout: no-WebGPU stays v2-base),
 * and always keeps v2-base as the init/load fallback.
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
import type { PrivSttV4VariantId } from '../sttConstants';

export type PrivateRuntimeKind = 'webgpu' | 'wasm-multithread' | 'wasm-singlethread';

export type PrivateRuntimeReason =
  | 'webgpu_available_and_model_cached'
  | 'webgpu_available_v4_flag'
  | 'v4_forced_auto'
  | 'no_webgpu_cross_origin_isolated'
  | 'no_webgpu_or_isolation';

/**
 * Fully-observable runtime decision. Every field is always present so it can be
 * logged/surfaced verbatim for diagnostics and release proof.
 */
export interface PrivateRuntimeDecision {
  /** Coarse runtime kind driving UX copy + telemetry. */
  runtime: PrivateRuntimeKind;
  /** Concrete engine the facade will initialize. (The GPU tier is parked; the WebGPU
   *  successor engine is transformers-js-v4 — whisper-turbo was retired.) */
  provider: 'transformers-js-v4' | 'transformers-js';
  /** When provider is v4, which model TIER was chosen; null on the v2/CPU path. */
  v4Variant: PrivSttV4VariantId | null;
  /** Acceleration class. */
  acceleration: 'gpu' | 'cpu';
  /**
   * Runtime ELIGIBILITY reason — why this runtime path was available/chosen. This is NOT the
   * selection source: do not infer `selectionSource` from it (on real WebGPU this reads
   * `webgpu_available_v4_flag` for BOTH a real-flag selection AND a dev/test forceAuto run).
   * Examples: WebGPU available + v4 flag, no WebGPU, cross-origin isolation. See `selectionSource`
   * for WHO selected the engine.
   */
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
  /**
   * WHO/WHAT selected the engine — an ORTHOGONAL dimension to `reason` (which explains runtime
   * ELIGIBILITY, not who selected). Explicit data, NEVER inferred from `reason`:
   *   - 'posthog_flag' : the real PostHog flag drove a v4 selection (Gate B / production v4).
   *   - 'dev_harness'  : only the dev/test `forceAuto` shim drove it (Gate A value run; never production).
   *   - 'default'      : the v2-base default path (flag off, flag on but no WebGPU, or promotion not allowed).
   * NOTE: on real WebGPU `reason` reads `webgpu_available_v4_flag` for BOTH the flag AND forceAuto
   * (because `webgpuAvailable===true`), so THIS field — not `reason` — is the honest selection signal.
   * Gate A (forceAuto) ⇒ 'dev_harness'; Gate B (real flag) ⇒ 'posthog_flag'; v2 ⇒ 'default'.
   * Decode-time FALLBACK is a separate outcome (orthogonal again): it's recorded via the telemetry
   * `fallbackReason`/`finalProvider` so we keep WHO originally selected v4, not collapse it to 'fallback'.
   */
  selectionSource: 'posthog_flag' | 'dev_harness' | 'default';
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
   * Whether the WebGPU GPU model is already cached. Promotion to GPU
   * requires this so we never trigger a surprise ~75MB download. Reported back in
   * the decision regardless of the outcome.
   */
  turboModelCached: boolean;
  /**
   * v4 flag-gated tiering. When omitted or { enabled:false } the resolver behaves
   * identically to the v2-base default — v4 is NEVER selected, so flag-off is
   * byte-identical. When enabled, v4 is selected ONLY on confirmed WebGPU
   * (no-WebGPU stays the v2-base CPU floor). `distilEnabled` selects the WebGPU
   * ACCURACY tier (distil_q4) on top of WebGPU; otherwise base_q4 is the WebGPU
   * floor. Exposure stays controlled by the flags; both tiers are implemented.
   */
  v4?: {
    enabled: boolean;
    distilEnabled: boolean;
    /** DEV/TEST-only: attempt v4 even WITHOUT WebGPU (headless-CI AUTO fallback proof). */
    forceAuto?: boolean;
    /** Honest selection provenance the caller computed (real PostHog flag vs dev/test forceAuto shim). */
    selectionSource?: 'posthog_flag' | 'dev_harness';
  };
}

function cpuDecision(crossOriginIsolated: boolean, webgpuAvailable: boolean, turboCached: boolean): PrivateRuntimeDecision {
  const threads = computeWasmThreadCount(crossOriginIsolated, getHardwareThreads());
  const multithread = crossOriginIsolated && threads > 1;
  return {
    runtime: multithread ? 'wasm-multithread' : 'wasm-singlethread',
    provider: 'transformers-js',
    v4Variant: null,
    acceleration: 'cpu',
    reason: multithread ? 'no_webgpu_cross_origin_isolated' : 'no_webgpu_or_isolation',
    webgpuAvailable,
    turboCached,
    crossOriginIsolated,
    wasmThreadCount: multithread ? threads : 1,
    fallbackAvailable: false, // CPU is the floor — nothing safer to fall back to.
    cloudFallbackAttempted: false,
    selectionSource: 'default', // v2-base default path (flag off / no WebGPU / promotion not allowed).
  };
}

/**
 * Resolve the Private runtime decision per the policy above.
 */
export async function resolvePrivateRuntimePath(
  options: ResolvePrivateRuntimePathOptions,
): Promise<PrivateRuntimeDecision> {
  const isolated = isCrossOriginIsolated();

  // v4 flag-gated path (post-paid-soft-launch). CONSERVATIVE: v4 is selected ONLY
  // on confirmed WebGPU; no-WebGPU stays the v2-base CPU floor. Omitted/disabled
  // `v4` never enters here, so flag-off behavior is byte-identical to the default.
  if (options.v4?.enabled) {
    let webgpuAvailable = false;
    try {
      webgpuAvailable = (await detectWebGPUSupport()).supported;
    } catch {
      webgpuAvailable = false;
    }

    // v4 is selected on confirmed WebGPU (the conservative rollout). The DEV/TEST-only
    // `forceAuto` knob ALSO selects v4 without WebGPU so headless CI can exercise the
    // AUTO-path decode fallback (v4 attempt -> decode fail -> v2-base). forceAuto is gated
    // in PrivateSTT (dev/test/E2E only) and is never set in production.
    if (webgpuAvailable || options.v4.forceAuto) {
      // Both v4 tiers load via the worker model-param. distil_q4 is the WebGPU ACCURACY tier
      // and requires its own explicit flag ON TOP of WebGPU; otherwise base_q4 is the floor.
      const v4Variant: PrivSttV4VariantId = options.v4.distilEnabled ? 'distil_q4' : 'base_q4';
      return {
        runtime: webgpuAvailable ? 'webgpu' : 'wasm-singlethread',
        provider: 'transformers-js-v4',
        v4Variant,
        acceleration: webgpuAvailable ? 'gpu' : 'cpu',
        reason: webgpuAvailable ? 'webgpu_available_v4_flag' : 'v4_forced_auto',
        // Honest provenance — independent of `reason` (which conflates flag vs forceAuto on real WebGPU).
        selectionSource: options.v4.selectionSource ?? (options.v4.forceAuto ? 'dev_harness' : 'posthog_flag'),
        webgpuAvailable,
        turboCached: options.turboModelCached,
        crossOriginIsolated: isolated,
        wasmThreadCount: webgpuAvailable ? 0 : 1,
        fallbackAvailable: true, // v4 can safely fall back to the v2-base CPU floor.
        cloudFallbackAttempted: false,
      };
    }

    // Flag on but no WebGPU (and not forced) → conservative rollout stays on the v2-base floor.
    return cpuDecision(isolated, false, options.turboModelCached);
  }

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
        provider: 'transformers-js-v4',
        v4Variant: null,
        acceleration: 'gpu',
        reason: 'webgpu_available_and_model_cached',
        webgpuAvailable: true,
        turboCached: true,
        crossOriginIsolated: isolated,
        wasmThreadCount: 0, // N/A on the GPU path.
        fallbackAvailable: true, // GPU can safely fall back to the CPU floor.
        cloudFallbackAttempted: false,
        selectionSource: 'default', // parked legacy-turbo GPU promotion — not flag/forceAuto driven.
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
