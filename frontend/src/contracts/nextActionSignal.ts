// #1306 — the STRICT structured next-action contract that REPLACES the free-form `ai_suggestions` prose.
// A successfully completed session persists EXACTLY ONE structured next action built only from fixed enums +
// numeric values — no transcript, quoted speech, or free-form coaching text ever crosses the persistence
// interface. The user-facing copy is generated at RENDER time from these codes (see `renderNextActionCopy`),
// never stored. This is ONE metrics-derived improvement action after a successful practice session — NOT a
// choice about which session to keep or complete.
//
// MVP taxonomy (Product-owned, locked): filler rate · pace too fast/slow · excessive/extended pauses ·
// clarity below baseline · establish baseline · maintain/repeat. The validator rejects any unknown key,
// any non-enum value, and any free-form string, so a prose payload cannot be persisted.

export const NEXT_ACTION_TEMPLATE_VERSION = 'rec_v1' as const;

export const REASON_CODES = [
  'HIGH_FILLER_RATE',
  'PACE_TOO_FAST',
  'PACE_TOO_SLOW',
  'EXTENDED_PAUSES',
  'CLARITY_BELOW_BASELINE',
  'ESTABLISH_BASELINE',
  'ON_TRACK',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const ACTION_CODES = [
  'REDUCE_FILLERS',
  'SLOW_DOWN',
  'SPEED_UP',
  'TIGHTEN_PAUSES',
  'IMPROVE_CLARITY',
  'RECORD_BASELINE',
  'MAINTAIN',
] as const;
export type ActionCode = (typeof ACTION_CODES)[number];

export const METRIC_CODES = ['filler_rate', 'wpm', 'extended_pauses', 'clarity_score', 'none'] as const;
export type MetricCode = (typeof METRIC_CODES)[number];

export const COMPARATOR_CODES = [
  'above_baseline',
  'below_baseline',
  'above_target',
  'below_target',
  'within_target',
  'no_baseline',
] as const;
export type ComparatorCode = (typeof COMPARATOR_CODES)[number];

export const TEMPLATE_VERSIONS = [NEXT_ACTION_TEMPLATE_VERSION] as const;
export type TemplateVersion = (typeof TEMPLATE_VERSIONS)[number];

/** The ONLY shape a session's next action may take. All string fields are enum-constrained; `value` is numeric. */
export interface NextActionSignal {
  reasonCode: ReasonCode;
  actionCode: ActionCode;
  metric: MetricCode;
  value: number;
  comparator: ComparatorCode;
  templateVersion: TemplateVersion;
}

// The exact, exhaustive key set — used to REJECT unknown keys (which could smuggle prose).
const ALLOWED_KEYS: ReadonlyArray<keyof NextActionSignal> = [
  'reasonCode', 'actionCode', 'metric', 'value', 'comparator', 'templateVersion',
];

export type NextActionValidation =
  | { ok: true; value: NextActionSignal }
  | { ok: false; errors: string[] };

/**
 * Fail-closed validation. Rejects: non-objects, MISSING required keys, UNKNOWN keys, any string value not in
 * its enum (so free-form prose is impossible), and a non-finite `value`. This mirrors the DB-side CHECK/enum
 * constraints so content cannot be persisted from any writer.
 */
export function validateNextActionSignal(input: unknown): NextActionValidation {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['next action must be a non-array object'] };
  }
  const obj = input as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!(ALLOWED_KEYS as ReadonlyArray<string>).includes(key)) {
      errors.push(`unknown key '${key}' is not permitted (only ${ALLOWED_KEYS.join(', ')})`);
    }
  }
  const inEnum = <T extends string>(v: unknown, allowed: ReadonlyArray<T>, field: string): v is T => {
    if (typeof v !== 'string' || !(allowed as ReadonlyArray<string>).includes(v)) {
      errors.push(`${field} must be one of: ${allowed.join(', ')}`);
      return false;
    }
    return true;
  };

  inEnum<ReasonCode>(obj.reasonCode, REASON_CODES, 'reasonCode');
  inEnum<ActionCode>(obj.actionCode, ACTION_CODES, 'actionCode');
  inEnum<MetricCode>(obj.metric, METRIC_CODES, 'metric');
  inEnum<ComparatorCode>(obj.comparator, COMPARATOR_CODES, 'comparator');
  inEnum<TemplateVersion>(obj.templateVersion, TEMPLATE_VERSIONS, 'templateVersion');
  if (typeof obj.value !== 'number' || !Number.isFinite(obj.value)) {
    errors.push('value must be a finite number');
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      reasonCode: obj.reasonCode as ReasonCode,
      actionCode: obj.actionCode as ActionCode,
      metric: obj.metric as MetricCode,
      value: obj.value as number,
      comparator: obj.comparator as ComparatorCode,
      templateVersion: obj.templateVersion as TemplateVersion,
    },
  };
}

/** Render-time ONLY: turn the stored codes into user-facing copy. Copy lives in code, never in the database. */
const REASON_TITLES: Record<ReasonCode, string> = {
  HIGH_FILLER_RATE: 'Trim the filler words',
  PACE_TOO_FAST: 'Ease off the pace',
  PACE_TOO_SLOW: 'Pick up the pace',
  EXTENDED_PAUSES: 'Tighten the long pauses',
  CLARITY_BELOW_BASELINE: 'Sharpen your clarity',
  ESTABLISH_BASELINE: 'Set your baseline',
  ON_TRACK: 'Keep it up',
};
const ACTION_BODIES: Record<ActionCode, string> = {
  REDUCE_FILLERS: 'Aim for fewer “um”s and “uh”s in your next take.',
  SLOW_DOWN: 'Slow down a little so each point lands.',
  SPEED_UP: 'Lift your pace to keep momentum.',
  TIGHTEN_PAUSES: 'Shorten the longest silences between thoughts.',
  IMPROVE_CLARITY: 'Focus on crisp, complete sentences next time.',
  RECORD_BASELINE: 'Record another session to establish your baseline.',
  MAINTAIN: 'You’re on track — repeat what worked.',
};

export function renderNextActionCopy(signal: NextActionSignal): { title: string; body: string } {
  return { title: REASON_TITLES[signal.reasonCode], body: ACTION_BODIES[signal.actionCode] };
}
