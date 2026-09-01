/**
 * #1259 T1 — the CLOSED attribution vocabulary for checkout return.
 *
 * The checkout return path reads its attribution from the URL query, which is entirely visitor
 * controlled: `?checkout=success&conversion_source=<anything>` put arbitrary caller text into a
 * governed event. A `slug` rule constrains the SHAPE of that text and not its ORIGIN, so any
 * slug-shaped string was accepted and stored.
 *
 * This module is the single place the legitimate values are written down, so the producer that closes
 * an inbound value and the allowlist that validates the outbound event cannot drift apart.
 *
 * It is deliberately dependency-free. Declaring these inside `conversionFunnel` would import
 * `AnalyticsBuffer` into `telemetryAllowlist`, which `AnalyticsBuffer` itself imports — a cycle.
 */

/** Every CTA that may legitimately originate a checkout. */
export const CONVERSION_SOURCES = Object.freeze([
    'hero_primary',
    'landing_cta',
    'pricing_free_card',
    'pricing_pro_card',
    'nav_upgrade',
    'analytics_overview_banner',
    'analytics_empty_state',
    'limit_modal',
    'post_session_prompt',
    'free_plan_support',
] as const);

export type ConversionSource = typeof CONVERSION_SOURCES[number];

/** The only two utm sources this product emits (see `getUpgradeUrl`). */
export const UTM_SOURCES = Object.freeze(['app_cta', 'app_support'] as const);

/** `utm_medium` is always a conversion source. */
export const UTM_MEDIUMS = CONVERSION_SOURCES;

/** The only campaign this product emits. */
export const UTM_CAMPAIGNS = Object.freeze(['upgrade'] as const);

/**
 * The value recorded when the inbound query said something we did not emit.
 *
 * `unknown` is a real answer: it says the return could not be attributed. Passing the raw value
 * through would let a visitor write their own text into the funnel.
 */
export const ATTRIBUTION_UNKNOWN = 'unknown';

/** Members of the closed vocabulary, plus the honest `unknown`. */
export const closedWith = (values: readonly string[]): readonly string[] =>
    Object.freeze([...values, ATTRIBUTION_UNKNOWN]);

/**
 * Collapse an untrusted inbound value to the closed vocabulary.
 *
 * Anything we did not emit becomes `unknown` rather than being echoed back into telemetry.
 */
export function closeAttribution(
    raw: string | null | undefined,
    allowed: readonly string[],
): string {
    if (typeof raw !== 'string') return ATTRIBUTION_UNKNOWN;
    const v = raw.trim();
    return allowed.includes(v) ? v : ATTRIBUTION_UNKNOWN;
}
