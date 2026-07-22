/**
 * Phase 2 SANDBOX static, in-memory fixtures. No DB, no network, no MSW — read directly by the page.
 *
 * The target values (fillers ≤ 2/min, pace 130–150 WPM) are CLEARLY-LABELED, EDITABLE illustrations
 * for the sandbox only. They are NOT presented as universal, scientifically-validated, or permanent
 * defaults; the product contract requires user-selected or clearly-labeled editable recommendations.
 */

import type { RehearsalBrief } from '@/services/rehearsal/rehearsalBrief';
import type { TranscriptSegment } from '@/services/rehearsal/outcomeScorecard';
import type { TargetShape } from './progressMath';

export type FixtureId =
  | 'baseline-established'
  | 'improved'
  | 'regression'
  | 'target-maintained'
  | 'incompatible'
  | 'partial-agenda'
  | 'recovered-agenda'
  | 'insufficient-confidence';

export interface DeliveryMetricFixture {
  key: string;
  label: string;
  unit: string;
  /** The target shape (defensible per-metric distance). Absent ⇒ not eligible for a % (raw only). */
  target?: TargetShape;
  /** A short, honest label that the target is a recommendation the user can edit. */
  targetNote?: string;
  eligibleForPercentage: boolean;
  ineligibleReason?: string;
  /** Fixed personal baseline value (does not move across sessions). */
  fixedBaseline: number;
  /** Previous comparable session value (absent for first session / no comparison). */
  previous?: number;
  current: number;
}

export interface ComparisonMeta {
  baselineSessionName: string;
  baselineDate: string;
  previousSessionName?: string;
  previousDate?: string;
  currentSessionName: string;
  currentDate: string;
  /** First eligible session under this target version ⇒ show "baseline established", no %. */
  isFirstSession: boolean;
  /** Whether the previous session is comparable (same engine/mode/purpose/quality). */
  comparable: boolean;
  /** Present when comparable === false. */
  exclusionReason?: string;
  /** Transcript confidence / quantity adequate for a comparison. */
  confidenceOk: boolean;
  /** Present when confidenceOk === false. */
  lowConfidenceReason?: string;
}

export interface GeneralFixture {
  mode: 'general';
  id: FixtureId;
  label: string;
  blurb: string;
  metrics: DeliveryMetricFixture[];
  comparison: ComparisonMeta;
  /** The single recommended next focus (metric key), or null. */
  nextFocusKey: string | null;
}

export interface RehearsalFixture {
  mode: 'rehearsal';
  id: FixtureId;
  label: string;
  blurb: string;
  brief: RehearsalBrief;
  /** Segments captured during the rehearsal (first pass). */
  segments: TranscriptSegment[];
  /** Optional post-guidance supplement (drives the "recovered after guidance" state). */
  supplement?: {
    /** Index into brief.talkingPoints that the user requested help on. */
    remedyPointIndex: number;
    segment: TranscriptSegment;
  };
  /** When true, the transcript confidence is too low to attribute coverage. */
  lowConfidence?: boolean;
  lowConfidenceReason?: string;
}

export type Fixture = GeneralFixture | RehearsalFixture;

const FILLER_TARGET: TargetShape = { kind: 'lowerThreshold', threshold: 2 };
const PACE_TARGET: TargetShape = { kind: 'range', lo: 130, hi: 150 };
const TARGET_NOTE = 'Recommended illustration — editable, not a universal standard';

// ---- General Practice fixtures ------------------------------------------------------------------

const baselineEstablished: GeneralFixture = {
  mode: 'general',
  id: 'baseline-established',
  label: '1 · Baseline established (first session)',
  blurb: 'First eligible session — this becomes your personal baseline (0% progress from baseline, not a grade).',
  metrics: [
    { key: 'fillers', label: 'Filler rate', unit: '/min', target: FILLER_TARGET, targetNote: TARGET_NOTE, eligibleForPercentage: true, fixedBaseline: 7.4, current: 7.4 },
    { key: 'pace', label: 'Speaking pace', unit: ' WPM', target: PACE_TARGET, targetNote: TARGET_NOTE, eligibleForPercentage: true, fixedBaseline: 182, current: 182 },
    { key: 'clarity', label: 'Clarity signal', unit: '', eligibleForPercentage: false, ineligibleReason: 'Not eligible for target progress — clarity measurement validity + target meaning not yet proven.', fixedBaseline: 61, current: 61 },
  ],
  comparison: {
    baselineSessionName: 'Today', baselineDate: 'this session',
    currentSessionName: 'Today', currentDate: 'this session',
    isFirstSession: true, comparable: true, confidenceOk: true,
  },
  nextFocusKey: 'fillers',
};

