/**
 * Private segmented-finalization flag + telemetry contract (#891, Phase 2 wiring).
 *
 * OFF by default. When off, Private finalization uses the existing whole-utterance decode at Stop,
 * unchanged. When on, the segment ledger + background per-segment decode + coverage-gated assembly
 * run — BUT this slice is INSTRUMENTED WIRING, not a behavioral cutover: the whole-utterance decode
 * remains the canonical/fallback path until the segmented worker path is proven (word timestamps,
 * background scheduling, bounded queue depth) on a real 5-minute take.
 *
 * Enable for an internal run via either:
 *   - `window.__PRIVATE_SEGMENTATION__ = true`
 *   - URL `?privateSeg=1`
 *
 * PRE-CUTOVER GATING (TODO before any behavioral cutover): `?privateSeg=1` is a publicly reachable
 * switch. While this slice only instruments (no behavioral change), that is fine. Before segmentation
 * ever becomes the canonical saved-transcript path, this switch MUST be restricted to internal/dev
 * builds or an explicit diagnostics mode so it cannot be flipped on in production.
 *
 * Side-effect-free and dependency-free so it can be imported anywhere (including the worker).
 */

declare global {
  interface Window {
    __PRIVATE_SEGMENTATION__?: boolean;
    /** Published per Private session for the segmentation diagnostic harness (test/internal only). */
    __PRIVATE_SEGMENTATION_TELEMETRY__?: PrivateSegmentationTelemetry;
  }
}

/** Per-segment lifecycle record. Field names are a stable contract for the diagnostic harness. */
export interface SegmentLifecycleTelemetry {
  segmentIndex: number;
  segmentStartMs: number;
  segmentEndMs: number;
  segmentDurationMs: number;
  closedReason: 'pause' | 'hardCap' | 'stopTail';
  /** Background-decode lifecycle (ms since session start; null until reached). */
  decodeQueuedAt: number | null;
  decodeStartedAt: number | null;
  decodeFinishedAt: number | null;
  decodeMs: number | null;
  /** Real-time factor for this segment's decode (decodeMs / segmentDurationMs). */
  rtf: number | null;
  /** Decode queue depth at the moment this segment was enqueued — the keep-pace signal. */
  queueDepthAtEnqueue: number | null;
}

/** Session-level segmentation telemetry the diagnostic harness / 5-min gate reads. */
export interface PrivateSegmentationTelemetry {
  /** Whether the segmentation path was active for this session. */
  segmentationEnabled: boolean;
  segments: SegmentLifecycleTelemetry[];
  /** Peak decode-queue depth across the recording — the backlog-risk observable. */
  maxQueueDepth: number;
  /** Tail (unconfirmed final segment) decode time at Stop. */
  tailDecodeMs: number | null;
  /** Stop -> final assembled transcript. */
  stopToFinalMs: number | null;
  /** True if the segmented path fell back to the whole-utterance decode (safety). */
  usedWholeUtteranceFallback: boolean;
}

/** True when Private segmented finalization is explicitly enabled for this session. */
export function isPrivateSegmentationEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__PRIVATE_SEGMENTATION__ === true) return true;
  try {
    return new URLSearchParams(window.location.search).get('privateSeg') === '1';
  } catch {
    return false;
  }
}

/** Publish the segmentation telemetry snapshot (test/internal only; no behavior impact). */
export function publishPrivateSegmentationTelemetry(telemetry: PrivateSegmentationTelemetry): void {
  if (typeof window === 'undefined') return;
  window.__PRIVATE_SEGMENTATION_TELEMETRY__ = telemetry;
}
