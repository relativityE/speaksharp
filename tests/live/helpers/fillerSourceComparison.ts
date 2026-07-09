/**
 * Filler-source comparison — pure, numbers-only analysis for the source-comparison gate.
 *
 * NO source of truth is pre-decided. This compares the two candidates from ONE finalized take —
 * Candidate A (live counter) and Candidate B (transcript recount) — against owner/QA-declared ground
 * truth, and emits a numbers/enum-only row for the evidence table. It renders no verdict; it produces
 * the facts + a per-row HINT so the Reviewer decides live-vs-recount (see FILLER_KNOWN_SCRIPT_RUNBOOK).
 *
 * Input is the sanitized `fillerDivergence` artifact the controller caches at finalization (numbers +
 * anonymized detail labels only — no transcript text, no raw custom words), plus the declared ground
 * truth and an optional card-row coherence flag. Kept dependency-free so it unit-tests in the vitest
 * shards AND runs inside the Playwright live spec.
 */

export interface FillerDetail { [label: string]: number }

/** The sanitized numbers-only artifact from `window.__SPEECH_RUNTIME_DEBUG__().fillerDivergence`. */
export interface FillerDivergenceArtifact {
  engine: string;
  selectedSource?: string;
  liveFillerCount: number;
  recountFillerCount: number;
  delta: number; // recount − live (as recorded in the artifact)
  clarityLive: number; clarityRecount: number; clarityDelta: number;
  scoreLive: number; scoreRecount: number; scoreDelta: number;
  usedCustomWords: boolean;
  liveDetail: FillerDetail;
  recountDetail: FillerDetail;
}

/**
 * Declared ground-truth per-word distributions for the known scripts (FILLER_KNOWN_SCRIPT_RUNBOOK).
 * Labels match the sanitized detail keys (FILLER_WORD_KEYS + anonymized custom_N). Script 3 = no fillers.
 */
export const KNOWN_SCRIPT_EXPECTED_DETAIL: Record<string, FillerDetail> = {
  '1': { um: 3, so: 2, like: 2, uh: 1, basically: 1 },
  '2': { custom_1: 3 },
  '3': {},
};

export interface ComparisonInput {
  artifact: FillerDivergenceArtifact;
  /** Owner/QA-declared count of fillers actually spoken in the fixture. */
  groundTruth: number;
  /** Script id (1|2|3) — annotation, and selects the expected detail distribution. */
  script: string;
  /** From the live DOM check: do the rendered card rows sum to the headline count? null = not checked. */
  cardRowCountCoherent?: boolean | null;
}

export type CloserSource = 'live' | 'recount' | 'tie';

/** Per-row hint (NOT a decision) encoding the runbook pass-criteria. Reviewer makes the call. */
export type DecisionHint =
  | 'live-primary'          // live is closest to ground truth
  | 'recount-candidate'     // recount is closest AND does not under-report real fillers
  | 'recount-under-reports' // recount < ground truth → recount would erase real fillers; STOP/re-scope
  | 'inconclusive';

export interface ComparisonRow {
  engine: string;
  script: string;
  groundTruth: number;
  liveCount: number;
  recountCount: number;
  liveDelta: number;    // liveCount − groundTruth
  recountDelta: number; // recountCount − groundTruth
  liveDetailCoherent: boolean;    // Σ(liveDetail) === liveCount
  recountDetailCoherent: boolean; // Σ(recountDetail) === recountCount
  /** Does the source's per-word detail match the KNOWN_SCRIPT_EXPECTED_DETAIL? null = unknown script. */
  liveDetailMatchesExpected: boolean | null;
  recountDetailMatchesExpected: boolean | null;
  cardRowCountCoherent: boolean | null;
  closerSource: CloserSource;
  recountUnderReports: boolean; // recountCount < groundTruth
  liveOverReports: boolean;     // liveCount > groundTruth
  hint: DecisionHint;
}

