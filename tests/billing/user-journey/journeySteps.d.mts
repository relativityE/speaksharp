export declare const BILLING_JOURNEYS: readonly ['conversion', 'renewal_recovery', 'portal_expiry'];
export type BillingJourney = typeof BILLING_JOURNEYS[number];
export declare const REQUIRED_STEPS: Readonly<Record<BillingJourney, readonly string[]>>;
