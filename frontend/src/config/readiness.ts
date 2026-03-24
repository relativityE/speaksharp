/**
 * CANONICAL READINESS SIGNALS
 * --------------------------
 * These signals represent the minimum viable state for the application 
 * to be considered "interactive" and "stable" for both users and E2E tests.
 */
export const CORE_READINESS_SIGNALS = ['boot', 'layout', 'auth'] as const;

export type CoreReadinessSignal = typeof CORE_READINESS_SIGNALS[number];
