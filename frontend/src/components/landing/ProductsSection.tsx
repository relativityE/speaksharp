import { BarChart3, Mic } from 'lucide-react';
import { PRODUCT_NAMES } from '@/constants/productNames';

/**
 * #1475 G12 Rev 2 §2 section 3 — the two product entries on white. Open Mic keeps the repository description
 * verbatim; Focus Points keeps the #1377 detection language locked by the public copy contract (ruling E on #1475).
 * The Focus Points card is distinguished by content, not hue (no product purple on this page).
 *
 * Each card keeps ONE entry control on the page's existing handler — content-free practice telemetry, then account
 * access that preserves the product intent. That control is a deliberate deviation from Appendix A (ruling A1):
 * these are the tested #1061 signed-out entry journeys. Its visible label is its accessible name.
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
            description: 'Start a Private practice recording whenever you are ready. Speak freely, then review the transcript and coaching.',
            Icon: Mic,
            signature: true,
            testid: 'practice-card-freeform',
            onClick: onStartFreeform,
        },
        {
            title: PRODUCT_NAMES.objective,
            // #1377 approved Focus Points detection language — locked by tests/release/public-product-copy-contract.
            description: 'Optionally name the points you want to cover. See which points were detected — and what to retry.',
            Icon: BarChart3,
            signature: false,
            testid: 'practice-card-objective',
            onClick: onStartObjective,
        },
    ];

    return (
        <section
            aria-label="Products"
            className="w-full border-b border-neutral-border-soft bg-neutral-page px-5 py-11 md:px-7 lg:px-[34px]"
        >
            <div className="flex flex-wrap items-stretch gap-4">
                {products.map(({ title, description, Icon, signature, testid, onClick }) => (
                    <article
                        key={testid}
                        data-testid={`${testid}-card`}
                        className={`flex min-w-0 flex-[1_1_320px] flex-col rounded-[14px] border border-t-[3px] border-neutral-border px-7 pb-7 pt-[26px] ${
                            signature ? 'border-t-signature' : 'border-t-neutral-border-strong'
                        }`}
                    >
                        <div className="mb-[15px] flex items-center gap-3">
                            <span
                                className={`flex size-[42px] shrink-0 items-center justify-center rounded-[10px] ${
                                    signature ? 'bg-signature-ground text-signature-text' : 'bg-neutral-band text-neutral-secondary'
                                }`}
                            >
                                <Icon className="size-[21px]" aria-hidden="true" />
                            </span>
                            <h3 className="text-[22px] font-extrabold tracking-[-0.025em] text-neutral-heading">{title}</h3>
                        </div>
                        <p className="text-[17px] font-medium leading-[1.6] text-neutral-body">{description}</p>
                        <button
                            type="button"
                            onClick={onClick}
                            data-testid={testid}
                            className="mt-5 inline-flex min-h-[44px] items-center justify-center self-start whitespace-nowrap rounded-[11px] border border-neutral-border-strong bg-neutral-page px-5 text-base font-extrabold text-neutral-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature-text focus-visible:ring-offset-2"
                        >
                            {`Start ${title}`}
                        </button>
                    </article>
                ))}
            </div>
        </section>
    );
};
