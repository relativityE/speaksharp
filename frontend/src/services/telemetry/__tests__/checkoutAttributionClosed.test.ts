/**
 * #1259 T1 — CHECKOUT RETURN ATTRIBUTION IS VISITOR-CONTROLLED INPUT.
 *
 * `useCheckoutNotifications` reads `conversion_source` and the `utm_*` fields straight off the URL
 * query. The allowlist rule was `slug()`, which constrains the SHAPE of a value and not its ORIGIN, so
 * `?checkout=success&conversion_source=<any-slug>` wrote arbitrary caller text into a governed event
 * and `?? 'unknown'` only ever defended against a MISSING parameter.
 *
 * Two independent defences, and both are asserted here: the producer collapses anything we did not
 * emit to `unknown`, and the seam's rule refuses it even if a producer stopped collapsing.
 */
import { describe, it, expect } from 'vitest';
import {
    CONVERSION_SOURCES, UTM_SOURCES, UTM_MEDIUMS, UTM_CAMPAIGNS,
    closeAttribution, closedWith, ATTRIBUTION_UNKNOWN,
} from '../../conversionVocabulary';
import { projectEventProps } from '../../telemetryAllowlist';

describe('the producer closes inbound checkout attribution', () => {
    it('CASUALTY: a slug-shaped value we never emitted becomes unknown', () => {
        expect(closeAttribution('attacker_controlled', CONVERSION_SOURCES)).toBe(ATTRIBUTION_UNKNOWN);
        expect(closeAttribution('promo_2026_blast', CONVERSION_SOURCES)).toBe(ATTRIBUTION_UNKNOWN);
    });

    it('POSITIVE CONTROL: every value the product actually emits survives', () => {
        for (const s of CONVERSION_SOURCES) expect(closeAttribution(s, CONVERSION_SOURCES)).toBe(s);
        for (const s of UTM_SOURCES) expect(closeAttribution(s, UTM_SOURCES)).toBe(s);
        for (const s of UTM_MEDIUMS) expect(closeAttribution(s, UTM_MEDIUMS)).toBe(s);
        for (const s of UTM_CAMPAIGNS) expect(closeAttribution(s, UTM_CAMPAIGNS)).toBe(s);
    });

    it('a missing parameter is unknown, same as an unrecognised one', () => {
        expect(closeAttribution(null, CONVERSION_SOURCES)).toBe(ATTRIBUTION_UNKNOWN);
        expect(closeAttribution(undefined, CONVERSION_SOURCES)).toBe(ATTRIBUTION_UNKNOWN);
    });

    it('unknown is itself an accepted value — an unattributable return is still recordable', () => {
        expect(closedWith(CONVERSION_SOURCES)).toContain(ATTRIBUTION_UNKNOWN);
    });
});

describe('the seam refuses arbitrary checkout attribution independently of the producer', () => {
    it('CASUALTY: an un-collapsed slug is DROPPED at the allowlist', () => {
        const { props, dropped } = projectEventProps('checkout_returned_success', {
            conversion_source: 'attacker_controlled',
            utm_source: 'attacker_controlled',
            utm_medium: 'attacker_controlled',
            utm_campaign: 'attacker_controlled',
        });
        expect(props.conversion_source).toBeUndefined();
        expect(props.utm_source).toBeUndefined();
        expect(props.utm_medium).toBeUndefined();
        expect(props.utm_campaign).toBeUndefined();
        // NON-VACUITY: these must be dropped BY RULE. Asserting only on absence would pass just as
        // happily if the event carried no allowlist at all.
        expect(dropped.sort()).toEqual(
            ['conversion_source', 'utm_campaign', 'utm_medium', 'utm_source'],
        );
    });

    it('POSITIVE CONTROL: legitimate attribution passes the seam intact', () => {
        const { props, dropped } = projectEventProps('checkout_returned_success', {
            conversion_source: 'limit_modal',
            utm_source: 'app_cta',
            utm_medium: 'limit_modal',
            utm_campaign: 'upgrade',
        });
        expect(dropped).toEqual([]);
        expect(props.conversion_source).toBe('limit_modal');
        expect(props.utm_source).toBe('app_cta');
        expect(props.utm_medium).toBe('limit_modal');
        expect(props.utm_campaign).toBe('upgrade');
    });
});
