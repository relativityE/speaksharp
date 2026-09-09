/**
 * #1428 — Production Core Web Vitals are observations, never a client-side pass/fail gate.
 *
 * PostHog's browser SDK owns the standards-compliant LCP/INP/CLS observers. Keeping this
 * configuration in a typed, testable value prevents the production initialization from silently
 * disabling RUM while preserving the product's privacy posture (no autocapture or recordings).
 */
export const PRODUCTION_RUM_OPTIONS = Object.freeze({
  capture_performance: true,
  autocapture: false,
  capture_pageview: false,
  disable_session_recording: true,
});
