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
 *  - §10 NUMBERS-ONLY: filler precision/recall is computed from ANNOTATED EXPECTED COUNTS versus the
 *    OBSERVED canonical count transitions emitted by `useFillerWords` — never by regex over transcript
 *    text. The app preserves the max observed interim count per key, so a filler present only in an
 *    interim is legitimately counted; the numeric transitions capture that without any hypothesis text.
 *    A controlled whole-utterance `finalHypothesis` is retained for WER/edit-alignment evidence ONLY.
 *  - §9 ZERO IS EVIDENCE: an executed phase emits a canonical zero event, so "ran and observed zero"
 *    stays distinguishable from "never ran".
 *  - §12 IMMUTABLE: captured evidence is deep-frozen so later emissions cannot mutate a stored artifact.
 *  - Token probabilities are OPTIONAL follow-up instrumentation (the worker does not expose them
 *    today); their absence must never block or invalidate a run.
 *  - Privacy: only pinned, consented, content-free fixtures. Never customer audio/transcripts.
 */

import { wordErrorRate, type WerResult } from './werMetric';
import { FILLER_METRIC_VERSION, type PrfResult } from './qualityMetrics';

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

/**
 * Classify a harness target. Shared by `scripts/manual-stt-corpus-proof.mjs` so there is ONE source of
 * truth (and so the boundary is directly testable — the harness itself self-executes on import).
 *
 * Fail-closed rules:
 *  - `local-preflight` requires localhost:5174 + real auth. It can NEVER satisfy deployed acceptance.
 *  - `deployed-authoritative` requires HTTPS, an allowlisted host, a non-empty expected release SHA,
 *    real auth, and (asserted separately at runtime) live `__APP_RELEASE__` equality.
 *  - A target satisfying neither is invalid; localhost can never be relabeled authoritative.
 */
export interface TargetClassificationInput {
  url: string;
  authMode: 'real' | 'mock';
  supabaseConfigured: boolean;
  deployedHostAllowlist: readonly string[];
  expectedReleaseSha: string | null;
  /** Live window.__APP_RELEASE__, when already known. Null when not yet read. */
  liveReleaseSha?: string | null;
}

export interface TargetClassification {
  evidenceClass: EvidenceClass;
  localPreflightEligible: boolean;
  deployedAcceptanceEligible: boolean;
  invalidReasons: string[];
}

export function classifyHarnessTarget(input: TargetClassificationInput): TargetClassification {
  const parsed = new URL(input.url);
  const hostname = parsed.hostname;
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

  const common = [
    ...(input.supabaseConfigured ? [] : ['missing_supabase_config']),
    ...(input.authMode === 'real' ? [] : [`auth_${input.authMode}`]),
  ];

  const local = [
    ...(isLocalhost ? [] : ['not_localhost']),
    ...(port === 5174 ? [] : [`port_${Number.isFinite(port) ? port : 'unknown'}_not_5174`]),
  ];

  const deployed = [
    ...(isLocalhost ? ['localhost_is_not_deployed'] : []),
    ...(parsed.protocol === 'https:' ? [] : ['not_https']),
    ...(input.deployedHostAllowlist.includes(hostname) ? [] : [`host_${hostname}_not_allowlisted`]),
    ...(input.expectedReleaseSha ? [] : ['missing_expected_release_sha']),
    // When the live release is known it must match exactly — a stale bundle never qualifies.
    ...(input.liveReleaseSha !== undefined && input.liveReleaseSha !== input.expectedReleaseSha
      ? ['release_sha_mismatch']
      : []),
  ];

  const localPreflightEligible = common.length === 0 && local.length === 0;
  const deployedAcceptanceEligible = common.length === 0 && deployed.length === 0;

  return {
    evidenceClass: deployedAcceptanceEligible ? 'deployed-authoritative' : 'local-preflight',
    localPreflightEligible,
    deployedAcceptanceEligible,
    invalidReasons: localPreflightEligible || deployedAcceptanceEligible
      ? []
      : [...common, ...(isLocalhost ? local : deployed)],
  };
}

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
  /** Annotated expected custom-word total for the controlled custom case (defaults to 0). */
  expectedCustomTotal?: number;
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

