import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, ShieldCheck, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { SUBSCRIPTION_LIMITS } from '@/config';
import {
  buildCheckoutBody,
  trackCheckoutStarted,
  trackConversionCtaClicked,
  trackConversionCtaViewed,
  type ConversionSource,
} from '@/services/conversionFunnel';
import { toast } from '@/lib/toast';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';
import logger from '../lib/logger';
import { useUserProfile } from '@/hooks/useUserProfile';
import { hasPaidProEntitlement } from '@/constants/subscriptionTiers';

interface Tier {
  name: string;
  plan: 'free' | 'pro';
  price: string;
  priceDescription: string;
  features: string[];
  cta: string;
  action: 'signup' | 'checkout';
  isPopular?: boolean;
}

const tiers: Tier[] = [
  {
    name: 'Free',
    plan: 'free',
    price: '$0',
    priceDescription: 'no card required',
    features: [
      `Up to ${SUBSCRIPTION_LIMITS.FREE_MONTHLY_MINUTES} mins of practice per month`,
      'Instant Browser transcription; accuracy varies by browser and environment',
      'Core practice feedback metrics',
      'Save last 5 sessions',
      'Watermarked PDF exports',
    ],
    cta: 'Start Free',
    action: 'signup',
  },
  {
    name: 'Pro',
    plan: 'pro',
    price: '$9.99',
    priceDescription: 'per month',
    features: [
      'Up to 2 hours/day and 50 hours/month',
      'Practice analytics, trends, and coaching reports',
      'Save all sessions',
      'Private transcription after one-time local model setup',
      'Cloud transcription when enabled for Pro workflows',
      'Semantic AI coaching and expanded PDF export capacity',
    ],
    cta: 'Upgrade to Pro',
    action: 'checkout',
    isPopular: true,
  },
];

const PricingCard: React.FC<{ tier: Tier }> = ({ tier }) => {
  const source: ConversionSource = tier.plan === 'free' ? 'pricing_free_card' : 'pricing_pro_card';
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    trackConversionCtaViewed({ source, plan: tier.plan });
  }, [source, tier.plan]);

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

      trackCheckoutStarted({ source, plan: 'pro' });

      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase client not available");

      const { data, error } = await supabase.functions.invoke('stripe-checkout', {
        body: buildCheckoutBody('pro', source)
      });

      if (error) throw error;
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err: unknown) {
      logger.error({ err, tier: tier.name }, 'Error creating Stripe checkout session:');
      toast.error('Unable to start checkout. Please try again or contact support if it continues.');
      setIsSubmitting(false);
    }
  };

  return (
    <Card className={`relative flex h-full flex-col border-border bg-card surface-shadow ${tier.isPopular ? 'border-primary' : ''}`}>
      {tier.isPopular && (
        <div className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 border border-amber-200 shadow-none">
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
        {(tier.action !== 'checkout' || arePaymentsEnabled()) && (
          <Button
            onClick={() => { void handleUpgrade(); }}
            className="w-full"
            variant={tier.isPopular ? 'default' : 'outline'}
            disabled={isSubmitting}
          >
            {isSubmitting && tier.action === 'checkout' ? 'Starting checkout...' : tier.cta}
          </Button>
        )}
      </div>
    </Card>
  );
};

const BillingManagementPanel: React.FC = () => {
  const { data: profile } = useUserProfile();
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const isPaidPro = hasPaidProEntitlement(profile);
  const canOpenPortal = arePaymentsEnabled() && isPaidPro;

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
          <h2 className="text-base font-semibold">Paid early access</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Pro is offered as paid early access while SpeakSharp is still improving. Transcription and coaching
            quality can vary by browser, microphone, speaking conditions, and selected mode.
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            You can cancel from billing management when Stripe has linked your paid account. Refund or
            cancellation questions can also be sent through Report Issue with Billing selected.
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
  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-28">
      <div className="mx-auto max-w-4xl text-center mb-10">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Choose your SpeakSharp plan</h1>
        <p className="text-base text-muted-foreground mt-3 sm:text-lg">
          Start free with instant Browser transcription and core feedback. Upgrade to Pro paid early access when you need Private transcription, deeper history, and expanded coaching capacity.
        </p>
      </div>
      <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
        {tiers.map((tier) => (
          <PricingCard key={tier.name} tier={tier} />
        ))}
      </div>
      <div className="mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
        {['Private transcription keeps audio local', 'Transcript data supports SpeakSharp features', 'Pro unlocks after Stripe confirmation'].map((label) => (
          <span key={label} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
      <BillingManagementPanel />
    </div>
  );
};
