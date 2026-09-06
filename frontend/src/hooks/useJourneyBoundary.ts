import { useEffect, useRef } from 'react';
import { beginJourney } from '@/services/telemetry/journeyIdentity';

/** The product surfaces. Entering any of them from outside them starts a journey. */
const PRODUCT_PREFIXES = ['/session', '/practice', '/analytics'] as const;

export const isProductRoute = (pathname: string): boolean =>
    PRODUCT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

/**
 * #1259 — start a new journey when the user ENTERS a product.
 *
 * `beginJourney()` had no production caller at all; only tests invoked it. A journey was therefore minted
 * lazily on first use and never replaced, so a tab that left a product and later came back reported both
 * visits under one `journey_id`, with `attempt_seq` and the initialisation ordinals continuing across
 * them. Every correlation boundary the experiment receipts depend on was one visit wide at best.
 *
 * Entering is the boundary, not every route change: moving from a session to Analytics and back is ONE
 * journey, and splitting it would hide exactly the post-session navigation the journey events exist to
 * describe. So a journey begins only on a transition from a non-product route into a product route —
 * including the first render, when there is no previous route to compare against.
 */
export function useJourneyBoundary(pathname: string): void {
    // `null` on the first render so entering a product directly by URL still counts as an entry.
    const previousPathRef = useRef<string | null>(null);

    useEffect(() => {
        const previous = previousPathRef.current;
        previousPathRef.current = pathname;
        const enteringProduct = isProductRoute(pathname);
        const wasInProduct = previous !== null && isProductRoute(previous);
        if (enteringProduct && !wasInProduct) beginJourney();
    }, [pathname]);
}
