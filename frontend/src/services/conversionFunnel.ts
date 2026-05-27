import { analyticsBuffer } from './AnalyticsBuffer';

export type BillingPlan = 'free' | 'basic' | 'pro';
export type CheckoutPlan = 'pro';

export type ConversionSource =
  | 'hero_primary'
  | 'hero_feedback'
  | 'landing_cta'
  | 'pricing_free_card'
  | 'pricing_pro_card'
  | 'nav_upgrade'
  | 'analytics_overview_banner'
  | 'analytics_empty_state'
  | 'limit_modal'
  | 'post_session_prompt'
  | 'free_plan_support';

type ConversionContext = {
  source: ConversionSource;
  plan?: BillingPlan;
  route?: string;
  tier?: string | null;
  trialState?: 'active' | 'expired' | 'none' | 'unknown';
};

export function getUpgradeUrl(source: ConversionSource, plan?: BillingPlan): string {
  const params = new URLSearchParams({
    utm_source: source === 'free_plan_support' ? 'house_ad' : 'app_cta',
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
      source: source === 'free_plan_support' ? 'house_ad' : 'app_cta',
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

function getConversionProperties(context: ConversionContext): Record<string, unknown> {
  return {
    source: context.source,
    plan: context.plan,
    route: context.route ?? getCurrentRoute(),
    tier: context.tier ?? null,
    trial_state: context.trialState ?? 'unknown',
  };
}

function getCurrentRoute(): string {
  if (typeof window === 'undefined') return 'unknown';
  return `${window.location.pathname}${window.location.search}`;
}
