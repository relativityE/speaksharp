import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';
import { trackConversionCtaClicked, trackConversionCtaViewed } from '@/services/conversionFunnel';
import { startProCheckout } from '@/services/proCheckout';
import { offerDisclosureChips, PAID_CONTINUATION_UNAVAILABLE } from '@/components/pricing/offerDisclosure';
import { toast } from '@/lib/toast';
import logger from '@/lib/logger';
import { LANDING_OFFER_SHORT, LANDING_SIGNUP_ROUTE } from './landingOffer';

const TRIAL_SIGNUP_HREF = `${LANDING_SIGNUP_ROUTE}?${new URLSearchParams({
    utm_source: 'app_cta',
    utm_medium: 'pricing_free_card',
    utm_campaign: 'start_free',
}).toString()}`;

/**
 * #1475 G12 pricing: ONE product presented as a sequence (30 days free, then $10/month), never as competing tiers,
 * so there is no "Most popular" badge. The paid card is a live checkout control only when payments are enabled;
 * otherwise it is a non-clickable notice that emits no paid-offer view, click or checkout event.
 */
export const LandingPricingSection = () => {
    const paymentsEnabled = arePaymentsEnabled();
    const [isStartingCheckout, setIsStartingCheckout] = useState(false);

    useEffect(() => {
        trackConversionCtaViewed({ source: 'pricing_free_card', plan: 'free' });
        if (paymentsEnabled) trackConversionCtaViewed({ source: 'pricing_pro_card', plan: 'pro' });
    }, [paymentsEnabled]);

    const handleContinue = async () => {
        if (!paymentsEnabled || isStartingCheckout) return;
        setIsStartingCheckout(true);
        trackConversionCtaClicked({ source: 'pricing_pro_card', plan: 'pro' });
        try {
            await startProCheckout('pricing_pro_card');
        } catch (err: unknown) {
            logger.error({ err }, 'Error creating Stripe checkout session from the landing pricing section:');
            toast.error('Unable to start checkout. Please try again or contact support if it continues.');
            setIsStartingCheckout(false);
        }
    };

    return (
        <section aria-label="Pricing" className="w-full bg-background pb-14 md:pb-20">
            <div className="mx-auto max-w-5xl px-4 md:px-6">
                <h2 className="text-3xl font-bold tracking-tight text-foreground [text-wrap:balance] sm:text-4xl">
                    One product. {LANDING_OFFER_SHORT}
                </h2>
                <div className="mt-8 flex flex-wrap gap-5">
                    <article
                        data-signup-decision
                        className="flex min-w-0 flex-[1_1_18rem] flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground"
                    >
                        <h3 className="text-xl font-bold">Your first 30 days</h3>
                        <p className="text-[17px] leading-relaxed">
                            <span className="text-4xl font-bold text-landing-money">$0</span>
                            <span className="ml-2 font-semibold">no card required</span>
                        </p>
                        <p className="text-[17px] font-semibold leading-relaxed">{LANDING_OFFER_SHORT}</p>
                        <p className="text-[17px] leading-relaxed text-foreground/80">
                            The complete Private Practice product: Open Mic and Focus Points.
                        </p>
                        <Link
                            to={TRIAL_SIGNUP_HREF}
                            onClick={() => trackConversionCtaClicked({ source: 'pricing_free_card', plan: 'free' })}
                            className="mt-auto inline-flex h-12 items-center justify-center whitespace-nowrap rounded-md bg-landing-ink px-6 text-base font-bold text-landing-ink-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            Start free
                        </Link>
                    </article>

                    <article className="flex min-w-0 flex-[1_1_18rem] flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground">
                        <h3 className="text-xl font-bold">After your trial</h3>
                        <p className="text-[17px] leading-relaxed">
                            <span className="text-4xl font-bold text-landing-money">$10</span>
                            <span className="ml-1 text-[17px] font-semibold text-landing-money">/month</span>
                        </p>
                        <p className="text-[17px] font-semibold leading-relaxed">Cancel any time.</p>
                        <p className="text-[17px] leading-relaxed text-foreground/80">The same complete product, after your first 30 days.</p>
                        {paymentsEnabled ? (
                            <Button
                                type="button"
                                size="lg"
                                variant="outline"
                                className="mt-auto h-12 whitespace-nowrap text-base font-bold"
                                onClick={() => { void handleContinue(); }}
                                disabled={isStartingCheckout}
                            >
                                {isStartingCheckout ? 'Starting checkout...' : 'Continue for $10/month'}
                            </Button>
                        ) : (
                            <div
                                data-testid="landing-pro-unavailable"
                                className="mt-auto rounded-md border border-border bg-muted/40 px-4 py-3"
                            >
                                <p className="text-[17px] font-semibold">{PAID_CONTINUATION_UNAVAILABLE.title}</p>
                                <p className="mt-1 text-[17px] leading-relaxed text-foreground/80">{PAID_CONTINUATION_UNAVAILABLE.detail}</p>
                            </div>
                        )}
                    </article>
                </div>
                <ul className="mt-6 flex flex-wrap gap-3" aria-label="Offer details">
                    {offerDisclosureChips(paymentsEnabled).map((label) => (
                        <li
                            key={label}
                            data-testid="offer-disclosure-chip"
                            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground"
                        >
                            <ShieldCheck className="size-4 text-landing-privacy" aria-hidden="true" />
                            {label}
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
};
