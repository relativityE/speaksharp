import * as React from 'react';
import { useLocation } from 'react-router-dom';
import { emitJourneyStep } from '@/services/telemetry/journeyStep';
import { useSessionStore } from '@/stores/useSessionStore';

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

    React.useEffect(() => {
        const to = location.pathname;
        const from = previous.current;
        previous.current = to;
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
