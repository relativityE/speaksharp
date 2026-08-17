// #1306: the STRICT persisted filler contract. `filler_counts` is a FLAT map of APPROVED standard filler
// identifiers → non-negative finite counts. `{}` is a valid MEASURED zero. Arbitrary/prose keys, nested
// objects, arrays, strings, and invalid numbers FAIL CLOSED — no prose can be smuggled through a filler key.
// `Record<string, number>` is intentionally NOT used (it would permit `{ "confidential phrase": 1 }`).
//
// This mirrors the DB firewall key set in 20260816223607_metrics_only_enforcement_1306.sql. Account-level
// custom filler DEFINITIONS live in account settings (task #41) and are NEVER persisted as arbitrary
// per-session JSON keys — the per-session map only ever holds these approved standard identifiers.

export const APPROVED_FILLER_KEYS = [
  'um', 'uh', 'ah', 'like', 'you_know', 'so', 'actually', 'oh', 'i_mean', 'basically', 'literally', 'kind_of', 'sort_of',
] as const;
export type ApprovedFillerKey = (typeof APPROVED_FILLER_KEYS)[number];
const APPROVED = new Set<string>(APPROVED_FILLER_KEYS);

/** The ONLY shape persisted filler counts may take. `{}` (a measured zero) is a valid value. */
export type PersistedFillerCounts = Partial<Record<ApprovedFillerKey, number>>;

/**
 * SANITIZED rejection codes. A fail-closed validator must NEVER echo the offending key or value (which could
 * be prose smuggled into a filler slot) into an error, log, or payload — only these fixed codes are returned.
 */
export type FillerCountsRejectionCode =
  | 'invalid_filler_counts_shape'  // not a plain object (null / array / string / number)
  | 'invalid_filler_counts_key'    // an unknown / non-approved (prose) key was present
  | 'invalid_filler_counts_value'; // an approved key carried a nested / string / negative / non-finite value

export type FillerCountsValidation =
  | { ok: true; value: PersistedFillerCounts }
  | { ok: false; code: FillerCountsRejectionCode };

// #1306 P1: the client value constraint MUST match the DB firewall (validate_filler_counts_1306):
// a non-negative INTEGER within range. Fractional (`2.5`) and over-limit (`> 1_000_000`) values are
// rejected by the DB trigger, so the client must reject them too — otherwise a client-"valid" map would
// be silently refused at the persistence boundary. `Number.isInteger` also excludes NaN/Infinity.
export const MAX_FILLER_COUNT = 1_000_000;
const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_FILLER_COUNT;

/**
 * Fail-closed RUNTIME validation (TypeScript alone is insufficient at the persistence boundary). Rejects
 * non-plain-objects, arrays, unknown/prose keys, nested objects, strings, and negative/non-finite numbers.
 * `{}` is accepted as a genuine measured zero. On rejection it returns ONLY a sanitized code — the offending
 * key/value is never included, so a prose key can never leak through an error message, log, or payload.
 */
export function validatePersistedFillerCounts(input: unknown): FillerCountsValidation {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'invalid_filler_counts_shape' };
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!APPROVED.has(key)) return { ok: false, code: 'invalid_filler_counts_key' };   // never echo `key`
    if (!isCount(value)) return { ok: false, code: 'invalid_filler_counts_value' };     // never echo `value`
    out[key] = value;
  }
  return { ok: true, value: out as PersistedFillerCounts };
}

/**
 * Reader coercion for PERSISTED data. Returns:
 *   - a validated map (including `{}` = measured zero) for MEASURED, valid input;
 *   - `null` for NOT-MEASURED (null/undefined) OR INVALID input (fail closed — invalid data never counts).
 * This is the runtime guard the persisted read path (History/Progress/PDF) MUST use — never trust the stored
 * shape blindly, and never let an unknown/prose key through.
 */
export function readPersistedFillerCounts(input: unknown): PersistedFillerCounts | null {
  if (input == null) return null; // not measured
  const v = validatePersistedFillerCounts(input);
  return v.ok ? v.value : null; // invalid → fail closed (excluded), never counted
}

/** Sum of a persisted filler map: `null` for not-measured/invalid, a number (0 for `{}`) for a measured map. */
export function persistedFillerTotal(input: unknown): number | null {
  const fc = readPersistedFillerCounts(input);
  if (fc === null) return null;
  return Object.values(fc).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
}
