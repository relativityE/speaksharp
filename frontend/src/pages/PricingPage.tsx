import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, ShieldCheck, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getSupabaseClient } from '@/lib/supabaseClient';
import {
  trackConversionCtaClicked,
  trackConversionCtaViewed,
  type ConversionSource,
} from '@/services/conversionFunnel';
import { startProCheckout } from '@/services/proCheckout';
import { offerDisclosureChips, PAID_CONTINUATION_UNAVAILABLE } from '@/components/pricing/offerDisclosure';
import { PRICING_HEADING, PRICING_TIERS, pricingIntro, type PricingTier } from '@/components/pricing/pricingTiers';
import { toast } from '@/lib/toast';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';
import logger from '../lib/logger';
import { useUserProfile } from '@/hooks/useUserProfile';
import { hasPaidProEntitlement } from '@/constants/subscriptionTiers';

// #1266 / #1254 / #1475 — the one-product, two-lifecycle tier copy lives in `pricingTiers.ts`, shared verbatim with
// the landing pricing section so the two surfaces cannot state different terms.
type Tier = PricingTier;
const tiers = PRICING_TIERS;

const PricingCard: React.FC<{ tier: Tier }> = ({ tier }) => {
  const source: ConversionSource = tier.plan === 'free' ? 'pricing_free_card' : 'pricing_pro_card';
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // #1266 — never record a PAID-OFFER view when enrollment is unavailable. When payments are disabled the
    // Pro (checkout) card renders an informational "not open yet" notice, NOT a live offer, so emitting
    // `pricing_pro_card` viewed would be misleading paid-conversion evidence. The free-trial CTA is always a
    // real offer, so it is unaffected. Mirrors the checkout-click guard below.
    if (tier.action === 'checkout' && !arePaymentsEnabled()) return;
    trackConversionCtaViewed({ source, plan: tier.plan });
  }, [source, tier.plan, tier.action]);

  const handleUpgrade = async () => {
    if (isSubmitting) return;
    if (tier.action === 'checkout' && !arePaymentsEnabled()) return; // payments not configured — checkout CTA is hidden
    setIsSubmitting(true);

    try {
      trackConversionCtaClicked({ source, plan: tier.plan });

      if (tier.action === 'signup') {
        const params = new URLSearchParams({
          utm_source: 'app_cta',
          utm_medium: source,
          utm_campaign: 'start_free',
        });
        navigate(`/auth/signup?${params.toString()}`);
        return;
      }

      await startProCheckout(source);
    } catch (err: unknown) {
      logger.error({ err, tier: tier.name }, 'Error creating Stripe checkout session:');
      toast.error('Unable to start checkout. Please try again or contact support if it continues.');
      setIsSubmitting(false);
    }
  };

  return (
    <Card className={`relative flex h-full flex-col border-border bg-card surface-shadow ${tier.isPopular ? 'border-primary' : ''}`}>
      {tier.isPopular && (
        <div className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full bg-signature-ground px-3 py-1 text-xs font-semibold text-signature-text border border-signature-border shadow-none">
          <Zap className="h-3 w-3" />
          Most popular
        </div>
      )}
      <CardHeader className="p-6 pb-4">
        <CardTitle className="text-2xl">{tier.name}</CardTitle>
        <CardDescription>{tier.priceDescription}</CardDescription>
        <div className="text-4xl font-bold tracking-tight">{tier.price}</div>
      </CardHeader>
      <CardContent className="flex-grow px-6">
        <ul className="space-y-2">
          {tier.features.map((feature, i) => (
            <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span className="text-foreground/95">{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <div className="p-6">
        {(tier.action !== 'checkout' || arePaymentsEnabled()) ? (
          <Button
            onClick={() => { void handleUpgrade(); }}
            className="w-full"
            variant={tier.isPopular ? 'default' : 'outline'}
            disabled={isSubmitting}
          >
            {isSubmitting && tier.action === 'checkout' ? 'Starting checkout...' : tier.cta}
          </Button>
        ) : (
          // Non-payment Wave-1 beta: the paid Pro checkout channel is not open. Keep the Pro plan
          // visible for transparency, but replace the (otherwise missing) checkout CTA with a
          // visible, NON-clickable informational state so the card does not read as broken. This
          // element emits NO checkout/conversion events and does not describe Pro as purchasable.
          <div
            data-testid="pricing-pro-beta-unavailable"
            className="w-full rounded-md border border-border bg-muted/40 px-4 py-3 text-center"
          >
            <p className="text-sm font-semibold text-foreground">{PAID_CONTINUATION_UNAVAILABLE.title}</p>
            <p className="mt-1 text-xs text-foreground/70">{PAID_CONTINUATION_UNAVAILABLE.detail}</p>
          </div>
        )}
      </div>
    </Card>
  );
};

const BillingManagementPanel: React.FC<{ paymentsEnabled: boolean }> = ({ paymentsEnabled }) => {
  const { data: profile } = useUserProfile();
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const isPaidPro = hasPaidProEntitlement(profile);
  const canOpenPortal = paymentsEnabled && isPaidPro;

  const handleManageBilling = async () => {
    if (!canOpenPortal || isOpeningPortal) return;
    setIsOpeningPortal(true);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase client not available');

      const { data, error } = await supabase.functions.invoke('stripe-billing-portal');
      if (error) throw error;
      if (data?.portalUrl) {
        window.location.href = data.portalUrl;
        return;
      }

      throw new Error('No billing portal URL returned');
    } catch (err) {
      logger.error({ err }, 'Error opening Stripe billing portal:');
      toast.error('Unable to open billing management. Please contact support if it continues.');
      setIsOpeningPortal(false);
    }
  };

  return (
    <section className="mx-auto mt-10 max-w-4xl border-t border-border pt-6 text-left">
      <div className="grid gap-5 md:grid-cols-[1.4fr_1fr]">
        <div className="space-y-2">
          <h2 className="text-base font-semibold">After your 30-day trial</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {paymentsEnabled
              ? 'Continue the same complete product for $10/month after your 30-day free trial. Private transcription is on-device for everyone; coaching quality can vary by device, microphone, and speaking conditions.'
              : 'Paid continuation ($10/month) is not yet enabled. Private transcription is on-device for everyone; coaching quality can vary by device, microphone, and speaking conditions.'}
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            You can cancel from billing management when Stripe has linked your paid account. Refund or
            cancellation questions can also be sent through Share Feedback.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-3 md:items-end">
          {canOpenPortal ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => { void handleManageBilling(); }}
              disabled={isOpeningPortal}
            >
              {isOpeningPortal ? 'Opening billing...' : 'Manage billing'}
            </Button>
          ) : (
            <p className="text-sm leading-6 text-muted-foreground md:text-right">
              Billing management appears here for paid Pro accounts after Stripe confirms the subscription.
            </p>
          )}
          <p className="text-xs leading-5 text-muted-foreground md:text-right">
            No payment is made if Checkout is cancelled. Pro unlocks only after Stripe confirmation reaches your account.
          </p>
        </div>
      </div>
    </section>
  );
};

export const PricingPage: React.FC = () => {
  const paymentsEnabled = arePaymentsEnabled();
  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-28">
      <div className="mx-auto max-w-4xl text-center mb-10">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{PRICING_HEADING}</h1>
        <p className="text-base text-muted-foreground mt-3 sm:text-lg">{pricingIntro(paymentsEnabled)}</p>
      </div>
      <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
        {tiers.map((tier) => (
          <PricingCard key={tier.name} tier={tier} />
        ))}
      </div>
      <div className="mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
        {offerDisclosureChips(paymentsEnabled).map((label) => (
          <span key={label} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
      <BillingManagementPanel paymentsEnabled={paymentsEnabled} />
    </div>
  );
};
