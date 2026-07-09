import type { PauseMetrics } from '@/services/audio/pauseDetector';
import type { FillerCounts } from '@/utils/fillerWordUtils';
import { FILLER_WORD_KEYS } from '@/config';
import { calculateCoreSessionMetrics } from '@/utils/sessionAnalysis';
import { calculateSpeakingScore } from '@/utils/speakingScore';

/**
 * Phase 5.8 PRECURSOR (C-then-A) — filler-source divergence measurement.
 *
 * Compares the LIVE filler counter (`useFillerWords` → store.fillerData) against the deterministic
 * transcript RECOUNT (`countFillerWords(transcript, userWords)`) — the value Analytics/PDF/save already
 * use and the candidate SSOT — and reports the downstream clarity/score impact.
 *
 * DIAGNOSTIC ONLY: nothing here is consumed by a product surface, no writer is changed, no cutover.
 * PRIVACY: reports are NUMBERS ONLY (counts + deltas + a category tag). No transcript text.
 */

export type DivergenceCategory =
  | 'match'
  | 'private-finalize-replacement'
  | 'cloud-partial-overlap'
  | 'live-counter-drift'
  | 'unknown';

export interface FillerDivergenceInputs {
  transcript: string;
  elapsedSeconds: number;
  /** The live useFillerWords output (store.fillerData). */
  liveFillerData: FillerCounts | null | undefined;
  pauseMetrics?: PauseMetrics;
  engine?: string;
  userWords?: string[];
  /** Known category for fixtures; runtime sessions are 'unknown'. */
  category?: DivergenceCategory;
  /** Which save-candidate the transcript came from (an enum tag, NOT text) — for real-session reports. */
  selectedSource?: string;
}

export interface FillerDivergenceReport {
  engine: string;
  liveFillerCount: number;
  recountFillerCount: number;
  /** recount − live. */
  delta: number;
  match: boolean;
  clarityLive: number;
  clarityRecount: number;
  clarityDelta: number;
  scoreLive: number;
  scoreRecount: number;
  scoreDelta: number;
  usedCustomWords: boolean;
  category: DivergenceCategory;
  /** Save-candidate source enum (e.g. 'service_result', 'committed_final') — NOT transcript text. */
  selectedSource?: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Deep-copy filler counts (each value is a flat { count, color }) so a snapshot captured at stop-entry
 * cannot drift if the store later mutates/replaces `fillerData` in place. No transcript text involved.
 */
export function cloneFillerCounts(data: FillerCounts | null | undefined): FillerCounts | null | undefined {
  if (!data) return data;
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { ...v }])) as FillerCounts;
}

/** Measure live-filler vs transcript-recount divergence and its clarity/score impact. Numbers only. */
export function measureFillerDivergence(inputs: FillerDivergenceInputs): FillerDivergenceReport {
  const userWords = inputs.userWords ?? [];
  const engine = inputs.engine ?? 'unknown';

  // LIVE path — clarity/score fed by the live counter (getFillerTotal(fillerData)).
  const live = calculateCoreSessionMetrics({
    transcript: inputs.transcript,
    durationSeconds: inputs.elapsedSeconds,
    fillerData: inputs.liveFillerData ?? undefined,
    userWords,
  });
  // RECOUNT path — the deterministic SSOT candidate (fillerData undefined → countFillerWords).
  const recount = calculateCoreSessionMetrics({
    transcript: inputs.transcript,
    durationSeconds: inputs.elapsedSeconds,
    fillerData: undefined,
    userWords,
  });

  const scoreLive = calculateSpeakingScore({
    transcript: inputs.transcript, wordCount: live.wordCount, wpm: live.wpm, clarityScore: live.clarityScore,
    fillerCount: live.fillerCount, elapsedSeconds: inputs.elapsedSeconds, pauseMetrics: inputs.pauseMetrics, engine,
  }).score;
  const scoreRecount = calculateSpeakingScore({
    transcript: inputs.transcript, wordCount: recount.wordCount, wpm: recount.wpm, clarityScore: recount.clarityScore,
    fillerCount: recount.fillerCount, elapsedSeconds: inputs.elapsedSeconds, pauseMetrics: inputs.pauseMetrics, engine,
  }).score;

  return {
    engine,
    liveFillerCount: live.fillerCount,
    recountFillerCount: recount.fillerCount,
    delta: recount.fillerCount - live.fillerCount,
    match: recount.fillerCount === live.fillerCount,
    clarityLive: live.clarityScore,
    clarityRecount: recount.clarityScore,
    clarityDelta: recount.clarityScore - live.clarityScore,
    scoreLive: round2(scoreLive),
    scoreRecount: round2(scoreRecount),
    scoreDelta: round2(scoreRecount - scoreLive),
    usedCustomWords: userWords.length > 0,
    category: inputs.category ?? 'unknown',
    selectedSource: inputs.selectedSource,
  };
}

