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
import logger from '../lib/logger';

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
      'Starter analytics',
      'Save last 5 sessions',
      'AI-assisted feedback',
      'Watermarked PDF exports',
      'Free may include privacy-respecting sponsor messages outside practice',
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
      'Practice analytics and trends',
      'Save all sessions',
      'Private transcription after one-time local model setup',
      'Cloud transcription for serious high-accuracy workflows',
      'More semantic AI coaching and PDF export capacity',
      'Ad-free experience',
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
        <Button
          onClick={() => { void handleUpgrade(); }}
          className="w-full"
          variant={tier.isPopular ? 'default' : 'outline'}
          disabled={isSubmitting}
        >
          {isSubmitting && tier.action === 'checkout' ? 'Starting checkout...' : tier.cta}
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
          Start free with instant Browser transcription and core feedback. Upgrade to Pro when you need Private transcription, Cloud accuracy, semantic AI coaching, and deeper history.
        </p>
      </div>
      <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
        {tiers.map((tier) => (
          <PricingCard key={tier.name} tier={tier} />
        ))}
      </div>
      <div className="mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
        {['Private transcription keeps audio local', 'Transcript data is never used for ads', 'Cloud available as a Pro feature'].map((label) => (
          <span key={label} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
};
