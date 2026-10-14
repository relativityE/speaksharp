import { hasPaidProEntitlement } from '@/constants/subscriptionTiers';
import type { UserProfile } from '@/types/user';

export type TrialPresentationState = 'active' | 'inactive' | 'checking' | 'unavailable';

export function trialPresentationState(usage: {
  data?: { trial_active?: unknown };
  isError?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
}): TrialPresentationState {
  if (usage.isError) return 'unavailable';
  if (usage.isLoading || usage.isPending) return 'checking';
  if (usage.data?.trial_active === true) return 'active';
  if (usage.data?.trial_active === false) return 'inactive';
  return 'unavailable';
}

export function membershipPresentation(profile: UserProfile | null | undefined, trialState: TrialPresentationState = 'unavailable') {
  if (!hasPaidProEntitlement(profile)) {
    if (trialState === 'active') return { status: 'Trial' as const, detail: 'Your trial is active. Trial access is confirmed by the server.' };
    if (trialState === 'inactive') return { status: 'Free' as const, detail: 'No active paid membership.' };
    if (trialState === 'checking') return { status: 'Checking' as const, detail: 'Checking your membership status…' };
    return { status: 'Unavailable' as const, detail: 'Membership status is temporarily unavailable. Please try again.' };
  }
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
