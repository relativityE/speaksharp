/**
 * Private segmented-finalization flag + telemetry contract (#891, Phase 2 wiring).
 *
 * OFF by default. When off, Private finalization uses the existing whole-utterance decode at Stop,
 * unchanged. When on, the segment ledger + background per-segment decode + coverage-gated assembly
 * run — BUT this slice is INSTRUMENTED WIRING, not a behavioral cutover: the whole-utterance decode
 * remains the canonical/fallback path until the segmented worker path is proven (word timestamps,
 * background scheduling, bounded queue depth) on a real 5-minute take.
 *
 * Enable for a run via either:
 *   - `window.__PRIVATE_SEGMENTATION__ = true` — INTERNAL/DEV/DIAGNOSTIC path. Works in ALL environments
 *     (including public production), because enabling it requires a deliberate devtools-console or
 *     test-harness action and is NOT reachable via a shareable/discoverable URL. This is the operator's
 *     switch for the production 5-minute diagnostic take.
 *   - URL `?privateSeg=1` — convenience switch, honored ONLY OUTSIDE public production (dev/test/preview).
 *
 * PRE-CUTOVER GATING (Item 5, DONE): the publicly-reachable `?privateSeg=1` URL param is IGNORED when
 * `import.meta.env.MODE === 'production'` (the public prod build; dev='development', test='test'). So a
 * discoverable/shareable URL can never enable segmentation for real production users — the hard gate the
 * eventual canonical-transcript cutover requires. (Today segmentation only adds shadow instrumentation,
 * so this is a forward-looking safety gate, not a fix for current behavior.)
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
/**
 * SHADOW COMPARISON (#891): text-free summary of the ASSEMBLED segmented transcript vs the canonical
 * whole-utterance transcript. The cutover-readiness signal — how close the segmented output is to what
 * we actually save today. Numbers ONLY; never the transcript text.
 */
export interface SegmentationShadowTelemetry {
  /** Segments that produced a decode and were folded. */
  segmentCount: number;
  /** Seams reconciled (segmentCount - 1 when ≥2 folded). */
  seamCount: number;
  /** Seams left flagged (residual duplication the coverage check could not certify away). */
  flaggedSeams: number;
  assembledTokenCount: number;
  wholeUtteranceTokenCount: number;
  /** assembled − whole-utterance token count (positive = segmented produced more words). */
  tokenCountDelta: number;
  /** Sørensen–Dice similarity over normalized word multisets, 0..1 (1 = identical bag of words). */
  similarity: number;
}

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
  /**
   * Assembled-vs-canonical shadow comparison. Null until the whole-utterance decode has committed (it
   * is published base-only first, then re-published with this once the comparison is available), or if
   * no segment produced a decode. Instrumentation only — the assembled transcript is never saved/shown.
   */
  shadow?: SegmentationShadowTelemetry | null;
}

/** True when Private segmented finalization is explicitly enabled for this session. */
export function isPrivateSegmentationEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  // Internal/dev/diagnostic path — deliberate window flag (devtools console / test harness). Honored in
  // EVERY environment, incl. public production, so an operator can run the production diagnostic take.
  // Not reachable via a URL, so it cannot be flipped on for a real user by a shared/discoverable link.
  if (window.__PRIVATE_SEGMENTATION__ === true) return true;
  // ITEM 5 HARD GATE: the publicly-reachable ?privateSeg=1 URL param is IGNORED in public production, so
  // it can never enable segmentation for real users (pre-cutover safety). Honored only in dev/test/preview.
  if (import.meta.env.MODE === 'production') return false;
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
