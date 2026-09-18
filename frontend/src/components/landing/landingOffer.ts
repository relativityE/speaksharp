/**
 * #1475 G12 Rev 2 — the homepage's offer and hero strings.
 *
 * Rev 2 §5.1: the hero states the terms in full, at reading size, directly under the CTA. Rev 2 §0.2 sets the hero
 * line and keeps the repository badge. The closing band carries the post-trial price because the #1470 acceptance
 * (binding on #1475) requires it; Rev 2 §5.1 disagrees, and that conflict is ruling B on the issue.
 */
export const HERO_BADGE = 'Complete product free for 30 days';
export const HERO_LINE = 'Speak. See what to fix. Say it again. Your audio never leaves the browser.';

/** Two terms lines under the hero CTA: the trial, then the price in the money role. */
export const HERO_TERMS_TRIAL = '30 days free, no card.';
export const HERO_TERMS_PRICE = 'Then $10/month. Cancel any time.';

/** Closing band: the repository's closing sentence, with the post-trial price #1470 requires. */
export const CLOSING_OFFER = 'Start the complete product free for 30 days. Then $10/month. Your recordings stay Private on this device.';

/** The repository's signed-out signup destination (see the `/auth/signup` route in App.tsx). */
export const LANDING_SIGNUP_ROUTE = '/auth/signup';
