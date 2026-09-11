import { useEffect } from 'react';
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
 *
 * #1259 P1 — WHY THE PREVIOUS ROUTE IS MODULE STATE AND NOT A REF.
 *
 * It was a `useRef` inside this hook, and the hook runs in App while the route event is emitted by
 * `JourneyRouteTelemetry`, a DESCENDANT. React flushes descendant passive effects before ancestor ones,
 * so on every cached re-entry into a product the entry `route_change` was captured under the OUTGOING
 * journey and only then did App mint the new id for everything after it. The one event that names the
 * transition sat on the wrong side of the boundary it describes.
 *
 * Making the boundary a module-level, idempotent function fixes the ordering rather than betting on it:
 * whichever of the two runs first establishes the journey, and the other becomes a no-op. The emitter
 * calls it immediately before emitting, so the entry event cannot precede its own journey.
 */
let previousPath: string | null = null;

/**
 * Establish the journey boundary for `pathname`. Safe to call from anywhere, any number of times: only
 * a genuine non-product -> product transition begins a journey, and the first caller for a given
 * navigation consumes it.
 */
export function ensureJourneyBoundary(pathname: string): void {
    const previous = previousPath;
    if (previous === pathname) return;
    previousPath = pathname;
    const enteringProduct = isProductRoute(pathname);
    const wasInProduct = previous !== null && isProductRoute(previous);
    if (enteringProduct && !wasInProduct) beginJourney();
}

/** Test seam only. Production never resets the boundary except by navigating. */
export function __resetJourneyBoundaryForTests(): void {
    previousPath = null;
}

export function useJourneyBoundary(pathname: string): void {
    useEffect(() => {
        ensureJourneyBoundary(pathname);
    }, [pathname]);
}
