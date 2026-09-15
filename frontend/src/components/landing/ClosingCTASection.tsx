import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { trackConversionCtaClicked, trackConversionCtaViewed } from '@/services/conversionFunnel';
import { LANDING_OFFER_SHORT, LANDING_SIGNUP_ROUTE } from './landingOffer';

/** #1475 G12 closing CTA — full-bleed ink, and the complete sequential offer next to the signup action (#1470). */
export const ClosingCTASection = () => {
    useEffect(() => {
        trackConversionCtaViewed({ source: 'landing_cta' });
    }, []);

    return (
        <section aria-label="Call to Action" className="w-full bg-landing-ink text-landing-ink-foreground">
            <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 px-4 py-14 text-center md:px-6 md:py-20" data-signup-decision>
                <h2 className="text-3xl font-bold leading-tight tracking-tight [text-wrap:balance] sm:text-4xl">
                    Ready to practice before it <span className="text-landing-signature">matters?</span>
                </h2>
                <p className="text-[17px] font-semibold leading-relaxed">
                    {LANDING_OFFER_SHORT} No card required to start.
                </p>
                <Link
                    to={LANDING_SIGNUP_ROUTE}
                    onClick={() => trackConversionCtaClicked({ source: 'landing_cta' })}
                    className="inline-flex h-14 items-center gap-2 whitespace-nowrap rounded-md bg-landing-signature px-8 text-base font-bold text-landing-signature-foreground transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-signature focus-visible:ring-offset-2 focus-visible:ring-offset-landing-ink motion-reduce:transition-none"
                >
                    Try it out!
                    <ArrowRight className="size-5" aria-hidden="true" />
                </Link>
            </div>
        </section>
    );
};
