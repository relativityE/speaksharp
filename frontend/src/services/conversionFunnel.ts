import { analyticsBuffer } from './AnalyticsBuffer';
import type { ConversionSource } from './conversionVocabulary';
import { getSessionCoachingExperimentProperties } from './sessionCoachingExperiment';

export type BillingPlan = 'free' | 'pro';
export type CheckoutPlan = 'pro';

// The vocabulary lives in `conversionVocabulary` so the producer that closes an inbound checkout
// return and the allowlist that validates the outbound event read the SAME list.
export type { ConversionSource };

type ConversionContext = {
  source: ConversionSource;
  plan?: BillingPlan;
  route?: string;
  tier?: string | null;
  trialState?: 'active' | 'expired' | 'none' | 'unknown';
};

export function getUpgradeUrl(source: ConversionSource, plan?: BillingPlan): string {
  const params = new URLSearchParams({
    utm_source: source === 'free_plan_support' ? 'app_support' : 'app_cta',
    utm_medium: source,
    utm_campaign: 'upgrade',
  });

  if (plan) params.set('plan', plan);
  return `/pricing?${params.toString()}`;
}

export function buildCheckoutBody(plan: CheckoutPlan, source: ConversionSource) {
  return {
    plan,
    returnUrlOrigin: window.location.origin,
    conversionSource: source,
    utm: {
      source: source === 'free_plan_support' ? 'app_support' : 'app_cta',
      medium: source,
      campaign: 'upgrade',
    },
  };
}

export function trackConversionCtaViewed(context: ConversionContext): void {
  analyticsBuffer.push('conversion_cta_viewed', getConversionProperties(context), 'LOW');
}

export function trackConversionCtaClicked(context: ConversionContext): void {
  analyticsBuffer.push('conversion_cta_clicked', getConversionProperties(context), 'HIGH');
}

export function trackCheckoutStarted(context: ConversionContext & { plan: CheckoutPlan }): void {
  analyticsBuffer.push('checkout_started', getConversionProperties(context), 'HIGH');
}

// Non-conversion engagement signal: the "See sample feedback" anchor scrolls to
// the on-page preview, it is NOT a signup/checkout conversion. Kept out of the
// conversion_cta_* funnel so it does not skew conversion metrics.
export function trackLandingPreviewClicked(): void {
  analyticsBuffer.push(
    'landing_preview_clicked',
    {
      route: getCurrentRoute(),
      ...getSessionCoachingExperimentProperties(),
    },
    'LOW',
  );
}

function getConversionProperties(context: ConversionContext): Record<string, unknown> {
  return {
    source: context.source,
    plan: context.plan,
    route: normalizeRoute(context.route) ?? getCurrentRoute(),
    tier: context.tier ?? null,
    trial_state: context.trialState ?? 'unknown',
    ...getSessionCoachingExperimentProperties(),
  };
}

/**
 * The in-app path ONLY — never the query string.
 *
 * This used to return `pathname + search`. The route validator rejects query material (it carries data), so
 * every conversion event fired on a URL with a query — which is precisely the utm-tagged acquisition
 * traffic the funnel exists to measure — silently LOST its route dimension. Dropping the query at the
 * producer keeps the dimension and keeps it content-free, rather than trading one for the other.
 */
function getCurrentRoute(): string | null {
  if (typeof window === 'undefined') return null;
  return normalizeRoute(window.location.pathname);
}

/**
 * Reduce any route-ish value to a query-free in-app path, or null.
 *
 * Applied to CALLER-SUPPLIED routes too: a context route carrying a query would be dropped by the
 * validator exactly like `window.location.search` was. Null is content-free absence, which the validator
 * accepts — a placeholder like 'unknown' is not a path and would itself be dropped.
 */
export function normalizeRoute(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.split('?')[0].split('#')[0];
  return /^\/[A-Za-z0-9/_-]*$/.test(path) ? path : null;
}