export interface FillerDivergenceSummary {
  total: number;
  exactMatches: number;
  divergent: number;
  avgDelta: number;      // mean signed delta (recount − live)
  avgAbsDelta: number;   // mean magnitude
  maxAbsDelta: number;
  maxAbsClarityDelta: number;
  maxAbsScoreDelta: number;
  byCategory: Record<DivergenceCategory, number>;
}

/** Aggregate a set of per-session/fixture reports into a numbers-only summary. */
export function summarizeFillerDivergence(reports: FillerDivergenceReport[]): FillerDivergenceSummary {
  const byCategory: Record<DivergenceCategory, number> = {
    'match': 0, 'private-finalize-replacement': 0, 'cloud-partial-overlap': 0, 'live-counter-drift': 0, 'unknown': 0,
  };
  let sumDelta = 0, sumAbs = 0, maxAbs = 0, maxClarity = 0, maxScore = 0, divergent = 0;
  for (const r of reports) {
    byCategory[r.category] += 1;
    sumDelta += r.delta;
    sumAbs += Math.abs(r.delta);
    maxAbs = Math.max(maxAbs, Math.abs(r.delta));
    maxClarity = Math.max(maxClarity, Math.abs(r.clarityDelta));
    maxScore = Math.max(maxScore, Math.abs(r.scoreDelta));
    if (!r.match) divergent += 1;
  }
  const n = reports.length || 1;
  return {
    total: reports.length,
    exactMatches: reports.length - divergent,
    divergent,
    avgDelta: round2(sumDelta / n),
    avgAbsDelta: round2(sumAbs / n),
    maxAbsDelta: maxAbs,
    maxAbsClarityDelta: maxClarity,
    maxAbsScoreDelta: round2(maxScore),
    byCategory,
  };
}

// ---------------------------------------------------------------------------
// Phase 5.8 Step 1 — sanitized artifact for the owner known-script take.
// Numbers-only + allowlisted labels. NO transcript text, NO raw custom-word text.
// ---------------------------------------------------------------------------

/** Allowlisted static filler labels (the FillerCounts keys produced by countFillerWords). */
const STATIC_FILLER_LABELS: ReadonlySet<string> = new Set<string>(Object.values(FILLER_WORD_KEYS));

/**
 * Reduce filler DETAIL rows to numbers-only, allowlisted labels:
 * - static filler labels (um/uh/so/…) pass through by their allowlisted key;
 * - RAW custom words are anonymized to custom_1, custom_2, … in userWords order (no user text leaks);
 * - 'total' is dropped (aggregate); any unexpected key buckets to 'custom_other' (defensive).
 */
export function sanitizeFillerDetail(
  data: FillerCounts | null | undefined,
  userWords: string[] = [],
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!data) return out;
  const customMap = new Map<string, string>();
  userWords.forEach((w, i) => customMap.set(String(w).toLowerCase(), `custom_${i + 1}`));
  for (const [key, val] of Object.entries(data)) {
    if (key === 'total') continue;
    const count = val?.count ?? 0;
    if (count <= 0) continue;
    if (STATIC_FILLER_LABELS.has(key)) {
      out[key] = (out[key] ?? 0) + count;
    } else if (customMap.has(key.toLowerCase())) {
      const label = customMap.get(key.toLowerCase())!;
      out[label] = (out[label] ?? 0) + count;
    } else {
      out['custom_other'] = (out['custom_other'] ?? 0) + count;
    }
  }
  return out;
}

/** Numbers-only artifact for the known-script owner take. No transcript/partial text; custom words anonymized. */
export interface SanitizedFillerArtifact {
  engine: string;
  selectedSource?: string;
  liveFillerCount: number;
  recountFillerCount: number;
  delta: number;
  clarityLive: number;
  clarityRecount: number;
  clarityDelta: number;
  scoreLive: number;
  scoreRecount: number;
  scoreDelta: number;
  usedCustomWords: boolean;
  liveDetail: Record<string, number>;
  recountDetail: Record<string, number>;
}

/** Build the sanitized artifact from a divergence report + the live/recount detail data. Numbers-only. */
export function buildSanitizedFillerArtifact(params: {
  report: FillerDivergenceReport;
  liveFillerData: FillerCounts | null | undefined;
  recountFillerData: FillerCounts | null | undefined;
  userWords?: string[];
}): SanitizedFillerArtifact {
  const { report, liveFillerData, recountFillerData, userWords = [] } = params;
  return {
    engine: report.engine,
    selectedSource: report.selectedSource,
    liveFillerCount: report.liveFillerCount,
    recountFillerCount: report.recountFillerCount,
    delta: report.delta,
    clarityLive: report.clarityLive,
    clarityRecount: report.clarityRecount,
    clarityDelta: report.clarityDelta,
    scoreLive: report.scoreLive,
    scoreRecount: report.scoreRecount,
    scoreDelta: report.scoreDelta,
    usedCustomWords: report.usedCustomWords,
    liveDetail: sanitizeFillerDetail(liveFillerData, userWords),
    recountDetail: sanitizeFillerDetail(recountFillerData, userWords),
  };
}
