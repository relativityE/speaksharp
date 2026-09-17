/**
 * The governed offer-disclosure copy, shared by every surface that presents the 30-day / $10 offer, so the
 * Pricing page and the landing pricing section cannot state different terms. The third chip is state-specific.
 */
export function offerDisclosureChips(paymentsEnabled: boolean): readonly [string, string, string] {
    return [
        'Private transcription keeps audio local',
        'Transcript data supports SpeakSharp features',
        paymentsEnabled ? 'Pro continues only after Stripe confirmation' : 'No card is collected until paid continuation opens',
    ];
}

/** The non-clickable state shown in place of paid checkout while enrollment is closed. */
export const PAID_CONTINUATION_UNAVAILABLE = Object.freeze({
    title: "Paid continuation isn't open yet.",
    detail: 'The complete product is free for your first 30 days — no card required. Paid continuation ($10/month) opens when Pro enrollment is enabled.',
});
