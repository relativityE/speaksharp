/**
 * #1266 / #1254 — SpeakSharp is ONE product (the Private Practice Loop). The commercial model is a 30-day free trial
 * of the complete product, then $10/month to continue — NOT a permanent feature-limited Free tier and NOT
 * feature-tiered Private. Both cards describe the SAME product; they differ only by lifecycle (trial vs paid
 * continuation). No invented fair-use numbers appear here — any operational limit is server-authoritative and owned
 * by the entitlement lane (#1282).
 *
 * #1475: the Pricing page and the landing pricing section render this one source verbatim, so their tier copy cannot
 * drift apart.
 */
export interface PricingTier {
    name: string;
    plan: 'free' | 'pro';
    price: string;
    priceDescription: string;
    features: string[];
    cta: string;
    action: 'signup' | 'checkout';
    isPopular?: boolean;
}

export const PRICING_TIERS: readonly PricingTier[] = [
    {
        name: 'Free trial',
        plan: 'free',
        price: '$0',
        priceDescription: 'first 30 days · no card required',
        features: [
            'The complete Private Practice product, free for 30 days',
            'Open Mic and Focus Points, with saved review and comparable Progress',
            'Private on-device transcription after one-time model setup',
            'History and PDF export',
            'No card required to start',
        ],
        cta: 'Start free',
        action: 'signup',
    },
    {
        name: 'Pro',
        plan: 'pro',
        price: '$10',
        priceDescription: 'per month, after your 30-day trial',
        features: [
            'Everything in the trial — the same complete product',
            'Keep practicing after your first 30 days',
            'Open Mic, Focus Points, saved review, Progress, History, and PDF',
            'Private on-device transcription stays the foundation',
        ],
        cta: 'Continue for $10/month',
        action: 'checkout',
        isPopular: true,
    },
];

/** The Pricing page's header copy, state-specific, shared with the landing pricing section. */
export const PRICING_HEADING = 'One product. Free for 30 days.';
export function pricingIntro(paymentsEnabled: boolean): string {
    return paymentsEnabled
        ? 'The complete Private Practice product is free for your first 30 days — no card required. After that, continue for $10/month.'
        : 'The complete Private Practice product is free for your first 30 days — no card required. Paid continuation ($10/month) opens when Pro enrollment is enabled.';
}
