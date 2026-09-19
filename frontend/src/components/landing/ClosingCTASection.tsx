import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Mic } from 'lucide-react';
import { trackConversionCtaClicked, trackConversionCtaViewed } from '@/services/conversionFunnel';
import { CLOSING_VALUE, LANDING_SIGNUP_ROUTE, LANDING_TRIAL_CTA } from './landingOffer';

/**
 * #1475 G12 Rev 2 §2 section 6 — the closing band on ink. Its H2 is one step below the section H2s on purpose.
 * G17 L1: it keeps its value sentence and button and states NO trial claim and NO price — a price quoted at the
 * moment of the last click reads as pressure. PO + PM accepted this as superseding #1470's closing-band copy.
 */
export const ClosingCTASection = () => {
    useEffect(() => {
        trackConversionCtaViewed({ source: 'landing_cta' });
    }, []);

    return (
        <section
            aria-label="Call to Action"
            data-signup-decision
            className="w-full bg-ink px-5 pb-[52px] pt-12 text-center md:px-7 lg:px-[34px]"
        >
            <h2 className="mb-[14px] text-[30px] font-extrabold leading-[1.15] tracking-[-0.035em] text-white [text-wrap:balance] lg:text-[36px]">
                Ready to practice before it <span className="text-signature">matters?</span>
            </h2>
            <p className="mx-auto mb-7 max-w-[580px] text-[17px] font-medium leading-[1.55] text-ink-text md:text-[19px]">
                {CLOSING_VALUE}
            </p>
            <Link
                to={LANDING_SIGNUP_ROUTE}
                onClick={() => trackConversionCtaClicked({ source: 'landing_cta' })}
                className="mx-auto inline-flex h-[58px] w-full max-w-[420px] items-center justify-center gap-[11px] whitespace-nowrap rounded-xl bg-signature px-8 text-[17px] font-extrabold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature focus-visible:ring-offset-2 focus-visible:ring-offset-ink md:w-auto"
            >
                <Mic className="size-[21px]" aria-hidden="true" />
                {LANDING_TRIAL_CTA}
            </Link>
        </section>
    );
};
