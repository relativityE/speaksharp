import * as React from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { emitJourneyStep } from '@/services/telemetry/journeyStep';
import { ensureJourneyBoundary } from '@/hooks/useJourneyBoundary';
import { useSessionStore } from '@/stores/useSessionStore';
import { practiceArrivalRoute, trackSavedReviewPracticeArrived } from '@/services/reviewSurfaceTelemetry';

/**
 * #1259 F08 — route transitions, so a journey has a shape.
 *
 * The finding is that a finished session leaves the user with nowhere obvious to go. Proving that
 * needs the moves the user actually made — including the detours through Home that a dead end
 * produces — and today no event records a route at all. `practice_mode_selected` says which product
 * was chosen and nothing about where anyone went afterwards.
 *
 * Mounted inside the Router, beside the routes rather than in a page, because a page-level hook only
 * sees the routes that page owns and would miss precisely the wandering this is meant to capture.
 *
 * Transitions ONLY. The first render establishes a starting point without emitting: a mount is not a
 * navigation, and reporting one would put a phantom move at the head of every journey.
 */
export function JourneyRouteTelemetry(): null {
    const location = useLocation();
    const previous = React.useRef<string | null>(null);

    // #1258 (Codex r4191751371): a location reached by a saved-review practice press carries that press's
    // `action_seq` in router state. Emit its arrival once per history entry, with the closed class of where it landed.
    // ONLY for the press's own PUSH/REPLACE: Back/Forward or a reload (POP) restores an OLD entry's state, and replaying
    // its arrival could pair a later press that reuses the number (numbers reset on remount) — a false PASS.
    // DECLARED FIRST (Codex r4196394184): effects run in order, so the arrival is emitted BEFORE `ensureJourneyBoundary`
    // below mints the product journey — it lands in the PRESS's journey as that press's terminal outcome, where the
    // readback pairs them. `route_change` stays the first event of the new journey (#1421 P1 unchanged).
    const navigationType = useNavigationType();
    const arrived = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (navigationType === 'POP') return;
        const seq = (location.state as { practiceActionSeq?: unknown } | null)?.practiceActionSeq;
        if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1 || seq > 100) return;
        if (arrived.current === location.key) return;
        arrived.current = location.key;
        trackSavedReviewPracticeArrived(seq, practiceArrivalRoute(location.pathname, location.search));
    }, [navigationType, location.key, location.state, location.pathname, location.search]);

    React.useEffect(() => {
        const to = location.pathname;
        const from = previous.current;
        previous.current = to;

        // #1259 P1 — the boundary is established BEFORE this event is emitted, not by an ancestor
        // effect that React runs afterwards. Entering a product is a new journey, and the event that
        // names the entry must be the first event inside it rather than the last event of the one
        // being left. Idempotent: if the ancestor got there first this does nothing.
        ensureJourneyBoundary(to);

        if (from === null || from === to) return;
        emitJourneyStep({
            step: 'route_change',
            fromRoute: from,
            toRoute: to,
            // What the runtime was doing on arrival. A route that lands while the engine is still
            // INITIATING is a different user experience from one that lands on READY, and F03's
            // "downloads a model and then waits" is exactly that distinction.
            runtimeStateOnArrival: useSessionStore.getState().runtimeState ?? null,
        });
    }, [location.pathname]);

    return null;
}
