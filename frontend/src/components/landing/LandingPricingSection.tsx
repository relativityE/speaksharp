import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { arePaymentsEnabled } from '@/config/appRuntimeConfig';
import { trackConversionCtaClicked, trackConversionCtaViewed } from '@/services/conversionFunnel';
import {
    LANDING_PRICING_HEADING,
    LANDING_PRICING_SUBLINE,
    LANDING_PRO_CTA,
    LANDING_PRO_UNAVAILABLE_LINE,
    LANDING_SIGNUP_ROUTE,
    LANDING_TIERS,
    LANDING_TRIAL_CTA,
    landingDisclosureChips,
    type LandingTier,
} from './landingOffer';

const TRIAL_SIGNUP_HREF = `${LANDING_SIGNUP_ROUTE}?${new URLSearchParams({
    utm_source: 'app_cta',
    utm_medium: 'pricing_free_card',
    utm_campaign: 'start_free',
}).toString()}`;

/**
 * Where the paid card sends a SIGNED-OUT visitor. This page is signed-out only, so its paid control must not
 * start checkout: `stripe-checkout` is an authenticated Edge Function and an anonymous invoke fails, which is
 * an error where the user expected checkout. It routes to signup instead and carries `/pricing` as the
 * post-auth return destination through the repository's existing `location.state.from` deep-link, which
 * `postAuthRouting` already guards against open-redirect. The visitor signs up, lands back on Pricing, and
 * starts checkout there as an authenticated user.
 */
const PRO_SIGNUP_RETURN = { from: { pathname: '/pricing' } } as const;

/**
 * One lifecycle card. G17 (Designer 2026-09-19, supersedes the 2px signature Pro border): BOTH cards take the same
 * 1px `neutral-border` token — yellow is the page's one action colour, and a yellow border on the only card you
 * cannot act on points emphasis the wrong way. The trial card is distinguished by holding the button. Equal borders
 * and equal padding also keep both 52px control slots on one baseline.
 *
 * Both lists take ONE neutral mark (the `neutral-muted` token; Designer 2026-09-19, supersedes G17's green and the
 * amber Pro marks): green is the status role, reserved for the disclosure-chip shields; amber is the action colour on
 * a mark that is not an action; and two colours for the same element would imply the lists differ in kind when both
 * describe the same product.
 */
const PriceCard = ({ tier, children }: { tier: LandingTier; children: ReactNode }) => (
    <article
        className="flex min-w-0 flex-[1_1_320px] flex-col rounded-[14px] border border-neutral-border bg-neutral-page px-7 pb-[30px] pt-7"
    >
        <h3 className="mb-1.5 text-[22px] font-extrabold tracking-[-0.02em] text-neutral-heading">{tier.name}</h3>
        <p className="mb-4 text-base font-semibold text-neutral-body">{tier.label}</p>
        <p className="mb-[26px] flex items-baseline gap-2">
            <span className="text-[42px] font-extrabold leading-none tracking-[-0.04em] text-money md:text-[50px]">{tier.price}</span>
            {tier.plan === 'pro' && <span className="text-xl font-bold text-money-soft">/month</span>}
        </p>
        <ul className="mb-7 flex flex-col gap-3">
            {tier.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-base font-semibold leading-normal text-neutral-body">
                    <CheckCircle2 className="mt-[3px] size-4 shrink-0 text-neutral-muted" aria-hidden="true" />
                    <span>{feature}</span>
                </li>
            ))}
        </ul>
        <div className="mt-auto">{children}</div>
    </article>
);

/**
 * #1475 G12 Rev 2 §5 — one product as two lifecycle states, never competing tiers, so there is no "Most popular"
 * badge. The paid card's geometry is identical in both payment states; only its control and the third chip change.
 *
 * G17 (L2–L4): the landing's own copy (`landingOffer`), not the Pricing page's — heading `Pricing`, the one-product
 * sub-line, no `no card` anywhere. With payments disabled the price is still shown, the trial stays actionable and
 * is the block's ONLY control (so it takes the signature fill), and the paid slot is a plain forward-looking line in
 * the same 52px box: not focusable, no ground or border, and it emits no conversion, checkout or Stripe event.
 *
 * This surface is SIGNED-OUT ONLY, so neither payment state starts checkout from here. With payments enabled the
 * paid control is a signup link carrying `/pricing` as its post-auth return destination; it emits the
 * `pricing_pro_card` click, and deliberately emits no `checkout_started` and makes no `stripe-checkout` call,
 * because that Edge Function is authenticated and an anonymous invoke would surface an error to the visitor.
 */
