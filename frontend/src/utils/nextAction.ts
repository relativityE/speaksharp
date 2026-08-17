// #1306 — CLIENT-side derivation of the metrics-only persistence payload. The server RPC no longer receives or
// re-derives from a transcript, so the client turns the in-memory session signals into (a) the strict flat
// filler_counts the persistence firewall accepts and (b) the ONE structured next_action_signal. Both are
// content-free (numbers + fixed enums only) — no transcript, quoted speech, or free-form prose.
import {
  type NextActionSignal,
  validateNextActionSignal,
  NEXT_ACTION_TEMPLATE_VERSION,
} from '@/contracts/nextActionSignal';
import { ANALYTICS_THRESHOLDS } from '@/utils/sessionAnalysis';
import type { FillerCounts } from '@/utils/fillerWordUtils';
import { APPROVED_FILLER_KEYS, type PersistedFillerCounts } from '@/contracts/fillerCounts';

// Approved snake_case filler identifiers — SINGLE SOURCE is `@/contracts/fillerCounts` (mirrored by the DB
// firewall). Re-exported here for back-compat. Derived 1:1 from the app's FILLER_WORD_KEYS display forms via
// `canonicalFillerKey` ('You Know' → you_know, 'I Mean' → i_mean, 'Kind Of' → kind_of, …).
export const CANONICAL_FILLER_KEYS = APPROVED_FILLER_KEYS;
const CANON = new Set<string>(APPROVED_FILLER_KEYS);

/** Display filler key → canonical snake_case token (lower-case, spaces → underscore). */
export const canonicalFillerKey = (k: string): string => k.toLowerCase().replace(/\s+/g, '_');

/**
 * Flatten the live nested FillerCounts ({ um: { count: 3 }, total: {…}, <customWord>: {…} }) into the strict
 * flat standard-key numeric map the persistence firewall accepts ({ um: 3 }). Excludes `total`, custom words,
 * and any non-standard key; drops non-finite/negative counts. Content-free — keys + integer counts only.
 */
export function flattenToFillerCounts(fillerData: FillerCounts | null | undefined): PersistedFillerCounts {
  const out: Record<string, number> = {};
  if (!fillerData || typeof fillerData !== 'object') return out;
  for (const [rawKey, entry] of Object.entries(fillerData)) {
    if (rawKey === 'total') continue;
    const key = canonicalFillerKey(rawKey);
    if (!CANON.has(key)) continue; // the live adapter EXPLICITLY selects approved keys — custom words dropped
    const count = (entry as { count?: unknown } | null)?.count;
    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
      out[key] = (out[key] ?? 0) + Math.trunc(count);
    }
  }
  return out as PersistedFillerCounts;
}

export interface FinalMetricsInput {
  durationSeconds: number;
  wordCount: number;
  wpm: number | null | undefined;
  fillerCounts: Record<string, number>;
  clarityScore?: number | null;
}

// Mirrors liveCoaching.TRUE_FILLER_RATE_PER_MIN — a filler is "overused" at >= 3 per minute. Not invented here.
const FILLER_RATE_PER_MIN_TARGET = 3;

/**
 * Derive the ONE structured next action from a successfully completed session's FINAL metrics. Pure + content-
 * free (numbers only). Single-choice priority: too little reliable speech → establish a baseline; else the
 * single most impactful signal (filler rate → pace → on track). Thresholds reuse the app's existing product
 * values (ANALYTICS_THRESHOLDS pace band; liveCoaching filler rate) — none are invented here. The result is
 * validated against the strict contract before return, so it always satisfies the DB shape CHECK.
 */
export function deriveNextActionSignal(m: FinalMetricsInput): NextActionSignal {
  const tv = NEXT_ACTION_TEMPLATE_VERSION;
  const build = (s: NextActionSignal): NextActionSignal => {
    const v = validateNextActionSignal(s);
    if (!v.ok) throw new Error(`deriveNextActionSignal produced an invalid signal: ${v.errors.join('; ')}`);
    return v.value;
  };

  // Too little reliable speech to assess → establish a baseline (never a fabricated judgement).
  if (!Number.isFinite(m.wordCount) || m.wordCount < ANALYTICS_THRESHOLDS.MIN_RELIABLE_SCORING_WORDS) {
    return build({ reasonCode: 'ESTABLISH_BASELINE', actionCode: 'RECORD_BASELINE', metric: 'none', value: 0, comparator: 'no_baseline', templateVersion: tv });
  }

  const totalFillers = Object.values(m.fillerCounts).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const minutes = m.durationSeconds > 0 ? m.durationSeconds / 60 : 0;
  const fillerRate = minutes > 0 ? totalFillers / minutes : 0;
  if (fillerRate >= FILLER_RATE_PER_MIN_TARGET) {
    return build({ reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate', value: Math.round(fillerRate * 100) / 100, comparator: 'above_target', templateVersion: tv });
  }

  const wpm = typeof m.wpm === 'number' && Number.isFinite(m.wpm) ? m.wpm : null;
  if (wpm !== null && wpm > ANALYTICS_THRESHOLDS.TARGET_WPM_MAX) {
    return build({ reasonCode: 'PACE_TOO_FAST', actionCode: 'SLOW_DOWN', metric: 'wpm', value: Math.round(wpm), comparator: 'above_target', templateVersion: tv });
  }
  if (wpm !== null && wpm > 0 && wpm < ANALYTICS_THRESHOLDS.TARGET_WPM_MIN) {
    return build({ reasonCode: 'PACE_TOO_SLOW', actionCode: 'SPEED_UP', metric: 'wpm', value: Math.round(wpm), comparator: 'below_target', templateVersion: tv });
  }

  // Everything within target → maintain what worked.
  return build({ reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: tv });
}
