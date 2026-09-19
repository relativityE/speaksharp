import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Mic } from 'lucide-react';
import { APP_TAGLINE } from '@/config';
import { trackConversionCtaClicked, trackConversionCtaViewed } from '@/services/conversionFunnel';
import { HeroWaveform } from './HeroWaveformBars';
import { HERO_LINE, HERO_TERMS, LANDING_SIGNUP_ROUTE, LANDING_TRIAL_CTA } from './landingOffer';

// The repository tagline is the source of truth; its second sentence takes the signature colour.
const TAGLINE_SPLIT = APP_TAGLINE.indexOf('. ') + 1;
const TAGLINE_LEAD = APP_TAGLINE.slice(0, TAGLINE_SPLIT);
const TAGLINE_ACCENT = APP_TAGLINE.slice(TAGLINE_SPLIT).trim();

/**
 * #1475 G12 Rev 2 hero — full-bleed ink, ONE column (no empty grid cell left where the sample dashboard used to sit),
 * and the decorative waveform as a full-bleed band at the bottom. G17 L1: no badge, and the terms are ONE line beside
 * the CTA at reading size (18px; the price at 800 in the money role), so #1470 holds.
 * The global Navigation is fixed, so the top padding is the header height plus Rev 2's 56px.
 */
export const LandingHero = () => {
    useEffect(() => {
        trackConversionCtaViewed({ source: 'hero_primary' });
    }, []);

    return (
        <section
            aria-label="Hero"
            className="w-full bg-ink px-5 pt-[calc(var(--header-height)+56px)] md:px-7 lg:px-[34px]"
        >
            <div className="max-w-[760px]" data-signup-decision>
                <h1 className="mb-[22px] text-4xl font-extrabold leading-[1.08] tracking-[-0.042em] text-white [text-wrap:balance] md:text-[46px] md:leading-[1.03] lg:text-[62px]">
                    {TAGLINE_LEAD}{' '}
                    <br />
                    <span className="text-signature">{TAGLINE_ACCENT}</span>
                </h1>
                <p className="mb-8 max-w-[540px] text-lg font-medium leading-normal text-ink-text md:text-[21px]">
                    {HERO_LINE}
                </p>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-4 pb-2">
                    <Link
                        to={LANDING_SIGNUP_ROUTE}
                        data-testid="practice-hero-start-free"
                        onClick={() => trackConversionCtaClicked({ source: 'hero_primary' })}
                        className="inline-flex h-[58px] w-full max-w-[420px] items-center justify-center gap-[11px] whitespace-nowrap rounded-xl bg-signature px-7 text-[17px] font-extrabold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature focus-visible:ring-offset-2 focus-visible:ring-offset-ink md:w-auto"
                    >
                        <Mic className="size-[21px]" aria-hidden="true" />
                        {LANDING_TRIAL_CTA}
                    </Link>
                    <p className="text-lg font-bold text-ink-text" data-testid="hero-terms">
                        {HERO_TERMS.lead}
                        <span className="font-extrabold text-money-on-ink">{HERO_TERMS.price}</span>
                        {HERO_TERMS.tail}
                    </p>
                </div>
            </div>
            <div className="-mx-5 mt-[34px] md:-mx-7 lg:-mx-[34px]">
                <HeroWaveform />
            </div>
        </section>
    );
};
