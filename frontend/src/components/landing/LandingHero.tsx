import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { trackConversionCtaClicked, trackConversionCtaViewed } from '@/services/conversionFunnel';
import { HeroWaveform } from './HeroWaveformBars';
import { APP_TAGLINE } from '@/config';
import { LANDING_OFFER_FULL, LANDING_SIGNUP_ROUTE } from './landingOffer';

// The repository tagline is the source of truth; the second sentence takes the signature accent.
const TAGLINE_SPLIT = APP_TAGLINE.indexOf('. ') + 1;
const TAGLINE_LEAD = APP_TAGLINE.slice(0, TAGLINE_SPLIT);
const TAGLINE_ACCENT = APP_TAGLINE.slice(TAGLINE_SPLIT).trim();

/**
 * #1475 G12 hero. Full-bleed ink; the desktop right half is deliberately EMPTY negative space (Product Owner
 * direction: no sample card, dashboard, screenshot, illustration or replacement widget). On mobile the hero is one
 * natural column with no empty column preserved.
 */
export const LandingHero = () => {
    useEffect(() => {
        trackConversionCtaViewed({ source: 'hero_primary' });
    }, []);

    return (
        <section aria-label="Hero" className="w-full bg-landing-ink text-landing-ink-foreground">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 pb-14 pt-28 md:px-6 md:pb-20 md:pt-32 lg:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-6" data-signup-decision>
                    <h1 className="text-5xl font-extrabold leading-[1.05] tracking-tight [text-wrap:balance] sm:text-6xl lg:text-[72px]">
                        {TAGLINE_LEAD}{' '}
                        <span className="text-landing-signature">{TAGLINE_ACCENT}</span>
                    </h1>
                    <p className="text-xl font-semibold leading-snug text-landing-ink-foreground sm:text-2xl">
                        Speak. See what to fix. Say it again.
                    </p>
                    <div className="flex flex-col items-start gap-4">
                        <Link
                            to={LANDING_SIGNUP_ROUTE}
                            data-testid="practice-hero-start-free"
                            onClick={() => trackConversionCtaClicked({ source: 'hero_primary' })}
                            className="inline-flex h-14 items-center gap-2 whitespace-nowrap rounded-md bg-landing-signature px-8 text-base font-bold text-landing-signature-foreground transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-signature focus-visible:ring-offset-2 focus-visible:ring-offset-landing-ink motion-reduce:transition-none"
                        >
                            Try it out!
                            <ArrowRight className="size-5" aria-hidden="true" />
                        </Link>
                        <p className="text-[17px] font-semibold leading-relaxed text-landing-ink-foreground">
                            {LANDING_OFFER_FULL}
                        </p>
                    </div>
                    <HeroWaveform className="mt-2" />
                </div>
                {/* Intentionally empty on desktop; not rendered as a column on smaller screens. */}
                <div aria-hidden="true" className="hidden lg:block" />
            </div>
        </section>
    );
};
