/**
 * RWT-20 — the closed vocabularies for `progress_debt` telemetry.
 *
 * Kept in a module with NO imports so the producer and the telemetry allowlist derive from the same source
 * without an import cycle (allowlist ← AnalyticsBuffer ← safeEmit ← producer).
 */
export const PROGRESS_DEBT_PHASES = ['enqueued', 'attempt_succeeded', 'attempt_failed', 'released'] as const;
export const PROGRESS_DEBT_TRIGGERS = ['save', 'load', 'retry'] as const;
/**
 * Why an attempt did not retire the debt. Categories only: the RPC error body can echo request material, so it is
 * never carried — see the allowlist's note on error text.
 */
export const PROGRESS_DEBT_REASONS = ['rpc_error', 'rpc_empty', 'rpc_timeout', 'clear_failed'] as const;

export type ProgressDebtPhase = typeof PROGRESS_DEBT_PHASES[number];
export type ProgressDebtTrigger = typeof PROGRESS_DEBT_TRIGGERS[number];
export type ProgressDebtReason = typeof PROGRESS_DEBT_REASONS[number];
