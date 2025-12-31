import React from 'react';
import { CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { SUBSCRIPTION_LIMITS } from '@/config';
import logger from '@/lib/logger';

interface Tier {
  name: string;
  price: string;
  priceDescription: string;
  features: string[];
  cta: string;
  isPopular?: boolean;
}

const tiers: Tier[] = [
  {
    name: 'Free',
    price: '$0',
    priceDescription: 'For basic use',
    features: [`Up to ${SUBSCRIPTION_LIMITS.FREE_MONTHLY_MINUTES} mins of practice per month`, 'Basic analytics', 'Save last 5 sessions'],
    cta: 'Continue with Free',
  },
  {
    name: 'Pro',
    price: '$10',
    priceDescription: 'per month',
    features: [
      'Unlimited practice time',
      'Advanced analytics',
      'Save all sessions',
      'Export data as PDF',
      'Private transcription',
      'AI-powered feedback (coming soon)',
    ],
    cta: 'Upgrade to Pro',
    isPopular: true,
  },
];

const PricingCard: React.FC<{ tier: Tier }> = ({ tier }) => {
  const handleUpgrade = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase client not available");

      // Backend uses STRIPE_PRO_PRICE_ID env var, no need to send priceId
      const { data, error } = await supabase.functions.invoke('stripe-checkout');

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
    <Card className={`flex flex-col ${tier.isPopular ? 'border-primary' : ''}`}>
      <CardHeader>
        <CardTitle>{tier.name}</CardTitle>
        <CardDescription>{tier.priceDescription}</CardDescription>
        <div className="text-4xl font-bold">{tier.price}</div>
      </CardHeader>
      <CardContent className="flex-grow">
        <ul className="space-y-2">
          {tier.features.map((feature, i) => (
            <li key={i} className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <div className="p-6">
        <Button onClick={handleUpgrade} className="w-full" disabled={tier.name === 'Free'}>
          {tier.cta}
        </Button>
      </div>
    </Card>
  );
};

export const PricingPage: React.FC = () => {
  return (
    <div className="container mx-auto py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold">Find the plan that's right for you</h1>
        <p className="text-xl text-muted-foreground mt-4">
          Whether you're just starting out or a seasoned pro, we have a plan for you.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {tiers.map((tier) => (
          <PricingCard key={tier.name} tier={tier} />
        ))}
      </div>
    </div>
  );
};
