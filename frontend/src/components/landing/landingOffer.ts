/**
 * The homepage's offer, CTA and pricing strings.
 *
 * G17 (LANDING_TERMS_DELTA L1–L5, LANDING_PAGE_SPEC §5.1/§5.4/§5.5, 2026-09-19): the commercial terms appear exactly
 * twice on this route — the hero terms line and the pricing block — and `no card` appears nowhere. The closing band
 * states neither a trial claim nor a price; PO + PM accepted that as superseding #1470's closing-band requirement
 * (#1470's rule still holds: no trial claim ships without its post-trial price, and the hero pairs the two).
 *
 * The pricing strings here are the LANDING's own. `/pricing` keeps the shared `pricingTiers` / `offerDisclosure`
 * copy until its own follow-up; this route must not change it (delta scope: the unauthenticated landing only).
 */
export const HERO_LINE = 'Speak. See what to fix. Say it again. Your audio never leaves the browser.';

/** L1 mention 1 — one line beside the hero CTA; `price` renders in the money role. */
export const HERO_TERMS = Object.freeze({ lead: 'Free for 30 days, ', price: '$10/month', tail: ' after.' });

/** L5 — the ONE trial-CTA label on the route (Designer 2026-09-19: says what happens when you press it). */
export const LANDING_TRIAL_CTA = 'Start your session';

/** Closing band: its value sentence only — no trial claim, no price. */
export const CLOSING_VALUE = 'Your recordings stay Private on this device.';

/** The repository's signed-out signup destination (see the `/auth/signup` route in App.tsx). */
export const LANDING_SIGNUP_ROUTE = '/auth/signup';

/** L4 — the pricing block names the section; the sub-line carries the one-product point. */
export const LANDING_PRICING_HEADING = 'Pricing';
export const LANDING_PRICING_SUBLINE = 'The trial is the complete product. Nothing is held back.';

export interface LandingTier {
    plan: 'free' | 'pro';
    name: string;
    label: string;
    price: string;
    features: readonly string[];
}

/** L4 card copy (G17). Both cards describe the same complete product; they differ only by trial vs continuation. */
export const LANDING_TIERS: readonly [LandingTier, LandingTier] = [
    {
        plan: 'free',
        name: 'Free trial',
        label: 'First 30 days',
        price: '$0',
        features: [
            'Open Mic and Focus Points sessions',
            'Full feedback and review after every run',
            'Private transcription, audio stays local',
        ],
    },
    {
        plan: 'pro',
        name: 'Pro',
        label: 'Per month, after trial',
        price: '$10',
        features: ['Everything in the trial, unchanged', 'Your session history keeps building', 'Cancel any time'],
    },
];

/** §5.4 enabled: the paid control's label. */
export const LANDING_PRO_CTA = 'Continue for $10/month';

/**
 * L3 / §5.4 disabled: a plain, forward-looking line in the paid control's slot — never an apology, never the
 * product's build state, never a control.
 */
export const LANDING_PRO_UNAVAILABLE_LINE = 'Available at the end of your trial.';

/**
 * §5.5: the two unconditional factual chips (no cards, billing or trial length), plus a third ONLY when
 * payments are enabled.
 *
 * #1522 — THE DISABLED STATE SAYS NOTHING ABOUT PAYMENT, RATHER THAN SAYING SOMETHING REASSURING.
 *
 * The disabled third chip used to read "Paid continuation opens later — nothing is charged today". PO
 * removed it, and it is NOT replaced: any substitute — a launch date, a reassurance, a "nothing is
 * charged" of another wording — is the same promise in different words, and the landing page has no
 * business making one while there is nothing to buy. The two retained chips are facts about privacy
 * and data that hold in both states.
 *
 * When payments ARE enabled the third chip is unchanged: Stripe confirmation is a fact about a
 * transaction the user can actually make.
 */
export function landingDisclosureChips(
    paymentsEnabled: boolean,
): readonly [string, string, string] | readonly [string, string] {
    const factual: readonly [string, string] = [
        'Private transcription keeps audio local',
        'Transcript data supports SpeakSharp features',
    ];
    return paymentsEnabled ? [...factual, 'Pro continues only after Stripe confirmation'] : factual;
}
