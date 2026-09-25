import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';
import { hasPaidProEntitlement } from '@/constants/subscriptionTiers';
import { useUserProfile } from '@/hooks/useUserProfile';
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';
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

export default function AccountPage() {
  const location = useLocation();
  const { data: profile, isLoading, isError, refetch } = useUserProfile();
  const [opening, setOpening] = useState<'manage' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const returned = new URLSearchParams(location.search).get('billing') === 'returned';
  const membership = membershipPresentation(profile);
  const hasPaidAccount = hasPaidProEntitlement(profile);
  const canManage = arePaymentsEnabled() && hasPaidAccount && Boolean(profile?.stripe_customer_id);
  const canCancel = canManage && Boolean(profile?.stripe_subscription_id) && membership.status === 'Active';

  // The return URL is not proof that a cancellation occurred. Read the webhook-backed profile now,
  // then retry briefly while Stripe's real webhook may still be in flight. Keep the last confirmed
  // membership visible throughout and stop after a bounded window if nothing changed.
  useEffect(() => {
    if (!returned) return;
    let active = true;
    setRefreshing(true);
    void refetch();
    const interval = window.setInterval(() => { if (active) void refetch(); }, 2000);
    const timeout = window.setTimeout(() => { setRefreshing(false); window.clearInterval(interval); }, 12000);
    return () => { active = false; window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [returned, refetch]);

  const openPortal = async (flow: 'manage' | 'cancel') => {
    if ((flow === 'cancel' ? !canCancel : !canManage) || opening) return;
    setOpening(flow);
    setError(null);
    try {
      const client = getSupabaseClient();
      if (!client) throw new Error('Billing unavailable');
      const { data, error: portalError } = await client.functions.invoke('stripe-billing-portal', {
        body: { flow },
      });
      if (portalError || typeof data?.portalUrl !== 'string' || !data.portalUrl.startsWith('https://billing.stripe.com/')) {
        throw new Error('Billing portal unavailable');
      }
      window.location.assign(data.portalUrl);
    } catch (cause) {
      logger.error({ cause, flow }, 'Unable to open billing portal');
      setError('Unable to open billing management. Please try again or contact support.');
      setOpening(null);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 pb-24 pt-28" data-testid="account-page">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-signature-text">Your account</p>
          <h1 className="mt-2 text-3xl font-bold text-foreground">Account</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Membership</CardTitle>
            <CardDescription>View your plan and manage your billing in one place.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {isLoading ? <p role="status">Loading membership…</p> : isError || !profile ? (
              <p role="alert">We couldn’t load your membership. Try again before making a billing change.</p>
            ) : (
              <>
                <div className="rounded-xl border border-border bg-muted/30 p-4" data-testid="membership-status">
                  <p className="font-semibold">{membership.status === 'Free' ? 'Free' : 'Pro'} · {membership.status}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{membership.detail}</p>
                </div>
                {returned && <p className="text-sm text-muted-foreground" role="status">
                  {refreshing ? 'Checking for billing changes…' : 'Changes can take a minute to appear. This is your latest confirmed membership status.'}
                </p>}
                {canManage ? (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                    <Button type="button" variant="outline" onClick={() => { void openPortal('manage'); }} disabled={opening !== null}>
                      {opening === 'manage' ? 'Opening billing…' : 'Manage billing'}
                    </Button>
                    {canCancel && <button type="button" className="text-sm font-medium underline underline-offset-4 hover:text-foreground/70 disabled:opacity-50"
                      onClick={() => { void openPortal('cancel'); }} disabled={opening !== null}>
                      {opening === 'cancel' ? 'Opening cancellation…' : 'Cancel membership'}
                    </button>}
                  </div>
                ) : hasPaidAccount ? <p className="text-sm text-muted-foreground">Billing management is temporarily unavailable. Please contact support.</p> : null}
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
