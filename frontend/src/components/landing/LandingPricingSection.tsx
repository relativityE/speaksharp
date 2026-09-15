import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';
import { trackConversionCtaClicked, trackConversionCtaViewed } from '@/services/conversionFunnel';
import { startProCheckout } from '@/services/proCheckout';
import { offerDisclosureChips, PAID_CONTINUATION_UNAVAILABLE } from '@/components/pricing/offerDisclosure';
import { PRICING_HEADING, PRICING_TIERS, pricingIntro, type PricingTier } from '@/components/pricing/pricingTiers';
import { toast } from '@/lib/toast';
import logger from '@/lib/logger';
import { LANDING_SIGNUP_ROUTE } from './landingOffer';

const TRIAL_SIGNUP_HREF = `${LANDING_SIGNUP_ROUTE}?${new URLSearchParams({
    utm_source: 'app_cta',
    utm_medium: 'pricing_free_card',
    utm_campaign: 'start_free',
}).toString()}`;

const PRICE_TOKEN = '$10/month';

/** The repository intro, with the price set in the money role rather than as body text. */
const PricedIntro = ({ text }: { text: string }) => {
    const at = text.indexOf(PRICE_TOKEN);
    if (at < 0) return <>{text}</>;
    return (
        <>
            {text.slice(0, at)}
            <strong className="font-extrabold text-landing-money">{PRICE_TOKEN}</strong>
            {text.slice(at + PRICE_TOKEN.length)}
        </>
    );
};

/** One lifecycle card. `bottomPadding` offsets the 2px signature border so both 52px controls share a baseline. */
const PriceCard = ({ tier, signature, children }: { tier: PricingTier; signature: boolean; children: ReactNode }) => (
    <article
        className={`flex min-w-0 flex-[1_1_320px] flex-col rounded-[14px] bg-landing-page px-7 pt-7 ${
            signature ? 'border-2 border-landing-signature pb-[29px]' : 'border border-landing-border pb-[30px]'
        }`}
    >
        <h3 className="mb-1.5 text-[22px] font-extrabold tracking-[-0.02em] text-landing-heading">{tier.name}</h3>
        <p className="mb-4 text-base font-semibold text-landing-body">{tier.priceDescription}</p>
        <p className="mb-[26px] flex items-baseline gap-2">
            <span className="text-[42px] font-extrabold leading-none tracking-[-0.04em] text-landing-money md:text-[50px]">{tier.price}</span>
            {tier.plan === 'pro' && <span className="text-xl font-bold text-landing-money-soft">/month</span>}
        </p>
        <ul className="mb-7 flex flex-col gap-3">
            {tier.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-base font-semibold leading-normal text-landing-body">
                    <CheckCircle2
                        className={`mt-[3px] size-4 shrink-0 ${signature ? 'text-landing-signature-text' : 'text-landing-muted'}`}
                        aria-hidden="true"
                    />
                    <span>{feature}</span>
                </li>
            ))}
        </ul>
        <div className="mt-auto">{children}</div>
    </article>
);

/**
 * #1475 G12 Rev 2 §5 — one product as two lifecycle states, never competing tiers, so there is no "Most popular"
 * badge. Tier copy, heading, intro and chips come verbatim from the repository (shared with the Pricing page). The
 * paid card's geometry is identical in both payment states; only its control and the third chip change. With
 * payments disabled the price is still shown, the trial stays actionable, and the paid slot is a non-focusable
 * notice that emits no conversion, checkout or Stripe event.
 */
export const LandingPricingSection = () => {
    const paymentsEnabled = arePaymentsEnabled();
    const [isStartingCheckout, setIsStartingCheckout] = useState(false);
    const [trial, pro] = PRICING_TIERS;

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
        <section
            aria-label="Pricing"
            data-signup-decision
            className="w-full border-t border-landing-border-soft bg-landing-band px-5 pb-[50px] pt-[46px] md:px-7 lg:px-[34px]"
        >
            <div className="mx-auto mb-8 max-w-[680px] text-center">
                <h2 className="mb-[13px] text-[32px] font-extrabold tracking-[-0.035em] text-landing-heading [text-wrap:balance] lg:text-[38px]">
                    {PRICING_HEADING}
                </h2>
                <p className="text-[17px] font-semibold leading-[1.55] text-landing-body md:text-[19px]">
                    <PricedIntro text={pricingIntro(paymentsEnabled)} />
                </p>
            </div>
            <div className="mx-auto flex max-w-[820px] flex-wrap items-stretch gap-4">
                <PriceCard tier={trial} signature={false}>
                    <Link
                        to={TRIAL_SIGNUP_HREF}
                        onClick={() => trackConversionCtaClicked({ source: 'pricing_free_card', plan: 'free' })}
                        className="box-border flex h-[52px] w-full items-center justify-center rounded-[11px] border border-landing-border-strong bg-landing-page text-base font-extrabold text-landing-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-signature-text focus-visible:ring-offset-2"
                    >
                        {trial.cta}
                    </Link>
                </PriceCard>
                <PriceCard tier={pro} signature>
                    {paymentsEnabled ? (
                        <Button
                            type="button"
                            onClick={() => { void handleContinue(); }}
                            disabled={isStartingCheckout}
                            className="box-border h-[52px] w-full rounded-[11px] bg-landing-signature text-base font-extrabold text-landing-ink hover:bg-landing-signature hover:brightness-95 focus-visible:ring-2 focus-visible:ring-landing-signature-text focus-visible:ring-offset-2"
                        >
                            {isStartingCheckout ? 'Starting checkout...' : pro.cta}
                        </Button>
                    ) : (
                        <div
                            data-testid="landing-pro-unavailable"
                            className="box-border flex h-[52px] w-full items-center justify-center rounded-[11px] border border-landing-border bg-landing-band px-3 text-center text-[15px] font-bold text-landing-secondary"
                        >
                            {PAID_CONTINUATION_UNAVAILABLE.title}
                        </div>
                    )}
                </PriceCard>
            </div>
            <ul aria-label="Offer details" className="mx-auto mt-[26px] flex max-w-[820px] flex-wrap justify-start gap-[10px] md:justify-center">
                {offerDisclosureChips(paymentsEnabled).map((label) => (
                    <li
                        key={label}
                        data-testid="offer-disclosure-chip"
                        className="inline-flex items-center gap-2 rounded-full border border-landing-border bg-landing-page px-[17px] py-2.5 text-[15px] font-semibold text-landing-body"
                    >
                        <ShieldCheck className="size-[15px] shrink-0 text-landing-status" aria-hidden="true" />
                        {label}
                    </li>
                ))}
            </ul>
        </section>
    );
};
