import type { CaptureResult, SupportedWebVitalsMetrics } from 'posthog-js';

const RUM_METRIC_VALUE_KEYS = [
  '$web_vitals_LCP_value',
  '$web_vitals_INP_value',
  '$web_vitals_CLS_value',
] as const;

const RUM_ENVELOPE_KEYS = ['token', 'distinct_id', '$lib', '$lib_version'] as const;

/**
 * PostHog's built-in `$web_vitals` event contains the current URL, session/window ids, and nested
 * attribution objects. Project it at the SDK's final pre-send boundary so those fields never leave
 * the browser. Other events already pass through their existing governed producers unchanged.
 */
export function governProductionRumEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event || event.event !== '$web_vitals') return event;

  const properties: Record<string, unknown> = {};
  for (const key of RUM_ENVELOPE_KEYS) {
    const value = event.properties[key];
    if (typeof value === 'string' && value.length > 0) properties[key] = value;
  }
  for (const key of RUM_METRIC_VALUE_KEYS) {
    const value = event.properties[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) properties[key] = value;
  }

  const hasMetric = RUM_METRIC_VALUE_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(properties, key));
  if (!hasMetric) return null;

  return {
    uuid: event.uuid,
    event: '$web_vitals',
    properties,
    timestamp: event.timestamp,
  };
}

/**
 * #1428 — Production Core Web Vitals are observations, never a client-side pass/fail gate.
 *
 * PostHog owns the standards-compliant LCP/INP/CLS observers. The selected metrics are projected
 * through `before_send`; autocapture, network timing, pageviews, and recordings remain disabled.
 */
export const PRODUCTION_RUM_OPTIONS = Object.freeze({
  capture_performance: {
    network_timing: false,
    web_vitals: true,
    web_vitals_allowed_metrics: ['LCP', 'INP', 'CLS'] as SupportedWebVitalsMetrics[],
  },
  before_send: governProductionRumEvent,
  autocapture: false,
  capture_pageview: false,
  disable_session_recording: true,
});