function nonZero(detail: FillerDetail): FillerDetail {
  const out: FillerDetail = {};
  for (const [k, v] of Object.entries(detail ?? {})) if (Number.isFinite(v) && v !== 0) out[k] = v;
  return out;
}

function sumDetail(detail: FillerDetail): number {
  return Object.values(detail ?? {}).reduce<number>((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
}

/** Exact per-word match: same non-zero labels with same counts (order-independent). */
export function detailMatchesExpected(detail: FillerDetail, expected: FillerDetail): boolean {
  const d = nonZero(detail);
  const e = nonZero(expected);
  const keys = new Set([...Object.keys(d), ...Object.keys(e)]);
  for (const k of keys) if ((d[k] ?? 0) !== (e[k] ?? 0)) return false;
  return true;
}

function hintFor(row: Omit<ComparisonRow, 'hint'>): DecisionHint {
  // Recount erasing real fillers is the disqualifying failure mode — flag it before anything else.
  if (row.recountUnderReports) return 'recount-under-reports';
  if (row.closerSource === 'live') return 'live-primary';
  if (row.closerSource === 'recount') return 'recount-candidate';
  return 'inconclusive';
}

/** Build one numbers-only comparison row from a finalized take's artifact + declared ground truth. */
export function buildComparisonRow(input: ComparisonInput): ComparisonRow {
  const { artifact, groundTruth, script } = input;
  const liveCount = artifact.liveFillerCount;
  const recountCount = artifact.recountFillerCount;
  const liveDelta = liveCount - groundTruth;
  const recountDelta = recountCount - groundTruth;
  const absLive = Math.abs(liveDelta);
  const absRecount = Math.abs(recountDelta);
  const closerSource: CloserSource = absLive < absRecount ? 'live' : absRecount < absLive ? 'recount' : 'tie';

  const expected = Object.prototype.hasOwnProperty.call(KNOWN_SCRIPT_EXPECTED_DETAIL, script)
    ? KNOWN_SCRIPT_EXPECTED_DETAIL[script]
    : null;

  const base = {
    engine: artifact.engine,
    script,
    groundTruth,
    liveCount,
    recountCount,
    liveDelta,
    recountDelta,
    liveDetailCoherent: sumDetail(artifact.liveDetail) === liveCount,
    recountDetailCoherent: sumDetail(artifact.recountDetail) === recountCount,
    liveDetailMatchesExpected: expected ? detailMatchesExpected(artifact.liveDetail, expected) : null,
    recountDetailMatchesExpected: expected ? detailMatchesExpected(artifact.recountDetail, expected) : null,
    cardRowCountCoherent: input.cardRowCountCoherent ?? null,
    closerSource,
    recountUnderReports: recountCount < groundTruth,
    liveOverReports: liveCount > groundTruth,
  };
  return { ...base, hint: hintFor(base) };
}

/** Aggregate hint across rows (e.g. all modes/scripts). Mode-specific divergence is surfaced, not hidden. */
export function summarizeComparison(rows: ComparisonRow[]): {
  total: number;
  recountUnderReportsAny: boolean;
  liveCloserCount: number;
  recountCloserCount: number;
  tieCount: number;
  cardRowCountIncoherentCount: number;
  liveDetailMatchCount: number;
  recountDetailMatchCount: number;
} {
  return {
    total: rows.length,
    recountUnderReportsAny: rows.some((r) => r.recountUnderReports),
    liveCloserCount: rows.filter((r) => r.closerSource === 'live').length,
    recountCloserCount: rows.filter((r) => r.closerSource === 'recount').length,
    tieCount: rows.filter((r) => r.closerSource === 'tie').length,
    cardRowCountIncoherentCount: rows.filter((r) => r.cardRowCountCoherent === false).length,
    liveDetailMatchCount: rows.filter((r) => r.liveDetailMatchesExpected === true).length,
    recountDetailMatchCount: rows.filter((r) => r.recountDetailMatchesExpected === true).length,
  };
}