const improved: GeneralFixture = {
  mode: 'general',
  id: 'improved',
  label: '2 · Improved vs previous comparable',
  blurb: 'A second comparable session that improved — cumulative progress vs the FIXED baseline plus movement since the previous session.',
  metrics: [
    { key: 'fillers', label: 'Filler rate', unit: '/min', target: FILLER_TARGET, targetNote: TARGET_NOTE, eligibleForPercentage: true, fixedBaseline: 8, previous: 6, current: 5 },
    { key: 'pace', label: 'Speaking pace', unit: ' WPM', target: PACE_TARGET, targetNote: TARGET_NOTE, eligibleForPercentage: true, fixedBaseline: 180, previous: 168, current: 165 },
    { key: 'clarity', label: 'Clarity signal', unit: '', eligibleForPercentage: false, ineligibleReason: 'Not eligible for target progress — raw direction only until clarity validity + target are proven.', fixedBaseline: 62, previous: 68, current: 71 },
  ],
  comparison: {
    baselineSessionName: 'Mon practice', baselineDate: 'Mon',
    previousSessionName: 'Wed practice', previousDate: 'Wed',
    currentSessionName: 'Today', currentDate: 'Today',
    isFirstSession: false, comparable: true, confidenceOk: true,
  },
  nextFocusKey: 'pace',
};

const regression: GeneralFixture = {
  mode: 'general',
  id: 'regression',
  label: '3 · Regression (moved away from target)',
  blurb: 'A session that moved away from the target — shown as raw direction with constructive language, never a shaming grade.',
  metrics: [
    { key: 'fillers', label: 'Filler rate', unit: '/min', target: FILLER_TARGET, targetNote: TARGET_NOTE, eligibleForPercentage: true, fixedBaseline: 6, previous: 5, current: 7 },
    { key: 'pace', label: 'Speaking pace', unit: ' WPM', target: PACE_TARGET, targetNote: TARGET_NOTE, eligibleForPercentage: true, fixedBaseline: 175, previous: 152, current: 149 },
    { key: 'clarity', label: 'Clarity signal', unit: '', eligibleForPercentage: false, ineligibleReason: 'Not eligible for target progress — raw direction only.', fixedBaseline: 70, previous: 72, current: 66 },
  ],
  comparison: {
    baselineSessionName: 'Mon practice', baselineDate: 'Mon',
    previousSessionName: 'Wed practice', previousDate: 'Wed',
    currentSessionName: 'Today', currentDate: 'Today',
    isFirstSession: false, comparable: true, confidenceOk: true,
  },
  nextFocusKey: 'fillers',
};

const targetMaintained: GeneralFixture = {
  mode: 'general',
  id: 'target-maintained',
  label: '4 · Target maintained (already at target)',
  blurb: 'The baseline was already at target — show "Target maintained", never a divide-by-zero or 0%.',
  metrics: [
    { key: 'fillers', label: 'Filler rate', unit: '/min', target: FILLER_TARGET, targetNote: TARGET_NOTE, eligibleForPercentage: true, fixedBaseline: 1.5, previous: 1.6, current: 1.4 },
    { key: 'pace', label: 'Speaking pace', unit: ' WPM', target: PACE_TARGET, targetNote: TARGET_NOTE, eligibleForPercentage: true, fixedBaseline: 142, previous: 145, current: 138 },
  ],
  comparison: {
    baselineSessionName: 'Mon practice', baselineDate: 'Mon',
    previousSessionName: 'Wed practice', previousDate: 'Wed',
    currentSessionName: 'Today', currentDate: 'Today',
    isFirstSession: false, comparable: true, confidenceOk: true,
  },
  nextFocusKey: null,
};

const incompatible: GeneralFixture = {
  mode: 'general',
  id: 'incompatible',
  label: '5 · Incompatible session (no comparison)',
  blurb: 'The previous session used a different transcription engine/mode — excluded from comparison, with the reason shown. No percentage.',
  metrics: [
    { key: 'fillers', label: 'Filler rate', unit: '/min', target: FILLER_TARGET, targetNote: TARGET_NOTE, eligibleForPercentage: true, fixedBaseline: 5.2, current: 4.6 },
    { key: 'pace', label: 'Speaking pace', unit: ' WPM', target: PACE_TARGET, targetNote: TARGET_NOTE, eligibleForPercentage: true, fixedBaseline: 176, current: 170 },
  ],
  comparison: {
    baselineSessionName: 'Today (Private)', baselineDate: 'Today',
    previousSessionName: 'Fri practice (Browser)', previousDate: 'Fri',
    currentSessionName: 'Today (Private)', currentDate: 'Today',
    isFirstSession: false, comparable: false,
    exclusionReason: 'Previous session used Browser transcription; Browser and Private measurements are not comparable without proven normalization.',
    confidenceOk: true,
  },
  nextFocusKey: 'fillers',
};

