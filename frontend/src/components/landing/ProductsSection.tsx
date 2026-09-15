import { Mic, ShieldCheck, Target } from 'lucide-react';
import { PRODUCT_NAMES } from '@/constants/productNames';
import { LANDING_OFFER_SHORT } from './landingOffer';

/**
 * #1475 G12 — the two product entries on the signed-out homepage. The actions are the page's existing product
 * handlers (content-free practice telemetry, then account access that preserves the product intent), so this
 * section changes presentation only. Both cards share one responsive flex basis, and the offer sits in the same
 * decision unit because each action leads a signed-out visitor to signup.
 */
export const ProductsSection = ({
    onStartFreeform,
    onStartObjective,
}: {
    onStartFreeform: () => void;
    onStartObjective: () => void;
}) => {
    const products = [
        {
            title: PRODUCT_NAMES.freeform,
            description: 'Start a practice take whenever you are ready. Speak freely, then see what to fix.',
            Icon: Mic,
            testid: 'practice-card-freeform',
            ctaAria: 'Start your session',
            onClick: onStartFreeform,
        },
        {
            title: PRODUCT_NAMES.objective,
            // #1377 approved Focus Points detection language — locked by tests/release/public-product-copy-contract.
            description: 'Prepare the points you need to cover. See which points were detected — and what to retry.',
            Icon: Target,
            testid: 'practice-card-objective',
            ctaAria: `Start ${PRODUCT_NAMES.objective}`,
            onClick: onStartObjective,
        },
    ];

    return (
        <section aria-label="Products" className="w-full bg-background py-14 md:py-20" data-signup-decision>
            <div className="mx-auto max-w-5xl px-4 md:px-6">
                <h2 className="text-3xl font-bold tracking-tight text-foreground [text-wrap:balance] sm:text-4xl">
                    Two ways to practice
                </h2>
                <p className="mt-3 text-[17px] font-semibold leading-relaxed text-foreground">
                    {LANDING_OFFER_SHORT} No card required to start.
                </p>
                <div className="mt-8 flex flex-wrap gap-5">
                    {products.map(({ title, description, Icon, testid, ctaAria, onClick }) => (
                        <article
                            key={testid}
                            data-testid={`${testid}-card`}
                            className="flex min-w-0 flex-[1_1_18rem] flex-col gap-3 rounded-lg border border-border bg-card p-6 text-card-foreground"
                        >
                            <Icon className="size-7 text-foreground" aria-hidden="true" />
                            <h3 className="text-xl font-bold">{title}</h3>
                            <p className="text-[17px] leading-relaxed text-foreground/80">{description}</p>
                            <button
                                type="button"
                                onClick={onClick}
                                data-testid={testid}
                                data-signup-action
                                aria-label={ctaAria}
                                className="mt-auto inline-flex h-12 items-center justify-center whitespace-nowrap rounded-md border border-foreground/20 bg-background px-6 text-base font-bold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                                Start your session
                            </button>
                        </article>
                    ))}
                </div>
                <p className="mt-6 flex items-start gap-2 text-[17px] leading-relaxed text-foreground/80">
                    <ShieldCheck className="mt-1 size-5 shrink-0 text-landing-privacy" aria-hidden="true" />
                    <span>Every recording uses on-device Private transcription, so your practice audio stays on your device.</span>
                </p>
            </div>
        </section>
    );
};
