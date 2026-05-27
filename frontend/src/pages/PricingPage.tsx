import { useEffect } from 'react';
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
import logger from '../lib/logger';

interface Tier {
  name: string;
  plan: 'basic' | 'pro';
  price: string;
  priceDescription: string;
  features: string[];
  cta: string;
  isPopular?: boolean;
}

const tiers: Tier[] = [
  {
    name: 'Basic',
    plan: 'basic',
    price: '$2.99',
    priceDescription: 'per month',
    features: [
      `Up to ${SUBSCRIPTION_LIMITS.BASIC_MONTHLY_MINUTES} mins of practice per month`,
      'Basic analytics',
      'Save last 5 sessions',
      'AI-assisted feedback',
      'Watermarked PDF exports',
    ],
    cta: 'Choose Basic',
  },
  {
    name: 'Pro',
    plan: 'pro',
    price: '$7.99',
    priceDescription: 'per month',
    features: [
      'Up to 2 hours/day and 50 hours/month',
      'Practice analytics and trends',
      'Save all sessions',
      'Private transcription',
      'Cloud transcription',
      'More AI feedback and PDF export capacity',
    ],
    cta: 'Upgrade to Pro',
    isPopular: true,
  },
];

const PricingCard: React.FC<{ tier: Tier }> = ({ tier }) => {
  const source: ConversionSource = tier.plan === 'basic' ? 'pricing_basic_card' : 'pricing_pro_card';

  useEffect(() => {
    trackConversionCtaViewed({ source, plan: tier.plan });
  }, [source, tier.plan]);

  const handleUpgrade = async () => {
    try {
      trackConversionCtaClicked({ source, plan: tier.plan });
      trackCheckoutStarted({ source, plan: tier.plan });

      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase client not available");

      const { data, error } = await supabase.functions.invoke('stripe-checkout', {
        body: buildCheckoutBody(tier.plan, source)
      });

      if (error) throw error;
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err: unknown) {
      logger.error({ err, tier: tier.name }, 'Error creating Stripe checkout session:');
      // Could add toast notification here for user feedback
    }
  };

  return (
    <Card className={`relative flex h-full flex-col border-border bg-card shadow-card ${tier.isPopular ? 'border-primary' : ''}`}>
      {tier.isPopular && (
        <div className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 border border-amber-200 shadow-none">
          <Zap className="h-3 w-3" />
          Best for testers
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
        <Button
          onClick={() => { void handleUpgrade(); }}
          className="w-full"
          variant={tier.isPopular ? 'default' : 'outline'}
        >
          {tier.cta}
        </Button>
      </div>
    </Card>
  );
};

export const PricingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-28">
      <div className="mx-auto max-w-4xl text-center mb-10">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Choose your SpeakSharp plan</h1>
        <p className="text-base text-muted-foreground mt-3 sm:text-lg">
          Start with browser transcription, AI feedback, and PDF reports, then upgrade when you need private models, cloud transcription, and deeper history.
        </p>
      </div>
      <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
        {tiers.map((tier) => (
          <PricingCard key={tier.name} tier={tier} />
        ))}
      </div>
      <div className="mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
        {['Privacy-first practice', 'Private STT available', 'Cloud STT is a Pro feature'].map((label) => (
          <span key={label} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
};
