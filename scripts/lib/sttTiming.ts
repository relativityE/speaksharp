/**
 * Generic STT timing decomposition for ALL engines — Private, Native, Cloud.
 * Reads each engine's inert diagnostic trace global and derives the matrix
 * timing/derived fields so harnesses don't re-implement timing math per engine.
 *
 * Tooling only: pure functions, no runtime behavior, safe to import from proofs
 * and tests. One module for the timing job (was: Private-only readPrivateFinalizeTiming).
 *
 * Trace sources (normalized here so callers don't care about per-engine shape):
 *   - Private: window.__PRIVATE_STT_TIMELINE__  events: { event, perfMs, epochMs, payload }
 *   - Native:  window.__NATIVE_BROWSER_TRACE__   events: { event, t, ...flatPayload }
 *   - Cloud:   window.__CLOUD_STT_TIMELINE__     (PENDING: Cloud has no trace global yet;
 *              the reader works on normalized events so it is ready once the
 *              `fix/cloud-stop-timeout-tail` branch adds the inert trace).
 *
 * Event-time is read as perfMs ?? t (ms since page load); payload fields are read
 * from `.payload` first, then the event root (Native flattens).
 */
export interface SttTraceEvent {
  event: string;
  perfMs?: number;
  t?: number;
  epochMs?: number;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const timeOf = (ev: SttTraceEvent | null | undefined): number | null =>
  ev ? (num(ev.perfMs) ?? num(ev.t)) : null;

const field = (ev: SttTraceEvent | null | undefined, key: string): unknown =>
  ev ? (ev.payload?.[key] ?? (ev as Record<string, unknown>)[key]) : undefined;

const list = (tl: SttTraceEvent[] | null | undefined): SttTraceEvent[] =>
  Array.isArray(tl) ? tl : [];

const findFirst = (tl: SttTraceEvent[], ...events: string[]): SttTraceEvent | null =>
  tl.find((e) => events.includes(e?.event)) ?? null;

const findLast = (tl: SttTraceEvent[], ...events: string[]): SttTraceEvent | null => {
  for (let i = tl.length - 1; i >= 0; i--) if (events.includes(tl[i]?.event)) return tl[i];
  return null;
};

const round1 = (n: number): number => Number(n.toFixed(1));
const deltaMs = (a: number | null, b: number | null): number | null =>
  a !== null && b !== null ? round1(a - b) : null;

/* ========================================================================== *
 * PRIVATE — whole-utterance finalize decode decomposition
 * ========================================================================== */

export interface PrivateFinalizeTiming {
  committed: boolean;
  finalInferenceDurationMs: number | null;
  decodeInputDurationMs: number | null;
  finalizePhaseWallMs: number | null;
  decodeWallMs: number | null;
}

export function readPrivateFinalizeTiming(
  timeline: SttTraceEvent[] | null | undefined,
): PrivateFinalizeTiming {
  const tl = list(timeline);
  const decodeStart = findLast(tl, 'stop_whole_utterance_decode_start');
  const commitStart = findLast(tl, 'whole_utterance_commit_start');
  const commitAccept = findLast(tl, 'whole_utterance_commit_accept');

  const startPerf = timeOf(commitStart);
  const acceptPerf = timeOf(commitAccept);
  const decodeStartPerf = timeOf(decodeStart);

  return {
    committed: commitAccept !== null,
    finalInferenceDurationMs: num(field(commitAccept, 'decodeMs')),
    decodeInputDurationMs: num(field(commitStart, 'decodeInputDurationMs')),
    finalizePhaseWallMs: deltaMs(acceptPerf, decodeStartPerf),
    decodeWallMs: deltaMs(acceptPerf, startPerf),
  };
}

export interface FinalizeWaitBreakdown {
  finalizationWaitMs: number;
  decodeMs: number | null;
  appOverheadMs: number | null;
  decodeShare: number | null;
}

export function decomposeFinalizeWait(
  finalizationWaitMs: number,
  timing: PrivateFinalizeTiming,
): FinalizeWaitBreakdown {
  const decodeMs = timing.finalInferenceDurationMs;
  return {
    finalizationWaitMs,
    decodeMs,
    appOverheadMs: decodeMs !== null ? round1(finalizationWaitMs - decodeMs) : null,
    decodeShare:
      decodeMs !== null && finalizationWaitMs > 0
        ? Number((decodeMs / finalizationWaitMs).toFixed(3))
        : null,
  };
}

/* ========================================================================== *
 * NATIVE — stop convergence (the late-final-after-stop risk)
 * ========================================================================== */

export interface NativeStopTiming {
  onAudioStartMs: number | null;
  onSpeechStartMs: number | null;
  firstInterimMs: number | null;
  firstFinalMs: number | null;
  stopInvokedMs: number | null;
  onEndMs: number | null;
  /** Stop request -> recognition end. */
  stopToOnEndMs: number | null;
  /**
   * TRUE if a final (final_candidate) arrived AFTER stop was invoked — the exact
   * "Chrome finalizes late, app already promoted interim" failure class.
   */
  finalAfterStopInvoke: boolean;
}

export function readNativeStopTiming(
  trace: SttTraceEvent[] | null | undefined,
): NativeStopTiming {
  const tl = list(trace);
  const stopInvoked = findLast(tl, 'recognition_stop_invoked');
  const onEnd = findLast(tl, 'recognition_stop_onend', 'onend');

  // A final arriving AFTER the last stop request is the late-final failure class.
  let stopInvokedIdx = -1;
  for (let i = tl.length - 1; i >= 0; i--) {
    if (tl[i]?.event === 'recognition_stop_invoked') { stopInvokedIdx = i; break; }
  }
  const finalAfterStopInvoke =
    stopInvokedIdx >= 0 &&
    tl.slice(stopInvokedIdx + 1).some((e) => e?.event === 'final_candidate');

  const stopInvokedMs = timeOf(stopInvoked);
  const onEndMs = timeOf(onEnd);

  return {
    onAudioStartMs: timeOf(findFirst(tl, 'onaudiostart')),
    onSpeechStartMs: timeOf(findFirst(tl, 'onspeechstart')),
    firstInterimMs: timeOf(findFirst(tl, 'interim_candidate')),
    firstFinalMs: timeOf(findFirst(tl, 'final_candidate')),
    stopInvokedMs,
    onEndMs,
    stopToOnEndMs: deltaMs(onEndMs, stopInvokedMs),
    finalAfterStopInvoke,
  };
}

/* ========================================================================== *
 * CLOUD — streaming / termination tail
 * Reader is ready; production cloud trace global is PENDING (no __CLOUD_STT_TIMELINE__
 * yet). Lands with fix/cloud-stop-timeout-tail. Event names below are the proposed
 * inert trace contract: socket_open, first_partial, first_final, termination,
 * stop_invoked.
 * ========================================================================== */

export interface CloudStreamTiming {
  socketOpenMs: number | null;
  firstPartialMs: number | null;
  firstFinalMs: number | null;
  terminationMs: number | null;
  stopInvokedMs: number | null;
  openToFirstPartialMs: number | null;
  openToFirstFinalMs: number | null;
  /** Stop request -> provider Termination (the tail-loss risk window). */
  stopToTerminationMs: number | null;
}

export function readCloudStreamTiming(
  trace: SttTraceEvent[] | null | undefined,
): CloudStreamTiming {
  const tl = list(trace);
  const socketOpenMs = timeOf(findFirst(tl, 'socket_open'));
  const firstPartialMs = timeOf(findFirst(tl, 'first_partial'));
  const firstFinalMs = timeOf(findFirst(tl, 'first_final'));
  const terminationMs = timeOf(findLast(tl, 'termination'));
  const stopInvokedMs = timeOf(findLast(tl, 'stop_invoked'));

  return {
    socketOpenMs,
    firstPartialMs,
    firstFinalMs,
    terminationMs,
    stopInvokedMs,
    openToFirstPartialMs: deltaMs(firstPartialMs, socketOpenMs),
    openToFirstFinalMs: deltaMs(firstFinalMs, socketOpenMs),
    stopToTerminationMs: deltaMs(terminationMs, stopInvokedMs),
  };
}