export const LandingPricingSection = () => {
    const paymentsEnabled = arePaymentsEnabled();
    const [trial, pro] = LANDING_TIERS;

    useEffect(() => {
        trackConversionCtaViewed({ source: 'pricing_free_card', plan: 'free' });
        if (paymentsEnabled) trackConversionCtaViewed({ source: 'pricing_pro_card', plan: 'pro' });
    }, [paymentsEnabled]);

    return (
        <section
            aria-label="Pricing"
            data-signup-decision
            className="w-full border-t border-neutral-border-soft bg-neutral-band px-5 pb-[50px] pt-[46px] md:px-7 lg:px-[34px]"
        >
            <div className="mx-auto mb-8 max-w-[680px] text-center">
                <h2 className="mb-[13px] text-[32px] font-extrabold tracking-[-0.035em] text-neutral-heading [text-wrap:balance] lg:text-[38px]">
                    {LANDING_PRICING_HEADING}
                </h2>
                <p className="text-[17px] font-semibold leading-[1.55] text-neutral-body md:text-[19px]">{LANDING_PRICING_SUBLINE}</p>
            </div>
            <div className="mx-auto flex max-w-[820px] flex-wrap items-stretch gap-4">
                <PriceCard tier={trial}>
                    <Link
                        to={TRIAL_SIGNUP_HREF}
                        onClick={() => trackConversionCtaClicked({ source: 'pricing_free_card', plan: 'free' })}
                        data-testid="landing-trial-cta"
                        className={`box-border flex h-[52px] w-full items-center justify-center rounded-[11px] text-base font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature-text focus-visible:ring-offset-2 ${
                            paymentsEnabled
                                ? 'border border-neutral-border-strong bg-neutral-page text-neutral-heading'
                                : 'bg-signature text-ink hover:brightness-95'
                        }`}
                    >
                        {LANDING_TRIAL_CTA}
                    </Link>
                </PriceCard>
                <PriceCard tier={pro}>
                    {paymentsEnabled ? (
                        <Link
                            to={LANDING_SIGNUP_ROUTE}
                            state={PRO_SIGNUP_RETURN}
                            data-testid="landing-pro-continue"
                            onClick={() => trackConversionCtaClicked({ source: 'pricing_pro_card', plan: 'pro' })}
                            className="box-border flex h-[52px] w-full items-center justify-center rounded-[11px] bg-signature text-base font-extrabold text-ink hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature-text focus-visible:ring-offset-2"
                        >
                            {LANDING_PRO_CTA}
                        </Link>
                    ) : (
                        <p
                            data-testid="landing-pro-unavailable"
                            className="box-border flex h-[52px] w-full items-center justify-center px-3 text-center text-[15px] font-bold text-neutral-secondary"
                        >
                            {LANDING_PRO_UNAVAILABLE_LINE}
                        </p>
                    )}
                </PriceCard>
            </div>
            <ul aria-label="Offer details" className="mx-auto mt-[26px] flex max-w-[820px] flex-wrap justify-start gap-[10px] md:justify-center">
                {landingDisclosureChips(paymentsEnabled).map((label) => (
                    <li
                        key={label}
                        data-testid="offer-disclosure-chip"
                        className="inline-flex items-center gap-2 rounded-full border border-neutral-border bg-neutral-page px-[17px] py-2.5 text-[15px] font-semibold text-neutral-body"
                    >
                        <ShieldCheck className="size-[15px] shrink-0 text-status" aria-hidden="true" />
                        {label}
                    </li>
                ))}
            </ul>
        </section>
    );
};
