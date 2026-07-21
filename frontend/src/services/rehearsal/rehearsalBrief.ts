/**
 * Executive Outcome Rehearsal — pre-session Rehearsal Brief model + validation.
 *
 * Pure data + validation logic. No I/O, no persistence, no telemetry. The brief captures the
 * user's intent for a high-stakes speaking rehearsal so the post-session scorecard can assess
 * whether each required point was covered.
 *
 * Privacy: the brief contains free text (audience, objective, decision/ask, talking points). It
 * MUST NOT be logged to telemetry (the PostHog scrubber does not cover these keys) and MUST NOT be
 * sent to any cloud service without explicit user consent. This module never transmits it.
 */

export const TALKING_POINTS_MIN = 3;
export const TALKING_POINTS_MAX = 7;
export const AUDIENCE_MAX = 200;
export const OBJECTIVE_MAX = 300;
export const DECISION_MAX = 300;
export const TALKING_POINT_MAX = 200;
/** Guard rails for the optional target duration (seconds): 30s .. 60min. */
export const TARGET_DURATION_MIN_SEC = 30;
export const TARGET_DURATION_MAX_SEC = 60 * 60;

export interface RehearsalBrief {
  /** Who the user is presenting to. */
  audience: string;
  /** What the user wants to achieve. */
  objective: string;
  /** The explicit decision the user is seeking, or the ask they will make. */
  desiredDecision: string;
  /** 3–7 required talking points the scorecard will check for coverage. */
  talkingPoints: string[];
  /** Optional target duration in seconds. */
  targetDurationSec?: number;
}

export interface BriefFieldError {
  field: keyof RehearsalBrief;
  /** Machine-readable reason; the UI maps this to a visible, screen-reader-friendly message. */
  code:
    | 'required'
    | 'too_long'
    | 'too_few_talking_points'
    | 'too_many_talking_points'
    | 'duration_out_of_range'
    | 'duration_not_a_number';
  /** Human-readable default message (UI may override for i18n/labelling). */
  message: string;
}

export interface BriefValidationResult {
  ok: boolean;
  errors: BriefFieldError[];
  /** A normalized brief (trimmed strings, trimmed non-empty talking points) when `ok`. */
  value?: RehearsalBrief;
}

const isBlank = (s: unknown): boolean => typeof s !== 'string' || s.trim().length === 0;

/**
 * Validate raw brief input. Returns structured field errors (never throws). Talking-point
 * min/max rules are explicit so the UI can explain them. Duration is optional but, if present,
 * must be a finite number within range.
 */
export function validateRehearsalBrief(input: Partial<RehearsalBrief> | null | undefined): BriefValidationResult {
  const errors: BriefFieldError[] = [];
  const i = input ?? {};

  if (isBlank(i.audience)) {
    errors.push({ field: 'audience', code: 'required', message: 'Audience is required.' });
  } else if ((i.audience as string).trim().length > AUDIENCE_MAX) {
    errors.push({ field: 'audience', code: 'too_long', message: `Audience must be ${AUDIENCE_MAX} characters or fewer.` });
  }

  if (isBlank(i.objective)) {
    errors.push({ field: 'objective', code: 'required', message: 'Objective is required.' });
  } else if ((i.objective as string).trim().length > OBJECTIVE_MAX) {
    errors.push({ field: 'objective', code: 'too_long', message: `Objective must be ${OBJECTIVE_MAX} characters or fewer.` });
  }

  if (isBlank(i.desiredDecision)) {
    errors.push({ field: 'desiredDecision', code: 'required', message: 'A desired decision or explicit ask is required.' });
  } else if ((i.desiredDecision as string).trim().length > DECISION_MAX) {
    errors.push({ field: 'desiredDecision', code: 'too_long', message: `Decision/ask must be ${DECISION_MAX} characters or fewer.` });
  }

  // Declared blank-talking-point behavior: blank/whitespace-only entries are trimmed out and NOT
  // counted; the effective count is the non-empty points. If dropping blanks leaves fewer than the
  // minimum, the too-few-talking-points error fires below. (No separate "blank" error code — blanks
  // are simply not points.)
  const rawPoints = Array.isArray(i.talkingPoints) ? i.talkingPoints : [];
  const trimmedPoints = rawPoints.map((p) => (typeof p === 'string' ? p.trim() : ''));
  const nonEmptyPoints = trimmedPoints.filter((p) => p.length > 0);
  if (nonEmptyPoints.length < TALKING_POINTS_MIN) {
    errors.push({
      field: 'talkingPoints',
      code: 'too_few_talking_points',
      message: `Add at least ${TALKING_POINTS_MIN} talking points.`,
    });
  } else if (nonEmptyPoints.length > TALKING_POINTS_MAX) {
    errors.push({
      field: 'talkingPoints',
      code: 'too_many_talking_points',
      message: `Use at most ${TALKING_POINTS_MAX} talking points.`,
    });
  }
  if (nonEmptyPoints.some((p) => p.length > TALKING_POINT_MAX)) {
    errors.push({
      field: 'talkingPoints',
      code: 'too_long',
      message: `Each talking point must be ${TALKING_POINT_MAX} characters or fewer.`,
    });
  }

  let normalizedDuration: number | undefined;
  if (i.targetDurationSec !== undefined && i.targetDurationSec !== null) {
    const d = i.targetDurationSec;
    if (typeof d !== 'number' || !Number.isFinite(d)) {
      errors.push({ field: 'targetDurationSec', code: 'duration_not_a_number', message: 'Target duration must be a number of seconds.' });
    } else if (d < TARGET_DURATION_MIN_SEC || d > TARGET_DURATION_MAX_SEC) {
      errors.push({
        field: 'targetDurationSec',
        code: 'duration_out_of_range',
        message: `Target duration must be between ${TARGET_DURATION_MIN_SEC}s and ${TARGET_DURATION_MAX_SEC}s.`,
      });
    } else {
      normalizedDuration = Math.round(d);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    value: {
      audience: (i.audience as string).trim(),
      objective: (i.objective as string).trim(),
      desiredDecision: (i.desiredDecision as string).trim(),
      talkingPoints: nonEmptyPoints,
      ...(normalizedDuration !== undefined ? { targetDurationSec: normalizedDuration } : {}),
    },
  };
}
