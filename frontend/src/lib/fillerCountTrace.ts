/**
 * #1325 privacy-safe filler count trace (evidence enabler for #1324).
 *
 * Records TIMESTAMPED COUNT TRANSITIONS — never interim/final transcript text. The controlled
 * qualification harness needs to distinguish "a true filler was counted from an interim hypothesis and
 * later lost" (remediation rung B) from "the recognizer never produced a filler at all" (rung D/E).
 * Comparing per-key aggregate counts across `interim_observed` / `final_observed` / `combined` phases
 * answers that without any hypothesis text.
 *
 * Invariants (each has a named falsification test):
 *  - OFF BY DEFAULT: writes nothing unless `window.__PRIVATE_TRANSCRIPT_TRACE__` is explicitly enabled,
 *    and never allocates the buffer in that case. Flag-off behavior is identical to production.
 *  - TEXT-FREE: only the canonical numeric keys below are recorded. Raw custom-word LABELS never leave
 *    the hook — callers pass a summed `custom_total`. Unknown keys are dropped, not stored.
 *  - IN-MEMORY ONLY: no storage, network, logging, analytics, or crash reporting. Page unload discards.
 *  - BOUNDED: ring buffer capped at MAX_FILLER_TRACE_EVENTS; oldest events are dropped first.
 *  - ORDERED: strictly increasing `seq`, non-decreasing `relativeMs`, both reset by an explicit clear.
 *  - SCHEMA-VALID: negative / non-integer counts and unknown phases are REJECTED rather than coerced,
 *    so malformed data can never masquerade as evidence.
 */

export const FILLER_COUNT_TRACE_VERSION = 'filler_count_trace_v1';

/** Ring-buffer cap. Bounded so a long session cannot grow memory without limit. */
export const MAX_FILLER_TRACE_EVENTS = 256;

/** Which stage of the hook produced the counts. */
export type FillerCountPhase = 'interim_observed' | 'final_observed' | 'combined';

const VALID_PHASES: ReadonlySet<string> = new Set<FillerCountPhase>([
  'interim_observed',
  'final_observed',
  'combined',
]);

/**
 * The ONLY fields that may be recorded. `custom_total` is a SUM — user-defined filler labels are
 * deliberately unrepresentable here.
 */
export interface FillerCountSnapshot {
  um: number;
  uh: number;
  ah: number;
  custom_total: number;
}

const CANONICAL_KEYS: ReadonlyArray<keyof FillerCountSnapshot> = ['um', 'uh', 'ah', 'custom_total'];

export interface FillerCountTraceEvent {
  version: typeof FILLER_COUNT_TRACE_VERSION;
  seq: number;
  /** Milliseconds since the first event after the most recent clear. */
  relativeMs: number;
  phase: FillerCountPhase;
  counts: FillerCountSnapshot;
}

interface TraceWindow {
  __PRIVATE_TRANSCRIPT_TRACE__?: boolean;
  __FILLER_COUNT_TRACE__?: FillerCountTraceEvent[];
}

const traceWindow = (): TraceWindow | null =>
  typeof window === 'undefined' ? null : (window as unknown as TraceWindow);

/** True only when the existing controlled trace flag is explicitly enabled. */
export function isFillerCountTraceEnabled(): boolean {
  return Boolean(traceWindow()?.__PRIVATE_TRANSCRIPT_TRACE__);
}

let seqCounter = 0;
let originMs: number | null = null;

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/**
 * Accept only finite, non-negative integers on the canonical keys. Anything else (negative, NaN,
 * fractional, missing) invalidates the whole event — evidence must never be silently repaired.
 */
function sanitizeCounts(counts: FillerCountSnapshot): FillerCountSnapshot | null {
  const out = {} as FillerCountSnapshot;
  for (const key of CANONICAL_KEYS) {
    const value = counts?.[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
    out[key] = value;
  }
  return out;
}

/**
 * Record one count transition. No-op unless the controlled flag is on. Returns nothing so callers
 * cannot branch on trace state — enabling the trace must not change product behavior.
 */
export function pushFillerCountTransition(phase: FillerCountPhase, counts: FillerCountSnapshot): void {
  const win = traceWindow();
  if (!win?.__PRIVATE_TRANSCRIPT_TRACE__) return;

  if (!VALID_PHASES.has(phase)) return;
  const sanitized = sanitizeCounts(counts);
  if (!sanitized) return;

  const timestamp = nowMs();
  if (originMs === null) originMs = timestamp;

  const buffer = win.__FILLER_COUNT_TRACE__ ?? (win.__FILLER_COUNT_TRACE__ = []);
  buffer.push({
    version: FILLER_COUNT_TRACE_VERSION,
    seq: seqCounter,
    relativeMs: Math.max(0, Math.round(timestamp - originMs)),
    phase,
    counts: sanitized,
  });
  seqCounter += 1;

  // Bounded ring buffer: drop oldest first.
  while (buffer.length > MAX_FILLER_TRACE_EVENTS) buffer.shift();
}

/** Read the current trace (empty when disabled or never written). */
export function readFillerCountTrace(): readonly FillerCountTraceEvent[] {
  return traceWindow()?.__FILLER_COUNT_TRACE__ ?? [];
}

/** Explicitly reset before each controlled replay so runs are independent. */
export function clearFillerCountTrace(): void {
  const win = traceWindow();
  if (win) delete win.__FILLER_COUNT_TRACE__;
  seqCounter = 0;
  originMs = null;
}