const insufficientConfidence: GeneralFixture = {
  mode: 'general',
  id: 'insufficient-confidence',
  label: '8 · Insufficient transcript confidence',
  blurb: 'Transcript confidence / quantity is below the reliability threshold — show "Not enough comparable evidence", no percentage.',
  metrics: [
    { key: 'fillers', label: 'Filler rate', unit: '/min', target: FILLER_TARGET, targetNote: TARGET_NOTE, eligibleForPercentage: true, fixedBaseline: 6, previous: 6, current: 5 },
    { key: 'pace', label: 'Speaking pace', unit: ' WPM', target: PACE_TARGET, targetNote: TARGET_NOTE, eligibleForPercentage: true, fixedBaseline: 180, previous: 175, current: 172 },
  ],
  comparison: {
    baselineSessionName: 'Mon practice', baselineDate: 'Mon',
    previousSessionName: 'Today', previousDate: 'Today',
    currentSessionName: 'Today', currentDate: 'Today',
    isFirstSession: false, comparable: true,
    confidenceOk: false,
    lowConfidenceReason: 'Only ~14s of speech captured with low transcript confidence — too little to attribute a reliable comparison.',
  },
  nextFocusKey: null,
};

// ---- Executive Rehearsal fixtures ---------------------------------------------------------------

const REHEARSAL_BRIEF: RehearsalBrief = {
  audience: 'Executive leadership team',
  objective: 'Get the Q3 plan and hiring approved',
  desiredDecision: 'Approve two additional engineering hires and the billing migration timeline',
  talkingPoints: [
    'Present our revenue growth of eighteen percent this quarter',
    'Explain the customer retention risk in the enterprise segment',
    'Request approval for two additional engineering hires',
    'Outline the migration timeline for the new billing system',
  ],
};

const partialAgenda: RehearsalFixture = {
  mode: 'rehearsal',
  id: 'partial-agenda',
  label: '6 · Executive Rehearsal — partly covered agenda',
  blurb: 'Optional agenda, tracked passively. Coverage is evidence-backed (covered / partly / not addressed) and kept separate from delivery progress.',
  brief: REHEARSAL_BRIEF,
  segments: [
    { text: 'I will present our revenue growth of eighteen percent this quarter', startSec: 6 },
    { text: 'There is a retention risk in our enterprise segment we should watch', startSec: 48 },
    { text: 'We also need to talk about hiring at some point soon', startSec: 96 },
    // No segment addresses the billing-migration timeline → that point is "not addressed".
  ],
};

const recoveredAgenda: RehearsalFixture = {
  mode: 'rehearsal',
  id: 'recovered-agenda',
  label: '7 · Executive Rehearsal — recovered after guidance',
  blurb: 'A point was not addressed; the user requested help and added a supplement. Only with attributable post-guidance evidence is it marked "recovered".',
  brief: {
    audience: 'Executive leadership team',
    objective: 'Get the hiring approved',
    desiredDecision: 'Approve two additional engineering hires',
    talkingPoints: [
      'Present our revenue growth of eighteen percent this quarter',
      'Explain the customer retention risk in the enterprise segment',
      'Request approval for two additional engineering hires',
    ],
  },
  segments: [
    { text: 'I will present our revenue growth of eighteen percent this quarter', startSec: 6 },
    { text: 'There is a customer retention risk in our enterprise segment to address', startSec: 44 },
    // Point 3 (approval for two additional engineering hires) is NOT addressed in the first pass.
  ],
  supplement: {
    remedyPointIndex: 2,
    segment: { text: 'To be clear, I am requesting approval for two additional engineering hires', startSec: 120 },
  },
};

export const FIXTURES: Fixture[] = [
  baselineEstablished,
  improved,
  regression,
  targetMaintained,
  incompatible,
  partialAgenda,
  recoveredAgenda,
  insufficientConfidence,
];

export function getFixture(id: FixtureId): Fixture {
  return FIXTURES.find((f) => f.id === id) ?? FIXTURES[0];
}
