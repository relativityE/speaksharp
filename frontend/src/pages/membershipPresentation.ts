import { hasPaidProEntitlement } from '@/constants/subscriptionTiers';
import type { UserProfile } from '@/types/user';

export function membershipPresentation(profile: UserProfile | null | undefined) {
  if (!hasPaidProEntitlement(profile)) return { status: 'Free' as const, detail: 'No active paid membership.' };
  const date = profile?.stripe_current_period_end;
  const parsed = date ? new Date(date) : null;
  const endDate = parsed && Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  }) : null;
  if (profile?.stripe_cancel_at_period_end === true) return {
    status: 'Ending' as const,
    detail: endDate ? `Pro access is scheduled to end on ${endDate}.` : 'Cancellation is scheduled. Pro access remains active for now.',
  };
  return { status: 'Active' as const,
    detail: endDate ? `Your current billing period ends on ${endDate}.` : 'Your Pro membership is active.' };
}
