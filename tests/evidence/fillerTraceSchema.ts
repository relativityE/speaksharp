/**
 * #1324 filler-accuracy trace schema (evidence-only; no product code).
 *
 * Scores ONE controlled replay of a pinned audio fixture through the REAL Private browser worker and
 * the application filler pipeline, and records the whole stage chain so a failing run names its own
 * remediation rung (ladder A–F in #1324) instead of requiring a guess.
 *
 * Scope discipline:
 *  - Authoritative evidence comes from the DEPLOYED exact candidate; local runs are harness preflight
 *    only. `route.evidenceClass` records which, so a preflight row can never be read as acceptance.
 *  - Fillers are counted by the app as regex/word-match over Whisper TEXT (interim + final), with the
 *    max observed interim count preserved per key (useFillerWords). Therefore the trace MUST capture
 *    interim hypotheses: a filler present ONLY in an interim is legitimately counted, and final-only
 *    evidence cannot decide recall.
 *  - Token probabilities are OPTIONAL follow-up instrumentation (the worker does not expose them
 *    today); their absence must never block or invalidate a run.
 *  - Privacy: only pinned, consented, content-free fixtures. Never customer audio/transcripts.
 */

import { wordErrorRate, type WerResult } from './werMetric';
import { fillerPrf, type PrfResult } from './qualityMetrics';

export const FILLER_TRACE_VERSION = 'filler_trace_v1';

/**
 * Frozen sample floor: 30 independent, naturally occurring audible true fillers across the consented
 * content-free set. Replays measure determinism and do NOT increase the independent acoustic sample.
 */
export const MIN_ANNOTATED_HUMAN_FILLERS = 30;

/** Deployed qualification thresholds (a failing value is never relabeled as a baseline). */
export const QUALIFICATION_THRESHOLDS = {
  maxFinalWer: 0.5,      // every run: final WER < 0.500
  minFillerRecall: 0.8,  // aggregate canonical filler recall >= 0.80
  minFillerPrecision: 0.9, // aggregate canonical filler precision >= 0.90
} as const;

/** Where the measurement ran. Only `deployed` may satisfy #1324 acceptance. */
export type EvidenceClass = 'deployed-authoritative' | 'local-preflight';

/** Which stage of the chain a failure is attributable to → selects the remediation rung. */
export type FailureBoundary =
  | 'none'
  | 'pcm-capture'          // A: audio absent/clipped/trimmed before decode
  | 'interim-evidence-lost' // B: emitted interim filler lost by debounce/state/snapshot/persistence
  | 'display-or-save'      // C: canonical snapshot correct, UI/persisted value differs
  | 'recognition'          // D/E: PCM correct but no filler token in ANY interim or final hypothesis
  | 'unmeasurable';        // F: no reliable measurement → must fail closed (never a false "0 fillers")

export interface FixtureProvenance {
  fixtureId: string;
  /** SHA-256 of the exact PCM16/16k mono bytes replayed. */
  audioSha256: string;
  referenceTranscript: string;
  /** Annotated true fillers expected in the reference (position-tagged where known). */
  expectedFillers: readonly string[];
  /** True when the clip is purpose-recorded, consented, non-customer human speech. */
  consentedHuman: boolean;
  /** Natural hesitation vs a scripted reading of "um" — scripted readings cannot satisfy acceptance. */
  naturalHesitation: boolean;
}

export interface RouteProvenance {
  evidenceClass: EvidenceClass;
  /** Build SHA actually under test (deployed release SHA for authoritative runs). */
  releaseSha: string;
  browser: string;
  os: string;
  modelName: string;
  modelRevision: string;
  /** Zero Cloud/Native provider requests observed for the run. */
  zeroRetiredProviderRequests: boolean;
}

/** The observable stage chain, in order. Empty/absent stages are meaningful, so they are explicit. */
export interface StageTrace {
  pcmSha256: string | null;
  pcmSampleCount: number | null;
  pcmDurationSeconds: number | null;
  /** Rolling/interim hypotheses in emission order — REQUIRED to decide recall (see header). */
  interimHypotheses: readonly string[];
  finalHypothesis: string | null;
  /** Observed/combined filler-count transitions from useFillerWords, in order. */
  fillerCountTransitions: ReadonlyArray<Record<string, number>>;
  /** Deep-cloned stop snapshot (liveFillerDataAtStop). */
  stopSnapshot: Record<string, number> | null;
  /** True when the save used the live stop snapshot; false when it fell back to recounting the final. */
  usedLiveSnapshot: boolean | null;
  persistedSnapshot: Record<string, number> | null;
  displayedTotal: number | null;
  displayedChipSum: number | null;
  lifecycleComplete: boolean;
}