/**
 * One canonical count transition emitted by `useFillerWords`. NUMBERS ONLY — this is the authoritative
 * filler-qualification surface (#1325 §10). No transcript, hypothesis, or token text may appear here.
 */
export const FILLER_COUNT_EVENT_VERSION = 'filler_count_trace_v1';

export interface FillerCountEvent {
  /** REQUIRED and exact — an unversioned or wrong-versioned event is not evidence. */
  version: typeof FILLER_COUNT_EVENT_VERSION;
  seq: number;
  relativeMs: number;
  phase: 'interim_observed' | 'final_observed' | 'combined';
  counts: { um: number; uh: number; ah: number; custom_total: number };
}

/** Canonical per-key filler map. Grand totals must never hide per-category disagreement. */
export interface FillerKeyCounts {
  um: number;
  uh: number;
  ah: number;
  custom_total: number;
}

const VALID_EVENT_PHASES: ReadonlySet<string> = new Set([
  'interim_observed',
  'final_observed',
  'combined',
]);

/** Strict validation: unknown keys, non-integer/negative counts, or ANY string field are rejected. */
export function isValidFillerCountEvent(candidate: unknown): candidate is FillerCountEvent {
  if (!candidate || typeof candidate !== 'object') return false;
  const event = candidate as Record<string, unknown>;

  const allowedTop = ['seq', 'relativeMs', 'phase', 'counts', 'version'];
  for (const key of Object.keys(event)) if (!allowedTop.includes(key)) return false;

  // §10: the version is REQUIRED and must match exactly. An unversioned or wrong-versioned event is
  // not evidence — previously `version` was merely *allowed*, so a stripped version still validated.
  if (event.version !== FILLER_COUNT_EVENT_VERSION) return false;

  if (typeof event.seq !== 'number' || !Number.isInteger(event.seq) || event.seq < 0) return false;
  if (typeof event.relativeMs !== 'number' || event.relativeMs < 0) return false;
  if (typeof event.phase !== 'string' || !VALID_EVENT_PHASES.has(event.phase)) return false;

  const counts = event.counts as Record<string, unknown> | undefined;
  if (!counts || typeof counts !== 'object') return false;
  const allowedCounts = ['um', 'uh', 'ah', 'custom_total'];
  for (const key of Object.keys(counts)) if (!allowedCounts.includes(key)) return false;
  for (const key of allowedCounts) {
    const value = counts[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return false;
  }
  return true;
}

/**
 * The observable stage chain, in order. Empty/absent stages are meaningful, so they are explicit.
 *
 * §10: interim evidence is carried ONLY as numeric count events. The controlled whole-utterance
 * `finalHypothesis` remains for WER/edit-alignment evidence and must never be used to qualify fillers.
 */
export interface StageTrace {
  pcmSha256: string | null;
  pcmSampleCount: number | null;
  pcmDurationSeconds: number | null;
  /** Controlled whole-utterance final hypothesis — WER/edit-alignment ONLY, never filler scoring. */
  finalHypothesis: string | null;
  /** Authoritative filler evidence: ordered numeric count transitions from useFillerWords. */
  fillerCountEvents: readonly FillerCountEvent[];
  /** Deep-cloned stop snapshot (liveFillerDataAtStop). */
  stopSnapshot: Record<string, number> | null;
  /** True when the save used the live stop snapshot; false when it fell back to recounting the final. */
  usedLiveSnapshot: boolean | null;
  /** §10: the finalized map, so the enforced chain is observed/combined → finalized → persisted → displayed. */
  finalizedSnapshot: Record<string, number> | null;
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

/**
 * §10: the MAXIMUM canonical true-filler count the recognizer ever produced, taken from the numeric
 * count transitions. This is the authoritative "was a filler ever counted?" surface — deliberately not
 * derived from transcript text, so a misheard-but-counted (or counted-then-cleaned) filler is scored
 * from what the app actually observed.
 */
export function maxObservedTrueFillers(events: readonly FillerCountEvent[]): number {
  let max = 0;
  for (const event of events) {
    const total = event.counts.um + event.counts.uh + event.counts.ah;
    if (total > max) max = total;
  }
  return max;
}

/** The maximum observed count for a single phase (used to separate interim evidence from final). */
export function maxObservedForPhase(
  events: readonly FillerCountEvent[],
  phase: FillerCountEvent['phase'],
): number {
  return maxObservedTrueFillers(events.filter((event) => event.phase === phase));
}

/**
 * §10: PER-KEY observed maxima. Scoring on grand totals alone lets a category substitution pass —
 * expected {um:1, uh:1} vs observed {um:2, uh:0} both total 2. Per-key scoring catches it.
 */
export function maxObservedByKey(events: readonly FillerCountEvent[]): FillerKeyCounts {
  const out: FillerKeyCounts = { um: 0, uh: 0, ah: 0, custom_total: 0 };
  for (const event of events) {
    for (const key of ['um', 'uh', 'ah', 'custom_total'] as const) {
      if (event.counts[key] > out[key]) out[key] = event.counts[key];
    }
  }
  return out;
}

/** Per-key TP/FP/FN, aggregated. `custom_total` must match EXACTLY (it is an annotated expectation). */
export function scoreFillerByKey(expected: FillerKeyCounts, observed: FillerKeyCounts): {
  prf: PrfResult;
  perKey: Record<keyof FillerKeyCounts, { expected: number; observed: number; exact: boolean }>;
  customTotalExact: boolean;
} {
  const keys = ['um', 'uh', 'ah'] as const;
  let tp = 0; let fp = 0; let fn = 0;
  const perKey = {} as Record<keyof FillerKeyCounts, { expected: number; observed: number; exact: boolean }>;

  for (const key of keys) {
    const e = expected[key];
    const o = observed[key];
    tp += Math.min(e, o);
    fp += Math.max(0, o - e);
    fn += Math.max(0, e - o);
    perKey[key] = { expected: e, observed: o, exact: e === o };
  }
  perKey.custom_total = {
    expected: expected.custom_total,
    observed: observed.custom_total,
    exact: expected.custom_total === observed.custom_total,
  };

  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;

  return {
    prf: {
      version: FILLER_METRIC_VERSION,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      precision,
      recall,
      f1,
      referenceCount: keys.reduce((s, k) => s + expected[k], 0),
      hypothesisCount: keys.reduce((s, k) => s + observed[k], 0),
    },
    perKey,
    customTotalExact: perKey.custom_total.exact,
  };
}

/** Derive per-key expected counts from the annotated filler list (e.g. ['um','uh','um'] -> um:2, uh:1). */
export function expectedCountsFromAnnotation(
  expectedFillers: readonly string[],
  expectedCustomTotal = 0,
): FillerKeyCounts {
  const out: FillerKeyCounts = { um: 0, uh: 0, ah: 0, custom_total: expectedCustomTotal };
  for (const raw of expectedFillers) {
    const key = raw.trim().toLowerCase();
    if (key === 'um' || key === 'uh' || key === 'ah') out[key] += 1;
  }
  return out;
}

/** One member of the downstream chain. `null` means NOT CAPTURED — which is a failure, never ignorable. */
export interface ChainMember { name: string; value: number | null }

/**
 * §11: strict chain equality. Every member must be PRESENT and FINITE, then all must be exactly equal.
 * Missing values are NEVER filtered out — the previous `.filter(v => v != null).every(...)` passed
 * vacuously when zero or one value was captured, which is the defect this replaces. A genuine numeric
 * zero IS valid evidence and must compare normally.
 */
export function evaluateChainStrict(members: readonly ChainMember[]): {
  ok: boolean;
  reasons: string[];
  values: Record<string, number | null>;
} {
  const reasons: string[] = [];
  const values: Record<string, number | null> = {};

  for (const member of members) {
    values[member.name] = member.value;
    if (member.value === null || member.value === undefined) {
      reasons.push(`chain_member_missing:${member.name}`);
    } else if (!Number.isFinite(member.value)) {
      reasons.push(`chain_member_not_finite:${member.name}`);
    }
  }

  if (reasons.length === 0) {
    const first = members[0].value as number;
    for (const member of members) {
      if (member.value !== first) {
        reasons.push(`chain_value_disagreement:${member.name}=${member.value}!=${members[0].name}=${first}`);
      }
    }
  }

  return { ok: reasons.length === 0, reasons, values };
}

/** §10: an executed run must contain these phases; their absence is a failure, not an empty pass. */
export const REQUIRED_PHASES: ReadonlyArray<FillerCountEvent['phase']> = ['final_observed', 'combined'];

/** Validate the whole event stream: schema, ordering, and required executed phases. */
export function validateEventStream(events: readonly unknown[]): string[] {
  const reasons: string[] = [];
  if (events.length === 0) return ['no_count_transitions_captured'];

  const valid: FillerCountEvent[] = [];
  for (const [index, candidate] of events.entries()) {
    if (!isValidFillerCountEvent(candidate)) {
      reasons.push(`invalid_event_at_index_${index}`);
      continue;
    }
    valid.push(candidate);
  }

  for (let i = 1; i < valid.length; i += 1) {
    if (valid[i].seq <= valid[i - 1].seq) reasons.push(`sequence_regression_at_${i}`);
    if (valid[i].relativeMs < valid[i - 1].relativeMs) reasons.push(`time_regression_at_${i}`);
  }

  const phases = new Set(valid.map((event) => event.phase));
  for (const required of REQUIRED_PHASES) {
    if (!phases.has(required)) reasons.push(`missing_required_phase:${required}`);
  }

  return reasons;
}

/**
 * Filler precision/recall computed from ANNOTATED EXPECTED COUNTS versus OBSERVED CANONICAL COUNTS.
 * No regex, no transcript strings. Over-counting is a false positive; under-counting a false negative.
 */
export function scoreFillerCounts(expectedCount: number, observedCount: number): PrfResult {
  const truePositives = Math.min(expectedCount, observedCount);
  const falsePositives = Math.max(0, observedCount - expectedCount);
  const falseNegatives = Math.max(0, expectedCount - observedCount);
  const precision = truePositives + falsePositives > 0
    ? truePositives / (truePositives + falsePositives)
    : null;
  const recall = truePositives + falseNegatives > 0
    ? truePositives / (truePositives + falseNegatives)
    : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;
  return {
    version: FILLER_METRIC_VERSION,
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1,
    referenceCount: expectedCount,
    hypothesisCount: observedCount,
  };
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
  // §9: an EXECUTED phase emits a canonical zero event, so "no events at all" genuinely means the
  // pipeline never ran — distinct from "ran and observed zero".
  if (stages.fillerCountEvents.length === 0 && !stages.finalHypothesis) return 'unmeasurable';

  if (expected > 0) {
    // §10: did the recognizer EVER count a filler? Answered from the numeric transitions, not text.
    // This is what final-only evidence cannot answer, and it separates rung D/E from rung B.
    const everCounted = maxObservedTrueFillers(stages.fillerCountEvents);
    if (everCounted <= 0) return 'recognition';

    // Counted at some phase, but the canonical stop snapshot lost it → rung B.
    const snapshotTotal = sumCounts(stages.stopSnapshot) ?? 0;
    if (snapshotTotal <= 0) return 'interim-evidence-lost';
  }

  // Snapshot correct but a downstream consumer disagrees → rung C.
  const snapshotTotal = sumCounts(stages.stopSnapshot);
  const downstream = [
    sumCounts(stages.finalizedSnapshot),
    sumCounts(stages.persistedSnapshot),
    stages.displayedTotal,
    stages.displayedChipSum,
  ];
  if (snapshotTotal !== null && downstream.some((v) => v !== null && v !== snapshotTotal)) {
    return 'display-or-save';
  }

  return 'none';
}

/** Falsifiable stop rules from #1324. A non-empty result FAILS the run — never relabel as a baseline. */
export function evaluateStopRules(fixture: FixtureProvenance, stages: StageTrace, wer: WerResult | null): string[] {
  const violations: string[] = [];
  const expected = fixture.expectedFillers.length;

  // §11: WER is a STRICT threshold — >= 0.500 fails. Never `<=`.
  // #1304: `wer.wer` is null when the reference was UNMEASURABLE. `null >= x` is false in JS, so the
  // old form happened to behave correctly — but only by accident, and the new evidence typecheck
  // surfaced it. An unmeasurable WER is not a passing WER; it simply cannot violate a threshold.
  if (wer && wer.wer !== null && wer.wer >= QUALIFICATION_THRESHOLDS.maxFinalWer) {
    violations.push(`final_wer_ge_${QUALIFICATION_THRESHOLDS.maxFinalWer} (${wer.wer.toFixed(3)})`);
  }

  // §10: the event stream itself must be schema-valid, ordered, and contain the executed phases.
  violations.push(...validateEventStream(stages.fillerCountEvents));

  // §10: recall is scored PER KEY from observed canonical COUNTS, never transcript regex.
  const expectedByKey = expectedCountsFromAnnotation(fixture.expectedFillers, fixture.expectedCustomTotal ?? 0);
  const observedByKey = maxObservedByKey(stages.fillerCountEvents);
  const scored = scoreFillerByKey(expectedByKey, observedByKey);
  const prf = expected > 0 ? scored.prf : null;
  if (expected > 0 && prf && prf.recall === 0) violations.push('zero_filler_recall_with_audible_fillers');
  // A category substitution with an equal grand total must still fail.
  for (const key of ['um', 'uh', 'ah'] as const) {
    if (!scored.perKey[key].exact) {
      violations.push(`per_key_mismatch:${key} expected=${scored.perKey[key].expected} observed=${scored.perKey[key].observed}`);
    }
  }
  if (!scored.customTotalExact) {
    violations.push(`custom_total_mismatch expected=${expectedByKey.custom_total} observed=${observedByKey.custom_total}`);
  }

  // A matched no-filler negative must not manufacture a filler.
  if (expected === 0 && (sumCounts(stages.stopSnapshot) ?? 0) > 0) violations.push('false_filler_on_negative');

  // §11: STRICT chain — every member must be present and finite, then all exactly equal.
  // Missing members FAIL with a specific reason; they are never filtered away.
  const chain = evaluateChainStrict([
    { name: 'observedCombined', value: maxObservedTrueFillers(stages.fillerCountEvents) },
    { name: 'finalized', value: sumCounts(stages.finalizedSnapshot) },
    { name: 'persisted', value: sumCounts(stages.persistedSnapshot) },
    { name: 'displayedTotal', value: stages.displayedTotal },
    { name: 'displayedChipSum', value: stages.displayedChipSum },
  ]);
  if (!chain.ok) violations.push(...chain.reasons);

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
    // TRACK B: this row scores DISFLUENCY, so fillers must be preserved by the normalization.
    ? wordErrorRate(fixture.referenceTranscript, stages.finalHypothesis, { track: 'track_b' })
    : null;

  const expectedByKey = expectedCountsFromAnnotation(fixture.expectedFillers, fixture.expectedCustomTotal ?? 0);
  const observedByKey = maxObservedByKey(stages.fillerCountEvents);
  const scoredByKey = scoreFillerByKey(expectedByKey, observedByKey);
  const filler = fixture.expectedFillers.length > 0 ? scoredByKey.prf : null;

  const detectedFillerTotal = sumCounts(stages.stopSnapshot);

  // §11: STRICT — present + finite + exactly equal. Missing is failure, never ignorable.
  const chainConsistent = evaluateChainStrict([
    { name: 'observedCombined', value: maxObservedTrueFillers(stages.fillerCountEvents) },
    { name: 'finalized', value: sumCounts(stages.finalizedSnapshot) },
    { name: 'persisted', value: sumCounts(stages.persistedSnapshot) },
    { name: 'displayedTotal', value: stages.displayedTotal },
    { name: 'displayedChipSum', value: stages.displayedChipSum },
  ]).ok;

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
