import { FREE_PLAN_SUPPORT_CONFIG } from '@/config';

export type FreePlanSupportPlacement =
  | 'landing-lower'
  | 'pricing-inline'
  | 'dashboard-lower'
  | 'analytics-overview-sidebar'
  | 'post-session-footer';

export type FreePlanSupportTier = 'free' | 'basic' | 'pro';

const ALLOWED_PLACEMENTS: ReadonlySet<FreePlanSupportPlacement> = new Set([
  'landing-lower',
  'pricing-inline',
  'dashboard-lower',
  'analytics-overview-sidebar',
  'post-session-footer',
]);

export function canShowFreePlanSupport({
  enabled = FREE_PLAN_SUPPORT_CONFIG.ENABLE_FREE_PLAN_SUPPORT,
  tier,
  placement,
  route,
  isRecording = false,
  isTrialPeriod = false,
}: {
  enabled?: boolean;
  tier: FreePlanSupportTier;
  placement: FreePlanSupportPlacement;
  route: string;
  isRecording?: boolean;
  isTrialPeriod?: boolean;
}): boolean {
  if (!enabled) return false;
  if (tier !== 'free') return false;
  if (isTrialPeriod || isRecording) return false;
  if (!ALLOWED_PLACEMENTS.has(placement)) return false;
  if (route.includes('/export')) return false;
  if (route.includes('/analytics/') || route.includes('/session/')) return false;
  if (route.startsWith('/session') && placement !== 'post-session-footer') return false;
  return true;
}
