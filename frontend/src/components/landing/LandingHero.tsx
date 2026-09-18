import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Mic, Star } from 'lucide-react';
import { APP_TAGLINE } from '@/config';
import { trackConversionCtaClicked, trackConversionCtaViewed } from '@/services/conversionFunnel';
import { HeroWaveform } from './HeroWaveformBars';
import { HERO_BADGE, HERO_LINE, HERO_TERMS_PRICE, HERO_TERMS_TRIAL, LANDING_SIGNUP_ROUTE } from './landingOffer';

// The repository tagline is the source of truth; its second sentence takes the signature colour.
const TAGLINE_SPLIT = APP_TAGLINE.indexOf('. ') + 1;
const TAGLINE_LEAD = APP_TAGLINE.slice(0, TAGLINE_SPLIT);
const TAGLINE_ACCENT = APP_TAGLINE.slice(TAGLINE_SPLIT).trim();

/**
 * #1475 G12 Rev 2 hero — full-bleed ink, ONE column (no empty grid cell left where the sample dashboard used to sit),
 * the terms stated in full under the CTA at 18px, and the decorative waveform as a full-bleed band at the bottom.
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
                <p className="mb-[26px] inline-flex items-center gap-2 rounded-full border border-ink-hairline bg-ink-raised px-[15px] py-2">
                    <Star className="size-[13px] fill-signature text-signature" aria-hidden="true" />
                    <span className="text-[13px] font-extrabold tracking-[0.03em] text-ink-text">{HERO_BADGE}</span>
                </p>
                <h1 className="mb-[22px] text-4xl font-extrabold leading-[1.08] tracking-[-0.042em] text-white [text-wrap:balance] md:text-[46px] md:leading-[1.03] lg:text-[62px]">
                    {TAGLINE_LEAD}{' '}
                    <br />
                    <span className="text-signature">{TAGLINE_ACCENT}</span>
                </h1>
                <p className="mb-8 max-w-[540px] text-lg font-medium leading-normal text-ink-text md:text-[21px]">
                    {HERO_LINE}
                </p>
                <div className="mb-[22px] flex flex-wrap items-center gap-4">
                    <Link
                        to={LANDING_SIGNUP_ROUTE}
                        data-testid="practice-hero-start-free"
                        onClick={() => trackConversionCtaClicked({ source: 'hero_primary' })}
                        className="inline-flex h-[58px] w-full max-w-[420px] items-center justify-center gap-[11px] whitespace-nowrap rounded-xl bg-signature px-7 text-[17px] font-extrabold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature focus-visible:ring-offset-2 focus-visible:ring-offset-ink md:w-auto"
                    >
                        <Mic className="size-[21px]" aria-hidden="true" />
                        Try it out!
                    </Link>
                </div>
                <div className="pb-2">
                    <p className="text-lg font-extrabold text-white">{HERO_TERMS_TRIAL}</p>
                    <p className="mt-1 text-lg font-bold text-money-on-ink">{HERO_TERMS_PRICE}</p>
                </div>
            </div>
            <div className="-mx-5 mt-[34px] md:-mx-7 lg:-mx-[34px]">
                <HeroWaveform />
            </div>
        </section>
    );
};