export interface FillerTraceRow {
  version: typeof FILLER_TRACE_VERSION;
  fixture: FixtureProvenance;
  route: RouteProvenance;
  /** 1-based replay index; each case runs at least three times. */
  replay: number;
  stages: StageTrace;
  wer: WerResult | null;
  /** Canonical filler P/R/F1 scored against the union of interim+final text the app actually counted. */
  filler: PrfResult | null;
  detectedFillerTotal: number | null;
  fillerCountDelta: number | null;
  /** All downstream values agree (snapshot === finalized === persisted === displayed === chip sum). */
  chainConsistent: boolean;
  failureBoundary: FailureBoundary;
  stopRuleViolations: readonly string[];
}

/** Text the APP counted fillers over: interim hypotheses are counted, so recall must consider them. */
export function countedText(stages: StageTrace): string {
  return [...stages.interimHypotheses, stages.finalHypothesis ?? ''].join(' ').trim();
}

function sumCounts(counts: Record<string, number> | null): number | null {
  if (!counts) return null;
  return Object.values(counts).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

/**
 * Locate the FIRST stage at which the expected filler evidence disappears. This is what selects the
 * remediation rung; it never guesses beyond what the trace shows.
 */
export function classifyFailureBoundary(fixture: FixtureProvenance, stages: StageTrace): FailureBoundary {
  const expected = fixture.expectedFillers.length;

  // No usable audio reached the worker → capture boundary (rung A).
  if (!stages.pcmSha256 || !stages.pcmSampleCount || stages.pcmSampleCount <= 0) return 'pcm-capture';

  // Nothing was recognized at all → cannot attribute; fail closed rather than claim a measured zero.
  if (stages.interimHypotheses.length === 0 && !stages.finalHypothesis) return 'unmeasurable';

  if (expected > 0) {
    // Did the recognizer EVER emit a filler (interim or final)? This is the question final-only
    // evidence cannot answer, and it separates rung D/E from rung B.
    const prf = fillerPrf(fixture.referenceTranscript, countedText(stages));
    const recognizerEmittedFiller = prf.truePositives > 0;
    if (!recognizerEmittedFiller) return 'recognition';

    // Emitted, but the canonical stop snapshot lost it → rung B.
    const snapshotTotal = sumCounts(stages.stopSnapshot) ?? 0;
    if (snapshotTotal <= 0) return 'interim-evidence-lost';
  }

  // Snapshot correct but a downstream consumer disagrees → rung C.
  const snapshotTotal = sumCounts(stages.stopSnapshot);
  const persistedTotal = sumCounts(stages.persistedSnapshot);
  const downstream = [persistedTotal, stages.displayedTotal, stages.displayedChipSum];
  if (snapshotTotal !== null && downstream.some((v) => v !== null && v !== snapshotTotal)) {
    return 'display-or-save';
  }

  return 'none';
}

/** Falsifiable stop rules from #1324. A non-empty result FAILS the run — never relabel as a baseline. */
export function evaluateStopRules(fixture: FixtureProvenance, stages: StageTrace, wer: WerResult | null): string[] {
  const violations: string[] = [];
  const expected = fixture.expectedFillers.length;

  if (wer && wer.wer >= 0.5) violations.push(`final_wer_ge_0.500 (${wer.wer.toFixed(3)})`);

  const prf = expected > 0 ? fillerPrf(fixture.referenceTranscript, countedText(stages)) : null;
  if (expected > 0 && prf && prf.recall === 0) violations.push('zero_filler_recall_with_audible_fillers');

  // A matched no-filler negative must not manufacture a filler.
  if (expected === 0 && (sumCounts(stages.stopSnapshot) ?? 0) > 0) violations.push('false_filler_on_negative');

  const snapshotTotal = sumCounts(stages.stopSnapshot);
  const persistedTotal = sumCounts(stages.persistedSnapshot);
  const mismatch = [persistedTotal, stages.displayedTotal, stages.displayedChipSum]
    .some((v) => snapshotTotal !== null && v !== null && v !== snapshotTotal);
  if (mismatch) violations.push('chain_value_disagreement');

  if (!stages.lifecycleComplete) violations.push('incomplete_stop_finalize_save_review');

  return violations;
}

/** Build one scored, self-classifying trace row. */
export function buildFillerTraceRow(args: {
  fixture: FixtureProvenance;
  route: RouteProvenance;
  replay: number;
  stages: StageTrace;
}): FillerTraceRow {
  const { fixture, route, replay, stages } = args;

  const wer = stages.finalHypothesis
    ? wordErrorRate(fixture.referenceTranscript, stages.finalHypothesis)
    : null;

  const filler = fixture.expectedFillers.length > 0
    ? fillerPrf(fixture.referenceTranscript, countedText(stages))
    : null;

  const detectedFillerTotal = sumCounts(stages.stopSnapshot);
  const snapshotTotal = detectedFillerTotal;
  const persistedTotal = sumCounts(stages.persistedSnapshot);

  const chainConsistent = [persistedTotal, stages.displayedTotal, stages.displayedChipSum]
    .every((v) => snapshotTotal === null || v === null || v === snapshotTotal);

  const stopRuleViolations = evaluateStopRules(fixture, stages, wer);
  if (!route.zeroRetiredProviderRequests) stopRuleViolations.push('retired_provider_request_observed');
  if (!route.releaseSha) stopRuleViolations.push('missing_provenance_release_sha');

  return {
    version: FILLER_TRACE_VERSION,
    fixture,
    route,
    replay,
    stages,
    wer,
    filler,
    detectedFillerTotal,
    fillerCountDelta: detectedFillerTotal === null ? null : detectedFillerTotal - fixture.expectedFillers.length,
    chainConsistent,
    failureBoundary: classifyFailureBoundary(fixture, stages),
    stopRuleViolations,
  };
}

/**
 * Acceptance predicate for a full replay set. Deliberately strict: only deployed-authoritative rows
 * count, every fixture needs >= 3 replays, human fixtures must be consented natural hesitation, and
 * ANY stop-rule violation fails the set.
 */
export function evaluateTraceSet(rows: readonly FillerTraceRow[], opts: { minReplays?: number } = {}): {
  accepted: boolean;
  reasons: string[];
} {
  const minReplays = opts.minReplays ?? 3;
  const reasons: string[] = [];

  const authoritative = rows.filter((r) => r.route.evidenceClass === 'deployed-authoritative');
  if (authoritative.length === 0) reasons.push('no_deployed_authoritative_rows (local preflight cannot accept)');

  const byFixture = new Map<string, FillerTraceRow[]>();
  for (const r of authoritative) {
    const list = byFixture.get(r.fixture.fixtureId) ?? [];
    list.push(r);
    byFixture.set(r.fixture.fixtureId, list);
  }
  for (const [id, list] of byFixture) {
    if (list.length < minReplays) reasons.push(`fixture_${id}_replays_${list.length}_lt_${minReplays}`);
  }

  const humanRows = authoritative.filter((r) => r.fixture.consentedHuman);
  if (humanRows.length === 0) reasons.push('no_consented_human_fixture');
  if (humanRows.some((r) => !r.fixture.naturalHesitation)) reasons.push('scripted_um_reading_not_acceptable');

  const totalAnnotatedFillers = new Set(humanRows.map((r) => r.fixture.fixtureId)).size > 0
    ? [...new Set(humanRows.map((r) => r.fixture.fixtureId))]
        .reduce((sum, id) => sum + (humanRows.find((r) => r.fixture.fixtureId === id)?.fixture.expectedFillers.length ?? 0), 0)
    : 0;
  if (totalAnnotatedFillers < MIN_ANNOTATED_HUMAN_FILLERS) {
    reasons.push(`annotated_human_fillers_${totalAnnotatedFillers}_lt_${MIN_ANNOTATED_HUMAN_FILLERS}`);
  }

  if (!humanRows.some((r) => r.fixture.expectedFillers.length === 0)
      && !authoritative.some((r) => r.fixture.expectedFillers.length === 0)) {
    reasons.push('missing_matched_no_filler_negative');
  }

  for (const r of authoritative) {
    if (r.stopRuleViolations.length > 0) {
      reasons.push(`stop_rule:${r.fixture.fixtureId}#${r.replay}:${r.stopRuleViolations.join('|')}`);
    }
  }

  // Aggregate quality floor across the authoritative positive rows.
  const positives = authoritative.filter((r) => r.fixture.expectedFillers.length > 0 && r.filler);
  if (positives.length > 0) {
    const tp = positives.reduce((s, r) => s + (r.filler?.truePositives ?? 0), 0);
    const fp = positives.reduce((s, r) => s + (r.filler?.falsePositives ?? 0), 0);
    const fn = positives.reduce((s, r) => s + (r.filler?.falseNegatives ?? 0), 0);
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    if (recall < QUALIFICATION_THRESHOLDS.minFillerRecall) {
      reasons.push(`aggregate_recall_${recall.toFixed(3)}_lt_${QUALIFICATION_THRESHOLDS.minFillerRecall}`);
    }
    if (precision < QUALIFICATION_THRESHOLDS.minFillerPrecision) {
      reasons.push(`aggregate_precision_${precision.toFixed(3)}_lt_${QUALIFICATION_THRESHOLDS.minFillerPrecision}`);
    }
    // Every positive clip must have nonzero recall (a single silent clip cannot hide in an average).
    for (const r of positives) {
      if ((r.filler?.recall ?? 0) <= 0) {
        reasons.push(`zero_recall_positive_clip:${r.fixture.fixtureId}#${r.replay}`);
      }
    }
  }

  return { accepted: reasons.length === 0, reasons };
}
